// =========================================================================
// GATILHOBR - AUTO-RESOLUÇÃO DE selectionId (MUNDO ISOLATED)
// =========================================================================
//
// A Bet365 moderna não publica `selectionId` como atributo HTML: a identidade
// vive no `stem.data.ID` do componente React no MAIN world. Este módulo recebe
// somente o recorte sanitizado dessa identidade e o vincula à exata interação
// observada no ISOLATED. Para versões legadas, também cruza a odd da célula com
// o resumo sanitizado do feed (`GBR_BET365_WS_OBSERVATION`).
//
// Quatro caminhos, do mais forte para o mais fraco:
//   1. Stem oficial do MAIN, preso ao mesmo evento e à mesma célula/odd.
//   2. Atributo no DOM (`data-outcome-id` e parentes), em grids legados.
//   3. Impressão digital do mercado: as odds visíveis do cartão precisam caber
//      inteiras em UM único `marketId` do feed, e a odd acionada precisa ser
//      única dentro desse mercado.
//   4. Odd única global — desligada por padrão (`directOrderAllowOddsOnlyMatch`),
//      porque uma odd que parece única no cache pode pertencer a um mercado que
//      o feed ainda não viu; nesse caso o id nomearia OUTRA seleção.
//
// Regra que vale mais que qualquer heurística: ambiguidade devolve `null`. Sem
// id o motor cai para `DOM_UI` (clique no botão da casa), que é o caminho
// oficial e seguro. Depósito errado seria aposta real em outro mercado.
//
// Somente leitura: nada aqui altera `fetch`, XHR ou WebSocket, nada aqui grava
// payload cru, e nada aqui autoriza gasto — quem decide o envio é o
// `placeBetEngine.js` com a ponte armada.

