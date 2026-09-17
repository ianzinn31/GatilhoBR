// =========================================================================
// GATILHOBR - PONTE DE ORDEM DIRETA (MUNDO ISOLATED)
// =========================================================================
//
// Única passagem entre a extensão e o despachante do MAIN world
// (`src/core/networkDispatcher.js`). O MAIN world não vê `chrome.*` e o mundo
// isolado não vê `window.__dispatchDirectOrder`, então tudo atravessa por
// `postMessage` na própria origem.
//
// Dois tipos de mensagem, de propósito separados:
//   `GBR_DIRECT_ORDER_CONTROL` — arma, desarma e configura. Nunca despacha.
//   `GBR_DIRECT_ORDER_REQUEST` — despacha uma ordem. Nunca arma.
// Assim nenhuma mensagem de armar pode virar aposta.
//
// Travas desta camada:
//   - `actionId` de uso único gerado aqui, com `issuedAt` do instante do pedido;
//   - uma ordem por seleção em voo, para tecla repetida não gastar intenção;
//   - `dryRun` ligado por padrão: mesmo armada, a ponte só move dinheiro quando
//     o armazenamento diz `dryRun: false` de forma explícita;
//   - resultado só é aceito se o `actionId` nasceu aqui (a página também pode
//     publicar `GBR_DIRECT_ORDER_RESULT`, e resultado forjado não é diagnóstico).

