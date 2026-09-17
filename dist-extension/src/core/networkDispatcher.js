// =========================================================================
// GATILHOBR - DESPACHANTE DE ORDEM DIRETA (MAIN WORLD)
// =========================================================================
//
// Este módulo roda no `world: MAIN`, junto de `inject.js`, porque o cache de
// estado (`window.__gbrMarketStateCache`) só é legível de forma síncrona ali.
// Ele NÃO altera `fetch`, XHR ou WebSocket: apenas chama `fetch` para um
// endpoint que o chamador informa. Nenhum endpoint de casa está embutido aqui.
//
// Trava financeira (mesma semântica de `background.js`): toda ordem exige
// intenção explícita e recente (`actionId` + `issuedAt`), o `actionId` é
// consumido uma única vez, e uma ordem já enviada NUNCA é repetida
// automaticamente — resposta lenta ou timeout devolvem `attempted: true` e a
// decisão de repetir é do usuário, não do motor.

(function installDirectOrderDispatcher() {
  'use strict';

  if (typeof window === 'undefined' || window.__gbrDirectOrderBooted === true) return;
  window.__gbrDirectOrderBooted = true;

  const DISPATCHER_VERSION = 1;

  const DEFAULT_TIMEOUT_MS = 4_000;
  const MAX_TIMEOUT_MS = 15_000;
  // Idade máxima da intenção do usuário, igual ao `USER_ACTION_MAX_AGE_MS` do
  // service worker: o mesmo comando não pode ser reaproveitado depois.
  const MAX_INTENT_AGE_MS = 5_000;
  // Estado mais velho que isso não serve para decidir dinheiro: em mercado ao
  // vivo uma odd de 1,5 s atrás pode já ter morrido.
  const DEFAULT_MAX_STATE_AGE_MS = 1_500;
  const RATE_LIMIT_MAX = 15;
  const RATE_LIMIT_WINDOW_MS = 5_000;
  const MAX_HEADERS = 24;
  const MAX_HEADER_NAME_LENGTH = 64;
  const MAX_HEADER_VALUE_LENGTH = 4_096;
  const MAX_BODY_LENGTH = 65_536;
  const MAX_RESPONSE_CHARS = 4_096;
  const CONSUMED_TTL_MS = 60_000;
  const MAX_CONSUMED_IDS = 256;

  // O corpo atravessa `postMessage` como dado puro (structured clone), então a
  // ponte do mundo isolado não consegue enviar função. `bodyContext` é o
  // substituto declarativo: um mapa `{ chaveDoCorpo: 'campoDoContexto' }`
  // resolvido aqui, contra esta allowlist. Sem eval, sem linguagem de template.
  const BODY_CONTEXT_FIELDS = new Set([
    'selectionId', 'selectionIdNumber', 'stake', 'stakeMinor', 'stakeFixed2',
    'odds', 'oddsText', 'suspended', 'marketId', 'marketIdNumber', 'eventId',
    'eventIdNumber', 'lineVersion', 'revision', 'stateAgeMs', 'actionId',
  ]);
  const MAX_BODY_CONTEXT_KEYS = 16;

  // `fetch` não permite definir estes cabeçalhos: o navegador os descarta em
  // silêncio. Recusamos de forma explícita para o chamador não acreditar que
  // enviou um `Cookie` manual — o cookie da sessão viaja por
  // `credentials: 'include'`, não por header.
  const FORBIDDEN_HEADERS = new Set([
    'accept-charset', 'accept-encoding', 'access-control-request-headers',
    'access-control-request-method', 'connection', 'content-length', 'cookie',
    'cookie2', 'date', 'dnt', 'expect', 'host', 'keep-alive', 'origin',
    'permissions-policy', 'referer', 'te', 'trailer', 'transfer-encoding',
    'upgrade', 'via',
  ]);

  const perf = window.performance;
  const monotonicNow = perf && typeof perf.now === 'function'
    ? () => perf.now()
    : () => Date.now();

  // Referências capturadas no boot: se a página trocar `fetch` depois, a ordem
  // continua saindo pela implementação original em vez de por um wrapper da
  // casa. Não substituímos nada de volta — só guardamos o que já existia.
  const ORIGINAL_FETCH = typeof window.fetch === 'function' ? window.fetch.bind(window) : null;
  const AbortControllerImpl =
    typeof window.AbortController === 'function' ? window.AbortController : null;
  const setTimer =
    typeof window.setTimeout === 'function' ? window.setTimeout.bind(window) : null;
  const clearTimer =
    typeof window.clearTimeout === 'function' ? window.clearTimeout.bind(window) : null;

  let enabled = window.__GBR_DIRECT_ORDER_ENABLED === true;
  let stopDispatcher = null;

  // Configuração ajustável pela ponte isolada. `allowedHosts` é a trava contra
  // exfiltração: `__dispatchDirectOrder` fica visível para todo script do MAIN
  // world (inclusive o da própria página), e sem allowlist um terceiro poderia
  // usar o despachante para enviar a sessão autenticada a outro host.
  const settings = {
    allowedHosts: [],
    maxStake: null,
    maxStateAgeMs: DEFAULT_MAX_STATE_AGE_MS,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    dryRun: false,
    publishResults: true,
  };

  const rateWindow = [];
  const consumedActionIds = new Map();
  // Uma ordem por seleção em voo. Duas teclas na mesma odd não podem virar
  // duas apostas porque a primeira ainda não respondeu.
  const inFlight = new Set();

  const stats = {
    dispatcherVersion: DISPATCHER_VERSION,
    requested: 0,
    attempted: 0,
    succeeded: 0,
    rejected: 0,
    failed: 0,
    timedOut: 0,
    lastCode: '',
    lastRtt: 0,
    minRtt: 0,
    maxRtt: 0,
    totalRtt: 0,
  };

  // Alvo reaproveitado do `readInto`: o cache preenche este objeto de formato
  // fixo, sem alocar nada por consulta. O laço de eventos é single-thread e a
  // leitura acontece antes de qualquer `await`, então os valores são copiados
  // para variáveis locais imediatamente e o objeto pode ser reusado.
  const stateScratch = {
    key: '',
    kind: '',
    selectionId: '',
    marketId: '',
    eventId: '',
    odds: null,
    suspended: null,
    lineVersion: null,
    updatedAt: 0,
    updatedAtEpoch: 0,
    oddsChangedAt: 0,
    suspendedChangedAt: 0,
    revision: 0,
    ageMs: 0,
  };

  // =======================================================================
  // RESULTADO
  // =======================================================================

  // `attempted` diz se a requisição saiu do navegador. É o campo que impede
  // repetição cega: com `attempted: true` e resultado desconhecido, o estado da
  // aposta na casa é indeterminado e só o usuário decide o próximo passo.
  function createResult(code, ok, order) {
    return {
      ok,
      code,
      attempted: false,
      dispatcherVersion: DISPATCHER_VERSION,
      actionId: order && typeof order.actionId === 'string' ? order.actionId : '',
      selectionId: order ? normalizeId(order.selectionId) : '',
      stake: order && Number.isFinite(Number(order.stake)) ? Number(order.stake) : null,
      odds: null,
      suspended: null,
      stateAgeMs: null,
      revision: null,
      status: 0,
      rtt: 0,
      totalMs: 0,
      validationMs: 0,
      response: null,
      error: '',
    };
  }

  function normalizeId(id) {
    if (typeof id === 'string') return id;
    if (typeof id === 'number') return Number.isFinite(id) ? String(id) : '';
    if (id === null || id === undefined) return '';
    return String(id);
  }

  function finalize(result) {
    stats.lastCode = result.code;
    if (result.ok) stats.succeeded += 1;
    else if (result.attempted) stats.failed += 1;
    else stats.rejected += 1;
    if (result.code === 'timeout') stats.timedOut += 1;
    if (result.rtt > 0) {
      stats.lastRtt = result.rtt;
      stats.totalRtt += result.rtt;
      if (stats.minRtt === 0 || result.rtt < stats.minRtt) stats.minRtt = result.rtt;
      if (result.rtt > stats.maxRtt) stats.maxRtt = result.rtt;
    }
    publishResult(result);
    return result;
  }

  // Diagnóstico para o mundo isolado: só ids, código, status e tempo. Nunca
  // header, corpo, token ou cookie — a mesma regra do feed de leitura.
  function publishResult(result) {
    if (!settings.publishResults) return;
    try {
      window.postMessage({
        type: 'GBR_DIRECT_ORDER_RESULT',
        schemaVersion: 1,
        result: {
          dispatcherVersion: DISPATCHER_VERSION,
          actionId: result.actionId,
          selectionId: result.selectionId,
          ok: result.ok,
          code: result.code,
          attempted: result.attempted,
          status: result.status,
          rtt: result.rtt,
          totalMs: result.totalMs,
          stateAgeMs: result.stateAgeMs,
          odds: result.odds,
          reportedAt: Date.now(),
        },
      }, window.location.origin);
    } catch (error) {}
  }

  // =======================================================================
  // TRAVAS
  // =======================================================================

  function consumeIntent(order) {
    const actionId = typeof order.actionId === 'string' ? order.actionId : '';
    const issuedAt = Number(order.issuedAt);
    const now = Date.now();

    if (consumedActionIds.size > 0) {
      for (const [id, timestamp] of consumedActionIds) {
        if (now - timestamp > CONSUMED_TTL_MS) consumedActionIds.delete(id);
      }
    }

    if (
      !actionId ||
      !Number.isFinite(issuedAt) ||
      issuedAt > now + 1_000 ||
      now - issuedAt > MAX_INTENT_AGE_MS
    ) {
      return 'invalid_intent';
    }
    if (consumedActionIds.has(actionId)) return 'replayed_intent';

    consumedActionIds.set(actionId, now);
    while (consumedActionIds.size > MAX_CONSUMED_IDS) {
      consumedActionIds.delete(consumedActionIds.keys().next().value);
    }
    return '';
  }

  // Janela deslizante própria: `src/securityGuard.js` vive no mundo ISOLATED e
  // não é visível daqui.
  function withinRateLimit() {
    const now = Date.now();
    while (rateWindow.length > 0 && now - rateWindow[0] >= RATE_LIMIT_WINDOW_MS) {
      rateWindow.shift();
    }
    if (rateWindow.length >= RATE_LIMIT_MAX) return false;
    rateWindow.push(now);
    return true;
  }

  function resolveUrl(endpoint) {
    if (typeof endpoint !== 'string' || endpoint === '') return null;
    try {
      const base = window.location && window.location.href ? window.location.href : undefined;
      const url = new URL(endpoint, base);
      if (url.protocol !== 'https:') return null;
      return url;
    } catch (error) {
      return null;
    }
  }

  // Mesma origem sempre; outro host só com allowlist explícita configurada pela
  // extensão. Sem isso, qualquer script da página poderia usar o despachante
  // como proxy da sessão autenticada.
  function hostAllowed(url) {
    const origin = window.location && window.location.origin;
    if (origin && url.origin === origin) return true;
    const host = url.hostname.toLowerCase();
    for (let index = 0; index < settings.allowedHosts.length; index += 1) {
      const allowed = settings.allowedHosts[index];
      if (host === allowed || host.endsWith(`.${allowed}`)) return true;
    }
    return false;
  }

  function sanitizeHeaders(source, target) {
    if (source === null || source === undefined) return '';
    if (typeof source !== 'object') return 'invalid_config';

    const names = Object.keys(source);
    if (names.length > MAX_HEADERS) return 'invalid_config';

    for (let index = 0; index < names.length; index += 1) {
      const name = names[index];
      const lower = name.toLowerCase();
      const value = source[name];
      if (name.length > MAX_HEADER_NAME_LENGTH || !/^[\w-]+$/.test(name)) return 'invalid_config';
      if (typeof value !== 'string' || value.length > MAX_HEADER_VALUE_LENGTH) {
        return 'invalid_config';
      }
      if (FORBIDDEN_HEADERS.has(lower) || lower.startsWith('proxy-') || lower.startsWith('sec-')) {
        return 'forbidden_header';
      }
      target[name] = value;
    }
    return '';
  }

  function decodeJsonPointer(pointer) {
    if (typeof pointer !== 'string' || !pointer.startsWith('/') || pointer.length > 512) {
      return null;
    }
    const raw = pointer.slice(1).split('/');
    if (raw.length === 0 || raw.length > 12) return null;
    const decoded = [];
    for (let index = 0; index < raw.length; index += 1) {
      const segment = raw[index];
      if (segment === '' || /~(?![01])/g.test(segment)) return null;
      decoded.push(segment.replace(/~1/g, '/').replace(/~0/g, '~'));
    }
    return decoded;
  }

  // Copia somente os ramos percorridos pelo JSON Pointer. O corpo recebido por
  // postMessage ja e um structured clone, mas o despachante tambem possui API
  // direta no MAIN world e nao deve mutar o objeto desse chamador.
  function setBodyPointer(body, pointer, value) {
    const segments = decodeJsonPointer(pointer);
    if (segments === null || body === null || typeof body !== 'object') return null;

    const rootCopy = Array.isArray(body) ? body.slice() : { ...body };
    let source = body;
    let target = rootCopy;
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      const last = index === segments.length - 1;
      if (Array.isArray(source) && !/^\d+$/.test(segment)) return null;
      if (!Object.prototype.hasOwnProperty.call(source, segment)) return null;
      if (last) {
        target[segment] = value;
        return rootCopy;
      }
      const nextSource = source[segment];
      if (nextSource === null || typeof nextSource !== 'object') return null;
      const nextTarget = Array.isArray(nextSource) ? nextSource.slice() : { ...nextSource };
      target[segment] = nextTarget;
      source = nextSource;
      target = nextTarget;
    }
    return null;
  }

  // Resolve `bodyContext` em campos de topo ou JSON Pointers. Apenas os ramos
  // tocados sao clonados e so campos da allowlist entram no payload.
  function applyBodyContext(body, mapping, context) {
    if (mapping === null || mapping === undefined) return { error: '', body };
    if (typeof mapping !== 'object' || Array.isArray(mapping)) {
      return { error: 'invalid_config', body: null };
    }

    const keys = Object.keys(mapping);
    if (keys.length === 0) return { error: '', body };
    if (keys.length > MAX_BODY_CONTEXT_KEYS) return { error: 'invalid_config', body: null };
    // Corpo já serializado (string) ou lista não aceita injeção de campo: o
    // chamador precisa mandar objeto para o mapa fazer sentido.
    if (body !== null && body !== undefined && typeof body !== 'object') {
      return { error: 'invalid_config', body: null };
    }

    let merged = body === null || body === undefined
      ? {}
      : (Array.isArray(body) ? body.slice() : { ...body });
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      const field = mapping[key];
      if (typeof field !== 'string' || !BODY_CONTEXT_FIELDS.has(field)) {
        return { error: 'invalid_config', body: null };
      }
      if (context[field] === null || context[field] === undefined) {
        return { error: 'body_failed', body: null };
      }
      if (key.startsWith('/')) {
        const next = setBodyPointer(merged, key, context[field]);
        if (next === null) return { error: 'invalid_config', body: null };
        merged = next;
      } else {
        if (Array.isArray(merged) || !/^[\w.-]{1,128}$/.test(key)) {
          return { error: 'invalid_config', body: null };
        }
        merged[key] = context[field];
      }
    }
    return { error: '', body: merged };
  }

  // O corpo pode ser string pronta, objeto (serializado), função que recebe o
  // contexto já validado — mercados precisam do preço corrente no payload — ou
  // objeto acompanhado de `bodyContext` para o caminho que vem por mensagem.
  function buildBody(order, context) {
    let body = order.body;
    if (typeof body === 'function') {
      try {
        body = body(context);
      } catch (error) {
        return { error: 'body_failed', body: null };
      }
    }

    const contextResult = applyBodyContext(body, order.bodyContext, context);
    if (contextResult.error !== '') return contextResult;
    body = contextResult.body;

    if (body === null || body === undefined) return { error: '', body: null };
    if (typeof body !== 'string') {
      try {
        body = JSON.stringify(body);
      } catch (error) {
        return { error: 'body_failed', body: null };
      }
    }
    if (typeof body !== 'string' || body.length > MAX_BODY_LENGTH) {
      return { error: 'invalid_config', body: null };
    }
    return { error: '', body };
  }

  function readState(selectionId, result) {
    const cache = window.__gbrMarketStateCache;
    if (!cache || typeof cache.readInto !== 'function') return 'no_cache';
    if (cache.readInto(selectionId, stateScratch) !== true) return 'unknown_state';

    const ageMs = stateScratch.ageMs;
    result.odds = stateScratch.odds;
    result.suspended = stateScratch.suspended;
    result.stateAgeMs = ageMs;
    result.revision = stateScratch.revision;

    // `suspended` só libera em `false` explícito: `null` significa que a casa
    // ainda não informou o estado da linha, e desconhecido não é aberto.
    if (stateScratch.suspended !== false) return 'suspended';

    const maxAge = Number(settings.maxStateAgeMs);
    if (Number.isFinite(maxAge) && maxAge > 0 && ageMs > maxAge) return 'stale_state';
    return '';
  }

  function clampTimeout(value) {
    const requested = Number(value);
    if (!Number.isFinite(requested) || requested <= 0) return DEFAULT_TIMEOUT_MS;
    return requested > MAX_TIMEOUT_MS ? MAX_TIMEOUT_MS : requested;
  }

  function isAbortError(error) {
    return Boolean(error) && (error.name === 'AbortError' || error.code === 20);
  }

  // =======================================================================
  // DESPACHO
  // =======================================================================

  async function dispatchDirectOrder(order) {
    const startedAt = monotonicNow();
    stats.requested += 1;

    if (order === null || typeof order !== 'object') {
      return finalize(createResult('invalid_config', false, null));
    }

    const result = createResult('pending', false, order);

    if (!enabled) {
      result.code = 'disabled';
      return finalize(result);
    }
    if (ORIGINAL_FETCH === null) {
      result.code = 'no_fetch';
      return finalize(result);
    }

    const selectionId = result.selectionId;
    const stake = result.stake;
    if (selectionId === '' || selectionId.length > 96) {
      result.code = 'invalid_config';
      return finalize(result);
    }
    if (stake === null || !(stake > 0)) {
      result.code = 'invalid_stake';
      return finalize(result);
    }
    // `Number(null)` é 0, então o teto só vale quando foi realmente configurado.
    if (
      settings.maxStake !== null &&
      Number.isFinite(Number(settings.maxStake)) &&
      stake > Number(settings.maxStake)
    ) {
      result.code = 'stake_above_cap';
      return finalize(result);
    }

    const url = resolveUrl(order.endpoint);
    if (url === null) {
      result.code = 'invalid_endpoint';
      return finalize(result);
    }
    if (!hostAllowed(url)) {
      result.code = 'host_not_allowed';
      return finalize(result);
    }

    const method = typeof order.method === 'string' ? order.method.toUpperCase() : 'POST';
    if (!/^[A-Z]{3,7}$/.test(method)) {
      result.code = 'invalid_config';
      return finalize(result);
    }

    const headers = {};
    const headerError = sanitizeHeaders(order.headers, headers);
    if (headerError !== '') {
      result.code = headerError;
      return finalize(result);
    }

    // A intenção é consumida só depois de a configuração passar: pedido
    // malformado não deve gastar o `actionId` do usuário.
    const intentError = consumeIntent(order);
    if (intentError !== '') {
      result.code = intentError;
      return finalize(result);
    }
    if (!withinRateLimit()) {
      result.code = 'rate_limited';
      return finalize(result);
    }
    if (inFlight.has(selectionId)) {
      result.code = 'in_flight';
      return finalize(result);
    }

    const stateError = readState(selectionId, result);
    if (stateError !== '') {
      result.code = stateError;
      return finalize(result);
    }

    // Guardas de preço opcionais: a odd do cache é a mais recente conhecida,
    // então o chamador pode exigir um piso ou uma tolerância contra o preço que
    // o usuário viu na tela.
    const minOdds = Number(order.minOdds);
    if (Number.isFinite(minOdds) && !(Number(result.odds) >= minOdds)) {
      result.code = 'odds_below_min';
      return finalize(result);
    }
    const expectedOdds = Number(order.expectedOdds);
    if (Number.isFinite(expectedOdds)) {
      const tolerance = Number.isFinite(Number(order.oddsTolerance))
        ? Math.abs(Number(order.oddsTolerance))
        : 0;
      const current = Number(result.odds);
      if (!Number.isFinite(current) || Math.abs(current - expectedOdds) > tolerance) {
        result.code = 'odds_moved';
        return finalize(result);
      }
    }

    const context = {
      selectionId,
      selectionIdNumber: Number.isFinite(Number(selectionId)) ? Number(selectionId) : null,
      stake,
      stakeMinor: Math.round(stake * 100),
      stakeFixed2: stake.toFixed(2),
      odds: result.odds,
      oddsText: Number.isFinite(Number(result.odds)) ? String(result.odds) : null,
      suspended: result.suspended,
      marketId: stateScratch.marketId,
      marketIdNumber: Number.isFinite(Number(stateScratch.marketId))
        ? Number(stateScratch.marketId)
        : null,
      eventId: stateScratch.eventId,
      eventIdNumber: Number.isFinite(Number(stateScratch.eventId))
        ? Number(stateScratch.eventId)
        : null,
      lineVersion: stateScratch.lineVersion,
      revision: result.revision,
      stateAgeMs: result.stateAgeMs,
      actionId: result.actionId,
    };
    const bodyResult = buildBody(order, context);
    if (bodyResult.error !== '') {
      result.code = bodyResult.error;
      return finalize(result);
    }

    result.validationMs = monotonicNow() - startedAt;

    // Ensaio: valida tudo e não envia nada. Serve para conferir credenciais,
    // payload e travas sem mover dinheiro.
    if (order.dryRun === true || settings.dryRun === true) {
      result.code = 'dry_run';
      return finalize(result);
    }

    const controller = AbortControllerImpl !== null ? new AbortControllerImpl() : null;
    const timeoutMs = clampTimeout(
      order.timeoutMs !== undefined ? order.timeoutMs : settings.timeoutMs,
    );
    let timeoutId = null;
    let timedOut = false;

    const init = {
      method,
      headers,
      // O cookie da sessão ativa viaja aqui. Não existe caminho para montar um
      // header `Cookie` manual em `fetch`, e nenhum cookie é lido pelo módulo.
      credentials: 'include',
      cache: 'no-store',
      redirect: 'follow',
    };
    if (bodyResult.body !== null && method !== 'GET' && method !== 'HEAD') {
      init.body = bodyResult.body;
    }
    if (controller !== null) {
      init.signal = controller.signal;
      if (order.signal && typeof order.signal.addEventListener === 'function') {
        order.signal.addEventListener('abort', () => controller.abort(), { once: true });
      }
      if (setTimer !== null) {
        timeoutId = setTimer(() => {
          timedOut = true;
          controller.abort();
        }, timeoutMs);
      }
    }

    inFlight.add(selectionId);
    stats.attempted += 1;
    result.attempted = true;
    const requestAt = monotonicNow();

    try {
      const response = await ORIGINAL_FETCH(url.href, init);
      // RTT = ida e volta até os cabeçalhos, que é quando a casa já decidiu.
      result.rtt = monotonicNow() - requestAt;
      result.status = Number(response.status) || 0;

      let text = '';
      if (order.readResponse !== false && typeof response.text === 'function') {
        try {
          text = await response.text();
        } catch (error) {
          text = '';
        }
      }
      result.totalMs = monotonicNow() - requestAt;
      result.response = typeof text === 'string' ? text.slice(0, MAX_RESPONSE_CHARS) : '';
      result.ok = response.ok === true;
      result.code = result.ok ? 'ok' : 'http_error';
      return finalize(result);
    } catch (error) {
      result.totalMs = monotonicNow() - requestAt;
      result.code = timedOut ? 'timeout' : isAbortError(error) ? 'aborted' : 'network_error';
      result.error = String(error && error.message ? error.message : error).slice(0, 200);
      // Sem reenvio automático: a ordem pode ter chegado à casa mesmo sem
      // resposta. Repetir aqui é o caminho para a aposta dobrada.
      return finalize(result);
    } finally {
      if (timeoutId !== null && clearTimer !== null) clearTimer(timeoutId);
      inFlight.delete(selectionId);
    }
  }

  // =======================================================================
  // CONFIGURAÇÃO E API
  // =======================================================================

  function configure(patch) {
    if (patch === null || typeof patch !== 'object') return snapshotSettings();

    if (Array.isArray(patch.allowedHosts)) {
      const hosts = [];
      for (let index = 0; index < patch.allowedHosts.length && hosts.length < 16; index += 1) {
        const host = patch.allowedHosts[index];
        if (typeof host === 'string' && /^[a-z0-9.-]{4,120}$/i.test(host)) {
          hosts.push(host.toLowerCase());
        }
      }
      settings.allowedHosts = hosts;
    }
    if (patch.maxStake === null || Number.isFinite(Number(patch.maxStake))) {
      settings.maxStake = patch.maxStake === null ? null : Number(patch.maxStake);
    }
    if (Number.isFinite(Number(patch.maxStateAgeMs))) {
      settings.maxStateAgeMs = Number(patch.maxStateAgeMs);
    }
    if (patch.timeoutMs !== undefined) settings.timeoutMs = clampTimeout(patch.timeoutMs);
    if (typeof patch.dryRun === 'boolean') settings.dryRun = patch.dryRun;
    if (typeof patch.publishResults === 'boolean') settings.publishResults = patch.publishResults;
    return snapshotSettings();
  }

  function snapshotSettings() {
    return {
      allowedHosts: settings.allowedHosts.slice(),
      maxStake: settings.maxStake,
      maxStateAgeMs: settings.maxStateAgeMs,
      timeoutMs: settings.timeoutMs,
      dryRun: settings.dryRun,
      publishResults: settings.publishResults,
    };
  }

  function snapshotStats() {
    return {
      dispatcherVersion: DISPATCHER_VERSION,
      enabled,
      installed: stopDispatcher !== null,
      cacheAvailable: typeof window.__gbrMarketStateCache?.readInto === 'function',
      inFlight: inFlight.size,
      requested: stats.requested,
      attempted: stats.attempted,
      succeeded: stats.succeeded,
      rejected: stats.rejected,
      failed: stats.failed,
      timedOut: stats.timedOut,
      lastCode: stats.lastCode,
      lastRtt: stats.lastRtt,
      minRtt: stats.minRtt,
      maxRtt: stats.maxRtt,
      averageRtt: stats.attempted > 0 ? stats.totalRtt / stats.attempted : 0,
    };
  }

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

  const dispatcherApi = {
    dispatcherVersion: DISPATCHER_VERSION,
    dispatch: dispatchDirectOrder,
    configure,
    settings: snapshotSettings,
    stats: snapshotStats,
    isEnabled: () => enabled,
  };

  function installDispatcher() {
    if (stopDispatcher !== null) return;

    defineGlobal('__dispatchDirectOrder', dispatchDirectOrder);
    defineGlobal('__gbrNetworkDispatcher', dispatcherApi);
    window.__gbrDirectOrderInstalled = true;

    stopDispatcher = () => {
      try {
        window.__gbrDirectOrderInstalled = false;
        rateWindow.length = 0;
        consumedActionIds.clear();
        inFlight.clear();
        delete window.__dispatchDirectOrder;
        delete window.__gbrNetworkDispatcher;
        stopDispatcher = null;
        delete window.__gbrDirectOrderStop;
      } catch (error) {}
    };
    window.__gbrDirectOrderStop = stopDispatcher;
  }

  // Mesmo contrato de controle do feed: apenas a própria janela e a própria
  // origem podem armar, desarmar ou pedir despacho.
  //
  // Armar e mover dinheiro são mensagens SEPARADAS de propósito:
  // `GBR_DIRECT_ORDER_CONTROL` liga/desliga e configura, e nunca despacha;
  // `GBR_DIRECT_ORDER_REQUEST` despacha, e nunca liga o despachante. Assim uma
  // mensagem de armar não pode virar aposta, e um pedido que chegue com o
  // despachante desarmado devolve `disabled` sem tocar na rede.
  window.addEventListener('message', (event) => {
    if (
      event.source !== window ||
      event.origin !== window.location.origin ||
      event.data?.schemaVersion !== 1
    ) return;

    const type = event.data.type;

    if (type === 'GBR_DIRECT_ORDER_CONTROL') {
      if (event.data.settings) configure(event.data.settings);
      enabled = event.data.enabled === true;
      window.__GBR_DIRECT_ORDER_ENABLED = enabled;
      if (enabled) installDispatcher();
      else window.__gbrDirectOrderStop?.();
      return;
    }

    if (type === 'GBR_DIRECT_ORDER_REQUEST') {
      const order = event.data.order;
      // Pedido sem objeto de ordem não gera resultado: sem `actionId` a ponte
      // não teria como correlacionar, e a mensagem não deve gastar intenção.
      if (order === null || typeof order !== 'object') return;
      // O resultado volta pelo `postMessage` de `publishResult`, não por aqui.
      void dispatchDirectOrder(order);
    }
  });

  // Desligado por padrão: nada de rede financeira sem a flag local ligada.
  window.__GBR_DIRECT_ORDER_ENABLED = enabled;
  if (enabled) installDispatcher();
})();