(function () {
  "use strict";

  if (typeof window === "undefined") return;
  if (window.FastTriggerSelectionResolver) return;

  const RESOLVER_VERSION = 1;
  // Tetos de memória: uma aba com muitos jogos abertos recebe milhares de
  // atualizações por minuto e o índice não pode crescer sem limite.
  const MAX_SELECTIONS = 4000;
  const MAX_MARKETS = 400;
  // Entrada velha não serve de identidade: o mercado pode ter sido recriado com
  // outros ids. Fora dessa janela a entrada é descartada.
  const MAX_ENTRY_AGE_MS = 30_000;
  const MIN_FINGERPRINT_ODDS = 2;
  const MAX_FINGERPRINT_ODDS = 40;
  const MAX_CONTAINER_WALK = 8;
  const MAX_CONTAINER_CANDIDATES = 3;
  const MAX_RECORDS_PER_FRAME = 64;
  // Janela da segunda tentativa: mesma ordem de grandeza do frescor exigido pelo
  // `placeBetEngine.js` para aceitar um depósito.
  const MAX_TARGET_AGE_MS = 12_000;
  // A odd da casa é exibida com duas decimais e a fracionária convertida pode
  // cair um centésimo ao lado (`2/7 + 1` = 1.2857). A comparação usa balde de
  // centésimos com vizinho, e empate entre baldes vizinhos conta como ambíguo.
  const ODDS_BUCKET_NEIGHBOURS = [-1, 0, 1];
  // O par `pointerdown` + `click` do mesmo toque descreve UMA interação. Sem
  // esta janela o mesmo clique contaria dois depósitos na telemetria. Só vale
  // para repetição que JÁ depositou: tentativa que falhou precisa poder repetir,
  // porque o frame que faltava pode ter chegado entre os dois eventos.
  const INTERACTION_DEDUPE_MS = 250;
  const MAX_LOCK_STATE_WALK = 5;
  // A grade React moderna usa classes ofuscadas, mas a classe-base do
  // CouponParticipant é aplicada à célula clicável inteira.
  const MODERN_PARTICIPANT_SELECTOR = '[class*="rgl-43895c"]';
  const PARTICIPANT_SELECTOR =
    `${MODERN_PARTICIPANT_SELECTOR}, [class*="Participant"], [class*="participant"]`;
  const ODDS_TEXT_SELECTOR =
    '[class*="rgl-4a5de5"], [class*="ParticipantOdds"], [class*="ScrollerParticipant_Odds"], [class*="OddsValue"]';
  // A identidade privada observada no MAIN só tem autoridade durante a própria
  // interação que a originou. Fora desta janela ela não nomeia clique posterior.
  const MAIN_SELECTION_MAX_AGE_MS = 1_000;
  const MAIN_SELECTION_FUTURE_TOLERANCE_MS = 250;
  const ID_ATTRIBUTES = [
    "data-outcome-id",
    "data-outcomeid",
    "data-selection-id",
    "data-selectionid",
    "data-participant-id",
    "data-oid",
    "outcomeid",
    "selectionid",
  ];
  const ID_PATTERN = /^[A-Za-z0-9_:.-]{2,96}$/;

  // selectionId -> { selectionId, marketId, eventId, odds, oddsKey, suspended, frameAt }
  const selections = new Map();
  // marketId -> Set<selectionId>
  const markets = new Map();
  // balde de odd (centésimos) -> Set<selectionId>
  const oddsBuckets = new Map();

  let observedFrames = 0;
  let observedRecords = 0;
  let lastFrameSeenAt = 0;
  let lastResolution = null;
  let lastTarget = null;
  let lastInteraction = { element: null, at: 0, deposited: false };
  let mainSelections = new WeakMap();
  let installed = false;
  const counters = {
    deposits: 0,
    cleared: 0,
    viaMainStem: 0,
    viaDom: 0,
    viaFingerprint: 0,
    viaOddsOnly: 0,
    ambiguous: 0,
    unresolved: 0,
    skippedDisabled: 0,
    mainSeedMessages: 0,
    mainStemMessages: 0,
    mainStemRejected: 0,
  };

  function now() {
    return Date.now();
  }

  function isEnabled() {
    return window.FastTriggerConfig?.directOrderAutoSelection !== false;
  }

  function allowOddsOnly() {
    return window.FastTriggerConfig?.directOrderAllowOddsOnlyMatch === true;
  }

  function normalizeId(value) {
    const raw = typeof value === "string" ? value.trim() : "";
    if (raw === "" || !ID_PATTERN.test(raw)) return null;
    return raw;
  }

  function normalizeOdds(value) {
    const odds = Number(value);
    return Number.isFinite(odds) && odds > 1 ? odds : null;
  }

  function oddsKey(odds) {
    const normalized = normalizeOdds(odds);
    return normalized === null ? null : Math.round(normalized * 100);
  }

  // =======================================================================
  // LEITURA DE ODD NO DOM
  // =======================================================================

  // A célula traz nome e odd no mesmo texto ("2+ 6.50"), então o número solto
  // não serve: só é aceita odd com separador decimal ou fracionária explícita, e
  // só quando existe um único candidato. Dois candidatos viram `null`, o que leva
  // ao clique no DOM em vez de um id chutado.
  function parseOddsFromText(text) {
    const raw = typeof text === "string" ? text : "";
    if (raw === "") return null;
    const candidates = new Set();

    for (const token of raw.match(/\d{1,4}\s*\/\s*\d{1,4}/g) || []) {
      const parts = token.split("/");
      const numerator = Number(parts[0]);
      const denominator = Number(parts[1]);
      if (!(denominator > 0) || !Number.isFinite(numerator)) continue;
      const decimal = normalizeOdds(numerator / denominator + 1);
      if (decimal !== null) candidates.add(oddsKey(decimal));
    }

    if (candidates.size === 0) {
      for (const token of raw.match(/\d{1,4}[.,]\d{1,3}/g) || []) {
        const decimal = normalizeOdds(Number(token.replace(",", ".")));
        if (decimal !== null) candidates.add(oddsKey(decimal));
      }
    }

    if (candidates.size !== 1) return null;
    return [...candidates][0] / 100;
  }

  function readOdds(element) {
    if (!element || typeof element.querySelector !== "function") return null;
    try {
      const holder = element.querySelector(ODDS_TEXT_SELECTOR);
      const fromHolder = parseOddsFromText(holder?.textContent);
      if (fromHolder !== null) return fromHolder;
      return parseOddsFromText(element.textContent);
    } catch (error) {
      return null;
    }
  }

  // =======================================================================
  // ÍNDICE ALIMENTADO PELO FEED
  // =======================================================================

  function detachFromMarket(entry) {
    if (!entry.marketId) return;
    const bucket = markets.get(entry.marketId);
    if (!bucket) return;
    bucket.delete(entry.selectionId);
    if (bucket.size === 0) markets.delete(entry.marketId);
  }

  function detachFromOdds(entry) {
    if (entry.oddsKey === null) return;
    const bucket = oddsBuckets.get(entry.oddsKey);
    if (!bucket) return;
    bucket.delete(entry.selectionId);
    if (bucket.size === 0) oddsBuckets.delete(entry.oddsKey);
  }

  function attach(entry) {
    if (entry.marketId) {
      let bucket = markets.get(entry.marketId);
      if (!bucket) {
        bucket = new Set();
        markets.set(entry.marketId, bucket);
      }
      bucket.add(entry.selectionId);
    }
    if (entry.oddsKey !== null) {
      let bucket = oddsBuckets.get(entry.oddsKey);
      if (!bucket) {
        bucket = new Set();
        oddsBuckets.set(entry.oddsKey, bucket);
      }
      bucket.add(entry.selectionId);
    }
  }

  function dropSelection(selectionId) {
    const entry = selections.get(selectionId);
    if (!entry) return false;
    detachFromMarket(entry);
    detachFromOdds(entry);
    selections.delete(selectionId);
    return true;
  }

  function pruneExpired(reference = now()) {
    let removed = 0;
    for (const [selectionId, entry] of selections) {
      if (reference - entry.frameAt > MAX_ENTRY_AGE_MS) {
        dropSelection(selectionId);
        removed += 1;
      }
    }
    return removed;
  }

  // O `Map` preserva ordem de inserção, então a primeira chave é a entrada mais
  // antiga a ser criada. Isso é suficiente como política de teto.
  function enforceCaps() {
    while (selections.size > MAX_SELECTIONS) {
      dropSelection(selections.keys().next().value);
    }
    while (markets.size > MAX_MARKETS) {
      const marketId = markets.keys().next().value;
      for (const selectionId of markets.get(marketId) || []) {
        dropSelection(selectionId);
      }
      markets.delete(marketId);
    }
  }

  function upsert(record, frameAt) {
    const selectionId = normalizeId(record?.outcomeId);
    if (selectionId === null) return false;

    const marketId = normalizeId(record?.marketId) || "";
    const eventId = normalizeId(record?.eventId) || "";
    const odds = normalizeOdds(record?.odds);
    const suspended = typeof record?.suspended === "boolean" ? record.suspended : null;

    const existing = selections.get(selectionId);
    if (!existing) {
      const entry = {
        selectionId,
        marketId,
        eventId,
        odds,
        oddsKey: oddsKey(odds),
        suspended,
        frameAt,
      };
      selections.set(selectionId, entry);
      attach(entry);
      return true;
    }

    // Onda parcial da casa: o frame pode trazer só preço, só suspensão ou só o
    // vínculo de mercado. Campo ausente não apaga o que já era conhecido.
    if (marketId && marketId !== existing.marketId) {
      detachFromMarket(existing);
      existing.marketId = marketId;
      attach(existing);
    }
    if (eventId && !existing.eventId) existing.eventId = eventId;
    if (odds !== null && odds !== existing.odds) {
      detachFromOdds(existing);
      existing.odds = odds;
      existing.oddsKey = oddsKey(odds);
      attach(existing);
    }
    if (suspended !== null) existing.suspended = suspended;
    existing.frameAt = frameAt;
    return true;
  }

  // Único ponto de entrada de dado externo. Os registros já chegam sanitizados
  // pelo `content.js` (campos recortados, odd numérica, `suspended` booleano ou
  // nulo); aqui a validação é repetida porque este módulo também é chamável do
  // console durante diagnóstico.
  function observe(records, receivedAt) {
    if (!Array.isArray(records) || records.length === 0) return 0;

    const reference = now();
    const declared = Number(receivedAt);
    // `receivedAt` nasce de `Date.now()` no mundo MAIN, mesmo relógio desta aba,
    // então serve de T0. Valor no futuro ou muito velho é substituído pelo agora.
    const frameAt =
      Number.isFinite(declared) &&
      declared <= reference + 2_000 &&
      reference - declared <= MAX_ENTRY_AGE_MS
        ? declared
        : reference;

    observedFrames += 1;
    let accepted = 0;
    for (const record of records.slice(0, MAX_RECORDS_PER_FRAME)) {
      if (upsert(record, frameAt)) accepted += 1;
    }

    if (accepted > 0) {
      observedRecords += accepted;
      lastFrameSeenAt = frameAt;
    }
    pruneExpired(reference);
    enforceCaps();
    return accepted;
  }

  // =======================================================================
  // CAMINHOS DE RESOLUÇÃO
  // =======================================================================

  function isFresh(entry, reference) {
    return Boolean(entry) && reference - entry.frameAt <= MAX_ENTRY_AGE_MS;
  }

  function freshEntriesForOddsKey(key, reference) {
    if (key === null) return [];
    const found = [];
    for (const offset of ODDS_BUCKET_NEIGHBOURS) {
      for (const selectionId of oddsBuckets.get(key + offset) || []) {
        const entry = selections.get(selectionId);
        if (isFresh(entry, reference)) found.push(entry);
      }
    }
    return found;
  }

  // 1) Atributo no DOM. Sobe poucos níveis a partir do elemento acionado: o id,
  // quando existe, fica no próprio botão ou no container imediato.
  function resolveFromDom(element) {
    let node = element;
    let depth = 0;
    while (node && depth <= MAX_CONTAINER_WALK && typeof node.getAttribute === "function") {
      for (const attribute of ID_ATTRIBUTES) {
        const candidate = normalizeId(node.getAttribute(attribute));
        if (candidate !== null) return candidate;
      }
      node = node.parentElement;
      depth += 1;
    }
    return null;
  }

  function resolveFromMainStem(element, domOdds, reference) {
    if (!element || typeof element !== "object") return null;
    const entry = mainSelections.get(element);
    if (!entry) return null;
    if (
      reference < entry.observedAt - MAIN_SELECTION_FUTURE_TOLERANCE_MS ||
      reference - entry.observedAt > MAIN_SELECTION_MAX_AGE_MS ||
      element.isConnected === false
    ) {
      mainSelections.delete(element);
      return null;
    }
    const displayedKey = oddsKey(domOdds);
    const stemKey = oddsKey(entry.odds);
    if (
      displayedKey === null ||
      stemKey === null ||
      !ODDS_BUCKET_NEIGHBOURS.some((offset) => stemKey + offset === displayedKey)
    ) return null;
    return entry;
  }

  function collectOddsKeys(container) {
    const keys = new Set();
    if (!container || typeof container.querySelectorAll !== "function") return keys;
    let cells = [];
    try {
      cells = Array.from(container.querySelectorAll(PARTICIPANT_SELECTOR));
    } catch (error) {
      return keys;
    }
    for (const cell of cells) {
      if (keys.size > MAX_FINGERPRINT_ODDS) break;
      const key = oddsKey(readOdds(cell));
      if (key !== null) keys.add(key);
    }
    return keys;
  }

  // A impressão digital é montada em camadas: a linha do mercado costuma ser o
  // primeiro ancestral com duas odds legíveis, mas o cartão inteiro também é
  // testado, porque a casa aninha participantes de formas diferentes por esporte.
  function collectContainerCandidates(element) {
    const candidates = [];
    let node = element?.parentElement || null;
    let depth = 0;
    let previousSize = 0;
    while (node && depth < MAX_CONTAINER_WALK && candidates.length < MAX_CONTAINER_CANDIDATES) {
      const keys = collectOddsKeys(node);
      if (
        keys.size >= MIN_FINGERPRINT_ODDS &&
        keys.size <= MAX_FINGERPRINT_ODDS &&
        keys.size > previousSize
      ) {
        candidates.push(keys);
        previousSize = keys.size;
      }
      node = node.parentElement;
      depth += 1;
    }
    return candidates;
  }

  function marketCoversKeys(marketId, keys, reference) {
    const members = markets.get(marketId);
    if (!members || members.size === 0) return false;
    for (const key of keys) {
      let covered = false;
      for (const selectionId of members) {
        const entry = selections.get(selectionId);
        if (!isFresh(entry, reference) || entry.oddsKey === null) continue;
        if (ODDS_BUCKET_NEIGHBOURS.some((offset) => entry.oddsKey + offset === key)) {
          covered = true;
          break;
        }
      }
      if (!covered) return false;
    }
    return true;
  }

  // 2) Impressão digital: cobertura total das odds visíveis por UM só mercado, e
  // odd acionada única dentro dele. Duas condições, ambas obrigatórias — cobrir
  // sem unicidade nomearia a seleção irmã de mesma cotação.
  function resolveFromFingerprint(element, clickedKey, reference) {
    const candidates = freshEntriesForOddsKey(clickedKey, reference);
    if (candidates.length === 0) return { status: "no_candidate", entry: null };

    const candidateMarkets = [
      ...new Set(candidates.map((entry) => entry.marketId).filter(Boolean)),
    ];
    if (candidateMarkets.length === 0) return { status: "no_market", entry: null };

    for (const keys of collectContainerCandidates(element)) {
      const covering = candidateMarkets.filter((marketId) =>
        marketCoversKeys(marketId, keys, reference),
      );
      if (covering.length !== 1) continue;
      const inMarket = candidates.filter((entry) => entry.marketId === covering[0]);
      if (inMarket.length !== 1) continue;
      return { status: "ok", entry: inMarket[0] };
    }
    return { status: "ambiguous", entry: null };
  }

  // 3) Odd única global. Só com a chave ligada, e ainda assim exige unicidade
  // absoluta no índice inteiro.
  function resolveFromOddsOnly(clickedKey, reference) {
    const candidates = freshEntriesForOddsKey(clickedKey, reference);
    const unique = [...new Set(candidates.map((entry) => entry.selectionId))];
    if (unique.length !== 1) return { status: "ambiguous", entry: null };
    return { status: "ok", entry: selections.get(unique[0]) };
  }

  function noteResolution(source, reason, selectionId) {
    lastResolution = {
      at: now(),
      source,
      reason,
      selectionId: selectionId || "",
    };
    return lastResolution;
  }

  /**
   * Resolve o `selectionId` da célula acionada. Devolve `null` sempre que a
   * identidade não for inequívoca — nunca um palpite.
   * @param {Element} element célula/botão de odd que será acionado
   * @param {{odds?: number}} [options] odd já conhecida pelo chamador
   * @returns {{selectionId: string, odds: (number|null), marketId: string,
   *   eventId: string, suspended: (boolean|null), frameAt: (number|null),
   *   source: string}|null}
   */
  function resolve(element, options = {}) {
    const reference = now();
    pruneExpired(reference);

    const domOdds = normalizeOdds(options.odds) ?? readOdds(element);
    const clickedKey = oddsKey(domOdds);
    const fromMainStem = resolveFromMainStem(element, domOdds, reference);
    if (fromMainStem !== null) {
      counters.viaMainStem += 1;
      noteResolution("main_stem", "trusted_stem_exact_element", fromMainStem.selectionId);
      return {
        selectionId: fromMainStem.selectionId,
        odds: domOdds,
        marketId: fromMainStem.marketId,
        eventId: fromMainStem.eventId,
        suspended: fromMainStem.suspended,
        frameAt: fromMainStem.observedAt,
        source: "main_stem",
      };
    }

    const fromDom = resolveFromDom(element);

    if (fromDom !== null) {
      counters.viaDom += 1;
      const known = selections.get(fromDom);
      const oddsAgree =
        isFresh(known, reference) &&
        known.oddsKey !== null &&
        clickedKey !== null &&
        ODDS_BUCKET_NEIGHBOURS.some((offset) => known.oddsKey + offset === clickedKey);
      noteResolution("dom_attribute", oddsAgree ? "dom_confirmed_by_feed" : "dom_only", fromDom);
      return {
        selectionId: fromDom,
        odds: domOdds ?? (oddsAgree ? known.odds : null),
        marketId: oddsAgree ? known.marketId : "",
        eventId: oddsAgree ? known.eventId : "",
        suspended: oddsAgree ? known.suspended : null,
        // T0 só é reivindicado quando a odd do frame casa com a odd da tela; do
        // contrário o carimbo seria de outro tique e a latência viraria ficção.
        frameAt: oddsAgree ? known.frameAt : null,
        source: "dom_attribute",
      };
    }

    if (clickedKey === null) {
      counters.unresolved += 1;
      noteResolution("", "no_readable_odds", "");
      return null;
    }
    if (selections.size === 0) {
      counters.unresolved += 1;
      noteResolution("", "empty_index", "");
      return null;
    }

    const fingerprint = resolveFromFingerprint(element, clickedKey, reference);
    if (fingerprint.status === "ok") {
      counters.viaFingerprint += 1;
      noteResolution("market_fingerprint", "fingerprint_unique", fingerprint.entry.selectionId);
      return {
        selectionId: fingerprint.entry.selectionId,
        odds: domOdds,
        marketId: fingerprint.entry.marketId,
        eventId: fingerprint.entry.eventId,
        suspended: fingerprint.entry.suspended,
        frameAt: fingerprint.entry.frameAt,
        source: "market_fingerprint",
      };
    }

    if (allowOddsOnly()) {
      const oddsOnly = resolveFromOddsOnly(clickedKey, reference);
      if (oddsOnly.status === "ok") {
        counters.viaOddsOnly += 1;
        noteResolution("odds_only", "odds_unique_global", oddsOnly.entry.selectionId);
        return {
          selectionId: oddsOnly.entry.selectionId,
          odds: domOdds,
          marketId: oddsOnly.entry.marketId,
          eventId: oddsOnly.entry.eventId,
          suspended: oddsOnly.entry.suspended,
          frameAt: oddsOnly.entry.frameAt,
          source: "odds_only",
        };
      }
    }

    if (fingerprint.status === "ambiguous") counters.ambiguous += 1;
    else counters.unresolved += 1;
    noteResolution("", `fingerprint_${fingerprint.status}`, "");
    return null;
  }

  // =======================================================================
  // DEPÓSITO
  // =======================================================================

  // Depósito automático que não resolveu precisa APAGAR o depósito automático
  // anterior. Sem isso o usuário clica na célula B, a identidade de B falha, e o
  // id de A — depositado segundos antes e ainda dentro da janela de 12 s — viraria
  // ordem real no mercado errado. Depósito manual (console, diagnóstico) é
  // preservado: ele é ato explícito de quem está testando.
  function clearAutoDeposit() {
    const state = window.FastTriggerState;
    const stored = state?.directOrderSelection;
    if (!stored) return false;
    if (typeof stored.source !== "string" || !stored.source.startsWith("auto_")) {
      return false;
    }
    state.directOrderSelection = null;
    counters.cleared += 1;
    return true;
  }

  function elementHasLockSignal(element) {
    if (!element || element.nodeType !== 1) return true;
    if (element.isConnected === false || element.disabled === true) return true;
    try {
      if (
        element.hasAttribute?.("disabled") ||
        element.getAttribute?.("aria-disabled") === "true"
      ) {
        return true;
      }
    } catch (error) {
      return true;
    }

    const className = typeof element.className === "string"
      ? element.className
      : (typeof element.className?.baseVal === "string" ? element.className.baseVal : "");
    return /disabled|suspended|locked|d3e321/i.test(className);
  }

  // A disponibilidade enviada ao MAIN nunca e inferida pela odd sozinha. O
  // participante e seus ancestrais imediatos precisam estar conectados e sem
  // qualquer marcador de bloqueio conhecido; na duvida devolve `true` e a ordem
  // direta falha fechada.
  function readDomSuspended(element) {
    let current = element || null;
    let depth = 0;
    while (current && depth < MAX_LOCK_STATE_WALK) {
      if (elementHasLockSignal(current)) return true;
      current = current.parentElement || null;
      depth += 1;
    }
    return !element || readOdds(element) === null;
  }

  // A versao atual da Bet365 publica apenas heartbeat no WebSocket da janela
  // principal. Quando (e somente quando) o proprio elemento acionado traz um id
  // direto, espelhamos a selecao real no cache MAIN. Isso nao clica, nao preenche
  // stake e nao envia ordem; apenas fornece ao dispatcher o estado curto que ele
  // ainda validara por TTL, suspensao e limites financeiros.
  function publishMainSelectionState(resolved, element) {
    const targetOrigin = typeof window.location?.origin === "string"
      ? window.location.origin
      : "";
    if (
      resolved?.source !== "dom_attribute" ||
      !normalizeId(resolved.selectionId) ||
      normalizeOdds(resolved.odds) === null ||
      targetOrigin === "" ||
      typeof window.postMessage !== "function"
    ) {
      return false;
    }

    const suspended = resolved.suspended === true || readDomSuspended(element);
    try {
      window.postMessage(
        {
          type: "GBR_DIRECT_SELECTION_STATE",
          schemaVersion: 1,
          state: {
            selectionId: resolved.selectionId,
            marketId: normalizeId(resolved.marketId) || "",
            eventId: normalizeId(resolved.eventId) || "",
            odds: resolved.odds,
            suspended,
          },
        },
        targetOrigin,
      );
      counters.mainSeedMessages += 1;
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Resolve e deposita em `FastTriggerState.directOrderSelection`.
   * @param {Element} element célula/botão de odd que será acionado
   * @param {{odds?: number, actionId?: string, interactionType?: string,
   *   interactionTimeStamp?: number}} [options]
   * @returns {object|null} entrada depositada, ou `null` quando não houve id
   */
  function deposit(element, options = {}) {
    if (!isEnabled()) {
      counters.skippedDisabled += 1;
      return null;
    }

    // A célula acionada é guardada mesmo quando a identidade falha: entre o
    // clique e a confirmação a casa costuma publicar o frame do mercado, e aí a
    // segunda tentativa (`retry`) resolve o que a primeira não resolveu.
    lastTarget = {
      element: element || null,
      odds: normalizeOdds(options.odds),
      at: now(),
      interactionType: typeof options.interactionType === "string" ? options.interactionType : "",
      interactionTimeStamp: Number.isFinite(Number(options.interactionTimeStamp))
        ? Number(options.interactionTimeStamp)
        : null,
    };

    const resolved = resolve(element, options);
    if (resolved === null) {
      clearAutoDeposit();
      return null;
    }

    const setter = window.setFastTriggerDirectOrderSelection;
    if (typeof setter !== "function") return null;

    let entry = null;
    try {
      entry = setter(resolved.selectionId, {
        odds: resolved.odds,
        marketId: resolved.marketId,
        eventId: resolved.eventId,
        actionId: typeof options.actionId === "string" ? options.actionId : "",
        frameAt: resolved.frameAt,
        source: `auto_${resolved.source}`,
      });
    } catch (error) {
      return null;
    }
    if (entry) {
      counters.deposits += 1;
      publishMainSelectionState(resolved, element);
    }
    return entry;
  }

  // =======================================================================
  // ESCUTA DE FOCO/PONTEIRO
  // =======================================================================

  // O caminho mais comum do usuário não passa por motor nenhum: ele clica a
  // célula com o mouse e depois pressiona a hotkey de confirmação. Sem esta
  // escuta o acionamento chegaria sem id e cairia para o DOM. É captura passiva,
  // não cancela evento e não injeta clique — só observa e deposita.
  function handleSelectionInteraction(event) {
    if (!isEnabled()) return;
    const target = event?.target;
    if (!target || typeof target.closest !== "function") return;
    let cell = null;
    try {
      cell = target.closest(PARTICIPANT_SELECTOR);
    } catch (error) {
      return;
    }
    // Cabeçalho e rótulo de linha também casam com o seletor de participante;
    // sem odd legível não existe seleção para depositar.
    if (!cell || readOdds(cell) === null) return;

    const at = now();
    if (
      lastInteraction.element === cell &&
      lastInteraction.deposited &&
      at - lastInteraction.at <= INTERACTION_DEDUPE_MS
    ) {
      return;
    }
    const entry = deposit(cell, {
      interactionType: typeof event.type === "string" ? event.type : "",
      interactionTimeStamp: event.timeStamp,
    });
    lastInteraction = { element: cell, at, deposited: entry !== null };
  }

  function isModernParticipant(element) {
    const className = typeof element?.className === "string"
      ? element.className
      : (typeof element?.className?.baseVal === "string" ? element.className.baseVal : "");
    return className.includes("rgl-43895c");
  }

  // O MAIN enxerga o `stem` privado do componente React; o ISOLATED enxerga a
  // célula real que recebeu a interação. A mensagem só é aceita quando os dois
  // lados descrevem a mesma interação recente e a mesma odd visível.
  function handleMainSelectionMessage(event) {
    const data = event?.data;
    if (
      data?.type !== "GBR_DIRECT_SELECTION_OBSERVED" ||
      data?.schemaVersion !== 1
    ) return;
    const reference = now();
    const selection = data?.selection;
    const observedAt = Number(selection?.observedAt);
    const target = lastTarget?.element;
    const targetOrigin = typeof window.location?.origin === "string" ? window.location.origin : "";
    const selectionId = normalizeId(selection?.selectionId);
    const odds = normalizeOdds(selection?.odds);
    const domOdds = readOdds(target);
    const interactionTimeStamp = Number(data?.interaction?.timeStamp);
    const interactionMatches =
      typeof data?.interaction?.type === "string" &&
      data.interaction.type !== "" &&
      data.interaction.type === lastTarget?.interactionType &&
      Number.isFinite(interactionTimeStamp) &&
      lastTarget?.interactionTimeStamp !== null &&
      Math.abs(interactionTimeStamp - lastTarget.interactionTimeStamp) <= 0.01;
    const oddsMatch =
      oddsKey(domOdds) !== null &&
      oddsKey(odds) !== null &&
      ODDS_BUCKET_NEIGHBOURS.some((offset) => oddsKey(odds) + offset === oddsKey(domOdds));
    const valid =
      event?.source === window &&
      event?.origin === targetOrigin &&
      selectionId !== null &&
      odds !== null &&
      typeof selection?.suspended === "boolean" &&
      Number.isFinite(observedAt) &&
      reference >= observedAt - MAIN_SELECTION_FUTURE_TOLERANCE_MS &&
      reference - observedAt <= MAIN_SELECTION_MAX_AGE_MS &&
      lastTarget !== null &&
      reference - lastTarget.at <= MAIN_SELECTION_MAX_AGE_MS &&
      target?.isConnected !== false &&
      isModernParticipant(target) &&
      interactionMatches &&
      oddsMatch;

    if (!valid) {
      counters.mainStemRejected += 1;
      return;
    }

    mainSelections.set(target, {
      selectionId,
      marketId: normalizeId(selection.marketId) || "",
      eventId: normalizeId(selection.eventId) || "",
      odds,
      suspended: selection.suspended,
      observedAt,
    });
    counters.mainStemMessages += 1;
    const entry = deposit(target, {
      odds: domOdds,
      interactionType: lastTarget.interactionType,
      interactionTimeStamp: lastTarget.interactionTimeStamp,
    });
    lastInteraction = { element: target, at: reference, deposited: entry !== null };
  }

  function install() {
    if (installed) return false;
    if (!window.document || typeof window.document.addEventListener !== "function") {
      return false;
    }
    installed = true;
    window.document.addEventListener("pointerdown", handleSelectionInteraction, {
      capture: true,
      passive: true,
    });
    // `click` cobre o que o ponteiro não vê: ativação por teclado (Enter/Espaço
    // na célula), toque que a casa converte em clique e clique re-despachado
    // pelo próprio script da página. Captura passiva, mesma regra do ponteiro.
    window.document.addEventListener("click", handleSelectionInteraction, {
      capture: true,
      passive: true,
    });
    window.document.addEventListener("focusin", handleSelectionInteraction, true);
    if (typeof window.addEventListener === "function") {
      window.addEventListener("message", handleMainSelectionMessage);
    }
    return true;
  }

  // =======================================================================
  // DIAGNÓSTICO
  // =======================================================================

  /**
   * Segunda tentativa sobre a última célula acionada. Usada pelo gancho
   * `getDirectOrderSelection` do adapter: o frame que faltava pode ter chegado
   * depois do clique. Fora da janela de frescor devolve `null` e o motor segue
   * pelo DOM.
   * @returns {object|null}
   */
  function retry() {
    if (!lastTarget || !lastTarget.element) return null;
    if (now() - lastTarget.at > MAX_TARGET_AGE_MS) return null;
    if (lastTarget.element.isConnected === false) return null;
    return deposit(lastTarget.element, { odds: lastTarget.odds });
  }

  // T0 da linha do tempo: quando o frame que descreve esta seleção chegou.
  function lastFrameAt(selectionId) {
    const entry = selections.get(normalizeId(selectionId) || "");
    return entry ? entry.frameAt : null;
  }

  function stats() {
    return {
      version: RESOLVER_VERSION,
      enabled: isEnabled(),
      oddsOnlyAllowed: allowOddsOnly(),
      selections: selections.size,
      markets: markets.size,
      oddsBuckets: oddsBuckets.size,
      observedFrames,
      observedRecords,
      lastFrameSeenAt,
      lastResolution: lastResolution ? { ...lastResolution } : null,
      ...counters,
    };
  }

  function describe() {
    const snapshot = stats();
    const feed = snapshot.lastFrameSeenAt
      ? `${Math.round((now() - snapshot.lastFrameSeenAt) / 100) / 10}s atrás`
      : "sem frame";
    return [
      `resolver v${snapshot.version}`,
      snapshot.enabled ? "auto ligado" : "auto DESLIGADO",
      `${snapshot.selections} seleções em ${snapshot.markets} mercados`,
      `último frame: ${feed}`,
      `depósitos: ${snapshot.deposits} (stem ${snapshot.viaMainStem}, dom ${snapshot.viaDom}, digital ${snapshot.viaFingerprint}, odd ${snapshot.viaOddsOnly})`,
      `ambíguos: ${snapshot.ambiguous}, sem id: ${snapshot.unresolved}`,
    ].join(" | ");
  }

  function clear() {
    selections.clear();
    markets.clear();
    oddsBuckets.clear();
    observedFrames = 0;
    observedRecords = 0;
    lastFrameSeenAt = 0;
    lastResolution = null;
    lastTarget = null;
    lastInteraction = { element: null, at: 0, deposited: false };
    mainSelections = new WeakMap();
  }

  window.FastTriggerSelectionResolver = {
    version: RESOLVER_VERSION,
    observe,
    resolve,
    deposit,
    retry,
    readOdds,
    install,
    lastFrameAt,
    stats,
    describe,
    clear,
  };

  install();
})();
