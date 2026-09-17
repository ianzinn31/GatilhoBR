(function installBet365MarketStateCache() {
  'use strict';

  // Este arquivo é carregado no MAIN world em document_start. Ele continua
  // somente leitura: nenhum frame é alterado, nada é enviado pelo socket e
  // nenhum payload cru, header, token ou cookie sai daqui. A diferença em
  // relação ao observador anterior é o destino do que foi lido: além do
  // resumo publicado para a ponte isolada, o frame alimenta um cache de
  // estado de mercado em memória, consultável de forma síncrona.
  if (typeof window === 'undefined' || window.__gbrNetworkFeedMainBooted === true) return;
  window.__gbrNetworkFeedMainBooted = true;

  const PARSER_VERSION = 2;
  const MAX_ID_LENGTH = 96;
  // Teto do resumo publicado por frame; mantido igual ao contrato v1 que o
  // content.js e o service worker já validam.
  const MAX_RECORDS = 32;
  // Teto do cache. Uma sessão longa vê milhares de seleções; sem teto o Map
  // cresceria junto com o tempo de aba aberta.
  const MAX_ENTRIES = 4096;
  const ENTRY_TTL_MS = 300_000;
  const SWEEP_INTERVAL_MS = 5_000;
  const MAX_FRAME_BYTES = 2_000_000;
  // Diagnóstico frio para mudanças de protocolo: somente os primeiros frames
  // sem registro reconhecido, sem valores completos. Depois do teto, não há
  // mais custo de coleta nesta sessão.
  const MAX_PROTOCOL_PROBES = 8;
  const MAX_PROTOCOL_KEYS = 24;
  const MAX_PROTOCOL_PREFIX_CODES = 96;
  // Memo de ids recém-vistos. Frames chegam em rajadas repetindo os mesmos
  // ids, então comparar contra as últimas strings evita fatiar de novo.
  const INTERN_RING = 16;
  // A grade React moderna não expõe a identidade da seleção em atributos HTML.
  // A própria Bet365, porém, entrega ao componente clicável um `stem` cujo
  // `data.ID` é usado pelo ParticipantClickDelegate oficial. A leitura abaixo é
  // feita somente na interação explícita do usuário e nunca procura por texto,
  // posição ou odd semelhante.
  const MODERN_PARTICIPANT_SELECTOR = '[class*="rgl-43895c"]';
  const MODERN_ODDS_SELECTOR = '[class*="rgl-4a5de5"]';
  const MAX_REACT_FIBER_WALK = 12;
  const MAX_REACT_DOM_WALK = 3;
  const STEM_INTERACTION_DEDUPE_MS = 250;

  const KIND_SELECTION = 1;
  const KIND_MARKET = 2;

  const F_NONE = 0;
  const F_SELECTION = 1;
  const F_MARKET = 2;
  const F_EVENT = 3;
  const F_ODDS = 4;
  const F_SUSPENDED = 5;
  const F_LINE_VERSION = 6;

  const ORIGINAL_WEBSOCKET = window.WebSocket;
  const perf = window.performance;
  const monotonicNow = perf && typeof perf.now === 'function'
    ? () => perf.now()
    : () => Date.now();

  let enabled = window.__GBR_NETWORK_FEED_ENABLED === true;
  let observationsEnabled = true;
  let stopObserver = null;

  // =======================================================================
  // ESTADO EM MEMÓRIA
  // =======================================================================

  // Map<string, MarketState>. A chave é o selectionId quando o registro tem
  // identidade de seleção e o marketId quando o registro é do mercado inteiro
  // (suspensão/versão de linha valendo para todas as seleções dele).
  const entries = new Map();

  // Estado do scanner mantido no módulo, não em objetos por frame. O laço de
  // mensagens é single-thread e não há await aqui dentro, então um frame nunca
  // começa antes de o anterior terminar — reaproveitar estas variáveis remove
  // a alocação de um objeto de contexto por frame.
  let scanSrc = null;
  let scanIsText = false;
  let scanLength = 0;
  // Contexto "grudento": mercado e evento aparecem uma vez e valem para as
  // seleções seguintes do mesmo frame.
  let ctxMarketStart = -1;
  let ctxMarketEnd = -1;
  let ctxEventStart = -1;
  let ctxEventEnd = -1;
  // Registro em construção (nível de seleção).
  let recSelectionStart = -1;
  let recSelectionEnd = -1;
  let recOdds = NaN;
  let recSuspended = -1;
  let recLineVersion = NaN;

  let lastSweepAt = 0;

  const stats = {
    frames: 0,
    textFrames: 0,
    binaryFrames: 0,
    unreadableFrames: 0,
    oversizedFrames: 0,
    upserts: 0,
    seedUpserts: 0,
    stemCaptures: 0,
    stemCaptureMisses: 0,
    lastStemCaptureAt: 0,
    evictions: 0,
    observationsPublished: 0,
    lookupHits: 0,
    lookupMisses: 0,
    lastFrameAt: 0,
    lastScanMs: 0,
    maxScanMs: 0,
    totalScanMs: 0,
  };
  const protocolProbes = [];

  // =======================================================================
  // LEITURA DE CARACTERES SEM ALOCAR
  // =======================================================================

  // A fonte é a própria string do frame ou uma view Uint8Array sobre o
  // ArrayBuffer recebido (view, não cópia). Todo o parser trabalha sobre
  // índices desta fonte e só materializa string para ids.
  function codeAt(index) {
    return scanIsText ? scanSrc.charCodeAt(index) : scanSrc[index];
  }

  function isKeyStart(code) {
    return (code >= 97 && code <= 122) || (code >= 65 && code <= 90) || code === 95;
  }

  function isKeyChar(code) {
    return isKeyStart(code) || (code >= 48 && code <= 57);
  }

  // Fim de valor não citado. A barra fica de fora porque odd fracionária da
  // casa chega como `5/2`.
  function isValueEnd(code) {
    return (
      code === 34 || code === 39 || code === 44 || code === 58 || code === 59 ||
      code === 123 || code === 125 || code === 91 || code === 93 || code === 124 ||
      code === 32 || code === 9 || code === 10 || code === 13 ||
      code === 0 || code === 1 || code === 2 || code === 3
    );
  }

  // Fronteira dura de registro: fim de objeto JSON e separadores do protocolo
  // delimitado da casa.
  function isRecordEnd(code) {
    return code === 125 || code === 1 || code === 124;
  }

  function tokenEquals(start, end, lowerCase) {
    if (end - start !== lowerCase.length) return false;
    for (let i = 0; i < lowerCase.length; i += 1) {
      let code = codeAt(start + i);
      if (code >= 65 && code <= 90) code += 32;
      if (code !== lowerCase.charCodeAt(i)) return false;
    }
    return true;
  }

  function tokenEqualsToken(aStart, aEnd, bStart, bEnd) {
    if (aEnd - aStart !== bEnd - bStart) return false;
    for (let i = 0; i < aEnd - aStart; i += 1) {
      if (codeAt(aStart + i) !== codeAt(bStart + i)) return false;
    }
    return true;
  }

  function tokenEqualsString(start, text) {
    for (let i = 0; i < text.length; i += 1) {
      if (codeAt(start + i) !== text.charCodeAt(i)) return false;
    }
    return true;
  }

  const byteScratch = [];

  function sliceToken(start, end) {
    if (scanIsText) return scanSrc.slice(start, end);
    // Ids de frame binário são ASCII (numéricos ou alfanuméricos). Montamos a
    // string a partir dos bytes sem passar por TextDecoder, que copiaria o
    // frame inteiro só para ler alguns caracteres.
    const length = end - start;
    byteScratch.length = length;
    for (let i = 0; i < length; i += 1) byteScratch[i] = scanSrc[start + i];
    return String.fromCharCode.apply(null, byteScratch);
  }

  const internRing = new Array(INTERN_RING).fill('');
  let internCursor = 0;

  // Devolve a string do id reaproveitando a referência já usada como chave do
  // Map quando ela está no memo. Isso evita fatiar a mesma string a cada tique
  // e faz o `entries.get` cair em uma string com hash já calculado.
  function internToken(start, end) {
    const length = end - start;
    if (length <= 0 || length > MAX_ID_LENGTH) return '';
    for (let i = 0; i < INTERN_RING; i += 1) {
      const cached = internRing[i];
      if (cached.length === length && tokenEqualsString(start, cached)) return cached;
    }
    const text = sliceToken(start, end);
    internRing[internCursor] = text;
    internCursor = internCursor + 1 >= INTERN_RING ? 0 : internCursor + 1;
    return text;
  }

  // =======================================================================
  // TABELA DE CHAVES
  // =======================================================================

  // O parser é genérico de propósito: atende o JSON (`"selectionId":123`) e o
  // protocolo delimitado da casa (`IT=123;OD=5/2;SU=1`) com a mesma varredura.
  // O switch por tamanho deixa cada token em poucas comparações de inteiro.
  // `value` ficou fora da lista de odds do parser v1: é genérico demais e
  // produzia registro falso em qualquer objeto do frame.
  function classifyKey(start, end) {
    switch (end - start) {
      case 2:
        if (tokenEquals(start, end, 'it') || tokenEquals(start, end, 'id')) return F_SELECTION;
        if (tokenEquals(start, end, 'od')) return F_ODDS;
        if (tokenEquals(start, end, 'su')) return F_SUSPENDED;
        if (tokenEquals(start, end, 'mi')) return F_MARKET;
        if (tokenEquals(start, end, 'ev') || tokenEquals(start, end, 'fi')) return F_EVENT;
        if (tokenEquals(start, end, 'lv')) return F_LINE_VERSION;
        return F_NONE;
      case 3:
        if (tokenEquals(start, end, 'odd') || tokenEquals(start, end, 'ltp')) return F_ODDS;
        return F_NONE;
      case 4:
        if (tokenEquals(start, end, 'odds')) return F_ODDS;
        return F_NONE;
      case 5:
        if (tokenEquals(start, end, 'price')) return F_ODDS;
        if (tokenEquals(start, end, 'event')) return F_EVENT;
        return F_NONE;
      case 6:
        if (tokenEquals(start, end, 'market')) return F_MARKET;
        if (tokenEquals(start, end, 'status') || tokenEquals(start, end, 'closed')) return F_SUSPENDED;
        return F_NONE;
      case 7:
        if (tokenEquals(start, end, 'eventid')) return F_EVENT;
        if (tokenEquals(start, end, 'version')) return F_LINE_VERSION;
        return F_NONE;
      case 8:
        if (tokenEquals(start, end, 'marketid')) return F_MARKET;
        if (tokenEquals(start, end, 'event_id')) return F_EVENT;
        if (tokenEquals(start, end, 'isclosed')) return F_SUSPENDED;
        return F_NONE;
      case 9:
        if (tokenEquals(start, end, 'outcomeid')) return F_SELECTION;
        if (tokenEquals(start, end, 'market_id')) return F_MARKET;
        if (tokenEquals(start, end, 'suspended')) return F_SUSPENDED;
        return F_NONE;
      case 10:
        if (tokenEquals(start, end, 'outcome_id')) return F_SELECTION;
        return F_NONE;
      case 11:
        if (tokenEquals(start, end, 'selectionid')) return F_SELECTION;
        if (tokenEquals(start, end, 'issuspended')) return F_SUSPENDED;
        if (tokenEquals(start, end, 'decimalodds')) return F_ODDS;
        if (tokenEquals(start, end, 'lineversion')) return F_LINE_VERSION;
        return F_NONE;
      case 12:
        if (tokenEquals(start, end, 'selection_id')) return F_SELECTION;
        if (tokenEquals(start, end, 'line_version')) return F_LINE_VERSION;
        return F_NONE;
      default:
        return F_NONE;
    }
  }

  // =======================================================================
  // VALORES
  // =======================================================================

  // Converte dígitos direto de códigos de caractere. `Number(text.slice(...))`
  // criaria uma string curta por campo lido, em todo frame.
  function parseNumberToken(start, end) {
    if (end <= start) return NaN;
    let index = start;
    let sign = 1;
    const first = codeAt(index);
    if (first === 45) {
      sign = -1;
      index += 1;
    } else if (first === 43) {
      index += 1;
    }

    let value = 0;
    let digits = 0;
    while (index < end) {
      const code = codeAt(index);
      if (code < 48 || code > 57) break;
      value = value * 10 + (code - 48);
      digits += 1;
      index += 1;
    }

    // Aceita ponto e vírgula decimal: valor citado pode chegar como "1,85".
    if (index < end && (codeAt(index) === 46 || codeAt(index) === 44)) {
      index += 1;
      let scale = 1;
      while (index < end) {
        const code = codeAt(index);
        if (code < 48 || code > 57) break;
        value = value * 10 + (code - 48);
        scale *= 10;
        digits += 1;
        index += 1;
      }
      if (index !== end || digits === 0) return NaN;
      return (sign * value) / scale;
    }

    if (index !== end || digits === 0) return NaN;
    return sign * value;
  }

  function parseOddsToken(start, end) {
    // `EVS`/`EVEN` é a fracionária 1/1 da casa.
    if (tokenEquals(start, end, 'evs') || tokenEquals(start, end, 'even')) return 2;

    let slash = -1;
    for (let index = start; index < end; index += 1) {
      if (codeAt(index) === 47) {
        slash = index;
        break;
      }
    }

    if (slash < 0) {
      const decimal = parseNumberToken(start, end);
      return decimal > 0 ? decimal : NaN;
    }

    // Fracionária é lucro sobre a aposta, então a decimal equivalente é
    // numerador/denominador + 1 (`5/2` vira 3.5).
    const numerator = parseNumberToken(start, slash);
    const denominator = parseNumberToken(slash + 1, end);
    if (!(numerator >= 0) || !(denominator > 0)) return NaN;
    return numerator / denominator + 1;
  }

  // Devolve 1 (suspenso), 0 (aberto) ou -1 (não informado neste campo).
  function parseSuspendedToken(start, end) {
    if (end - start === 1) {
      const code = codeAt(start);
      if (code === 49) return 1;
      if (code === 48) return 0;
      return -1;
    }
    if (
      tokenEquals(start, end, 'true') ||
      tokenEquals(start, end, 'susp') ||
      tokenEquals(start, end, 'closed') ||
      tokenEquals(start, end, 'locked') ||
      tokenEquals(start, end, 'inactive') ||
      tokenEquals(start, end, 'suspended') ||
      tokenEquals(start, end, 'unavailable')
    ) return 1;
    if (
      tokenEquals(start, end, 'false') ||
      tokenEquals(start, end, 'open') ||
      tokenEquals(start, end, 'active') ||
      tokenEquals(start, end, 'available')
    ) return 0;
    return -1;
  }

  // =======================================================================
  // CACHE
  // =======================================================================

  // Toda entrada nasce com o mesmo conjunto de campos e nunca ganha campo
  // novo depois. O objeto é criado uma vez por id e reescrito no lugar a cada
  // frame — a taxa de alocação do cache é o número de ids distintos da sessão,
  // não o número de frames.
  function createEntry(key, kind) {
    return {
      key,
      kind,
      selectionId: kind === KIND_SELECTION ? key : '',
      marketId: kind === KIND_MARKET ? key : '',
      eventId: '',
      odds: null,
      suspended: null,
      lineVersion: null,
      updatedAt: 0,
      updatedAtEpoch: 0,
      oddsChangedAt: 0,
      suspendedChangedAt: 0,
      revision: 0,
    };
  }

  function evict(nowMonotonic) {
    // Varredura por idade é amortizada: só roda quando o cache passou do teto
    // e no máximo uma vez por janela.
    if (nowMonotonic - lastSweepAt >= SWEEP_INTERVAL_MS) {
      lastSweepAt = nowMonotonic;
      for (const [key, entry] of entries) {
        if (nowMonotonic - entry.updatedAt > ENTRY_TTL_MS) {
          entries.delete(key);
          stats.evictions += 1;
        }
      }
    }
    // Se a varredura não bastou, cai para ordem de inserção.
    while (entries.size > MAX_ENTRIES) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) break;
      entries.delete(oldest);
      stats.evictions += 1;
    }
  }

  function upsert(key, kind, nowMonotonic, nowEpoch) {
    if (!key) return;

    let entry = entries.get(key);
    if (entry === undefined) {
      entry = createEntry(key, kind);
      entries.set(key, entry);
      if (entries.size > MAX_ENTRIES) evict(nowMonotonic);
    }

    // Campo ausente no registro não apaga o que já era conhecido: o cache
    // guarda o estado mais recente de cada campo, não o último frame.
    if (recOdds === recOdds && entry.odds !== recOdds) {
      entry.odds = recOdds;
      entry.oddsChangedAt = nowMonotonic;
    }
    if (recSuspended >= 0) {
      const suspended = recSuspended === 1;
      if (entry.suspended !== suspended) {
        entry.suspended = suspended;
        entry.suspendedChangedAt = nowMonotonic;
      }
    }
    if (recLineVersion === recLineVersion) entry.lineVersion = recLineVersion;
    if (kind === KIND_SELECTION && ctxMarketStart >= 0) {
      entry.marketId = internToken(ctxMarketStart, ctxMarketEnd);
    }
    if (ctxEventStart >= 0) entry.eventId = internToken(ctxEventStart, ctxEventEnd);

    entry.updatedAt = nowMonotonic;
    entry.updatedAtEpoch = nowEpoch;
    entry.revision += 1;
    stats.upserts += 1;

    if (observationsEnabled) pushObservationRecord(entry);
  }

  function normalizeSeedId(value) {
    if (typeof value !== 'string' && typeof value !== 'number') return '';
    const text = String(value).trim();
    if (text.length < 2 || text.length > MAX_ID_LENGTH) return '';
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      const valid =
        (code >= 48 && code <= 57) ||
        (code >= 65 && code <= 90) ||
        (code >= 97 && code <= 122) ||
        code === 45 || code === 46 || code === 58 || code === 95;
      if (!valid) return '';
    }
    return text;
  }

  // Fallback para a versão atual da Bet365, cujo socket da janela principal
  // carrega só controle/heartbeat. A célula real acionada pelo usuário fornece
  // id, odd e disponibilidade; o MAIN guarda isso por poucos milissegundos e o
  // despachante aplica o mesmo TTL/guardas do estado vindo do feed.
  function seedSelectionState(raw) {
    if (!enabled || raw === null || typeof raw !== 'object') return false;
    const selectionId = normalizeSeedId(raw.selectionId);
    const odds = Number(raw.odds);
    if (!selectionId || !Number.isFinite(odds) || odds <= 1) return false;
    if (typeof raw.suspended !== 'boolean') return false;

    const nowMonotonic = monotonicNow();
    const nowEpoch = Date.now();
    let entry = entries.get(selectionId);
    if (entry === undefined) {
      entry = createEntry(selectionId, KIND_SELECTION);
      entries.set(selectionId, entry);
      if (entries.size > MAX_ENTRIES) evict(nowMonotonic);
    }

    const marketId = normalizeSeedId(raw.marketId);
    const eventId = normalizeSeedId(raw.eventId);
    if (marketId) entry.marketId = marketId;
    if (eventId) entry.eventId = eventId;
    if (entry.odds !== odds) {
      entry.odds = odds;
      entry.oddsChangedAt = nowMonotonic;
    }
    if (entry.suspended !== raw.suspended) {
      entry.suspended = raw.suspended;
      entry.suspendedChangedAt = nowMonotonic;
    }
    entry.updatedAt = nowMonotonic;
    entry.updatedAtEpoch = nowEpoch;
    entry.revision += 1;
    stats.upserts += 1;
    stats.seedUpserts += 1;
    return true;
  }

  function classText(element) {
    if (!element) return '';
    if (typeof element.className === 'string') return element.className;
    return typeof element.className?.baseVal === 'string' ? element.className.baseVal : '';
  }

  function parseExplicitOddsText(value) {
    const text = typeof value === 'string' || typeof value === 'number'
      ? String(value).trim()
      : '';
    if (!text) return NaN;
    if (/^(?:EVS|EVEN)$/i.test(text)) return 2;

    const fractional = text.match(/^(\d{1,5})\s*\/\s*(\d{1,5})$/);
    if (fractional) {
      const numerator = Number(fractional[1]);
      const denominator = Number(fractional[2]);
      return denominator > 0 ? numerator / denominator + 1 : NaN;
    }

    if (!/^\d{1,5}(?:[.,]\d{1,4})?$/.test(text)) return NaN;
    const decimal = Number(text.replace(',', '.'));
    return Number.isFinite(decimal) && decimal > 1 ? decimal : NaN;
  }

  function readDisplayedParticipantOdds(element) {
    if (!element || typeof element.querySelector !== 'function') return NaN;
    try {
      const holder = element.querySelector(MODERN_ODDS_SELECTOR);
      return parseExplicitOddsText(holder?.textContent);
    } catch (error) {
      return NaN;
    }
  }

  function stemFromProps(props) {
    const stem = props?.stem;
    const data = stem?.data;
    return data && normalizeSeedId(data.ID) ? stem : null;
  }

  function stemFromFiber(fiber) {
    let current = fiber;
    let depth = 0;
    while (current && depth < MAX_REACT_FIBER_WALK) {
      const fromMemo = stemFromProps(current.memoizedProps);
      if (fromMemo) return fromMemo;
      const fromPending = stemFromProps(current.pendingProps);
      if (fromPending) return fromPending;
      current = current.return || null;
      depth += 1;
    }
    return null;
  }

  // React deixa a referência do fiber/props como propriedade própria do nó no
  // MAIN world. O prefixo é estável; o sufixo aleatório deliberadamente não é.
  function readParticipantStem(element) {
    let node = element;
    let domDepth = 0;
    while (node && domDepth < MAX_REACT_DOM_WALK) {
      let keys = [];
      try {
        keys = Object.getOwnPropertyNames(node);
      } catch (error) {
        return null;
      }
      for (const key of keys) {
        try {
          if (key.startsWith('__reactProps$')) {
            const stem = stemFromProps(node[key]);
            if (stem) return stem;
          }
          if (key.startsWith('__reactFiber$')) {
            const stem = stemFromFiber(node[key]);
            if (stem) return stem;
          }
        } catch (error) {}
      }
      node = node.parentElement || null;
      domDepth += 1;
    }
    return null;
  }

  function readStemEventId(stem) {
    let current = stem;
    let depth = 0;
    while (current && depth < 16) {
      const eventId = normalizeSeedId(current.data?.FI);
      if (eventId) return eventId;
      current = current.parent || null;
      depth += 1;
    }
    return '';
  }

  function readStemSuspended(stem, element) {
    let current = element;
    let depth = 0;
    while (current && depth < 5) {
      const classes = classText(current);
      try {
        if (
          current.disabled === true ||
          current.hasAttribute?.('disabled') ||
          current.getAttribute?.('aria-disabled') === 'true' ||
          /disabled|suspended|locked|rgl-d3e321/i.test(classes)
        ) return true;
      } catch (error) {
        return true;
      }
      current = current.parentElement || null;
      depth += 1;
    }

    // Contrato do BaseParticipant da própria casa: SU ausente/0 é aberto;
    // qualquer outro valor marca indisponibilidade.
    const value = stem?.data?.SU;
    if (value === undefined || value === null || value === '' || value === 0 || value === '0') {
      return false;
    }
    return true;
  }

  function extractStemSelection(element) {
    const stem = readParticipantStem(element);
    const selectionId = normalizeSeedId(stem?.data?.ID);
    if (!stem || !selectionId) return null;

    const displayedOdds = readDisplayedParticipantOdds(element);
    const stemOdds = parseExplicitOddsText(stem.data?.OD);
    if (!Number.isFinite(displayedOdds) || !Number.isFinite(stemOdds)) return null;
    // A identidade só vale para a célula acionada quando o preço que o usuário
    // vê concorda com o preço do mesmo stem. Divergência é repaint/race: falha.
    if (Math.abs(displayedOdds - stemOdds) > 0.011) return null;

    return {
      selectionId,
      marketId: normalizeSeedId(stem.parent?.parent?.data?.ID),
      eventId: readStemEventId(stem),
      odds: displayedOdds,
      suspended: readStemSuspended(stem, element),
    };
  }

  let lastStemInteraction = { element: null, at: 0, captured: false };

  function handleTrustedParticipantInteraction(event) {
    if (!enabled || event?.isTrusted !== true) return;
    const target = event.target;
    if (!target || typeof target.closest !== 'function') return;

    let element = null;
    try {
      element = target.closest(MODERN_PARTICIPANT_SELECTOR);
    } catch (error) {
      return;
    }
    if (!element || element.isConnected === false) return;

    const at = Date.now();
    if (
      lastStemInteraction.element === element &&
      lastStemInteraction.captured &&
      at - lastStemInteraction.at <= STEM_INTERACTION_DEDUPE_MS
    ) return;

    const state = extractStemSelection(element);
    if (!state || !seedSelectionState(state)) {
      stats.stemCaptureMisses += 1;
      lastStemInteraction = { element, at, captured: false };
      return;
    }

    stats.stemCaptures += 1;
    stats.lastStemCaptureAt = at;
    lastStemInteraction = { element, at, captured: true };
    window.postMessage(
      {
        type: 'GBR_DIRECT_SELECTION_OBSERVED',
        schemaVersion: 1,
        selection: { ...state, observedAt: at },
        interaction: {
          type: typeof event.type === 'string' ? event.type : '',
          timeStamp: Number(event.timeStamp),
        },
      },
      window.location.origin,
    );
  }

  let participantObserverInstalled = false;
  function installParticipantObserver() {
    const document = window.document;
    if (participantObserverInstalled || !document?.addEventListener) return;
    participantObserverInstalled = true;
    document.addEventListener('pointerdown', handleTrustedParticipantInteraction, {
      capture: true,
      passive: true,
    });
    document.addEventListener('click', handleTrustedParticipantInteraction, {
      capture: true,
      passive: true,
    });
    document.addEventListener('focusin', handleTrustedParticipantInteraction, true);
  }

  function removeParticipantObserver() {
    const document = window.document;
    if (!participantObserverInstalled || !document?.removeEventListener) return;
    document.removeEventListener('pointerdown', handleTrustedParticipantInteraction, true);
    document.removeEventListener('click', handleTrustedParticipantInteraction, true);
    document.removeEventListener('focusin', handleTrustedParticipantInteraction, true);
    participantObserverInstalled = false;
    lastStemInteraction = { element: null, at: 0, captured: false };
  }

  // Fecha o registro em construção. Mercado e evento continuam valendo para os
  // registros seguintes do frame; só o nível de seleção é zerado.
  function flushRecord(nowMonotonic, nowEpoch) {
    const hasValue = recOdds === recOdds || recSuspended >= 0 || recLineVersion === recLineVersion;
    if (hasValue) {
      if (recSelectionStart >= 0) {
        upsert(internToken(recSelectionStart, recSelectionEnd), KIND_SELECTION, nowMonotonic, nowEpoch);
      } else if (ctxMarketStart >= 0) {
        upsert(internToken(ctxMarketStart, ctxMarketEnd), KIND_MARKET, nowMonotonic, nowEpoch);
      }
    }
    recSelectionStart = -1;
    recSelectionEnd = -1;
    recOdds = NaN;
    recSuspended = -1;
    recLineVersion = NaN;
  }

  function applyField(field, start, end, nowMonotonic, nowEpoch) {
    switch (field) {
      case F_SELECTION: {
        if (end - start > MAX_ID_LENGTH) return;
        // Id de seleção diferente com registro em aberto: o anterior terminou.
        if (recSelectionStart >= 0 && !tokenEqualsToken(recSelectionStart, recSelectionEnd, start, end)) {
          flushRecord(nowMonotonic, nowEpoch);
        }
        recSelectionStart = start;
        recSelectionEnd = end;
        return;
      }
      case F_MARKET: {
        if (end - start > MAX_ID_LENGTH) return;
        if (ctxMarketStart >= 0 && !tokenEqualsToken(ctxMarketStart, ctxMarketEnd, start, end)) {
          flushRecord(nowMonotonic, nowEpoch);
        }
        ctxMarketStart = start;
        ctxMarketEnd = end;
        return;
      }
      case F_EVENT: {
        if (end - start > MAX_ID_LENGTH) return;
        ctxEventStart = start;
        ctxEventEnd = end;
        return;
      }
      case F_ODDS: {
        const odds = parseOddsToken(start, end);
        if (odds === odds) recOdds = odds;
        return;
      }
      case F_SUSPENDED: {
        const suspended = parseSuspendedToken(start, end);
        if (suspended >= 0) recSuspended = suspended;
        return;
      }
      case F_LINE_VERSION: {
        const lineVersion = parseNumberToken(start, end);
        if (lineVersion === lineVersion) recLineVersion = lineVersion;
        return;
      }
      default:
        return;
    }
  }

  // Varredura única do frame: um laço, sem JSON.parse, sem expressão regular,
  // sem array intermediário e sem closure por frame.
  function scanFrame(nowMonotonic, nowEpoch) {
    ctxMarketStart = -1;
    ctxMarketEnd = -1;
    ctxEventStart = -1;
    ctxEventEnd = -1;
    recSelectionStart = -1;
    recSelectionEnd = -1;
    recOdds = NaN;
    recSuspended = -1;
    recLineVersion = NaN;

    let index = 0;
    while (index < scanLength) {
      const code = codeAt(index);
      if (isRecordEnd(code)) {
        flushRecord(nowMonotonic, nowEpoch);
        index += 1;
        continue;
      }
      if (!isKeyStart(code)) {
        index += 1;
        continue;
      }

      const keyStart = index;
      index += 1;
      while (index < scanLength && isKeyChar(codeAt(index))) index += 1;
      const field = classifyKey(keyStart, index);
      if (field === F_NONE) continue;

      // Separador: `":` do JSON ou `=` do protocolo delimitado.
      let cursor = index;
      while (cursor < scanLength) {
        const between = codeAt(cursor);
        if (between === 34 || between === 39 || between === 32 || between === 9) {
          cursor += 1;
          continue;
        }
        break;
      }
      if (cursor >= scanLength) break;
      const separator = codeAt(cursor);
      if (separator !== 58 && separator !== 61) continue;
      cursor += 1;
      while (cursor < scanLength && (codeAt(cursor) === 32 || codeAt(cursor) === 9)) cursor += 1;

      let quoted = false;
      if (cursor < scanLength) {
        const opening = codeAt(cursor);
        if (opening === 34 || opening === 39) {
          quoted = true;
          cursor += 1;
        }
      }

      const valueStart = cursor;
      while (cursor < scanLength) {
        const value = codeAt(cursor);
        if (quoted ? value === 34 || value === 39 : isValueEnd(value)) break;
        cursor += 1;
      }
      const valueEnd = cursor;
      index = quoted && cursor < scanLength ? cursor + 1 : cursor;
      if (valueEnd > valueStart) applyField(field, valueStart, valueEnd, nowMonotonic, nowEpoch);
    }

    flushRecord(nowMonotonic, nowEpoch);
  }

  // =======================================================================
  // PONTE ISOLADA (CONTRATO v1 INALTERADO)
  // =======================================================================

  // Os registros publicados saem de um pool reaproveitado. O `postMessage`
  // clona o array na hora do envio, então mutar o pool depois é seguro e não
  // é preciso criar objeto novo por frame.
  const observationPool = [];
  const observationView = [];
  let observationCount = 0;

  function pushObservationRecord(entry) {
    if (observationCount >= MAX_RECORDS) return;
    let record = observationPool[observationCount];
    if (record === undefined) {
      record = { eventId: '', marketId: '', outcomeId: '', odds: null, suspended: null };
      observationPool[observationCount] = record;
    }
    record.eventId = entry.eventId;
    record.marketId = entry.marketId;
    record.outcomeId = entry.kind === KIND_SELECTION ? entry.selectionId : '';
    record.odds = entry.odds;
    record.suspended = entry.suspended;
    observationCount += 1;
  }

  // Continua publicando somente ids, odd, suspensão e timestamp. Frame sem
  // nenhum campo reconhecido não gera mais mensagem: o PoC mede antecipação
  // por registro correlacionado, e observação vazia só custava CPU e memória
  // no content script e no service worker.
  function publishObservation(size, nowEpoch) {
    if (observationCount === 0) return;
    observationView.length = 0;
    for (let index = 0; index < observationCount; index += 1) {
      observationView.push(observationPool[index]);
    }

    window.postMessage({
      type: 'GBR_BET365_WS_OBSERVATION',
      schemaVersion: 1,
      observation: {
        parserVersion: PARSER_VERSION,
        source: 'bet365',
        kind: 'websocket_message',
        receivedAt: nowEpoch,
        size,
        parseable: true,
        records: observationView,
      },
    }, window.location.origin);
    stats.observationsPublished += 1;
  }

  // =======================================================================
  // FRAME
  // =======================================================================

  function handleFrame(data) {
    if (!enabled) return;

    const nowMonotonic = monotonicNow();
    const nowEpoch = Date.now();
    stats.frames += 1;
    stats.lastFrameAt = nowMonotonic;

    let size = 0;
    if (typeof data === 'string') {
      if (data.length > MAX_FRAME_BYTES) {
        stats.oversizedFrames += 1;
        return;
      }
      scanSrc = data;
      scanIsText = true;
      scanLength = data.length;
      size = data.length;
      stats.textFrames += 1;
    } else if (data instanceof ArrayBuffer) {
      if (data.byteLength > MAX_FRAME_BYTES) {
        stats.oversizedFrames += 1;
        return;
      }
      // View sobre o buffer que a página já recebeu: nenhuma cópia e nenhum
      // TextDecoder no caminho quente.
      scanSrc = new Uint8Array(data);
      scanIsText = false;
      scanLength = data.byteLength;
      size = data.byteLength;
      stats.binaryFrames += 1;
    } else if (ArrayBuffer.isView(data)) {
      if (data.byteLength > MAX_FRAME_BYTES) {
        stats.oversizedFrames += 1;
        return;
      }
      scanSrc = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      scanIsText = false;
      scanLength = data.byteLength;
      size = data.byteLength;
      stats.binaryFrames += 1;
    } else {
      // Blob só seria legível de forma assíncrona, o que anularia a premissa
      // de latência. `binaryType` pertence à página e não é alterado aqui.
      stats.unreadableFrames += 1;
      return;
    }

    observationCount = 0;
    scanFrame(nowMonotonic, nowEpoch);
    if (observationCount === 0) collectProtocolProbe(size);
    if (observationsEnabled) publishObservation(size, nowEpoch);
    // Não segurar referência ao frame depois da varredura.
    scanSrc = null;
    scanLength = 0;

    const scanMs = monotonicNow() - nowMonotonic;
    stats.lastScanMs = scanMs;
    stats.totalScanMs += scanMs;
    if (scanMs > stats.maxScanMs) stats.maxScanMs = scanMs;
  }

  // =======================================================================
  // CONSULTA SÍNCRONA
  // =======================================================================

  function normalizeKey(id) {
    if (typeof id === 'string') return id;
    if (typeof id === 'number') return Number.isFinite(id) ? String(id) : '';
    if (id === null || id === undefined) return '';
    return String(id);
  }

  // Devolve uma cópia rasa: o objeto interno é reescrito no próximo frame e
  // não pode vazar para o chamador. É uma alocação por consulta — não por
  // frame — e a leitura em si é um `Map.get`.
  function getLatestMarketState(id) {
    const entry = entries.get(normalizeKey(id));
    if (entry === undefined) {
      stats.lookupMisses += 1;
      return null;
    }
    stats.lookupHits += 1;
    return {
      key: entry.key,
      kind: entry.kind === KIND_SELECTION ? 'selection' : 'market',
      selectionId: entry.selectionId,
      marketId: entry.marketId,
      eventId: entry.eventId,
      odds: entry.odds,
      suspended: entry.suspended,
      lineVersion: entry.lineVersion,
      updatedAt: entry.updatedAt,
      updatedAtEpoch: entry.updatedAtEpoch,
      oddsChangedAt: entry.oddsChangedAt,
      suspendedChangedAt: entry.suspendedChangedAt,
      revision: entry.revision,
      ageMs: monotonicNow() - entry.updatedAt,
    };
  }

  // Variante sem alocação nenhuma: o chamador reaproveita um objeto próprio.
  function readLatestMarketStateInto(id, target) {
    if (target === null || typeof target !== 'object') return false;
    const entry = entries.get(normalizeKey(id));
    if (entry === undefined) {
      stats.lookupMisses += 1;
      return false;
    }
    stats.lookupHits += 1;
    target.key = entry.key;
    target.kind = entry.kind === KIND_SELECTION ? 'selection' : 'market';
    target.selectionId = entry.selectionId;
    target.marketId = entry.marketId;
    target.eventId = entry.eventId;
    target.odds = entry.odds;
    target.suspended = entry.suspended;
    target.lineVersion = entry.lineVersion;
    target.updatedAt = entry.updatedAt;
    target.updatedAtEpoch = entry.updatedAtEpoch;
    target.oddsChangedAt = entry.oddsChangedAt;
    target.suspendedChangedAt = entry.suspendedChangedAt;
    target.revision = entry.revision;
    target.ageMs = monotonicNow() - entry.updatedAt;
    return true;
  }

  function clearCache() {
    entries.clear();
    observationCount = 0;
    observationView.length = 0;
    protocolProbes.length = 0;
    internRing.fill('');
    internCursor = 0;
  }

  function snapshotStats() {
    return {
      parserVersion: PARSER_VERSION,
      enabled,
      observationsEnabled,
      installed: stopObserver !== null,
      entries: entries.size,
      maxEntries: MAX_ENTRIES,
      frames: stats.frames,
      textFrames: stats.textFrames,
      binaryFrames: stats.binaryFrames,
      unreadableFrames: stats.unreadableFrames,
      oversizedFrames: stats.oversizedFrames,
      upserts: stats.upserts,
      seedUpserts: stats.seedUpserts,
      stemCaptures: stats.stemCaptures,
      stemCaptureMisses: stats.stemCaptureMisses,
      lastStemCaptureAt: stats.lastStemCaptureAt,
      evictions: stats.evictions,
      observationsPublished: stats.observationsPublished,
      lookupHits: stats.lookupHits,
      lookupMisses: stats.lookupMisses,
      lastFrameAt: stats.lastFrameAt,
      lastScanMs: stats.lastScanMs,
      maxScanMs: stats.maxScanMs,
      averageScanMs: stats.frames > 0 ? stats.totalScanMs / stats.frames : 0,
    };
  }

  function collectProtocolProbe(size) {
    if (protocolProbes.length >= MAX_PROTOCOL_PROBES || scanLength <= 0) return;

    const prefixCodes = [];
    const prefixLength = Math.min(scanLength, MAX_PROTOCOL_PREFIX_CODES);
    for (let index = 0; index < prefixLength; index += 1) {
      const code = codeAt(index);
      // Preserva somente a forma: letras viram `A`, dígitos viram `0` e
      // separadores mantêm o código real. Assim nenhum id/token/odd completo
      // pode ser reconstruído do diagnóstico.
      if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122)) {
        prefixCodes.push(65);
      } else if (code >= 48 && code <= 57) {
        prefixCodes.push(48);
      } else {
        prefixCodes.push(code);
      }
    }

    const keys = [];
    let index = 0;
    while (index < scanLength && keys.length < MAX_PROTOCOL_KEYS) {
      if (!isKeyStart(codeAt(index))) {
        index += 1;
        continue;
      }
      const start = index;
      index += 1;
      while (index < scanLength && isKeyChar(codeAt(index))) index += 1;
      const end = index;
      if (end - start > 16) continue;

      let cursor = end;
      while (
        cursor < scanLength &&
        cursor - end <= 3 &&
        (codeAt(cursor) === 32 || codeAt(cursor) === 9 || codeAt(cursor) === 34 || codeAt(cursor) === 39)
      ) cursor += 1;
      if (cursor >= scanLength || cursor - end > 3) continue;
      const separator = codeAt(cursor);
      if (separator !== 58 && separator !== 59 && separator !== 61 && separator !== 2) continue;

      const key = sliceToken(start, end);
      if (key && !keys.includes(key)) keys.push(key);
    }

    protocolProbes.push({
      size,
      text: scanIsText,
      prefixCodes,
      keys,
    });
  }

  function snapshotDiagnostics() {
    return protocolProbes.map((probe) => ({
      size: probe.size,
      text: probe.text,
      prefixCodes: probe.prefixCodes.slice(),
      keys: probe.keys.slice(),
    }));
  }

  // Propriedade não enumerável: a interface fica acessível pelo nome combinado
  // sem aparecer em varredura de `window`.
  function defineGlobal(name, value) {
    try {
      Object.defineProperty(window, name, {
        value,
        writable: true,
        enumerable: false,
        configurable: true,
      });
    } catch (error) {
      window[name] = value;
    }
  }

  const marketStateApi = {
    parserVersion: PARSER_VERSION,
    get: getLatestMarketState,
    readInto: readLatestMarketStateInto,
    has: (id) => entries.has(normalizeKey(id)),
    size: () => entries.size,
    stats: snapshotStats,
    diagnostics: snapshotDiagnostics,
    clear: clearCache,
  };

  // =======================================================================
  // INSTALAÇÃO
  // =======================================================================

  function installObserver() {
    if (stopObserver || typeof ORIGINAL_WEBSOCKET !== 'function') return;

    try {
      const WebSocketProxy = new Proxy(ORIGINAL_WEBSOCKET, {
        construct(target, args, newTarget) {
          const socket = Reflect.construct(target, args, newTarget);
          // O ouvinte é registrado na construção, antes de a página registrar
          // o dela: o cache já está atualizado quando a aplicação reage ao
          // mesmo frame. Uma closure por socket, nenhuma por frame.
          socket.addEventListener('message', (event) => {
            try {
              handleFrame(event.data);
            } catch (error) {}
          });
          return socket;
        },
      });

      // O parser anterior fazia `WebSocketProxy.prototype = ORIGINAL.prototype`.
      // Em `WebSocket` a propriedade `prototype` é somente leitura, então a
      // atribuição lançava TypeError em modo estrito e o `catch` abaixo engolia
      // a instalação inteira — na prática o observador nunca entrou em uso. O
      // Proxy já encaminha a leitura de `prototype` para o alvo, e
      // `instanceof WebSocket` continua verdadeiro para os sockets criados.
      window.WebSocket = WebSocketProxy;
      window.__gbrNetworkFeedInstalled = true;
      defineGlobal('__getLatestMarketState', getLatestMarketState);
      defineGlobal('__gbrMarketStateCache', marketStateApi);
      installParticipantObserver();

      stopObserver = () => {
        try {
          window.WebSocket = ORIGINAL_WEBSOCKET;
          window.__gbrNetworkFeedInstalled = false;
          removeParticipantObserver();
          clearCache();
          delete window.__getLatestMarketState;
          delete window.__gbrMarketStateCache;
          stopObserver = null;
          delete window.__gbrNetworkFeedStop;
        } catch (error) {}
      };
      window.__gbrNetworkFeedStop = stopObserver;
    } catch (error) {
      // O fluxo principal da página permanece intacto se a observação não
      // puder ser instalada neste release do navegador.
    }
  }

  window.addEventListener('message', (event) => {
    if (
      event.source !== window ||
      event.origin !== window.location.origin ||
      event.data?.schemaVersion !== 1
    ) return;

    if (event.data?.type === 'GBR_DIRECT_SELECTION_STATE') {
      seedSelectionState(event.data.state);
      return;
    }
    if (event.data?.type !== 'GBR_NETWORK_FEED_CONTROL') return;

    enabled = event.data.enabled === true;
    // `observations` é opcional e o padrão continua sendo publicar o resumo,
    // para não mudar o contrato de quem já manda apenas `enabled`.
    observationsEnabled = event.data.observations !== false;
    window.__GBR_NETWORK_FEED_ENABLED = enabled;
    if (enabled) {
      installObserver();
    } else {
      window.__gbrNetworkFeedStop?.();
    }
  });

  window.__GBR_NETWORK_FEED_ENABLED = enabled;
  if (enabled) installObserver();
})();