(function installDirectOrderBridge() {
  'use strict';

  if (typeof window === 'undefined' || window.__gbrDirectOrderBridgeBooted === true) return;
  // Frame único: dinheiro sai da janela principal, não de iframe de anúncio.
  if (window !== window.top) return;
  window.__gbrDirectOrderBridgeBooted = true;

  const BRIDGE_VERSION = 1;

  const EXPERIMENT_KEY = 'gbr_direct_order_experiment';
  const SETTINGS_KEY = 'gbr_direct_order_settings';
  const REQUEST_KEY = 'gbr_direct_order_request';

  const DEFAULT_TIMEOUT_MS = 4_000;
  const MAX_TIMEOUT_MS = 15_000;
  // Margem sobre o tempo limite do despachante: se nem assim o resultado
  // chegou, o MAIN world não respondeu e o estado da ordem é desconhecido.
  const BRIDGE_TIMEOUT_MARGIN_MS = 1_500;
  const ISSUED_TTL_MS = 60_000;
  const MAX_ISSUED_IDS = 256;
  const MAX_HEADERS = 24;
  const MAX_HEADER_VALUE_LENGTH = 4_096;
  const MAX_BODY_LENGTH = 65_536;
  const MAX_BODY_CONTEXT_KEYS = 16;
  const MAX_ALLOWED_HOSTS = 16;

  // Espelho da allowlist do despachante: o mapa declarativo substitui a função
  // de corpo, que não atravessa `postMessage`.
  const BODY_CONTEXT_FIELDS = [
    'selectionId', 'selectionIdNumber', 'stake', 'stakeMinor', 'stakeFixed2',
    'odds', 'oddsText', 'suspended', 'marketId', 'marketIdNumber', 'eventId',
    'eventIdNumber', 'lineVersion', 'revision', 'stateAgeMs', 'actionId',
  ];

  const BLOCKED_HEADERS = [
    'cookie', 'cookie2', 'host', 'origin', 'referer', 'connection',
    'content-length', 'transfer-encoding', 'upgrade', 'via', 'date',
    'accept-encoding', 'accept-charset', 'keep-alive', 'expect', 'te', 'trailer',
  ];

  const RESULT_CODE_PATTERN = /^[a-z_]{2,32}$/;

  let armed = false;
  let dispatcherSettings = defaultSettings();
  let requestTemplate = null;
  let mainRuntimeReady = null;
  let mainRuntimeRecovery = null;

  // `actionId` -> entrada pendente. `pendingBySelection` evita gastar intenção
  // com a mesma seleção enquanto a anterior não respondeu.
  const pending = new Map();
  const pendingBySelection = new Map();
  const issued = new Map();
  const resultHandlers = [];

  const stats = {
    bridgeVersion: BRIDGE_VERSION,
    dispatched: 0,
    resolved: 0,
    timedOut: 0,
    rejectedLocally: 0,
    lateResults: 0,
    spoofedResults: 0,
    lastCode: '',
    lastRtt: 0,
  };

  const setTimer = typeof window.setTimeout === 'function' ? window.setTimeout.bind(window) : null;
  const clearTimer = typeof window.clearTimeout === 'function'
    ? window.clearTimeout.bind(window)
    : null;

  function monotonicNow() {
    const perf = window.performance;
    return perf && typeof perf.now === 'function' ? perf.now() : Date.now();
  }

  function defaultSettings() {
    return {
      allowedHosts: [],
      maxStake: null,
      maxStateAgeMs: 1_500,
      timeoutMs: DEFAULT_TIMEOUT_MS,
      // Padrão seguro: armar não é autorizar gasto.
      dryRun: true,
      // A ponte depende do diagnóstico para correlacionar o resultado.
      publishResults: true,
    };
  }

  function normalizeId(id) {
    if (typeof id === 'string') return id.slice(0, 96);
    if (typeof id === 'number') return Number.isFinite(id) ? String(id) : '';
    return '';
  }

  function clampTimeout(value) {
    const requested = Number(value);
    if (!Number.isFinite(requested) || requested <= 0) return DEFAULT_TIMEOUT_MS;
    return requested > MAX_TIMEOUT_MS ? MAX_TIMEOUT_MS : requested;
  }

  function createActionId() {
    const random = window.crypto && typeof window.crypto.randomUUID === 'function'
      ? window.crypto.randomUUID()
      : `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
    return `gbr-direct-${Date.now().toString(36)}-${random}`;
  }

  function rememberIssued(actionId) {
    const now = Date.now();
    for (const [id, timestamp] of issued) {
      if (now - timestamp > ISSUED_TTL_MS) issued.delete(id);
    }
    issued.set(actionId, now);
    while (issued.size > MAX_ISSUED_IDS) {
      issued.delete(issued.keys().next().value);
    }
  }

  // =======================================================================
  // VALIDAÇÃO DA CONFIGURAÇÃO ARMAZENADA
  // =======================================================================

  function sanitizeSettings(raw) {
    const next = defaultSettings();
    if (raw === null || typeof raw !== 'object') return next;

    if (Array.isArray(raw.allowedHosts)) {
      const hosts = [];
      for (let index = 0; index < raw.allowedHosts.length; index += 1) {
        if (hosts.length >= MAX_ALLOWED_HOSTS) break;
        const host = raw.allowedHosts[index];
        if (typeof host === 'string' && /^[a-z0-9.-]{4,120}$/i.test(host)) {
          hosts.push(host.toLowerCase());
        }
      }
      next.allowedHosts = hosts;
    }
    if (raw.maxStake === null) next.maxStake = null;
    else if (Number.isFinite(Number(raw.maxStake)) && Number(raw.maxStake) > 0) {
      next.maxStake = Number(raw.maxStake);
    }
    const maxStateAgeMs = Number(raw.maxStateAgeMs);
    if (Number.isFinite(maxStateAgeMs) && maxStateAgeMs >= 100 && maxStateAgeMs <= 10_000) {
      next.maxStateAgeMs = maxStateAgeMs;
    }
    if (raw.timeoutMs !== undefined) next.timeoutMs = clampTimeout(raw.timeoutMs);
    // Só `false` explícito no armazenamento libera envio real.
    if (raw.dryRun === false) next.dryRun = false;
    return next;
  }

  function sanitizeHeaders(raw) {
    if (raw === null || raw === undefined) return { ok: true, headers: null };
    if (typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'headers' };

    const names = Object.keys(raw);
    if (names.length > MAX_HEADERS) return { ok: false, reason: 'headers' };

    const headers = {};
    for (let index = 0; index < names.length; index += 1) {
      const name = names[index];
      const value = raw[name];
      const lower = name.toLowerCase();
      if (!/^[\w-]{1,64}$/.test(name)) return { ok: false, reason: 'header_name' };
      if (typeof value !== 'string' || value.length > MAX_HEADER_VALUE_LENGTH) {
        return { ok: false, reason: 'header_value' };
      }
      if (
        BLOCKED_HEADERS.indexOf(lower) !== -1 ||
        lower.indexOf('proxy-') === 0 ||
        lower.indexOf('sec-') === 0
      ) {
        return { ok: false, reason: 'forbidden_header' };
      }
      headers[name] = value;
    }
    return { ok: true, headers };
  }

  function sanitizeBodyContext(raw) {
    if (raw === null || raw === undefined) return { ok: true, bodyContext: null };
    if (typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'body_context' };

    const keys = Object.keys(raw);
    if (keys.length === 0) return { ok: true, bodyContext: null };
    if (keys.length > MAX_BODY_CONTEXT_KEYS) return { ok: false, reason: 'body_context' };

    const bodyContext = {};
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      const field = raw[key];
      const validKey = key.startsWith('/')
        ? key.length <= 512 && /^\/(?:[^/~]|~[01])+(?:\/(?:[^/~]|~[01])+)*$/.test(key)
        : /^[\w.-]{1,128}$/.test(key);
      if (!validKey) return { ok: false, reason: 'body_context_key' };
      if (typeof field !== 'string' || BODY_CONTEXT_FIELDS.indexOf(field) === -1) {
        return { ok: false, reason: 'body_context_field' };
      }
      bodyContext[key] = field;
    }
    return { ok: true, bodyContext };
  }

  // O modelo de requisição vem do armazenamento da extensão, nunca da página.
  // Nada de endpoint de casa embutido no código: quem configura é o usuário.
  function sanitizeRequestTemplate(raw) {
    if (raw === null || typeof raw !== 'object') return { ok: false, reason: 'missing' };

    const endpoint = typeof raw.endpoint === 'string' ? raw.endpoint.trim() : '';
    if (endpoint === '' || endpoint.length > 2_048) return { ok: false, reason: 'endpoint' };
    let url = null;
    try {
      url = new URL(endpoint, window.location.href);
    } catch (error) {
      return { ok: false, reason: 'endpoint' };
    }
    if (url.protocol !== 'https:') return { ok: false, reason: 'endpoint_scheme' };

    const method = typeof raw.method === 'string' ? raw.method.toUpperCase() : 'POST';
    if (!/^[A-Z]{3,7}$/.test(method)) return { ok: false, reason: 'method' };

    const headerResult = sanitizeHeaders(raw.headers);
    if (!headerResult.ok) return { ok: false, reason: headerResult.reason };

    const contextResult = sanitizeBodyContext(raw.bodyContext);
    if (!contextResult.ok) return { ok: false, reason: contextResult.reason };

    let body = null;
    if (typeof raw.body === 'string') {
      if (raw.body.length > MAX_BODY_LENGTH) return { ok: false, reason: 'body' };
      // Corpo em texto não aceita `bodyContext`: não há onde injetar o campo.
      if (contextResult.bodyContext !== null) return { ok: false, reason: 'body_context_string' };
      body = raw.body;
    } else if (raw.body !== null && raw.body !== undefined) {
      if (typeof raw.body !== 'object') {
        return { ok: false, reason: 'body' };
      }
      try {
        const serialized = JSON.stringify(raw.body);
        if (typeof serialized !== 'string' || serialized.length > MAX_BODY_LENGTH) {
          return { ok: false, reason: 'body' };
        }
        // Cópia por serialização: o modelo guardado fica imune a mutação
        // posterior e já está pronto para o structured clone.
        body = JSON.parse(serialized);
      } catch (error) {
        return { ok: false, reason: 'body' };
      }
    }

    return {
      ok: true,
      template: {
        endpoint: url.href,
        host: url.hostname.toLowerCase(),
        method,
        headers: headerResult.headers,
        body,
        bodyContext: contextResult.bodyContext,
        readResponse: raw.readResponse !== false,
        timeoutMs: raw.timeoutMs !== undefined ? clampTimeout(raw.timeoutMs) : null,
      },
    };
  }

  // =======================================================================
  // CONTROLE DO MAIN WORLD
  // =======================================================================

  function publishControl(nextEnabled, settingsPatch) {
    try {
      const message = {
        type: 'GBR_DIRECT_ORDER_CONTROL',
        schemaVersion: 1,
        enabled: nextEnabled === true,
      };
      if (settingsPatch) message.settings = settingsPatch;
      window.postMessage(message, window.location.origin);
      return true;
    } catch (error) {
      return false;
    }
  }

  function settlePendingWith(code) {
    for (const actionId of Array.from(pending.keys())) {
      settle(actionId, localResult(code, pending.get(actionId).selectionId, actionId, null));
    }
  }

  function setArmed(nextArmed) {
    const next = nextArmed === true;
    if (next) {
      armed = publishControl(true, dispatcherSettings);
      return armed;
    }
    armed = false;
    publishControl(false);
    // Desarmar não deixa promessa pendurada: quem esperava recebe recusa.
    settlePendingWith('bridge_disarmed');
    return false;
  }

  function configure(patch) {
    dispatcherSettings = sanitizeSettings({ ...dispatcherSettings, ...(patch || {}) });
    if (armed) publishControl(true, dispatcherSettings);
    return snapshotSettings();
  }

  function snapshotSettings() {
    return {
      allowedHosts: dispatcherSettings.allowedHosts.slice(),
      maxStake: dispatcherSettings.maxStake,
      maxStateAgeMs: dispatcherSettings.maxStateAgeMs,
      timeoutMs: dispatcherSettings.timeoutMs,
      dryRun: dispatcherSettings.dryRun,
      publishResults: dispatcherSettings.publishResults,
    };
  }

  // =======================================================================
  // DESPACHO
  // =======================================================================

  function localResult(code, selectionId, actionId, attempted) {
    stats.lastCode = code;
    return {
      bridgeVersion: BRIDGE_VERSION,
      dispatcherVersion: 0,
      actionId: typeof actionId === 'string' ? actionId : '',
      selectionId: selectionId || '',
      ok: false,
      code,
      // `null` significa desconhecido: só o despachante sabe se a requisição
      // saiu, e quem não sabe não pode repetir a ordem.
      attempted: attempted === undefined ? false : attempted,
      status: 0,
      rtt: 0,
      totalMs: 0,
      stateAgeMs: null,
      odds: null,
      bridgeMs: 0,
      reportedAt: Date.now(),
      fromBridge: true,
    };
  }

  function notifyHandlers(result) {
    for (let index = 0; index < resultHandlers.length; index += 1) {
      try {
        resultHandlers[index](result);
      } catch (error) {}
    }
  }

  function settle(actionId, result) {
    const entry = pending.get(actionId);
    if (!entry) {
      // Resultado atrasado: a promessa já foi resolvida por tempo limite. Ainda
      // vale como diagnóstico, mas não desfaz nada.
      stats.lateResults += 1;
      notifyHandlers({ ...result, late: true });
      return;
    }
    pending.delete(actionId);
    if (pendingBySelection.get(entry.selectionId) === actionId) {
      pendingBySelection.delete(entry.selectionId);
    }
    if (entry.timer !== null && clearTimer !== null) clearTimer(entry.timer);

    const finalResult = { ...result, bridgeMs: monotonicNow() - entry.startedAt };
    stats.lastCode = finalResult.code;
    if (finalResult.code === 'bridge_timeout') stats.timedOut += 1;
    else stats.resolved += 1;
    if (Number.isFinite(finalResult.rtt) && finalResult.rtt > 0) stats.lastRtt = finalResult.rtt;

    entry.resolve(finalResult);
    notifyHandlers(finalResult);
  }

  function dispatch(request) {
    const input = request !== null && typeof request === 'object' ? request : {};
    const selectionId = normalizeId(input.selectionId);

    if (!armed) {
      stats.rejectedLocally += 1;
      return Promise.resolve(localResult('bridge_disarmed', selectionId, '', false));
    }
    if (requestTemplate === null) {
      stats.rejectedLocally += 1;
      return Promise.resolve(localResult('bridge_no_template', selectionId, '', false));
    }
    if (selectionId === '') {
      stats.rejectedLocally += 1;
      return Promise.resolve(localResult('bridge_no_selection', '', '', false));
    }
    const stake = Number(input.stake);
    if (!Number.isFinite(stake) || stake <= 0) {
      stats.rejectedLocally += 1;
      return Promise.resolve(localResult('bridge_invalid_stake', selectionId, '', false));
    }
    // Tecla repetida na mesma seleção não gasta intenção nova.
    if (pendingBySelection.has(selectionId)) {
      stats.rejectedLocally += 1;
      return Promise.resolve(localResult('bridge_in_flight', selectionId, '', false));
    }
    if (setTimer === null) {
      stats.rejectedLocally += 1;
      return Promise.resolve(localResult('bridge_no_timer', selectionId, '', false));
    }

    const actionId = createActionId();
    const timeoutMs = clampTimeout(
      input.timeoutMs !== undefined
        ? input.timeoutMs
        : (requestTemplate.timeoutMs !== null ? requestTemplate.timeoutMs : dispatcherSettings.timeoutMs),
    );

    // Intenção fresca gerada agora: `issuedAt` é o instante do pedido, e o
    // despachante recusa qualquer coisa com mais de 5 s.
    const order = {
      actionId,
      issuedAt: Date.now(),
      selectionId,
      stake,
      endpoint: requestTemplate.endpoint,
      method: requestTemplate.method,
      readResponse: requestTemplate.readResponse,
      timeoutMs,
    };
    if (requestTemplate.headers !== null) order.headers = requestTemplate.headers;
    if (requestTemplate.body !== null) order.body = requestTemplate.body;
    if (requestTemplate.bodyContext !== null) order.bodyContext = requestTemplate.bodyContext;
    if (Number.isFinite(Number(input.minOdds))) order.minOdds = Number(input.minOdds);
    if (Number.isFinite(Number(input.expectedOdds))) order.expectedOdds = Number(input.expectedOdds);
    if (Number.isFinite(Number(input.oddsTolerance))) {
      order.oddsTolerance = Math.abs(Number(input.oddsTolerance));
    }
    if (input.dryRun === true || dispatcherSettings.dryRun === true) order.dryRun = true;

    rememberIssued(actionId);
    stats.dispatched += 1;

    return new Promise((resolve) => {
      const entry = { selectionId, resolve, startedAt: monotonicNow(), timer: null };
      pending.set(actionId, entry);
      pendingBySelection.set(selectionId, actionId);

      entry.timer = setTimer(() => {
        // O MAIN world não respondeu: `attempted` fica desconhecido e ninguém
        // repete a ordem por conta própria.
        settle(actionId, localResult('bridge_timeout', selectionId, actionId, null));
      }, timeoutMs + BRIDGE_TIMEOUT_MARGIN_MS);

      let posted = false;
      try {
        window.postMessage(
          { type: 'GBR_DIRECT_ORDER_REQUEST', schemaVersion: 1, order },
          window.location.origin,
        );
        posted = true;
      } catch (error) {}
      if (!posted) settle(actionId, localResult('bridge_post_failed', selectionId, actionId, false));
    });
  }

  // =======================================================================
  // RESULTADO DO MAIN WORLD (DADO NÃO CONFIÁVEL)
  // =======================================================================

  function clampNumber(value, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return null;
    if (number < min) return min;
    if (number > max) return max;
    return number;
  }

  function sanitizeResult(raw) {
    if (raw === null || typeof raw !== 'object') return null;
    const actionId = typeof raw.actionId === 'string' ? raw.actionId.slice(0, 128) : '';
    const code = typeof raw.code === 'string' ? raw.code : '';
    if (actionId === '' || !RESULT_CODE_PATTERN.test(code)) return null;

    return {
      bridgeVersion: BRIDGE_VERSION,
      dispatcherVersion: clampNumber(raw.dispatcherVersion, 0, 999) ?? 0,
      actionId,
      selectionId: normalizeId(raw.selectionId),
      ok: raw.ok === true,
      code,
      attempted: raw.attempted === true ? true : raw.attempted === false ? false : null,
      status: clampNumber(raw.status, 0, 599) ?? 0,
      rtt: clampNumber(raw.rtt, 0, 600_000) ?? 0,
      totalMs: clampNumber(raw.totalMs, 0, 600_000) ?? 0,
      stateAgeMs: clampNumber(raw.stateAgeMs, 0, 600_000),
      odds: clampNumber(raw.odds, 0, 1_000_000),
      bridgeMs: 0,
      reportedAt: clampNumber(raw.reportedAt, 0, Number.MAX_SAFE_INTEGER) ?? Date.now(),
      fromBridge: true,
    };
  }

  window.addEventListener('message', (event) => {
    if (
      event.source !== window ||
      event.origin !== window.location.origin ||
      event.data === null ||
      typeof event.data !== 'object' ||
      event.data.type !== 'GBR_DIRECT_ORDER_RESULT' ||
      event.data.schemaVersion !== 1
    ) return;

    const result = sanitizeResult(event.data.result);
    if (result === null) return;
    // Qualquer script da página pode publicar esta mensagem. Só vale resultado
    // cujo `actionId` foi gerado aqui — nunca um sucesso inventado pela casa.
    if (!issued.has(result.actionId)) {
      stats.spoofedResults += 1;
      return;
    }
    settle(result.actionId, result);
  });

  // =======================================================================
  // ARMAZENAMENTO E MENSAGENS DA EXTENSÃO
  // =======================================================================

  function storageArea() {
    try {
      const area = typeof chrome !== 'undefined' && chrome.storage ? chrome.storage.local : null;
      return area && typeof area.get === 'function' ? area : null;
    } catch (error) {
      return null;
    }
  }

  function applyStored(stored) {
    dispatcherSettings = sanitizeSettings(stored ? stored[SETTINGS_KEY] : null);
    const template = sanitizeRequestTemplate(stored ? stored[REQUEST_KEY] : null);
    requestTemplate = template.ok ? template.template : null;
    setArmed(stored ? stored[EXPERIMENT_KEY] === true : false);
  }

  function reloadFromStorage() {
    const area = storageArea();
    if (area === null) return;
    try {
      const request = area.get([EXPERIMENT_KEY, SETTINGS_KEY, REQUEST_KEY]);
      if (request && typeof request.then === 'function') {
        request.then((stored) => applyStored(stored)).catch(() => {});
        return;
      }
      // Ambiente sem promessa em `storage.get`: cai para o estilo de callback.
      area.get([EXPERIMENT_KEY, SETTINGS_KEY, REQUEST_KEY], (stored) => applyStored(stored));
    } catch (error) {}
  }

  // Uma aba pode manter o mundo ISOLATED depois de um reload da extensao e
  // perder os scripts do MAIN world. Pedir a recuperacao no boot evita esperar
  // o primeiro disparo para descobrir isso. A mensagem somente instala os
  // modulos passivos e republica a configuracao; nunca contem uma ordem.
  function ensureMainRuntime() {
    if (mainRuntimeReady === true) return Promise.resolve(true);
    if (mainRuntimeRecovery !== null) return mainRuntimeRecovery;
    try {
      if (
        typeof chrome === 'undefined' ||
        !chrome.runtime ||
        typeof chrome.runtime.sendMessage !== 'function'
      ) {
        return Promise.resolve(false);
      }
      mainRuntimeRecovery = Promise.resolve(
        chrome.runtime.sendMessage({ action: 'ENSURE_BET365_MAIN_RUNTIME' }),
      )
        .then((response) => {
          mainRuntimeReady = response?.ready === true;
          if (mainRuntimeReady && armed) publishControl(true, dispatcherSettings);
          return mainRuntimeReady;
        })
        .catch(() => {
          mainRuntimeReady = false;
          return false;
        })
        .finally(() => {
          mainRuntimeRecovery = null;
        });
      return mainRuntimeRecovery;
    } catch (error) {
      mainRuntimeReady = false;
      mainRuntimeRecovery = null;
      return Promise.resolve(false);
    }
  }

  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' || !changes) return;
        if (
          changes[EXPERIMENT_KEY] === undefined &&
          changes[SETTINGS_KEY] === undefined &&
          changes[REQUEST_KEY] === undefined
        ) return;
        reloadFromStorage();
      });
    }
  } catch (error) {}

  try {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (!message || typeof message.type !== 'string') return undefined;
        if (message.type === 'ENABLE_DIRECT_ORDER') {
          reloadFromStorage();
          if (typeof sendResponse === 'function') sendResponse({ ok: true, armed });
          return undefined;
        }
        if (message.type === 'DISABLE_DIRECT_ORDER') {
          setArmed(false);
          if (typeof sendResponse === 'function') sendResponse({ ok: true, armed: false });
          return undefined;
        }
        if (message.type === 'DIRECT_ORDER_STATUS') {
          if (typeof sendResponse === 'function') sendResponse(describe());
          return undefined;
        }
        return undefined;
      });
    }
  } catch (error) {}

  // =======================================================================
  // INTERFACE PARA O RESTO DA EXTENSÃO
  // =======================================================================

  // Diagnóstico sem segredo: host e presença de cabeçalho, nunca o valor deles.
  function describe() {
    return {
      bridgeVersion: BRIDGE_VERSION,
      armed,
      hasTemplate: requestTemplate !== null,
      endpointHost: requestTemplate !== null ? requestTemplate.host : '',
      method: requestTemplate !== null ? requestTemplate.method : '',
      headerCount: requestTemplate !== null && requestTemplate.headers !== null
        ? Object.keys(requestTemplate.headers).length
        : 0,
      bodyContextKeys: requestTemplate !== null && requestTemplate.bodyContext !== null
        ? Object.keys(requestTemplate.bodyContext)
        : [],
      dryRun: dispatcherSettings.dryRun,
      pending: pending.size,
      dispatcherInstalled:
        (armed && mainRuntimeReady === true) || window.__GBR_DIRECT_ORDER_ENABLED === true,
      mainRuntimeReady,
    };
  }

  const bridgeApi = {
    bridgeVersion: BRIDGE_VERSION,
    isArmed: () => armed,
    isReady: () => armed && requestTemplate !== null,
    arm: () => setArmed(true),
    disarm: () => setArmed(false),
    configure,
    settings: snapshotSettings,
    setRequestTemplate(raw) {
      const template = sanitizeRequestTemplate(raw);
      if (!template.ok) return { ok: false, reason: template.reason };
      requestTemplate = template.template;
      return { ok: true, describe: describe() };
    },
    clearRequestTemplate() {
      requestTemplate = null;
    },
    dispatch,
    onResult(handler) {
      if (typeof handler !== 'function') return () => {};
      resultHandlers.push(handler);
      return () => {
        const index = resultHandlers.indexOf(handler);
        if (index !== -1) resultHandlers.splice(index, 1);
      };
    },
    // Usado pelo `content.js`: resultado com `actionId` desconhecido não é
    // diagnóstico desta extensão e não deve virar telemetria nem aviso na tela.
    wasIssuedHere: (actionId) => typeof actionId === 'string' && issued.has(actionId),
    stats: () => ({ ...stats, pending: pending.size, armed, hasTemplate: requestTemplate !== null }),
    describe,
    reload: reloadFromStorage,
    ensureMainRuntime,
  };

  try {
    Object.defineProperty(window, 'GatilhoBRDirectOrder', {
      value: bridgeApi,
      writable: false,
      enumerable: false,
      configurable: true,
    });
  } catch (error) {
    window.GatilhoBRDirectOrder = bridgeApi;
  }

  // Desarmado até o armazenamento dizer o contrário.
  reloadFromStorage();
  void ensureMainRuntime();
})();
