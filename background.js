// =========================================================================
// SERVICE WORKER CENTRAL - FAST TRIGGER PRO (MULTI-ABAS & MULTI-CASAS)
// =========================================================================

importScripts("src/core/directOrderAutoSetup.js");
importScripts("src/installationState.js");

let currentMarketState = {
  groups: [],
  betslip: "",
  eventContext: null,
  lastUpdate: 0,
};
// Última configuração recebida do painel Electron. O Chrome real pode não
// compartilhar storage.sync com o app; usamos este cache para transportar a
// stake efetiva junto dos comandos de bind.
let electronConfigCache = {};

try {
  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    chrome.storage.local.get(
      ["latestElectronConfig", "stakeVal", "fastTriggerStakeVal", "stakeValByHouse", "gbr_stake_by_house"],
      (res) => {
        if (chrome.runtime?.lastError || !res) return;
        if (res.latestElectronConfig && typeof res.latestElectronConfig === "object") {
          latestElectronConfig = { ...res.latestElectronConfig };
          electronConfigCache = { ...electronConfigCache, ...res.latestElectronConfig };
        } else if (res.stakeVal || res.fastTriggerStakeVal) {
          const loadedStake = String(res.stakeVal || res.fastTriggerStakeVal);
          const loadedByHouse = res.stakeValByHouse || res.gbr_stake_by_house || {};
          latestElectronConfig = {
            stakeVal: loadedStake,
            stakeValByHouse: loadedByHouse,
          };
          electronConfigCache = {
            stakeVal: loadedStake,
            stakeValByHouse: loadedByHouse,
          };
        }
      }
    );
  }
} catch (_) {}

// Resolve a stake por casa de forma tolerante ao formato/capitalizacao usado
// pelo painel Electron (ex.: betnacional, Betnacional, betNacional).  Manter
// esta logica num unico ponto evita que comandos de selecao/bind caiam no valor
// global quando o mapa por casa estiver presente.
function resolveConfiguredStakeForHouse(house, config = electronConfigCache) {
  const normalized = String(house || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  const byHouse = config?.stakeValByHouse;
  if (byHouse && typeof byHouse === "object" && !Array.isArray(byHouse)) {
    const key = Object.keys(byHouse).find(
      (candidate) => String(candidate).trim().toLowerCase().replace(/[^a-z0-9]/g, "") === normalized,
    );
    const value = key !== undefined ? byHouse[key] : null;
    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value);
    }
  }
  const global = config?.stakeVal ?? config?.stake ?? config?.stakeValue;
  return global !== undefined && global !== null && String(global).trim()
    ? String(global)
    : null;
}

// Registro de portas ativas
const activePorts = new Set();
// Ponte opcional para o aplicativo desktop. A extensao continua inteiramente
// funcional quando o host ainda nao foi instalado (caso comum no primeiro uso).
// O canal aceita apenas snapshots/status; comandos de aposta nunca atravessam
// esta fronteira.
const NATIVE_HOST_NAME = "com.gatilho.native_messaging";
const NATIVE_RECONNECT_MIN_MS = 1500;
const NATIVE_RECONNECT_MAX_MS = 30000;
let nativeMessagingPort = null;
let nativeReconnectTimer = null;
let nativeReconnectDelayMs = NATIVE_RECONNECT_MIN_MS;
let nativeHostAvailable = false;

function scheduleNativeReconnect() {
  if (nativeReconnectTimer) return;
  const delay = nativeReconnectDelayMs;
  nativeReconnectDelayMs = Math.min(
    NATIVE_RECONNECT_MAX_MS,
    Math.round(nativeReconnectDelayMs * 1.8),
  );
  nativeReconnectTimer = setTimeout(() => {
    nativeReconnectTimer = null;
    connectNativeHost();
  }, delay);
}

function postToNativeHost(message) {
  if (!nativeMessagingPort || !message || typeof message !== "object") return false;
  try {
    nativeMessagingPort.postMessage({
      protocol: "gatilhobr-native-v1",
      sentAt: Date.now(),
      ...message,
    });
    return true;
  } catch (error) {
    return false;
  }
}

function nativeSnapshotPayload(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return null;
  // Native Messaging tem limite de tamanho por frame. Nunca mandamos o
  // betslip (nao e necessario para a dashboard externa) e reduzimos somente
  // snapshots excepcionalmente grandes, mantendo os primeiros mercados.
  const safe = {
    ...snapshot,
    betslip: "",
    groups: Array.isArray(snapshot.groups) ? snapshot.groups.slice(0, 300) : [],
  };
  try {
    while (safe.groups.length > 1 && JSON.stringify(safe).length > 750000) {
      safe.groups = safe.groups.slice(0, Math.ceil(safe.groups.length / 2));
    }
    return JSON.stringify(safe).length <= 900000 ? safe : null;
  } catch (error) {
    return null;
  }
}

function relayNativeMarketUpdate(message) {
  if (!message || typeof message !== "object") return;
  const siteName = String(message.siteName || message.payload?.siteName || "").slice(0, 32);
  const payload = message.payload && typeof message.payload === "object"
    ? message.payload
    : message;
  if (!siteName) return;
  const snapshot = recordMarketSnapshot(siteName, {
    ...payload,
    siteName,
    source: "native-host",
    capturedAt: Number(payload.capturedAt) || Date.now(),
    lastUpdate: Number(payload.lastUpdate) || Date.now(),
  });
  if (!snapshot) return;
  currentMarketState = snapshot;
  void broadcastConnectionStatus(snapshot);
}

// Comandos vindos da dashboard Electron percorrem o caminho inverso da ponte:
// Electron -> host nativo -> Service Worker do Chrome -> content script da
// casa.  Eles já foram validados como uma ação explícita pelo background do
// Electron; aqui só fazemos a entrega à porta real da aba, nunca executamos
// código nem geramos cliques no Service Worker.
const NATIVE_BRIDGE_COMMAND_TYPES = new Set([
  "UPDATE_CONFIG",
  "SELECT_ODDS",
  "SELECT_ODDS_ACTION",
  "REQUEST_MARKET_UPDATE",
  "PREPARE_DYNAMIC_BIND",
  "EXECUTE_DYNAMIC_BIND",
  "DYNAMIC_BIND_ACTION",
  "DYNAMIC_BIND_ACTION_BATCH",
  "DISPARAR_APOSTA",
  "TRIGGER_BET_ACTION",
  "COMMIT_DYNAMIC_BIND",
  "CANCEL_DYNAMIC_BIND",
]);

function relayNativeCommandToHouse(message) {
  if (!message || typeof message !== "object") return false;
  let type = String(message.type || message.action || "");
  const requestedHouseRaw =
    message.house || message.houseKey || message.siteName || message.payload?.house;
  const requestedHouse = requestedHouseRaw
    ? marketHouseKey(requestedHouseRaw)
    : null;

  const fallbackStake =
    resolveConfiguredStakeForHouse(requestedHouse) ||
    latestElectronConfig?.stakeVal ||
    electronConfigCache?.stakeVal ||
    "";

  if (type === "SELECT_ODDS_ACTION" || type === "SELECT_ODDS") {
    const effectiveStake =
      message.stake ||
      message.stakeVal ||
      message.payload?.stake ||
      message.payload?.stakeVal ||
      fallbackStake;

    message = {
      ...message,
      ...(message.payload || {}),
      type: "SELECT_ODDS",
      val: message.val || message.odds || message.payload?.odds || message.payload?.val || "",
      odds: message.odds || message.val || message.payload?.odds || message.payload?.val || "",
      stake: effectiveStake,
      stakeVal: effectiveStake,
      name: message.name || message.payload?.name || "",
      marketTitle: message.marketTitle || message.payload?.marketTitle || "",
      outcomeId: message.outcomeId || message.payload?.outcomeId || "",
      optionLabel: message.optionLabel || message.payload?.optionLabel || "",
      lineName: message.lineName || message.payload?.lineName || "",
      colIndex: message.colIndex !== undefined ? message.colIndex : message.payload?.colIndex,
      rowIndex: message.rowIndex !== undefined ? message.rowIndex : message.payload?.rowIndex,
      fastMode: message.fastMode === true || message.payload?.fastMode === true || true,
    };
    type = "SELECT_ODDS";
  } else if (
    type === "DISPARAR_APOSTA" ||
    type === "EXECUTE_DIRECT_TRIGGER" ||
    type === "TRIGGER_BET_ACTION"
  ) {
    const triggerStake =
      message.stakeVal ||
      message.stake ||
      message.payload?.stakeVal ||
      message.payload?.stake ||
      fallbackStake;
    message.stakeVal = triggerStake;
    message.stake = triggerStake;
    message.action = "DISPARAR_APOSTA";
    message.type = "DISPARAR_APOSTA";
    type = "DISPARAR_APOSTA";
  } else if (type === "DYNAMIC_BIND_ACTION" || type === "EXECUTE_DYNAMIC_BIND") {
    const bindStake =
      message.stakeVal ||
      message.stake ||
      fallbackStake;
    if (bindStake) {
      message.stakeVal = bindStake;
      message.stake = bindStake;
    }
  }
  const isBetTrigger = type === "DISPARAR_APOSTA" || type === "EXECUTE_DIRECT_TRIGGER";
  if (!isBetTrigger && !NATIVE_BRIDGE_COMMAND_TYPES.has(type)) return false;

  let delivered = 0;
  const deliveredPorts = new Set();
  const deliveredTabs = new Set();

  activeTradingTabs.forEach((tabInfo) => {
    if (!tabInfo?.port || deliveredPorts.has(tabInfo.port)) return;
    const tabHouse = marketHouseKey(tabInfo.siteName);
    if (requestedHouse && tabHouse && !tabHouse.includes(requestedHouse) && !requestedHouse.includes(tabHouse)) return;
    try {
      tabInfo.port.postMessage({ ...message, __gbrElectronAuthorized: true });
      deliveredPorts.add(tabInfo.port);
      if (tabInfo.tabId) deliveredTabs.add(tabInfo.tabId);
      delivered += 1;
    } catch (error) {}
  });

  // Fallback direto via chrome.tabs.query / chrome.tabs.sendMessage
  try {
    const houseUrlPatterns = {
      superbet: [
        "*://superbet.bet.br/*",
        "*://*.superbet.bet.br/*",
        "*://superbet.com/*",
        "*://*.superbet.com/*",
      ],
      betano: [
        "*://betano.bet.br/*",
        "*://*.betano.bet.br/*",
      ],
      bet365: [
        "*://*.bet365.com/*",
        "*://*.bet365.bet.br/*",
        "*://*.bet365.es/*",
      ],
      betfair: [
        "*://*.betfair.com/*",
        "*://*.betfair.bet.br/*",
        "*://*.betfair.es/*",
      ],
      betnacional: [
        "*://betnacional.com/*",
        "*://*.betnacional.com/*",
        "*://betnacional.bet.br/*",
        "*://*.betnacional.bet.br/*",
        "*://betnacional.br/*",
        "*://*.betnacional.br/*",
      ],
      betmgm: [
        "*://betmgm.bet.br/*",
        "*://*.betmgm.bet.br/*",
      ],
    };

    const urlPatterns = requestedHouse && houseUrlPatterns[requestedHouse]
      ? houseUrlPatterns[requestedHouse]
      : ["*://*/*"];

    if (typeof chrome !== "undefined" && chrome.tabs && typeof chrome.tabs.query === "function") {
      chrome.tabs.query({ url: urlPatterns }).then((tabs) => {
        if (!Array.isArray(tabs)) return;
        tabs.forEach((tab) => {
          if (!tab.id || deliveredTabs.has(tab.id)) return;
          const detected = detectSiteFromUrl(tab.url);
          const tabHouse = detected ? marketHouseKey(detected) : null;
          if (requestedHouse && tabHouse && tabHouse !== requestedHouse) return;

          try {
            chrome.tabs.sendMessage(
              tab.id,
              { ...message, __gbrElectronAuthorized: true },
              { frameId: 0 }
            ).then(() => {
              deliveredTabs.add(tab.id);
              console.log(`[Native Bridge] ${type} entregue via tabs.sendMessage na aba ${tab.id} (${tabHouse || "casa"})`);
            }).catch(() => {});
          } catch (_) {}
        });
      }).catch(() => {});
    }
  } catch (err) {
    console.warn("[Native Bridge] Falha ao consultar abas para envio direto:", err);
  }

  console.log(
    `[Native Bridge] ${type} encaminhado para ${delivered} porta(s) ativas` +
      (requestedHouse ? ` (${requestedHouse})` : ""),
  );
  return delivered > 0;
}

function handleNativeHostMessage(rawMessage) {
  // Electron escreve comandos dentro deste envelope. Sem desempacotar, um
  // SELECT_ODDS chega com `type` vazio e é silenciosamente descartado antes de
  // alcançar a aba Bet365 real.
  if (
    rawMessage &&
    rawMessage.direction === "to-extension" &&
    rawMessage.message &&
    typeof rawMessage.message === "object"
  ) {
    rawMessage = {
      ...rawMessage.message,
      // Keep the synthetic-port destination when the command itself does
      // not carry a house (for example DISPARAR_APOSTA broadcasts).
      houseKey: rawMessage.message.houseKey || rawMessage.houseKey || "",
    };
  }
  // O host de diagnostico também pode responder com { type: 'relay', ... }.
  // Essa resposta é apenas ACK e nunca deve voltar ao host, evitando loops.
  if (!rawMessage || typeof rawMessage !== "object" || rawMessage.type === "relay") return;
  const type = String(rawMessage.type || rawMessage.action || "");
  if (type === "NATIVE_HELLO_ACK") return;
  if (type === "UPDATE_CONFIG" || rawMessage.action === "UPDATE_CONFIG") {
    if (rawMessage.config && typeof rawMessage.config === "object") {
      latestElectronConfig = { ...rawMessage.config };
      electronConfigCache = { ...electronConfigCache, ...rawMessage.config };
      try {
        chrome.storage.local.set({
          fastTriggerStakeVal: rawMessage.config.stakeVal,
          stakeVal: rawMessage.config.stakeVal,
          stakeValByHouse: rawMessage.config.stakeValByHouse,
          gbr_stake_by_house: rawMessage.config.stakeValByHouse,
          latestElectronConfig: rawMessage.config,
        });
      } catch (_) {}
      activeTradingTabs.forEach((tabInfo) => {
        if (!tabInfo?.port) return;
        try {
          tabInfo.port.postMessage({
            action: "UPDATE_CONFIG",
            config: latestElectronConfig,
            __gbrElectronAuthorized: true,
          });
        } catch (_) {}
      });
    }
  }
  if (type === "MARKET_DATA_UPDATE") {
    relayNativeMarketUpdate(rawMessage);
    return;
  }
  if (type === "SYNC_DASHBOARD") {
    const payload = rawMessage.payload;
    if (!payload || typeof payload !== "object") return;
    relayNativeMarketUpdate({ type: "MARKET_DATA_UPDATE", siteName: payload.siteName, payload });
    return;
  }
  relayNativeCommandToHouse(rawMessage);
}

function connectNativeHost() {
  if (nativeMessagingPort) return;
  try {
    const port = chrome.runtime.connectNative(NATIVE_HOST_NAME);
    nativeMessagingPort = port;
    nativeHostAvailable = true;
    nativeReconnectDelayMs = NATIVE_RECONNECT_MIN_MS;
    port.onMessage.addListener(handleNativeHostMessage);
    port.onDisconnect.addListener(() => {
      if (nativeMessagingPort !== port) return;
      nativeMessagingPort = null;
      nativeHostAvailable = false;
      scheduleNativeReconnect();
    });
    postToNativeHost({
      type: "NATIVE_HELLO",
      payload: {
        extensionId: chrome.runtime.id,
        version: chrome.runtime.getManifest().version,
        capabilities: ["MARKET_DATA_UPDATE", "SYNC_DASHBOARD"],
      },
    });
  } catch (error) {
    nativeHostAvailable = false;
    scheduleNativeReconnect();
  }
}
const EXECUTION_REPORTS_SESSION_KEY = "gbr_execution_reports_v1";
const MAX_EXECUTION_REPORTS = 100;
let executionReports = [];
let executionReportsWriteTimer = null;

function sanitizeExecutionReport(report) {
  if (!report || typeof report !== "object") return null;
  const timestamps = report.timestamps && typeof report.timestamps === "object"
    ? report.timestamps
    : {};
  const oddsChange = report.oddsChange && typeof report.oddsChange === "object"
    ? report.oddsChange
    : {};
  const marketIndex = report.marketIndex && typeof report.marketIndex === "object"
    ? report.marketIndex
    : {};
  const latency = report.latency && typeof report.latency === "object"
    ? report.latency
    : {};
  const numberOrNull = (value) =>
    Number.isFinite(Number(value)) ? Number(value) : null;
  return {
    schemaVersion: 1,
    actionId: String(report.actionId || "").slice(0, 160),
    house: String(report.house || "").slice(0, 32),
    keyCode: String(report.keyCode || "").slice(0, 32),
    intentSource: String(report.intentSource || "").slice(0, 32),
    intentType: String(report.intentType || "").slice(0, 32),
    oddsChange: {
      policy: String(oddsChange.policy || "").slice(0, 32),
      decision: String(oddsChange.decision || "").slice(0, 40),
      expectedOdds: numberOrNull(oddsChange.expectedOdds),
      currentOdds: numberOrNull(oddsChange.currentOdds),
    },
    stage: String(report.stage || "").slice(0, 24),
    outcome: String(report.outcome || "").slice(0, 24),
    reasonCode: String(report.reasonCode || "").slice(0, 64),
    clickAttempted: report.clickAttempted === true,
    // Caminho usado (DOM_UI ou DIRECT_NETWORK) e de onde veio o selectionId.
    // Sem estes dois campos o relatório comparativo não separa os fluxos.
    executionMode: String(report.executionMode || "").slice(0, 24),
    executionModeChanged: report.executionModeChanged === true,
    selectionSource: String(report.selectionSource || "").slice(0, 40),
    latency: {
      rttMs: numberOrNull(latency.rttMs),
      totalMs: numberOrNull(latency.totalMs),
      stateAgeMs: numberOrNull(latency.stateAgeMs),
    },
    marketIndex: {
      hit: marketIndex.hit === true,
      miss: marketIndex.miss === true,
    },
    timestamps: {
      // T0: chegada do frame de WebSocket que descreve a seleção.
      frameSeenAt: numberOrNull(timestamps.frameSeenAt),
      intentAt: numberOrNull(timestamps.intentAt),
      routedAt: numberOrNull(timestamps.routedAt),
      targetReadyAt: numberOrNull(timestamps.targetReadyAt),
      selectionReadyAt: numberOrNull(timestamps.selectionReadyAt),
      stakeReadyAt: numberOrNull(timestamps.stakeReadyAt),
      ctaReadyAt: numberOrNull(timestamps.ctaReadyAt),
      oddsChangeAt: numberOrNull(timestamps.oddsChangeAt),
      commitSentAt: numberOrNull(timestamps.commitSentAt),
      resultAt: numberOrNull(timestamps.resultAt),
    },
    updatedAt: numberOrNull(report.updatedAt) || Date.now(),
  };
}

async function restoreExecutionReports() {
  try {
    const stored = await chrome.storage.session.get([EXECUTION_REPORTS_SESSION_KEY]);
    const reports = Array.isArray(stored?.[EXECUTION_REPORTS_SESSION_KEY])
      ? stored[EXECUTION_REPORTS_SESSION_KEY]
      : [];
    executionReports = reports
      .map(sanitizeExecutionReport)
      .filter(Boolean)
      .slice(-MAX_EXECUTION_REPORTS);
  } catch (error) {
    executionReports = [];
  }
}

function scheduleExecutionReportsPersist() {
  if (executionReportsWriteTimer) return;
  executionReportsWriteTimer = setTimeout(() => {
    executionReportsWriteTimer = null;
    void chrome.storage.session
      .set({ [EXECUTION_REPORTS_SESSION_KEY]: executionReports })
      .catch(() => {});
  }, 60);
}

function recordExecutionReport(report) {
  const safeReport = sanitizeExecutionReport(report);
  if (!safeReport?.actionId) return null;
  const index = executionReports.findIndex(
    (entry) => entry.actionId === safeReport.actionId,
  );
  if (index >= 0) executionReports[index] = safeReport;
  else executionReports.push(safeReport);
  if (executionReports.length > MAX_EXECUTION_REPORTS) {
    executionReports = executionReports.slice(-MAX_EXECUTION_REPORTS);
  }
  scheduleExecutionReportsPersist();
  return safeReport;
}

void restoreExecutionReports();

const MARKET_SNAPSHOTS_SESSION_KEY = "gbr_market_snapshots_v1";
// Mantém um snapshot por casa suportada (incluindo Betano e Superbet), sem
// expulsar a Betano quando as demais casas atualizam em sequência.
const MAX_MARKET_SNAPSHOT_HOUSES = 8;
const MAX_MARKET_SNAPSHOT_AGE_MS = 5 * 60 * 1000;
// A aba "Todos os mercados" da Betfair publica um snapshot grande a cada rodada.
// Persistir a cada 250 ms serializava dezenas de mercados várias vezes por
// segundo sem ganho: o storage de sessão só serve para reidratar o worker.
const MARKET_SNAPSHOTS_WRITE_DEBOUNCE_MS = 1200;
// Recalcular as casas conectadas custa até quatro chrome.tabs.query. Isso não
// pode acontecer a cada atualização de mercado.
const CONNECTION_STATUS_CACHE_MS = 3000;
let connectionStatusCache = null;
let connectionStatusCacheAt = 0;
let lastBroadcastConnectionStatus = null;
let marketSnapshotsWriteTimer = null;
globalThis.marketStatesByHouse = globalThis.marketStatesByHouse || new Map();

function marketHouseKey(siteName) {
  const value = String(siteName || "").toLowerCase();
  if (value.includes("betfair")) return "betfair";
  if (value.includes("betnacional")) return "betnacional";
  if (value.includes("betano")) return "betano";
  if (value.includes("betmgm")) return "betmgm";
  if (value.includes("superbet")) return "superbet";
  if (value.includes("bet365")) return "bet365";
  return value.replace(/[^a-z0-9]+/g, "").slice(0, 32);
}

function sanitizeMarketSnapshot(siteName, payload, stale = false) {
  if (!payload || typeof payload !== "object") return null;
  const resolvedSiteName = String(siteName || payload.siteName || "").slice(0, 32);
  if (!resolvedSiteName) return null;

  const now = Date.now();
  const lastUpdate = Number(payload.lastUpdate) || now;
  const capturedAt = Number(payload.capturedAt) || lastUpdate;
  if (
    stale === true &&
    (!Number.isFinite(capturedAt) || now - capturedAt > MAX_MARKET_SNAPSHOT_AGE_MS)
  ) {
    return null;
  }

  const snapshot = {
    schemaVersion: 1,
    groups: Array.isArray(payload.groups) ? payload.groups : [],
    betslip: String(payload.betslip || "").slice(0, 4000),
    eventContext:
      payload.eventContext && typeof payload.eventContext === "object"
        ? {
            teams: Array.isArray(payload.eventContext.teams)
              ? payload.eventContext.teams.map((team) => String(team).slice(0, 100)).slice(0, 4)
              : [],
            eventLabel: String(payload.eventContext.eventLabel || "").slice(0, 220),
          }
        : null,
    frameEvidence: Array.isArray(payload.frameEvidence)
      ? payload.frameEvidence.slice(0, 32).map((frame) => ({
          frameToken: String(frame?.frameToken || "").slice(0, 32),
          origin: String(frame?.origin || "").slice(0, 160),
          marketNodeCount: Math.max(0, Math.min(500, Number(frame?.marketNodeCount) || 0)),
          lastSeenAt: Number(frame?.lastSeenAt) || null,
        }))
      : [],
    siteName: resolvedSiteName,
    lastUpdate,
    // Preserve the original capture time when rehydrating the service worker.
    // Replacing it with Date.now() would make an old event look fresh again.
    capturedAt,
    stale: stale === true,
    source: String(payload.source || "").slice(0, 48),
    forced: stale !== true && payload.forced === true,
    // IDs existem apenas no snapshot vivo para confirmar uma sincronização
    // manual específica. Nunca são reidratados do storage como se fossem ACKs.
    syncRequestIds:
      stale !== true && Array.isArray(payload.syncRequestIds)
        ? [...new Set(payload.syncRequestIds.map((value) => String(value || "").slice(0, 96)).filter(Boolean))].slice(0, 8)
        : [],
  };

  try {
    // O payload chega por porta (já é uma cópia estruturada e serializável) e os
    // campos acima são construídos explicitamente. A ida e volta por JSON só é
    // necessária na reidratação a partir do storage, onde a origem é externa.
    return stale === true ? JSON.parse(JSON.stringify(snapshot)) : snapshot;
  } catch (error) {
    return null;
  }
}

async function restoreMarketSnapshots() {
  try {
    const stored = await chrome.storage.session.get([MARKET_SNAPSHOTS_SESSION_KEY]);
    const snapshots = stored?.[MARKET_SNAPSHOTS_SESSION_KEY];
    if (!snapshots || typeof snapshots !== "object") return;

    Object.entries(snapshots)
      .slice(0, MAX_MARKET_SNAPSHOT_HOUSES)
      .forEach(([houseKey, value]) => {
        const snapshot = sanitizeMarketSnapshot(
          value?.siteName || houseKey,
          value,
          true,
        );
        if (snapshot) globalThis.marketStatesByHouse.set(houseKey, snapshot);
      });

    const latest = [...globalThis.marketStatesByHouse.values()]
      .sort((left, right) => Number(right.capturedAt || 0) - Number(left.capturedAt || 0))[0];
    if (latest) currentMarketState = latest;
  } catch (error) {}
}

function scheduleMarketSnapshotsPersist() {
  if (marketSnapshotsWriteTimer) return;
  marketSnapshotsWriteTimer = setTimeout(() => {
    marketSnapshotsWriteTimer = null;
    const snapshots = Object.fromEntries(
      [...globalThis.marketStatesByHouse.entries()]
        .slice(0, MAX_MARKET_SNAPSHOT_HOUSES)
        .map(([houseKey, snapshot]) => [houseKey, { ...snapshot, stale: true }]),
    );
    void chrome.storage.session
      .set({ [MARKET_SNAPSHOTS_SESSION_KEY]: snapshots })
      .catch(() => {});
  }, MARKET_SNAPSHOTS_WRITE_DEBOUNCE_MS);
}

function recordMarketSnapshot(siteName, payload) {
  const houseKey = marketHouseKey(siteName);
  if (!houseKey) return null;
  const snapshot = sanitizeMarketSnapshot(siteName, payload, false);
  if (!snapshot) return null;
  globalThis.marketStatesByHouse.set(houseKey, snapshot);
  scheduleMarketSnapshotsPersist();
  return snapshot;
}

function emptyMarketSnapshot(siteName) {
  return {
    schemaVersion: 1,
    groups: [],
    betslip: "",
    eventContext: null,
    siteName: String(siteName || "").slice(0, 32),
    lastUpdate: 0,
    capturedAt: Date.now(),
    stale: true,
  };
}

function invalidateMarketSnapshot(siteName, notify = true) {
  const houseKey = marketHouseKey(siteName);
  if (!houseKey) return;
  globalThis.marketStatesByHouse.delete(houseKey);
  if (marketHouseKey(currentMarketState?.siteName) === houseKey) {
    currentMarketState = emptyMarketSnapshot(siteName);
  }
  if (!notify) return;

  const cleared = emptyMarketSnapshot(siteName);
  activePorts.forEach((port) => {
    try {
      port.postMessage({ type: "SYNC_DASHBOARD", payload: cleared });
    } catch (error) {}
  });
}

void restoreMarketSnapshots().then(() => {
  if (typeof broadcastConnectionStatus === "function") {
    void broadcastConnectionStatus();
  }
});

// Experimento de feed de rede: desligado por padrão, somente leitura e sem
// persistência. A execução de binds continua usando exclusivamente o DOM.
const NETWORK_FEED_EXPERIMENT_KEY = "gbr_network_feed_experiment";
const MAX_NETWORK_FEED_OBSERVATIONS = 200;
let networkFeedExperimentEnabled = false;
let networkFeedObservations = [];
const BET365_MAIN_WORLD_SCRIPT_FILES = [
  "inject.js",
  "src/core/networkDispatcher.js",
];
// A execução direta depende do mesmo observador: o despachante do MAIN world lê
// `window.__gbrMarketStateCache` de forma síncrona e devolve `no_cache` quando
// ele não existe, jogando todo disparo de volta para o fluxo visual. Ligar a
// aceleração na dashboard precisa ligar o feed sem console.
let directOrderFeedRequired = false;

function networkFeedShouldBeEnabled() {
  return networkFeedExperimentEnabled || directOrderFeedRequired;
}

function sanitizeNetworkFeedObservation(observation, tabId) {
  if (!observation || typeof observation !== "object") return null;
  const records = Array.isArray(observation.records)
    ? observation.records.slice(0, 32).map((record) => ({
        eventId: String(record?.eventId || "").slice(0, 96),
        marketId: String(record?.marketId || "").slice(0, 96),
        outcomeId: String(record?.outcomeId || "").slice(0, 96),
        odds: Number.isFinite(Number(record?.odds)) ? Number(record.odds) : null,
        suspended: typeof record?.suspended === "boolean" ? record.suspended : null,
      }))
    : [];
  const tabInfo = Number.isInteger(tabId) ? activeTradingTabs.get(tabId) : null;
  const networkSeenAt = Number(observation.networkSeenAt) || Date.now();
  const domSeenAt =
    Number(observation.domSeenAt) || Number(tabInfo?.lastMarketUpdateAt) || null;
  const correlation = observation.correlation && typeof observation.correlation === "object"
    ? observation.correlation
    : {};
  const matchedOutcomeIds = Array.isArray(correlation.matchedOutcomeIds)
    ? correlation.matchedOutcomeIds
        .slice(0, 32)
        .map((value) => String(value).slice(0, 96))
        .filter(Boolean)
    : [];
  return {
    schemaVersion: 1,
    parserVersion: Number(observation.parserVersion) || 1,
    source: "bet365",
    kind: "websocket_message",
    tabId: Number.isInteger(tabId) ? tabId : null,
    networkSeenAt,
    domSeenAt,
    leadMs: domSeenAt === null ? null : Math.max(-60_000, Math.min(60_000, domSeenAt - networkSeenAt)),
    size: Math.min(Number(observation.size) || 0, 5_000_000),
    parseable: observation.parseable === true,
    records,
    correlation: {
      domOutcomeCount: Math.max(0, Math.min(500, Number(correlation.domOutcomeCount) || 0)),
      networkOutcomeCount: Math.max(0, Math.min(500, Number(correlation.networkOutcomeCount) || 0)),
      matchedOutcomeCount: matchedOutcomeIds.length,
      matchedOutcomeIds,
    },
    receivedAt: Date.now(),
  };
}

// Telemetria da ordem direta: só latência e código de recusa, com o mesmo
// limite de memória do feed. Nada de endpoint, cabeçalho, corpo ou resposta da
// casa entra aqui, e nada é persistido.
const MAX_DIRECT_ORDER_RESULTS = 200;
let directOrderResults = [];

function sanitizeDirectOrderResult(result, tabId) {
  if (!result || typeof result !== "object") return null;
  const actionId = String(result.actionId || "").slice(0, 128);
  const code = String(result.code || "").slice(0, 32);
  if (!actionId || !/^[a-z_]{2,32}$/.test(code)) return null;

  const clamp = (value, min, max) => {
    const number = Number(value);
    if (!Number.isFinite(number)) return null;
    return Math.max(min, Math.min(max, number));
  };
  const latency = result.latency && typeof result.latency === "object" ? result.latency : {};
  return {
    schemaVersion: 1,
    source: "bet365",
    tabId: Number.isInteger(tabId) ? tabId : null,
    actionId,
    selectionId: String(result.selectionId || "").slice(0, 96),
    ok: result.ok === true,
    code,
    // `null` significa desconhecido: ordem que pode ter chegado à casa.
    attempted: result.attempted === true ? true : result.attempted === false ? false : null,
    status: clamp(result.status, 0, 599) ?? 0,
    rttMs: clamp(latency.rttMs, 0, 600_000) ?? 0,
    totalMs: clamp(latency.totalMs, 0, 600_000) ?? 0,
    stateAgeMs: clamp(latency.stateAgeMs, 0, 600_000),
    odds: clamp(result.odds, 0, 1_000_000),
    reportedAt: clamp(result.reportedAt, 0, Number.MAX_SAFE_INTEGER) ?? Date.now(),
    receivedAt: Date.now(),
  };
}

function recordDirectOrderResult(tabId, result) {
  const safeResult = sanitizeDirectOrderResult(result, tabId);
  if (!safeResult) return null;
  directOrderResults.push(safeResult);
  if (directOrderResults.length > MAX_DIRECT_ORDER_RESULTS) {
    directOrderResults = directOrderResults.slice(-MAX_DIRECT_ORDER_RESULTS);
  }
  console.debug("[FT Ordem Direta] resultado", {
    code: safeResult.code,
    ok: safeResult.ok,
    attempted: safeResult.attempted,
    status: safeResult.status,
    rttMs: safeResult.rttMs,
  });
  return safeResult;
}

function getDirectOrderMetrics() {
  const attempted = directOrderResults.filter((entry) => entry.attempted === true);
  const withRtt = attempted.filter((entry) => entry.rttMs > 0);
  const averageRttMs = withRtt.length > 0
    ? Math.round(
        withRtt.reduce((total, entry) => total + entry.rttMs, 0) / withRtt.length,
      )
    : null;
  return {
    results: directOrderResults.length,
    attempted: attempted.length,
    accepted: directOrderResults.filter((entry) => entry.ok === true).length,
    unknown: directOrderResults.filter((entry) => entry.attempted === null).length,
    averageRttMs,
    lastCode: directOrderResults.length > 0
      ? directOrderResults[directOrderResults.length - 1].code
      : "",
  };
}

function getNetworkFeedMetrics() {
  const correlated = networkFeedObservations.filter(
    (observation) =>
      observation.leadMs !== null &&
      Number.isFinite(Number(observation.leadMs)),
  );
  const positiveLead = correlated.filter((observation) => Number(observation.leadMs) >= 0);
  const averageLeadMs = correlated.length > 0
    ? Math.round(
        correlated.reduce((total, observation) => total + Number(observation.leadMs), 0) /
          correlated.length,
      )
    : null;
  return {
    observations: networkFeedObservations.length,
    correlated: correlated.length,
    positiveLead: positiveLead.length,
    averageLeadMs,
    positiveLeadRate: correlated.length > 0 ? positiveLead.length / correlated.length : null,
  };
}

function recordNetworkFeedObservation(tabId, observation) {
  if (!networkFeedExperimentEnabled) return null;
  const safeObservation = sanitizeNetworkFeedObservation(observation, tabId);
  if (!safeObservation) return null;
  networkFeedObservations.push(safeObservation);
  if (networkFeedObservations.length > MAX_NETWORK_FEED_OBSERVATIONS) {
    networkFeedObservations = networkFeedObservations.slice(-MAX_NETWORK_FEED_OBSERVATIONS);
  }
  console.debug("[FT Network Feed PoC] observação somente leitura", {
    networkSeenAt: safeObservation.networkSeenAt,
    domSeenAt: safeObservation.domSeenAt,
    leadMs: safeObservation.leadMs,
    matchedOutcomeCount: safeObservation.correlation.matchedOutcomeCount,
    records: safeObservation.records.length,
  });
  return safeObservation;
}

async function loadNetworkFeedExperimentFlag() {
  try {
    const stored = await chrome.storage.local.get([NETWORK_FEED_EXPERIMENT_KEY]);
    networkFeedExperimentEnabled = stored?.[NETWORK_FEED_EXPERIMENT_KEY] === true;
    if (networkFeedExperimentEnabled) {
      await ensureContentScriptsInBettingTabs();
    }
  } catch (error) {
    networkFeedExperimentEnabled = false;
  }
}

async function ensureNetworkFeedBridgeInTab(tabId) {
  if (!Number.isInteger(tabId)) return false;
  try {
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      files: ["src/bet365NetworkFeedBridge.js"],
    });
    return true;
  } catch (error) {
    return false;
  }
}

async function ensureBet365MainWorldRuntimeInTab(tabId) {
  if (!Number.isInteger(tabId)) return false;
  try {
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      files: BET365_MAIN_WORLD_SCRIPT_FILES,
      world: "MAIN",
    });

    // `executeScript` resolver apenas prova que o Chrome aceitou a injecao.
    // Um erro de boot engolido pelo IIFE deixava a aba conectada e o caminho
    // direto ausente, fazendo o hotkey cair no CDP. Confirme as duas APIs que
    // realmente sustentam a ordem antes de declarar a aba pronta.
    const probe = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      world: "MAIN",
      func: () => ({
        feedBooted: window.__gbrNetworkFeedMainBooted === true,
        cacheAvailable:
          typeof window.__gbrMarketStateCache?.readInto === "function",
        dispatcherBooted: window.__gbrDirectOrderBooted === true,
      }),
    });
    const state = probe?.[0]?.result;
    const ready =
      state?.feedBooted === true &&
      state?.cacheAvailable === true &&
      state?.dispatcherBooted === true;
    if (!ready) {
      console.warn(
        `[Fast Trigger SW] Runtime MAIN da Bet365 incompleto na aba ${tabId}.`,
        state || null,
      );
    }
    return ready;
  } catch (error) {
    console.warn(
      `[Fast Trigger SW] Nao foi possivel iniciar o runtime MAIN da Bet365 na aba ${tabId}:`,
      error,
    );
    return false;
  }
}

async function setNetworkFeedExperimentEnabled(enabled) {
  networkFeedExperimentEnabled = enabled === true;
  await chrome.storage.local.set({
    [NETWORK_FEED_EXPERIMENT_KEY]: networkFeedExperimentEnabled,
  });

  await applyNetworkFeedStateToTabs();
  return networkFeedExperimentEnabled;
}

// Chamado pelo estado do experimento de ordem direta (seção de aprendizado):
// ligar a aceleração arma o observador, desligar só o desarma se o diagnóstico
// manual também estiver desligado.
async function setDirectOrderFeedRequirement(required) {
  const next = required === true;
  if (next === directOrderFeedRequired) return directOrderFeedRequired;
  directOrderFeedRequired = next;
  await applyNetworkFeedStateToTabs();
  return directOrderFeedRequired;
}

async function applyNetworkFeedStateToTabs() {
  const enabled = networkFeedShouldBeEnabled();
  const tabs = await chrome.tabs.query({
    url: [
      "*://*.bet365.com/*",
      "*://*.bet365.bet.br/*",
      "*://*.bet365.es/*",
    ],
  });
  await Promise.all(tabs.map(async (tab) => {
    if (!Number.isInteger(tab?.id) || tab.status === "loading") return;
    try {
      if (enabled) {
        await injectNetworkFeedObserver(tab.id);
      } else {
        await ensureNetworkFeedBridgeInTab(tab.id);
        await chrome.tabs.sendMessage(
          tab.id,
          { action: "DISABLE_BET365_NETWORK_FEED" },
          { frameId: 0 },
        );
      }
    } catch (error) {}
  }));
  return enabled;
}

async function injectNetworkFeedObserver(tabId) {
  if (!networkFeedShouldBeEnabled() || !Number.isInteger(tabId)) return false;
  try {
    // O manifest é a primeira linha de defesa, mas uma extensão recarregada com
    // a aba aberta pode manter apenas os scripts ISOLATED reinjetados pelo
    // service worker. Sem estes dois arquivos, o controle é publicado para um
    // MAIN world sem ouvinte e o sintoma aparece como `bridge_no_selection`.
    if (!(await ensureBet365MainWorldRuntimeInTab(tabId))) return false;
    if (!(await ensureNetworkFeedBridgeInTab(tabId))) return false;
    // O directOrderBridge pode ter publicado o controle antes da reinjeção do
    // MAIN world. Forçar a releitura depois garante que o dispatcher receba a
    // configuração armazenada, sem criar ou disparar qualquer ordem.
    if (directOrderExperimentArmed) {
      await chrome.tabs.sendMessage(
        tabId,
        { type: "ENABLE_DIRECT_ORDER" },
        { frameId: 0 },
      );
    }
    await chrome.tabs.sendMessage(
      tabId,
      {
        action: "ENABLE_BET365_NETWORK_FEED",
        // Resumo por frame é diagnóstico. No caminho de execução ele só
        // acrescentaria um `postMessage` por frame no trecho sensível a
        // latência, sem ninguém para ler.
        observations: networkFeedExperimentEnabled,
      },
      { frameId: 0 },
    );
    return true;
  } catch (error) {
    return false;
  }
}

void loadNetworkFeedExperimentFlag();

const trustedTextTasksByTab = new Map();
// Evita que o mesmo disparo financeiro seja entregue duas vezes quando o
// painel/frames encaminham comandos quase simultâneos para a mesma aba.
const trustedClickTasksByTab = new Map();
const trustedDebuggerSessions = new Map();
const trustedDebuggerAttachTasks = new Map();
const TRUSTED_DEBUGGER_IDLE_MS = 900;
const TRUSTED_DEBUGGER_WARM_IDLE_MS = 4000;

async function ensureTrustedDebuggerAttached(tabId) {
  const existing = trustedDebuggerSessions.get(tabId);
  if (existing) {
    if (existing.detachingPromise) {
      await existing.detachingPromise;
      return ensureTrustedDebuggerAttached(tabId);
    }
    if (existing.detachTimer) clearTimeout(existing.detachTimer);
    existing.detachTimer = null;
    return;
  }

  const pendingAttach = trustedDebuggerAttachTasks.get(tabId);
  if (pendingAttach) return pendingAttach;

  const attachTask = (async () => {
    const debugTarget = { tabId };
    await chrome.debugger.attach(debugTarget, "1.3");
    trustedDebuggerSessions.set(tabId, {
      tabId,
      detachTimer: null,
      detachingPromise: null,
    });
  })().finally(() => {
    if (trustedDebuggerAttachTasks.get(tabId) === attachTask) {
      trustedDebuggerAttachTasks.delete(tabId);
    }
  });
  trustedDebuggerAttachTasks.set(tabId, attachTask);
  return attachTask;
}

function scheduleTrustedDebuggerDetach(tabId, idleMs = TRUSTED_DEBUGGER_IDLE_MS) {
  const session = trustedDebuggerSessions.get(tabId);
  if (!session) return;
  if (session.detachTimer) clearTimeout(session.detachTimer);
  session.detachTimer = setTimeout(() => {
    if (trustedDebuggerSessions.get(tabId) !== session) return;
    session.detachTimer = null;
    session.detachingPromise = chrome.debugger
      .detach({ tabId })
      .catch(() => {})
      .finally(() => {
        if (trustedDebuggerSessions.get(tabId) === session) {
          trustedDebuggerSessions.delete(tabId);
        }
      });
  }, idleMs);
}

// Teto da rajada de limpeza: a caixa de stake aceita poucos dígitos, então um
// `clearLength` vindo torto de outro campo não pode virar uma sequência longa de
// teclas dentro do caminho quente.
const TRUSTED_TEXT_MAX_CLEAR_KEYS = 24;

const TRUSTED_BACKSPACE_KEY = {
  type: "keyDown",
  key: "Backspace",
  code: "Backspace",
  windowsVirtualKeyCode: 8,
  nativeVirtualKeyCode: 8,
};

// O `keyUp` repete o descritor da tecla sem o texto inserido nem os comandos de
// edição — esses só valem na descida.
function trustedKeyUpPayload(keyDownPayload) {
  const { type, text, unmodifiedText, commands, ...rest } = keyDownPayload;
  return { ...rest, type: "keyUp" };
}

async function dispatchTrustedKey(debugTarget, keyDownPayload) {
  await chrome.debugger.sendCommand(
    debugTarget,
    "Input.dispatchKeyEvent",
    keyDownPayload,
  );
  await chrome.debugger.sendCommand(
    debugTarget,
    "Input.dispatchKeyEvent",
    trustedKeyUpPayload(keyDownPayload),
  );
}

/**
 * Esvazia o campo focado antes de digitar. `clearLength` é o tamanho do valor
 * que o chamador leu no DOM e serve de rede de segurança quando o atalho de
 * seleção não é interpretado como comando de edição.
 * @param {{tabId: number}} debugTarget
 * @param {number} clearLength
 */
async function clearTrustedTextField(debugTarget, clearLength, skipFallback = false) {
  const selectAllKey = {
    type: "rawKeyDown",
    modifiers: 2,
    key: "a",
    code: "KeyA",
    windowsVirtualKeyCode: 65,
    nativeVirtualKeyCode: 65,
  };

  // `commands` é o que o Chrome anexa quando o próprio usuário aperta Ctrl+A.
  // Sem esse campo o atalho chega como tecla crua: o componente pode ignorá-lo,
  // e aí o Backspace seguinte apagaria um único caractere em vez do valor todo.
  try {
    await chrome.debugger.sendCommand(debugTarget, "Input.dispatchKeyEvent", {
      ...selectAllKey,
      commands: ["selectAll"],
    });
  } catch (error) {
    // Build sem suporte ao parâmetro: mantém o atalho cru e conta com a rajada.
    await chrome.debugger.sendCommand(
      debugTarget,
      "Input.dispatchKeyEvent",
      selectAllKey,
    );
  }
  await chrome.debugger.sendCommand(
    debugTarget,
    "Input.dispatchKeyEvent",
    trustedKeyUpPayload(selectAllKey),
  );
  await dispatchTrustedKey(debugTarget, TRUSTED_BACKSPACE_KEY);

  // No caminho insertText o Ctrl+A + Backspace é suficiente para controles
  // nativos/React modernos. Evite a rajada de End/Backspace (vários RTTs CDP)
  // que só serve como rede de segurança para componentes legados.
  if (skipFallback) return;

  const extraKeys = Math.min(
    Math.max(Math.floor(Number(clearLength) || 0), 0),
    TRUSTED_TEXT_MAX_CLEAR_KEYS,
  );
  if (extraKeys === 0) return;

  // Com o campo já vazio cada tecla abaixo é inócua; com o valor intacto, `End`
  // leva o cursor para o fim e a rajada apaga o que sobrou.
  await dispatchTrustedKey(debugTarget, {
    type: "keyDown",
    key: "End",
    code: "End",
    windowsVirtualKeyCode: 35,
    nativeVirtualKeyCode: 35,
  });
  for (let index = 0; index < extraKeys; index += 1) {
    await dispatchTrustedKey(debugTarget, TRUSTED_BACKSPACE_KEY);
  }
}

async function detachTrustedDebuggerNow(tabId) {
  const pendingAttach = trustedDebuggerAttachTasks.get(tabId);
  if (pendingAttach) await pendingAttach.catch(() => {});

  const session = trustedDebuggerSessions.get(tabId);
  if (!session) return;
  if (session.detachTimer) clearTimeout(session.detachTimer);
  session.detachTimer = null;
  if (!session.detachingPromise) {
    session.detachingPromise = chrome.debugger.detach({ tabId }).catch(() => {});
  }
  await session.detachingPromise;
  if (trustedDebuggerSessions.get(tabId) === session) {
    trustedDebuggerSessions.delete(tabId);
  }
}

async function detachAllTrustedDebuggerSessions() {
  const tabIds = new Set([
    ...trustedDebuggerSessions.keys(),
    ...trustedDebuggerAttachTasks.keys(),
  ]);
  await Promise.all(
    [...tabIds].map((tabId) => detachTrustedDebuggerNow(tabId)),
  );
}

function warmTrustedDebuggerSession(tabId, actionId = "") {
  if (!Number.isInteger(tabId)) return;
  stampDynamicBindTiming(actionId, "debugWarmStartedAt");
  void ensureTrustedDebuggerAttached(tabId)
    .then(() => {
      stampDynamicBindTiming(actionId, "debugReadyAt");
      scheduleTrustedDebuggerDetach(tabId, TRUSTED_DEBUGGER_WARM_IDLE_MS);
    })
    .catch((error) => {
      // O clique final ainda fará uma tentativa normal e devolverá erro claro
      // se a API de depuração estiver indisponível.
      console.warn("[Fast Trigger SW] Não foi possível aquecer o clique nativo:", error);
    });
}

if (chrome.debugger?.onDetach) {
  chrome.debugger.onDetach.addListener(({ tabId }) => {
    if (tabId != null) trustedDebuggerSessions.delete(tabId);
  });
}

// =========================================================================
// APRENDIZADO AUTOMATICO DA ROTA DIRETA BET365
// =========================================================================
// A observacao de rede fica inerte ate o instante de um clique financeiro que
// ja foi autorizado pelo usuario. O proprio clique DOM arma uma janela curta;
// somente uma requisicao JSON com selectionId + stake unicos pode virar perfil.
// O ouvinte de `requestBody` nem existe fora dessa janela: ele e registrado ao
// armar e removido quando a ultima janela fecha.
const DIRECT_ORDER_EXPERIMENT_KEY = "gbr_direct_order_experiment";
const DIRECT_ORDER_SETTINGS_KEY = "gbr_direct_order_settings";
const DIRECT_ORDER_REQUEST_KEY = "gbr_direct_order_request";
const DIRECT_ORDER_AUTO_STATUS_KEY = "gbr_direct_order_auto_status";
const DIRECT_ORDER_LEARNING_TTL_MS = 5_000;
const DIRECT_ORDER_LEARNING_FILTER = {
  urls: [
    "https://*.bet365.bet.br/*",
    "https://*.bet365.com/*",
    "https://*.bet365.es/*",
  ],
  types: ["xmlhttprequest", "other"],
};
const directOrderLearningByTab = new Map();
// Espelho local das duas chaves que governam o caminho direto. Sem perfil o
// aprendizado ainda tem o que fazer; com perfil, nada mais precisa ser
// observado.
let directOrderExperimentArmed = false;
let directOrderProfileStored = false;
let directOrderLearningObserverAttached = false;
let directOrderLearningSweepTimer = null;

function normalizeDirectOrderLearning(raw, tab) {
  const selectionId = typeof raw?.selectionId === "string"
    ? raw.selectionId.trim().slice(0, 96)
    : "";
  const stake = Number(raw?.stake);
  const issuedAt = Number(raw?.issuedAt);
  const now = Date.now();
  if (
    !tab?.id ||
    !selectionId ||
    !Number.isFinite(stake) ||
    stake <= 0 ||
    !Number.isFinite(issuedAt) ||
    issuedAt > now + 1_000 ||
    now - issuedAt > 5_000
  ) {
    return null;
  }
  const pageUrl = typeof tab.url === "string" ? tab.url : "";
  try {
    const parsed = new URL(pageUrl);
    if (
      parsed.protocol !== "https:" ||
      !globalThis.FastTriggerDirectOrderAutoSetup?.isOfficialBet365Host?.(parsed.hostname)
    ) {
      return null;
    }
  } catch (error) {
    return null;
  }
  const normalizeOptionalId = (value) => {
    if (typeof value === "string") return value.trim().slice(0, 128);
    if (Number.isFinite(Number(value))) return String(value).slice(0, 128);
    return "";
  };
  return {
    tabId: tab.id,
    pageUrl,
    actionId: typeof raw.actionId === "string" ? raw.actionId.slice(0, 160) : "",
    selectionId,
    marketId: normalizeOptionalId(raw.marketId),
    eventId: normalizeOptionalId(raw.eventId),
    stake,
    odds: Number.isFinite(Number(raw.odds)) && Number(raw.odds) > 0
      ? Number(raw.odds)
      : null,
    armedAt: now,
    expiresAt: now + DIRECT_ORDER_LEARNING_TTL_MS,
    persisting: false,
    lastReason: "",
  };
}

function armAutomaticDirectOrderLearning(raw, sender) {
  // Sem aceleração ligada não há o que aprender, e com perfil já gravado o
  // aprendizado seria descartado no fim: em nenhum dos dois casos vale anexar
  // um ouvinte de corpo de requisição.
  if (!directOrderExperimentArmed || directOrderProfileStored) return false;
  const capture = normalizeDirectOrderLearning(raw, sender?.tab);
  if (capture === null) return false;
  directOrderLearningByTab.set(capture.tabId, capture);
  setDirectOrderLearningObserver(true);
  scheduleDirectOrderLearningSweep();
  void chrome.storage.local.set({
    [DIRECT_ORDER_AUTO_STATUS_KEY]: {
      schemaVersion: 1,
      state: "learning",
      updatedAt: Date.now(),
    },
  }).catch(() => {});
  return true;
}

// O ouvinte de `requestBody` existe apenas enquanto alguma janela está aberta.
// Fora dela nenhum corpo de requisição da Bet365 chega ao service worker.
function setDirectOrderLearningObserver(active) {
  const api = chrome.webRequest?.onBeforeRequest;
  if (!api) return false;
  const shouldAttach = active === true;
  if (shouldAttach === directOrderLearningObserverAttached) {
    return directOrderLearningObserverAttached;
  }
  try {
    if (shouldAttach) {
      api.addListener(
        observeAutomaticDirectOrderRequest,
        DIRECT_ORDER_LEARNING_FILTER,
        ["requestBody"],
      );
    } else {
      api.removeListener(observeAutomaticDirectOrderRequest);
    }
    directOrderLearningObserverAttached = shouldAttach;
  } catch (error) {}
  return directOrderLearningObserverAttached;
}

function sweepDirectOrderLearning() {
  const now = Date.now();
  for (const [tabId, capture] of directOrderLearningByTab) {
    if (now > capture.expiresAt) directOrderLearningByTab.delete(tabId);
  }
  if (directOrderLearningByTab.size > 0) {
    scheduleDirectOrderLearningSweep();
    return;
  }
  if (directOrderLearningSweepTimer !== null) {
    clearTimeout(directOrderLearningSweepTimer);
    directOrderLearningSweepTimer = null;
  }
  setDirectOrderLearningObserver(false);
}

function scheduleDirectOrderLearningSweep() {
  if (directOrderLearningSweepTimer !== null) {
    clearTimeout(directOrderLearningSweepTimer);
  }
  // A varredura fecha a janela mesmo quando nenhuma requisição chega: o ouvinte
  // não pode sobreviver ao clique que o autorizou.
  directOrderLearningSweepTimer = setTimeout(() => {
    directOrderLearningSweepTimer = null;
    sweepDirectOrderLearning();
  }, DIRECT_ORDER_LEARNING_TTL_MS + 250);
}

async function persistAutomaticDirectOrderTemplate(capture, inferred) {
  if (!capture || capture.persisting || !inferred?.template) return false;
  capture.persisting = true;
  try {
    const stored = await chrome.storage.local.get([
      DIRECT_ORDER_SETTINGS_KEY,
      DIRECT_ORDER_REQUEST_KEY,
    ]);
    // Perfil configurado explicitamente continua soberano. O aprendizado so
    // preenche a lacuna; nunca substitui silenciosamente um modelo existente.
    if (stored?.[DIRECT_ORDER_REQUEST_KEY]) return false;

    const currentSettings = stored?.[DIRECT_ORDER_SETTINGS_KEY];
    const settings = currentSettings && typeof currentSettings === "object"
      ? currentSettings
      : {};
    const allowedHosts = Array.isArray(settings.allowedHosts)
      ? settings.allowedHosts.filter((host) => typeof host === "string")
      : [];
    if (!allowedHosts.includes(inferred.endpointHost)) {
      allowedHosts.push(inferred.endpointHost);
    }

    await chrome.storage.local.set({
      [DIRECT_ORDER_EXPERIMENT_KEY]: true,
      [DIRECT_ORDER_REQUEST_KEY]: inferred.template,
      [DIRECT_ORDER_SETTINGS_KEY]: {
        ...settings,
        allowedHosts: allowedHosts.slice(0, 16),
        dryRun: false,
        publishResults: true,
      },
      [DIRECT_ORDER_AUTO_STATUS_KEY]: {
        schemaVersion: 1,
        state: "ready",
        profileVersion: inferred.profileVersion || 1,
        endpointHost: inferred.endpointHost,
        learnedAt: Date.now(),
        updatedAt: Date.now(),
      },
    });

    chrome.tabs
      .sendMessage(capture.tabId, { action: "DIRECT_ORDER_AUTO_CONFIGURED" })
      .catch(() => {});
    return true;
  } catch (error) {
    await chrome.storage.local.set({
      [DIRECT_ORDER_AUTO_STATUS_KEY]: {
        schemaVersion: 1,
        state: "learning",
        reason: "storage_failed",
        updatedAt: Date.now(),
      },
    }).catch(() => {});
    return false;
  }
}

function observeAutomaticDirectOrderRequest(details) {
  const tabId = Number(details?.tabId);
  const capture = directOrderLearningByTab.get(tabId);
  if (!capture) return;
  if (Date.now() > capture.expiresAt) {
    directOrderLearningByTab.delete(tabId);
    sweepDirectOrderLearning();
    return;
  }
  const inferred = globalThis.FastTriggerDirectOrderAutoSetup?.inferTemplate?.(
    details,
    capture,
  );
  if (!inferred?.ok) {
    capture.lastReason = String(inferred?.reason || "not_candidate").slice(0, 64);
    return;
  }
  directOrderLearningByTab.delete(tabId);
  sweepDirectOrderLearning();
  void persistAutomaticDirectOrderTemplate(capture, inferred);
}

// Boot do service worker: o espelho das chaves precisa existir antes do
// primeiro clique, e a aceleração já escolhida pelo usuário arma o feed sem
// esperar um novo toque na dashboard.
async function loadDirectOrderRuntimeFlags() {
  try {
    const stored = await chrome.storage.local.get([
      DIRECT_ORDER_EXPERIMENT_KEY,
      DIRECT_ORDER_REQUEST_KEY,
    ]);
    directOrderExperimentArmed = stored?.[DIRECT_ORDER_EXPERIMENT_KEY] === true;
    directOrderProfileStored = Boolean(stored?.[DIRECT_ORDER_REQUEST_KEY]);
  } catch (error) {
    directOrderExperimentArmed = false;
    directOrderProfileStored = false;
  }
  await setDirectOrderFeedRequirement(directOrderExperimentArmed);
  return directOrderExperimentArmed;
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes) return;
  if (changes[DIRECT_ORDER_REQUEST_KEY] !== undefined) {
    directOrderProfileStored = Boolean(changes[DIRECT_ORDER_REQUEST_KEY].newValue);
  }
  if (changes[DIRECT_ORDER_EXPERIMENT_KEY] === undefined) return;
  directOrderExperimentArmed = changes[DIRECT_ORDER_EXPERIMENT_KEY].newValue === true;
  if (!directOrderExperimentArmed) {
    // Desligar a aceleração fecha as janelas abertas na hora: nenhuma delas
    // sobrevive à retirada da autorização.
    directOrderLearningByTab.clear();
    sweepDirectOrderLearning();
  }
  void setDirectOrderFeedRequirement(directOrderExperimentArmed);
});

// Aba fechada no meio da janela não pode deixar registro nem ouvinte de pé.
chrome.tabs.onRemoved.addListener((tabId) => {
  if (directOrderLearningByTab.delete(tabId)) sweepDirectOrderLearning();
});

void loadDirectOrderRuntimeFlags();

const pendingDynamicBindTabRestores = new Map();
const dynamicBindResultWaiters = new Map();
const dynamicBindPreparationWaiters = new Map();
const dynamicBindArmWaiters = new Map();
const dynamicBindRetryParents = new Map();
const dynamicBindDispatchChains = new Map();
const GBR_USER_STORAGE_PREFIX = "gbr_user_";
const dynamicBindStorageCache = {
  userId: "",
  dynamicPlayerBinds: {},
  ready: false,
  inFlight: null,
  updatedAt: 0,
};

const dynamicBindTimings = new Map();
const DYNAMIC_BIND_TIMING_MAX_AGE_MS = 30_000;
// Cada item conserva um actionId próprio e é roteado de modo independente.
// O lote não deve ser artificialmente limitado às quatro casas atuais: oito
// cobre as integrações futuras sem transformar uma tecla em uma tempestade de
// comandos. A deduplicação continua sendo feita pelo intent/actionId antes de
// esta etapa.
const MAX_DYNAMIC_BIND_BATCH_SIZE = 8;

function enqueueDynamicBindDispatch(task, queueKey = "global") {
  const previous = dynamicBindDispatchChains.get(queueKey) || Promise.resolve();
  const next = previous.then(task, task);
  const settled = next.catch(() => {});
  dynamicBindDispatchChains.set(queueKey, settled);
  settled.finally(() => {
    if (dynamicBindDispatchChains.get(queueKey) === settled) {
      dynamicBindDispatchChains.delete(queueKey);
    }
  });
  return next;
}

function startDynamicBindTiming(action) {
  const startedAt = Number(action?.issuedAt) || Date.now();
  dynamicBindTimings.set(String(action?.actionId || ""), {
    actionId: String(action?.actionId || ""),
    house: action?.house || "",
    keyCode: action?.keyCode || "",
    startedAt,
    workerAt: Date.now(),
  });
}

function stampDynamicBindTiming(actionId, stage, value = Date.now()) {
  const entry = dynamicBindTimings.get(String(actionId || ""));
  if (entry) entry[stage] = value;
}

function finishDynamicBindTiming(actionId, extra = {}) {
  const key = String(actionId || "");
  const entry = dynamicBindTimings.get(key);
  if (!entry) return;
  Object.assign(entry, extra, { finishedAt: Date.now() });
  const elapsed = (stage) =>
    entry[stage] && entry.startedAt ? entry[stage] - entry.startedAt : null;
  console.info("[FT Perf] bind", {
    actionId: entry.actionId,
    house: entry.house,
    keyCode: entry.keyCode,
    workerMs: elapsed("workerAt"),
    routeMs: elapsed("routeResolvedAt"),
    debugReadyMs: elapsed("debugReadyAt"),
    preparedMs: elapsed("backgroundPreparedAt"),
    focusMs: elapsed("focusedAt"),
    messageMs: elapsed("messageSentAt"),
    contentMs: extra.contentMs ?? null,
    totalMs: entry.finishedAt - entry.startedAt,
    success: extra.success,
  });
  setTimeout(() => {
    if (dynamicBindTimings.get(key) === entry) dynamicBindTimings.delete(key);
  }, DYNAMIC_BIND_TIMING_MAX_AGE_MS);
}

async function refreshDynamicBindStorageCache() {
  if (dynamicBindStorageCache.inFlight) return dynamicBindStorageCache.inFlight;

  dynamicBindStorageCache.inFlight = (async () => {
    const auth = await chrome.storage.local.get(["gbr_user_id"]);
    const userId =
      typeof auth?.gbr_user_id === "string" ? auth.gbr_user_id.trim() : "";
    if (!userId) {
      dynamicBindStorageCache.userId = "";
      dynamicBindStorageCache.dynamicPlayerBinds = {};
      dynamicBindStorageCache.ready = true;
      dynamicBindStorageCache.updatedAt = Date.now();
      return;
    }

    const scopedKey = `${GBR_USER_STORAGE_PREFIX}${userId}_dynamicPlayerBinds`;
    const stored = await chrome.storage.local.get([scopedKey]);
    dynamicBindStorageCache.userId = userId;
    dynamicBindStorageCache.dynamicPlayerBinds =
      stored?.[scopedKey] && typeof stored[scopedKey] === "object"
        ? stored[scopedKey]
        : {};
    dynamicBindStorageCache.ready = true;
    dynamicBindStorageCache.updatedAt = Date.now();
  })()
    .catch((error) => {
      console.warn("[Fast Trigger SW] Falha ao atualizar cache de binds:", error);
      dynamicBindStorageCache.ready = true;
      dynamicBindStorageCache.updatedAt = Date.now();
    })
    .finally(() => {
      dynamicBindStorageCache.inFlight = null;
    });

  return dynamicBindStorageCache.inFlight;
}

async function getDynamicBindStorageCache() {
  if (
    !dynamicBindStorageCache.ready ||
    Date.now() - dynamicBindStorageCache.updatedAt > 60_000
  ) {
    await refreshDynamicBindStorageCache();
  }
  return { dynamicPlayerBinds: dynamicBindStorageCache.dynamicPlayerBinds };
}

void refreshDynamicBindStorageCache();

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  const changedKeys = Object.keys(changes);
  if (
    changedKeys.includes("gbr_user_id") ||
    changedKeys.some((key) => key.endsWith("_dynamicPlayerBinds"))
  ) {
    dynamicBindStorageCache.ready = false;
    void refreshDynamicBindStorageCache();
  }
});

function waitForDynamicBindResult(actionId, timeoutMs = 12000) {
  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      dynamicBindResultWaiters.delete(actionId);
      resolve(null);
    }, timeoutMs);

    dynamicBindResultWaiters.set(actionId, (message, restorePromise) => {
      clearTimeout(timeoutId);
      dynamicBindResultWaiters.delete(actionId);
      resolve({ message, restorePromise });
    });
  });
}

function waitForDynamicBindPreparation(actionId, timeoutMs = 900) {
  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      dynamicBindPreparationWaiters.delete(actionId);
      resolve(null);
    }, timeoutMs);

    dynamicBindPreparationWaiters.set(actionId, (message) => {
      clearTimeout(timeoutId);
      dynamicBindPreparationWaiters.delete(actionId);
      resolve(message);
    });
  });
}

function waitForDynamicBindArm(actionId, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      dynamicBindArmWaiters.delete(actionId);
      resolve(null);
    }, timeoutMs);

    dynamicBindArmWaiters.set(actionId, (message) => {
      clearTimeout(timeoutId);
      dynamicBindArmWaiters.delete(actionId);
      resolve(message);
    });
  });
}

async function getCurrentUserScopedLocal(keys, defaults = {}) {
  const auth = await chrome.storage.local.get(["gbr_user_id"]);
  const userId =
    typeof auth?.gbr_user_id === "string" ? auth.gbr_user_id.trim() : "";
  if (!userId) return { ...defaults };
  const logicalKeys = Array.isArray(keys)
    ? keys
    : Object.keys(keys || defaults);
  const scopedKeys = logicalKeys.map(
    (key) => `${GBR_USER_STORAGE_PREFIX}${userId}_${key}`,
  );
  const stored = await chrome.storage.local.get(scopedKeys);
  return Object.fromEntries(
    logicalKeys.map((key) => [
      key,
      stored?.[`${GBR_USER_STORAGE_PREFIX}${userId}_${key}`] ?? defaults[key],
    ]),
  );
}

async function initializeGbrBrowserSession() {
  if (!chrome.storage?.local || !chrome.storage?.session) return;
  try {
    const [sessionState, localState] = await Promise.all([
      chrome.storage.session.get(["gbr_browser_session_marker"]),
      chrome.storage.local.get(["gbr_remember_access"]),
    ]);
    if (!sessionState.gbr_browser_session_marker) {
      if (localState.gbr_remember_access !== true) {
        await chrome.storage.local.remove([
          "gbr_auth_token",
          "gbr_refresh_token",
          "gbr_auth_expires_at",
          "gbr_user_id",
          "gbr_user_email",
          "gbr_license_status",
          "gbr_user_profile",
          "gbr_license_result",
        ]);
      }
      await chrome.storage.session.set({
        gbr_browser_session_marker: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      });
    }
  } catch (error) {
    console.warn(
      "[Auth Session] Não foi possível inicializar o limite da sessão do navegador:",
      error,
    );
  }
}

initializeGbrBrowserSession();

const GBR_DASHBOARD_URL = chrome.runtime.getURL(
  "dashboard-app/dist/index.html",
);
let dashboardOpenInFlight = null;

async function openOrFocusGbrDashboard() {
  if (dashboardOpenInFlight) return dashboardOpenInFlight;

  dashboardOpenInFlight = (async () => {
    // A dashboard oficial pertence ao GatilhoBR desktop. Nunca abra a cópia
    // React dentro do Chrome; solicite apenas foco ao processo principal.
    postToNativeHost({ type: 'OPEN_DASHBOARD' });
    dashboardOpenInFlight = null;
    return;
    /*
    try {
      const tabs = await chrome.tabs.query({});
      const existing = tabs.find(
        (tab) =>
          typeof tab.url === "string" && tab.url.startsWith(GBR_DASHBOARD_URL),
      );

      if (existing?.id != null) {
        if (existing.windowId != null) {
          await chrome.windows.update(existing.windowId, { focused: true });
        }
        await chrome.tabs.update(existing.id, { active: true });
      } else {
        await chrome.windows.create({
          url: GBR_DASHBOARD_URL,
          type: "popup",
          width: 620,
          height: 850,
          focused: true,
        });
      }

      // A dashboard recém-aberta já consegue se conectar ao stream e renderizar
      // o cache. A injeção/verificação das casas continua em paralelo para não
      // transformar a abertura em uma espera proporcional ao número de abas.
      void ensureContentScriptsInBettingTabs();
    } catch (error) {
      console.error("[GatilhoBR] NÃ£o foi possÃ­vel abrir o painel:", error);
    } finally {
      dashboardOpenInFlight = null;
    }
    */
  })();

  return dashboardOpenInFlight;
}

chrome.action.onClicked.addListener(() => {
  void openOrFocusGbrDashboard();
});

const consumedUserActionIds = new Map();
const USER_ACTION_MAX_AGE_MS = 5000;

function consumeExplicitUserIntent(message, expectedType) {
  const actionId = message && message.actionId;
  const issuedAt = Number(message && message.issuedAt);
  const source = message && message.intentSource;
  const intentType = message && message.intentType;
  const now = Date.now();

  consumedUserActionIds.forEach((timestamp, id) => {
    if (now - timestamp > USER_ACTION_MAX_AGE_MS)
      consumedUserActionIds.delete(id);
  });

  if (message?.__gbrElectronAuthorized === true) {
    if (actionId && consumedUserActionIds.has(actionId)) return false;
    if (actionId) {
      consumedUserActionIds.set(actionId, now);
      setTimeout(() => consumedUserActionIds.delete(actionId), USER_ACTION_MAX_AGE_MS);
    }
    return true;
  }

  if (
    !actionId ||
    !Number.isFinite(issuedAt) ||
    source !== "dashboard_user" ||
    intentType !== expectedType ||
    issuedAt > now + 30000 ||
    now - issuedAt > USER_ACTION_MAX_AGE_MS ||
    consumedUserActionIds.has(actionId)
  ) {
    return false;
  }

  consumedUserActionIds.set(actionId, now);
  return true;
}

function createInternalIntent(intentType, intentSource = "chrome_command") {
  return {
    actionId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    issuedAt: Date.now(),
    intentSource,
    intentType,
  };
}

// Registro de abas de apostas ativas monitoradas pela extensão
// Map<tabId, { tabId, siteName, port, url, active: boolean }>
const activeTradingTabs = new Map();
// Última configuração recebida da dashboard Electron. Abas Chrome reais não
// participam do chrome.tabs.query do Electron; por isso mantemos o snapshot
// em memória e reaplicamos ao registrar/reconectar cada aba.
let latestElectronConfig = null;
const contentScriptInjectionInFlight = new Map();

function replaceActiveTradingTab(tabId, tabInfo) {
  const previous = activeTradingTabs.get(tabId);
  if (previous?.port && previous.port !== tabInfo.port) {
    activePorts.delete(previous.port);
    try {
      previous.port.disconnect();
    } catch (e) {}
  }
  activeTradingTabs.set(tabId, tabInfo);
}

const BETTING_TAB_PATTERNS = [
  "*://*.bet365.com/*",
  "*://*.bet365.bet.br/*",
  "*://*.bet365.es/*",
  "*://*.betfair.com/*",
  "*://*.betfair.bet.br/*",
  "*://*.betfair.es/*",
  "*://*.betnacional.com/*",
  "*://*.betnacional.bet.br/*",
  "*://*.betnacional.br/*",
  "*://*.betano.bet.br/*",
  "*://betmgm.bet.br/*",
  "*://*.betmgm.bet.br/*",
  "*://superbet.bet.br/*",
  "*://*.superbet.bet.br/*",
  "*://superbet.com/*",
  "*://*.superbet.com/*",
];

const BETTING_TAB_PATTERNS_BY_HOUSE = {
  bet365: [
    "*://*.bet365.com/*",
    "*://*.bet365.bet.br/*",
    "*://*.bet365.es/*",
  ],
  betfair: [
    "*://*.betfair.com/*",
    "*://*.betfair.bet.br/*",
    "*://*.betfair.es/*",
  ],
  betnacional: [
    "*://*.betnacional.com/*",
    "*://*.betnacional.bet.br/*",
    "*://*.betnacional.br/*",
  ],
  betano: ["*://*.betano.bet.br/*"],
  betmgm: ["*://betmgm.bet.br/*", "*://*.betmgm.bet.br/*"],
  superbet: [
    "*://superbet.bet.br/*",
    "*://*.superbet.bet.br/*",
    "*://superbet.com/*",
    "*://*.superbet.com/*",
  ],
};

// A aba pode ter sido aberta antes da extensao. Nesse caso, os content
// scripts declarativos nao sao executados retroativamente; mantemos a mesma
// ordem do manifest para iniciar a captura sem exigir um novo carregamento.
// A lista precisa ser IDENTICA a do manifest (mesmos arquivos, mesma ordem):
// um arquivo que falte aqui produz uma aba meio inicializada, em que a captura
// depende de um global que nunca foi definido. `tests/injection-parity` compara
// as duas listas para que a divergencia nao volte silenciosamente.
const BET365_FRAME_SCRIPT_FILES = ["src/bet365FrameSentinel.js"];
const CONTENT_SCRIPT_FILES_BY_SITE = {
  Bet365: [
    "src/securityGuard.js",
    "src/utils/executionReport.js",
    "src/utils/marketIndex.js",
    "src/core/selectionResolver.js",
    "src/userScopedStorage.js",
    "src/config.js",
    "src/core/directOrderPreferences.js",
    "src/ui.js",
    "src/supabaseClient.js",
    "src/services/licensingEngine.js",
    "src/authManager.js",
    "src/presetManager.js",
    "src/utils/domWaiter.js",
    "src/stakeEngine.js",
    "src/placeBetEngine.js",
    "src/presetEngine.js",
    "src/gridScraper.js",
    "src/utils/bet365MarketTitle.js",
    "src/quickBindEngine.js",
    "src/quickExecEngine.js",
    "src/hotkeyEngine.js",
    "src/hotkeyConfigurator.js",
    "src/utils/humanizer.js",
    "src/adapters/bet365Adapter.js",
    "src/triggerEngine.js",
    "src/parser.js",
    "content.js",
  ],
  Betfair: [
    "src/securityGuard.js",
    "src/utils/executionReport.js",
    "src/utils/marketIndex.js",
    "src/userScopedStorage.js",
    "src/config.js",
    "src/ui.js",
    "src/supabaseClient.js",
    "src/services/licensingEngine.js",
    "src/authManager.js",
    "src/presetManager.js",
    "src/utils/domWaiter.js",
    "src/stakeEngine.js",
    "src/placeBetEngine.js",
    "src/presetEngine.js",
    "src/quickBindEngine.js",
    "src/quickExecEngine.js",
    "src/hotkeyEngine.js",
    "src/hotkeyConfigurator.js",
    "src/utils/humanizer.js",
    "src/adapters/betfairSportsbookAdapter.js",
    "src/triggerEngine.js",
    "content.js",
  ],
  Betnacional: [
    "src/securityGuard.js",
    "src/utils/executionReport.js",
    "src/utils/marketIndex.js",
    "src/userScopedStorage.js",
    "src/config.js",
    "src/ui.js",
    "src/supabaseClient.js",
    "src/services/licensingEngine.js",
    "src/authManager.js",
    "src/presetManager.js",
    "src/utils/domWaiter.js",
    "src/stakeEngine.js",
    "src/placeBetEngine.js",
    "src/presetEngine.js",
    "src/quickBindEngine.js",
    "src/quickExecEngine.js",
    "src/hotkeyEngine.js",
    "src/hotkeyConfigurator.js",
    "src/utils/humanizer.js",
    "src/adapters/betnacionalAdapter.js",
    "src/triggerEngine.js",
    "content.js",
  ],
  BetMGM: [
    "src/securityGuard.js",
    "src/utils/executionReport.js",
    "src/utils/marketIndex.js",
    "src/userScopedStorage.js",
    "src/config.js",
    "src/ui.js",
    "src/supabaseClient.js",
    "src/services/licensingEngine.js",
    "src/authManager.js",
    "src/presetManager.js",
    "src/utils/domWaiter.js",
    "src/stakeEngine.js",
    "src/placeBetEngine.js",
    "src/presetEngine.js",
    "src/quickBindEngine.js",
    "src/quickExecEngine.js",
    "src/hotkeyEngine.js",
    "src/hotkeyConfigurator.js",
    "src/utils/humanizer.js",
    "src/adapters/betmgmAdapter.js",
    "src/triggerEngine.js",
    "content.js",
  ],
  Betano: [
    "src/securityGuard.js",
    "src/utils/executionReport.js",
    "src/utils/marketIndex.js",
    "src/userScopedStorage.js",
    "src/config.js",
    "src/ui.js",
    "src/supabaseClient.js",
    "src/services/licensingEngine.js",
    "src/authManager.js",
    "src/presetManager.js",
    "src/utils/domWaiter.js",
    "src/stakeEngine.js",
    "src/placeBetEngine.js",
    "src/presetEngine.js",
    "src/quickBindEngine.js",
    "src/quickExecEngine.js",
    "src/hotkeyEngine.js",
    "src/hotkeyConfigurator.js",
    "src/utils/humanizer.js",
    "src/adapters/betanoAdapter.js",
    "src/triggerEngine.js",
    "content.js",
  ],
  Superbet: [
    "src/securityGuard.js",
    "src/utils/executionReport.js",
    "src/utils/marketIndex.js",
    "src/userScopedStorage.js",
    "src/config.js",
    "src/ui.js",
    "src/supabaseClient.js",
    "src/services/licensingEngine.js",
    "src/authManager.js",
    "src/presetManager.js",
    "src/utils/domWaiter.js",
    "src/stakeEngine.js",
    "src/placeBetEngine.js",
    "src/presetEngine.js",
    "src/quickBindEngine.js",
    "src/quickExecEngine.js",
    "src/hotkeyEngine.js",
    "src/hotkeyConfigurator.js",
    "src/utils/humanizer.js",
    "src/adapters/superbetAdapter.js",
    "src/triggerEngine.js",
    "content.js",
  ],
};

function detectSiteFromUrl(url) {
  if (!url) return null;
  const u = url.toLowerCase();
  if (u.includes("betfair")) return "Betfair";
  if (u.includes("bet365")) return "Bet365";
  if (u.includes("betnacional")) return "Betnacional";
  if (u.includes("betano")) return "Betano";
  if (u.includes("betmgm")) return "BetMGM";
  if (u.includes("superbet")) return "Superbet";
  return null;
}

async function isContentScriptReady(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(
      tabId,
      { action: "FAST_TRIGGER_PING" },
      { frameId: 0 }
    );
    if (response?.ready === true || response?.status === "OK" || response?.handled === true) {
      return true;
    }
  } catch (error) {}

  try {
    const check = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      func: () => Boolean(
        window.FastTriggerAdapter ||
        window.FastTriggerConfig ||
        window.FastTriggerState ||
        window.__gbrContentScriptLoaded ||
        window.__gbrContentRuntimeBooted
      ),
    });
    return Boolean(check?.[0]?.result);
  } catch (err) {
    return false;
  }
}

async function ensureContentScriptInTab(tab) {
  const site = detectSiteFromUrl(tab?.url);
  if (!tab || !Number.isInteger(tab.id) || !site)
    return false;
  if (tab.status === "loading") return false;

  const tabId = tab.id;
  const existingTask = contentScriptInjectionInFlight.get(tabId);
  if (existingTask) return existingTask;

  const task = (async () => {
    // O coletor ISOLATED pode estar vivo enquanto o MAIN world ficou ausente
    // (por exemplo, depois de recarregar a extensão com a aba aberta). Instalar
    // estes módulos é idempotente e não arma o feed nem envia ordem: os próprios
    // módulos só passam a observar/despachar depois dos controles explícitos.
    if (site === "Bet365") {
      await ensureBet365MainWorldRuntimeInTab(tabId);
    }

    if (!(await isContentScriptReady(tabId))) {
      let alreadyPresent = false;
      try {
        const probe = await chrome.scripting.executeScript({
          target: { tabId, frameIds: [0] },
          func: () => Boolean(
            window.FastTriggerAdapter ||
            window.FastTriggerConfig ||
            window.FastTriggerState ||
            window.__gbrContentScriptLoaded ||
            window.__gbrContentRuntimeBooted
          ),
        });
        alreadyPresent = Boolean(probe?.[0]?.result);
      } catch (_) {}

      if (!alreadyPresent) {
        try {
          if (site === "Bet365") {
            await chrome.scripting.executeScript({
              target: { tabId, allFrames: true },
              files: BET365_FRAME_SCRIPT_FILES,
            });
            await chrome.scripting.executeScript({
              target: { tabId, frameIds: [0] },
              files: CONTENT_SCRIPT_FILES_BY_SITE[site],
            });
          } else {
            await chrome.scripting.executeScript({
              target: { tabId, frameIds: [0] },
              files: CONTENT_SCRIPT_FILES_BY_SITE[site],
            });
          }
        } catch (error) {
          console.warn(
            `[Fast Trigger SW] Nao foi possivel iniciar a captura na aba ${tabId}:`,
            error,
          );
          return false;
        }
      }
    }

    // O coletor faz a primeira leitura sozinho, mas esta solicitacao tambem
    // cobre o caso em que a pagina ja estava totalmente renderizada.
    try {
      if (site === "Bet365") {
        await chrome.tabs.sendMessage(tabId, {
          action: "REQUEST_MARKET_UPDATE",
        });
      } else {
        await chrome.tabs.sendMessage(
          tabId,
          { action: "REQUEST_MARKET_UPDATE" },
          { frameId: 0 },
        );
      }
    } catch (error) {}

    if (site === "Bet365" && networkFeedShouldBeEnabled()) {
      await injectNetworkFeedObserver(tabId);
    }

    return true;
  })();

  contentScriptInjectionInFlight.set(tabId, task);
  try {
    return await task;
  } finally {
    contentScriptInjectionInFlight.delete(tabId);
  }
}

async function forceMarketUpdateForHouse(houseKey, requestId) {
  const normalizedHouse = String(houseKey || "").toLowerCase();
  const patterns = BETTING_TAB_PATTERNS_BY_HOUSE[normalizedHouse];
  if (!patterns) return;

  // A porta é o caminho mais rápido. O sendMessage direto logo abaixo é uma
  // rota de recuperação: alcança a aba mesmo quando o Map ainda guarda uma
  // porta antiga ou o content script precisou ser reinjetado.
  activeTradingTabs.forEach((tabInfo) => {
    if (marketHouseKey(tabInfo?.siteName) !== normalizedHouse || !tabInfo?.port) return;
    try {
      tabInfo.port.postMessage({
        type: "REQUEST_MARKET_UPDATE",
        force: true,
        requestId,
      });
    } catch (error) {}
  });

  let tabs = [];
  try {
    tabs = await chrome.tabs.query({ url: patterns });
  } catch (error) {
    return;
  }

  await Promise.all(
    tabs.map(async (tab) => {
      if (!Number.isInteger(tab?.id)) return;
      await ensureContentScriptInTab(tab);
      try {
        await chrome.tabs.sendMessage(
          tab.id,
          {
            action: "REQUEST_MARKET_UPDATE",
            force: true,
            requestId,
          },
          { frameId: 0 },
        );
      } catch (error) {}
    }),
  );
}

async function ensureContentScriptsInBettingTabs() {
  try {
    const tabs = await chrome.tabs.query({ url: BETTING_TAB_PATTERNS });
    await Promise.all(tabs.map((tab) => ensureContentScriptInTab(tab)));
  } catch (error) {
    console.warn(
      "[Fast Trigger SW] Nao foi possivel verificar as abas das casas:",
      error,
    );
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void ensureContentScriptsInBettingTabs();
  connectNativeHost();
});

chrome.runtime.onStartup.addListener(() => {
  void ensureContentScriptsInBettingTabs();
  connectNativeHost();
});

// Tenta uma vez sempre que o service worker sobe. Falhas nao afetam captura,
// dashboard da extensao ou navegacao das casas.
connectNativeHost();

async function broadcastConnectionStatus(snapshotPayload = currentMarketState) {
  let bet365Active = false;
  let betfairActive = false;
  let betnacionalActive = false;
  let betmgmActive = false;
  let betanoActive = false;
  let superbetActive = false;

  activeTradingTabs.forEach((t) => {
    if (t.siteName === "Betfair") betfairActive = true;
    if (t.siteName === "Bet365") bet365Active = true;
    if (t.siteName === "Betnacional") betnacionalActive = true;
    if (t.siteName === "BetMGM") betmgmActive = true;
    if (t.siteName === "Betano") betanoActive = true;
    if (t.siteName === "Superbet") superbetActive = true;
  });

  if (!bet365Active || !betfairActive || !betnacionalActive || !betmgmActive || !betanoActive || !superbetActive) {
    const cacheIsFresh =
      connectionStatusCache &&
      Date.now() - connectionStatusCacheAt <= CONNECTION_STATUS_CACHE_MS;
    if (cacheIsFresh) {
      bet365Active = bet365Active || connectionStatusCache.bet365Active;
      betfairActive = betfairActive || connectionStatusCache.betfairActive;
      betnacionalActive = betnacionalActive || connectionStatusCache.betnacionalActive;
      betmgmActive = betmgmActive || connectionStatusCache.betmgmActive;
      betanoActive = betanoActive || connectionStatusCache.betanoActive;
      superbetActive = superbetActive || connectionStatusCache.superbetActive;
    } else {
      try {
        if (!bet365Active) {
          const b365Tabs = await chrome.tabs.query({
            url: [
              "*://*.bet365.com/*",
              "*://*.bet365.bet.br/*",
              "*://*.bet365.es/*",
            ],
          });
          if (b365Tabs && b365Tabs.length > 0) bet365Active = true;
        }
        if (!betfairActive) {
          const bfTabs = await chrome.tabs.query({
            url: [
              "*://*.betfair.com/*",
              "*://*.betfair.bet.br/*",
              "*://*.betfair.es/*",
            ],
          });
          if (bfTabs && bfTabs.length > 0) betfairActive = true;
        }
        if (!betnacionalActive) {
          const bnTabs = await chrome.tabs.query({
            url: [
              "*://*.betnacional.com/*",
              "*://*.betnacional.bet.br/*",
              "*://*.betnacional.br/*",
            ],
          });
          if (bnTabs && bnTabs.length > 0) betnacionalActive = true;
        }
        if (!betmgmActive) {
          const betmgmTabs = await chrome.tabs.query({
            url: ["*://betmgm.bet.br/*", "*://*.betmgm.bet.br/*"],
          });
          if (betmgmTabs && betmgmTabs.length > 0) betmgmActive = true;
        }
        if (!betanoActive) {
          const betanoTabs = await chrome.tabs.query({ url: ["*://*.betano.bet.br/*"] });
          if (betanoTabs && betanoTabs.length > 0) betanoActive = true;
        }
        if (!superbetActive) {
          const superbetTabs = await chrome.tabs.query({
            url: [
              "*://superbet.bet.br/*",
              "*://*.superbet.bet.br/*",
              "*://superbet.com/*",
              "*://*.superbet.com/*",
            ],
          });
          if (superbetTabs && superbetTabs.length > 0) superbetActive = true;
        }
      } catch (e) {}
    }
  }

  const connectionStatus = { bet365Active, betfairActive, betnacionalActive, betmgmActive, betanoActive, superbetActive };
  const statusChanged =
    !lastBroadcastConnectionStatus ||
    lastBroadcastConnectionStatus.bet365Active !== bet365Active ||
    lastBroadcastConnectionStatus.betfairActive !== betfairActive ||
    lastBroadcastConnectionStatus.betnacionalActive !== betnacionalActive ||
    lastBroadcastConnectionStatus.betmgmActive !== betmgmActive ||
    lastBroadcastConnectionStatus.betanoActive !== betanoActive ||
    lastBroadcastConnectionStatus.superbetActive !== superbetActive;
  connectionStatusCache = connectionStatus;
  connectionStatusCacheAt = Date.now();
  lastBroadcastConnectionStatus = connectionStatus;

  activePorts.forEach((p) => {
    // Portas `native-browser:*` representam a casa real no Chrome. Elas são
    // usadas exclusivamente para comandos Electron -> casa; retransmitir o
    // snapshot nelas devolve SYNC_DASHBOARD ao Native Messaging e cria um
    // ciclo. A porta da dashboard continua recebendo normalmente.
    if (
      String(p?.name || "").startsWith("native-browser:") ||
      p?.sender?.external === true
    ) return;
    try {
      p.postMessage({
        type: "SYNC_DASHBOARD",
        payload: snapshotPayload,
        connectionStatus: connectionStatus,
      });
    } catch (e) {}
  });
  // Espelha somente o estado de leitura para o aplicativo local. O host pode
  // estar ausente; postToNativeHost e um no-op nesse caso.
  if (snapshotPayload?.source !== "native-host") {
    const nativePayload = nativeSnapshotPayload(snapshotPayload);
    if (nativePayload) {
      postToNativeHost({
        type: "SYNC_DASHBOARD",
        payload: nativePayload,
        connectionStatus,
      });
    }
  }

  // O runtime.sendMessage acorda todas as páginas da extensão. Enquanto as casas
  // conectadas não mudam, uma atualização de mercado não precisa desse aviso.
  if (!statusChanged) return;

  try {
    chrome.runtime
      .sendMessage({
        type: "CONNECTION_STATUS_UPDATE",
        connectionStatus: connectionStatus,
      })
      .catch(() => {});
  } catch (e) {}
}

chrome.runtime.onConnect.addListener((port) => {
  const senderIsTopFrame =
    !port.sender ||
    port.sender.frameId === undefined ||
    port.sender.frameId === 0;
  const senderSite = detectSiteFromUrl(port.sender?.tab?.url);

  // A Bet365 usa frames internos para coletar mercados. Nas outras casas,
  // portas de iframe só duplicam o stream e são descartadas.
  if (senderSite && !senderIsTopFrame && senderSite !== "Bet365") {
    try {
      port.disconnect();
    } catch (e) {}
    return;
  }

  activePorts.add(port);

  let registeredTabId = null;

  if (port.sender && port.sender.tab && port.sender.tab.id) {
    registeredTabId = port.sender.tab.id;
    const site = senderSite;

    if (site && senderIsTopFrame) {
      replaceActiveTradingTab(registeredTabId, {
        tabId: registeredTabId,
        siteName: site,
        port: port,
        url: port.sender.tab.url,
        windowId: port.sender.tab.windowId,
        active: true,
        lastFocusedAt: Date.now(),
      });
    }

    broadcastConnectionStatus();
  }

  // Envia imediatamente o estado em cache para novas conexões da dashboard.
  // Portas sintéticas marcadas como externas pertencem ao Native Messaging e
  // não devem receber snapshots (isso os devolveria ao Chrome como comando).
  if (port.sender?.external !== true) {
    port.postMessage({
      type: "SYNC_DASHBOARD",
      payload: currentMarketState,
      connectionStatus: {
        bet365Active: Array.from(activeTradingTabs.values()).some((t) => t.siteName === "Bet365"),
        betfairActive: Array.from(activeTradingTabs.values()).some((t) => t.siteName === "Betfair"),
        betnacionalActive: Array.from(activeTradingTabs.values()).some((t) => t.siteName === "Betnacional"),
        betmgmActive: Array.from(activeTradingTabs.values()).some((t) => t.siteName === "BetMGM"),
        betanoActive: Array.from(activeTradingTabs.values()).some((t) => t.siteName === "Betano"),
        superbetActive: Array.from(activeTradingTabs.values()).some((t) => t.siteName === "Superbet"),
      },
    });
  }

  port.onMessage.addListener((msg) => {
    if (!msg || (!msg.type && !msg.action)) return;

    // A dashboard Electron envia UPDATE_CONFIG pela porta sintética da casa.
    // Repasse imediatamente para as abas Chrome reais e guarde o último valor
    // para reaplicar quando a aba for registrada/recarregada.
    if (msg.action === "UPDATE_CONFIG" && msg.config && typeof msg.config === "object") {
      latestElectronConfig = { ...msg.config };
      electronConfigCache = { ...electronConfigCache, ...msg.config };
      electronConfigCache = { ...electronConfigCache, ...msg.config };
      activeTradingTabs.forEach((tabInfo) => {
        if (!tabInfo?.port) return;
        try {
          tabInfo.port.postMessage({
            action: "UPDATE_CONFIG",
            config: latestElectronConfig,
            __gbrElectronAuthorized: true,
          });
        } catch (_) {}
      });
      return;
    }

    // Native Messaging pode entregar o snapshot encapsulado em `payload`.
    // Normalize também no Service Worker para manter compatibilidade com
    // hosts/versões antigas do Electron que ainda não desempacotam o evento.
    if (msg.type === "MARKET_DATA_UPDATE" && msg.payload && typeof msg.payload === "object" && !Array.isArray(msg.groups)) {
      msg = {
        ...msg.payload,
        ...msg,
        type: "MARKET_DATA_UPDATE",
        siteName: msg.siteName || msg.payload.siteName,
      };
      delete msg.payload;
    }

    if (msg.type === "EXECUTION_REPORT") {
      const safeReport = recordExecutionReport(msg.report);
      // Devolva o resultado à dashboard Electron quando a execução ocorreu na
      // aba Chrome real. O Electron usa esse relatório para encerrar a espera
      // de binds e restaurar o foco da janela.
      postToNativeHost({ type: "EXECUTION_REPORT", report: safeReport || msg.report });
      if (safeReport) {
        activePorts.forEach((activePort) => {
          if (activePort === port) return;
          try {
            activePort.postMessage({
              type: "EXECUTION_REPORT",
              report: safeReport,
            });
          } catch (error) {}
        });
      }
      // Slot global com foco emprestado (Bet365): a janela anterior volta assim
      // que a casa conclui, sem esperar o tempo limite de segurança. Não há
      // efeito quando nenhum foco foi trocado para esta ação.
      if (safeReport?.actionId && safeReport.outcome && safeReport.outcome !== "pending") {
        void restoreDynamicBindTab(safeReport.actionId);
      }
      return;
    }

    if (msg.type === "NETWORK_FEED_OBSERVATION") {
      if (!networkFeedExperimentEnabled || !senderIsTopFrame || senderSite !== "Bet365") return;
      const safeObservation = recordNetworkFeedObservation(registeredTabId, msg.observation);
      if (safeObservation) {
        activePorts.forEach((activePort) => {
          if (activePort === port) return;
          try {
            activePort.postMessage({
              type: "NETWORK_FEED_OBSERVATION",
              observation: safeObservation,
            });
          } catch (error) {}
        });
      }
      return;
    }

    // Diagnóstico da ordem direta. Não dispara, não repete e não autoriza nada:
    // apenas guarda latência/código e espelha para os painéis abertos.
    if (msg.type === "DIRECT_ORDER_RESULT") {
      if (!senderIsTopFrame || senderSite !== "Bet365") return;
      const safeResult = recordDirectOrderResult(registeredTabId, msg.result);
      if (safeResult) {
        activePorts.forEach((activePort) => {
          if (activePort === port) return;
          try {
            activePort.postMessage({
              type: "DIRECT_ORDER_RESULT",
              result: safeResult,
            });
          } catch (error) {}
        });
      }
      return;
    }

    // Registra aba explicitamente com nome do site (Bet365 / Betfair)
    if (msg.type === "REGISTER_TAB") {
      if (registeredTabId && msg.isTop !== false) {
        const site = msg.siteName || detectSiteFromUrl(msg.url);
        if (site) {
          replaceActiveTradingTab(registeredTabId, {
            tabId: registeredTabId,
            siteName: site,
            port: port,
            url:
              msg.url ||
              (port.sender && port.sender.tab ? port.sender.tab.url : ""),
            windowId:
              port.sender?.tab?.windowId ??
              activeTradingTabs.get(registeredTabId)?.windowId,
            active: true,
            // Instante em que o coletor da aba subiu. O atalho global usa isso
            // para não gastar o disparo dentro da janela de inicialização segura
            // do content script.
            bootedAt:
              Number(msg.bootedAt) ||
              activeTradingTabs.get(registeredTabId)?.bootedAt ||
              0,
            lastFocusedAt:
              activeTradingTabs.get(registeredTabId)?.lastFocusedAt ||
              Date.now(),
          });
          if (latestElectronConfig && port) {
            try {
              port.postMessage({
                action: "UPDATE_CONFIG",
                config: latestElectronConfig,
                __gbrElectronAuthorized: true,
              });
            } catch (_) {}
          }
        }
        broadcastConnectionStatus();
      }
    }

    // 1. Atualização vinda do content.js (MutationObserver/WebSocket)
    if (msg.type === "MARKET_DATA_UPDATE") {
      // Eventos que retornam da ponte Native Messaging carregam o snapshot
      // dentro de `payload` (o mesmo formato enviado por postToNativeHost).
      // Mensagens diretas do content script continuam com os campos no nível
      // raiz. Normalize os dois formatos antes de registrar/broadcastar;
      // anteriormente `msg.groups` ficava indefinido no caminho nativo e a
      // dashboard recebia sempre Grupos: 0.
      const marketPayloadRaw =
        msg.payload && typeof msg.payload === "object" ? msg.payload : msg;
      // Alguns hosts/versões da extensão encapsulam o snapshot em
      // `snapshot` ou usam o nome legado `markets`. Normalize esses formatos
      // antes de registrar o estado; caso contrário a dashboard recebe um
      // evento válido, porém com `groups: []`.
      const marketPayload =
        marketPayloadRaw.snapshot && typeof marketPayloadRaw.snapshot === "object"
          ? { ...marketPayloadRaw, ...marketPayloadRaw.snapshot }
          : marketPayloadRaw;
      if (!Array.isArray(marketPayload.groups) && Array.isArray(marketPayload.markets)) {
        marketPayload.groups = marketPayload.markets;
      }
      // A mensagem com `payload` é o envelope devolvido pelo host nativo
      // (o content script envia grupos diretamente na raiz). Considere ambos
      // os sinais para impedir o reenvio e o loop mesmo quando o snapshot
      // preserva `source: dom-scan` da captura original.
      const fromNativeBridge =
        !!(msg.payload && typeof msg.payload === "object") ||
        msg.source === "native-host" || marketPayload.source === "native-host";
      const siteName =
        msg.siteName ||
        marketPayload.siteName ||
        (registeredTabId && activeTradingTabs.has(registeredTabId)
          ? activeTradingTabs.get(registeredTabId).siteName
          : "Bet365");
      const incomingGroupCount = Array.isArray(marketPayload.groups) ? marketPayload.groups.length : 0;
      if (registeredTabId && siteName) {
        const existing = activeTradingTabs.get(registeredTabId);
        if (existing) {
          existing.siteName = siteName;
          existing.eventContext =
            marketPayload.eventContext || existing.eventContext || null;
          existing.lastMarketUpdateAt = Date.now();
          activeTradingTabs.set(registeredTabId, existing);
        }
      }

      const recordedSnapshot = recordMarketSnapshot(siteName, {
          groups: marketPayload.groups || [],
          betslip: marketPayload.betslip || "",
          eventContext: marketPayload.eventContext || null,
          frameEvidence: marketPayload.frameEvidence || [],
          siteName: siteName,
          lastUpdate: Date.now(),
          capturedAt: Number(marketPayload.capturedAt) || Date.now(),
          source: marketPayload.source || "dom-scan",
          forced: marketPayload.forced === true,
          syncRequestIds: Array.isArray(marketPayload.syncRequestIds) ? marketPayload.syncRequestIds : [],
        });
      currentMarketState = recordedSnapshot || currentMarketState;

      const nativePayload = nativeSnapshotPayload(recordedSnapshot);
      // Eventos recebidos do Electron/Native Messaging já vieram da ponte;
      // reenviá-los criaria um loop host -> main -> background -> host.
      if (nativePayload && !fromNativeBridge) {
        postToNativeHost({
          type: "MARKET_DATA_UPDATE",
          siteName,
          payload: nativePayload,
        });
      }

      // Broadcast transparente e instantâneo para todas as portas ativas (dashboard.js, popup.js)
      broadcastConnectionStatus(recordedSnapshot || currentMarketState);
    }

    // 1.5. Solicitação de mercados de uma casa específica
    if (msg.type === "REQUEST_MARKETS" || msg.action === "REQUEST_MARKETS") {
      const targetHouse = (msg.house || "bet365").toLowerCase();
      let houseKey = "bet365";
      if (targetHouse.includes("betfair")) houseKey = "betfair";
      else if (targetHouse.includes("betnacional")) houseKey = "betnacional";
      else if (targetHouse.includes("betmgm")) houseKey = "betmgm";
      else if (targetHouse.includes("betano")) houseKey = "betano";
      else if (targetHouse.includes("superbet")) houseKey = "superbet";

      const force = msg.force === true;
      const requestId = String(
        msg.requestId || `market-sync-${houseKey}-${Date.now()}`,
      ).slice(0, 96);

      // Um clique em Sincronizar nunca rebaixa um snapshot vivo para `stale`:
      // isso bloqueava as odds enquanto a coleta nova ainda estava em voo.
      // O cache marcado como antigo continua existindo apenas na hidratação
      // inicial, antes de haver uma solicitação manual explícita.
      if (!force) {
        const cached = globalThis.marketStatesByHouse
          ? globalThis.marketStatesByHouse.get(houseKey)
          : null;
        if (cached) {
          try {
            port.postMessage({
              type: "SYNC_DASHBOARD",
              payload: { ...cached, stale: cached.stale === true },
            });
          } catch (e) {}
        }
      }

      if (force) {
        void forceMarketUpdateForHouse(houseKey, requestId);
      } else {
        // Inicialização normal: a porta já registrada é suficiente e evita
        // consultar todas as abas quatro vezes ao abrir o painel.
        let deliveredToHouse = false;
        activeTradingTabs.forEach((tabInfo) => {
          if (
            tabInfo &&
            marketHouseKey(tabInfo.siteName) === houseKey &&
            tabInfo.port
          ) {
            try {
              tabInfo.port.postMessage({
                type: "REQUEST_MARKET_UPDATE",
                requestId,
              });
              deliveredToHouse = true;
            } catch (e) {}
          }
        });

        // Após um reload da extensão a dashboard pode se reconectar antes de
        // a aba da casa recriar a porta. Não deixe o botão Sincronizar morrer
        // silenciosamente: localize a aba pelo URL, garanta o content script
        // e peça uma leitura direta. A rotina é idempotente e só é usada
        // quando não existia uma porta viva para a casa solicitada.
        if (!deliveredToHouse) {
          void forceMarketUpdateForHouse(houseKey, requestId);
        }
      }
    }

    // 2. Ação de disparo enviada pelo dashboard.js
    if (msg.type === "TRIGGER_BET_ACTION") {
      if (!consumeExplicitUserIntent(msg, "trigger_bet")) {
        console.warn(
          "[Fast Trigger SW] Disparo bloqueado: intenção ausente, antiga ou duplicada.",
        );
        return;
      }
      dispatchBetToAllActiveTabs(!!msg.isHotkey, msg);
    }

    // 2.5. Binds contextuais acionadas enquanto o painel da extensão está em foco.
    if (msg.type === "DYNAMIC_BIND_ACTION_BATCH") {
      const actions = Array.isArray(msg.actions) ? msg.actions : [];
      if (actions.length === 0) return;
      if (actions.length > MAX_DYNAMIC_BIND_BATCH_SIZE) {
        actions.forEach((action) => {
          try {
            port.postMessage({
              type: "DYNAMIC_BIND_DISPATCH_RESULT",
              actionId: action?.actionId,
              success: false,
              pending: false,
              reason: `Lote de bind excede o limite de ${MAX_DYNAMIC_BIND_BATCH_SIZE} casas.`,
            });
          } catch (e) {}
        });
        return;
      }
      const validActions = actions.filter((action) =>
        consumeExplicitUserIntent(action, "dynamic_bind"),
      );
      actions
        .filter((action) => !validActions.includes(action))
        .forEach((action) => {
          try {
            port.postMessage({
              type: "DYNAMIC_BIND_DISPATCH_RESULT",
              actionId: action.actionId,
              success: false,
              reason: "Comando de bind inválido ou expirado.",
            });
          } catch (e) {}
        });
      if (validActions.length > 0) {
        dispatchDynamicBindBatch(validActions, port).catch((error) => {
          console.error(
            "[Fast Trigger SW] Falha ao preparar binds simultâneas:",
            error,
          );
          validActions.forEach((action) => {
            try {
              port.postMessage({
                type: "DYNAMIC_BIND_DISPATCH_RESULT",
                actionId: action.actionId,
                success: false,
                reason: "Falha interna ao preparar o disparo simultâneo.",
              });
            } catch (e) {}
          });
        });
      }
    }

    if (msg.type === "DYNAMIC_BIND_ACTION") {
      if (!consumeExplicitUserIntent(msg, "dynamic_bind")) {
        console.warn(
          "[Fast Trigger SW] Bind contextual bloqueada: intenção ausente, antiga ou duplicada.",
        );
        try {
          port.postMessage({
            type: "DYNAMIC_BIND_DISPATCH_RESULT",
            actionId: msg.actionId,
            success: false,
            reason: "Comando de bind inválido ou expirado.",
          });
        } catch (e) {}
        return;
      }
      dispatchDynamicBindToHouse(msg.house, msg.keyCode, msg, port).catch(
        (error) => {
          console.error(
            "[Fast Trigger SW] Falha ao rotear bind contextual:",
            error,
          );
          try {
            port.postMessage({
              type: "DYNAMIC_BIND_DISPATCH_RESULT",
              actionId: msg.actionId,
              success: false,
              reason: "Falha interna ao localizar a aba da casa.",
            });
          } catch (e) {}
        },
      );
    }

    // 3. Ação de seleção de odds enviada pelo dashboard.js
    if (msg.type === "SELECT_ODDS_ACTION") {
      if (!consumeExplicitUserIntent(msg, "select_odds")) {
        console.warn(
          "[Fast Trigger SW] Seleção bloqueada: intenção ausente, antiga ou duplicada.",
        );
        return;
      }
      const targetHouse = (
        msg.house ||
        (msg.payload ? msg.payload.house : "") ||
        ""
      ).toLowerCase();
      const deliveredPorts = new Set();

      activeTradingTabs.forEach((tabInfo) => {
        const matchesHouse =
          !targetHouse || tabInfo.siteName.toLowerCase().includes(targetHouse);
        if (matchesHouse && tabInfo.port) {
          try {
            const stakeVal = resolveConfiguredStakeForHouse(targetHouse);
            if (stakeVal) {
              tabInfo.port.postMessage({
                action: "UPDATE_CONFIG",
                config: { ...electronConfigCache, stakeVal, oneShot: electronConfigCache.oneShot === true, oneClick: electronConfigCache.oneShot === true },
                __gbrElectronAuthorized: true,
              });
            }
            tabInfo.port.postMessage({
              type: "SELECT_ODDS",
              actionId: msg.actionId,
              issuedAt: msg.issuedAt,
              intentSource: msg.intentSource,
              intentType: msg.intentType,
              fastMode: msg.fastMode === true,
              house: targetHouse,
              eventId: msg.eventId || (msg.payload ? msg.payload.eventId : ""),
              name: msg.name || (msg.payload ? msg.payload.name : ""),
              lineName:
                msg.lineName || (msg.payload ? msg.payload.lineName : ""),
              optionLabel:
                msg.optionLabel || (msg.payload ? msg.payload.optionLabel : ""),
              val:
                msg.val ||
                msg.odds ||
                (msg.payload ? msg.payload.odds || msg.payload.val : ""),
              odds:
                msg.odds ||
                msg.val ||
                (msg.payload ? msg.payload.odds || msg.payload.val : ""),
              stake: msg.stake || msg.stakeVal || (msg.payload ? msg.payload.stake || msg.payload.stakeVal : "") || stakeVal,
              stakeVal: msg.stakeVal || msg.stake || (msg.payload ? msg.payload.stakeVal || msg.payload.stake : "") || stakeVal,
              marketTitle:
                msg.marketTitle || (msg.payload ? msg.payload.marketTitle : ""),
              colIndex:
                msg.colIndex !== undefined
                  ? msg.colIndex
                  : msg.payload
                    ? msg.payload.colIndex
                    : 0,
              rowIndex:
                msg.rowIndex !== undefined
                  ? msg.rowIndex
                  : msg.payload
                    ? msg.payload.rowIndex
                    : 0,
              outcomeId:
                msg.outcomeId || (msg.payload ? msg.payload.outcomeId : ""),
              __gbrElectronAuthorized: true,
            });
            deliveredPorts.add(tabInfo.port);
          } catch (e) {}
        }
      });

      // Uma seleção deve chegar somente à porta principal da aba da casa.
      if (deliveredPorts.size === 0) {
        console.warn(
          "[Fast Trigger SW] Nenhuma aba principal da casa selecionada recebeu a odd.",
        );
      }
    }

    // 4. Solicitação de saldo da conta vinda do dashboard.js
    if (msg.type === "REQUEST_ACCOUNT_BALANCE") {
      activePorts.forEach((p) => {
        if (p !== port) {
          try {
            p.postMessage({ type: "REQUEST_ACCOUNT_BALANCE" });
          } catch (e) {}
        }
      });
    }

    // 5. Resposta de saldo vinda do content script
    if (msg.type === "ACCOUNT_BALANCE_RESPONSE") {
      activePorts.forEach((p) => {
        if (p !== port) {
          try {
            p.postMessage({
              type: "ACCOUNT_BALANCE_RESULT",
              balance: msg.balance,
            });
          } catch (e) {}
        }
      });
    }

    if (msg.type === "DYNAMIC_BIND_EXECUTION_RESULT") {
      postToNativeHost({ type: "DYNAMIC_BIND_EXECUTION_RESULT", ...msg });
      stampDynamicBindTiming(msg.actionId, "resultReceivedAt");
      const restorePromise = restoreDynamicBindTab(msg.actionId).catch(() => {});
      const resultActionId = String(msg.actionId || "");
      const resultWaiter = dynamicBindResultWaiters.get(resultActionId);
      if (resultWaiter) resultWaiter(msg, restorePromise);
      const dashboardActionId = dynamicBindRetryParents.get(resultActionId) || resultActionId;
      dynamicBindRetryParents.delete(resultActionId);
      const shouldDeferRetryableFailure =
        msg.retryable === true &&
        msg.success !== true &&
        msg.clickAttempted !== true;
      if (shouldDeferRetryableFailure) return;
      activePorts.forEach((p) => {
        if (p !== port) {
          try {
            p.postMessage({
              type: "DYNAMIC_BIND_DISPATCH_RESULT",
              actionId: dashboardActionId,
              success: msg.success === true,
              pending: false,
              house: msg.house,
              keyCode: msg.keyCode,
              clickAttempted: msg.clickAttempted === true,
              timing: msg.timing || null,
              reason: msg.reason || "",
            });
          } catch (e) {}
        }
      });
    }

    if (msg.type === "DYNAMIC_BIND_PREPARED_RESULT") {
      postToNativeHost({ type: "DYNAMIC_BIND_PREPARED_RESULT", ...msg });
      const waiter = dynamicBindPreparationWaiters.get(
        String(msg.actionId || ""),
      );
      if (waiter) waiter(msg);
    }

    if (msg.type === "DYNAMIC_BIND_ARMED_RESULT") {
      postToNativeHost({ type: "DYNAMIC_BIND_ARMED_RESULT", ...msg });
      const waiter = dynamicBindArmWaiters.get(String(msg.actionId || ""));
      if (waiter) waiter(msg);
    }
  });

  port.onDisconnect.addListener(async () => {
    activePorts.delete(port);
    if (registeredTabId) {
      try {
        const tab = await chrome.tabs.get(registeredTabId);
        if (!tab || !detectSiteFromUrl(tab.url)) {
          activeTradingTabs.delete(registeredTabId);
          disableCDPSession(registeredTabId);
        }
      } catch (e) {
        activeTradingTabs.delete(registeredTabId);
        disableCDPSession(registeredTabId);
      }
      broadcastConnectionStatus();
    }
  });
});

async function restoreDynamicBindTab(actionId) {
  const pending = pendingDynamicBindTabRestores.get(actionId);
  if (!pending) return;
  pendingDynamicBindTabRestores.delete(actionId);
  clearTimeout(pending.timeoutId);

  try {
    const activeTabs = await chrome.tabs.query({
      active: true,
      windowId: pending.windowId,
    });
    // Não desfaz uma troca manual feita pelo usuário durante a execução.
    if (
      Number.isInteger(pending.previousTabId) &&
      pending.previousTabId !== pending.targetTabId &&
      activeTabs[0]?.id === pending.targetTabId
    ) {
      await chrome.tabs.update(pending.previousTabId, { active: true });
    }

    const focusedWindow = await chrome.windows
      .getLastFocused()
      .catch(() => null);
    if (
      Number.isInteger(pending.previousFocusedWindowId) &&
      pending.previousFocusedWindowId !== pending.windowId &&
      focusedWindow?.id === pending.windowId
    ) {
      await chrome.windows.update(pending.previousFocusedWindowId, {
        focused: true,
      });
    }

    if (pending.previousWindowState === "minimized") {
      await chrome.windows.update(pending.windowId, { state: "minimized" });
    }
  } catch (error) {
    console.warn(
      "[Fast Trigger SW] Não foi possível restaurar a guia anterior:",
      error,
    );
  }
}

async function prepareDynamicBindTab(target, actionId) {
  const targetTab = await chrome.tabs.get(target.tabId);
  const windowId = targetTab.windowId;
  const [previousFocusedWindow, targetWindow] = await Promise.all([
    chrome.windows.getLastFocused().catch(() => null),
    chrome.windows.get(windowId).catch(() => null),
  ]);
  const activeTabs = await chrome.tabs.query({ active: true, windowId });
  const previousTabId = activeTabs[0]?.id;
  const alreadyReady =
    previousTabId === target.tabId &&
    previousFocusedWindow?.id === windowId &&
    targetWindow?.state !== "minimized";
  if (alreadyReady) return;

  if (previousTabId !== target.tabId) {
    await chrome.tabs.update(target.tabId, { active: true });
  }

  // O CDP entrega o evento nativo somente de forma confiável quando a janela
  // que contém a página também está em primeiro plano. O foco é temporário e
  // será devolvido assim que a pipeline responder.
  if (targetWindow?.state === "minimized") {
    await chrome.windows.update(windowId, { state: "normal" });
  }
  await chrome.windows.update(windowId, { focused: true });

  const timeoutId = setTimeout(() => {
    restoreDynamicBindTab(actionId).catch(() => {});
  }, 10000);
  pendingDynamicBindTabRestores.set(actionId, {
    previousTabId,
    previousFocusedWindowId: previousFocusedWindow?.id,
    previousWindowState: targetWindow?.state,
    targetTabId: target.tabId,
    windowId,
    timeoutId,
  });

  // Aguarda a composição do primeiro quadro da janela agora visível.
  await new Promise((resolve) => setTimeout(resolve, 35));
}

function dynamicBindHouseKey(house) {
  const lowerHouse = (house || "").toLowerCase();
  if (lowerHouse.includes("betfair")) return "betfair";
  if (lowerHouse.includes("betnacional")) return "betnacional";
  if (lowerHouse.includes("betmgm")) return "betmgm";
  if (lowerHouse.includes("betano")) return "betano";
  if (lowerHouse.includes("superbet")) return "superbet";
  return "bet365";
}

function dynamicBindHouseName(houseKey) {
  return houseKey === "betfair"
    ? "Betfair"
    : houseKey === "betnacional"
      ? "Betnacional"
      : houseKey === "betmgm"
      ? "BetMGM"
      : houseKey === "betano"
        ? "Betano"
        : houseKey === "superbet"
          ? "Superbet"
          : "Bet365";
}

function dynamicBindUsesTrustedDebugger(houseKey) {
  // A Betnacional, Betano e Superbet aceitam o clique DOM do próprio content script. Manter CDP
  // nelas criava a faixa "Depurando" e concorria com a sessão da Bet365.
  return houseKey === "bet365" || houseKey === "betfair";
}

function warmDynamicBindTrustedClick(houseKey, target, actionId) {
  if (!dynamicBindUsesTrustedDebugger(houseKey)) return;
  warmTrustedDebuggerSession(target?.tabId, actionId);
}

async function prepareDynamicBindInteractionTransport(houseKey, target, actionId) {
  if (houseKey === "betnacional" || houseKey === "betmgm" || houseKey === "betano" || houseKey === "superbet") {
    // Estas casas usam interação DOM e não precisam de CDP. Não encerre as
    // sessões das outras casas: em um disparo paralelo, Bet365/Betfair podem
    // estar usando o transporte confiável ao mesmo tempo.
    return;
  }
  warmDynamicBindTrustedClick(houseKey, target, actionId);
}

function sanitizeIncomingDynamicBinds(rawBinds, houseKey, keyCode) {
  const entries = (Array.isArray(rawBinds) ? rawBinds : rawBinds ? [rawBinds] : [])
    .filter((bind) => bind && typeof bind === "object")
    .slice(0, 8);
  return entries.filter((bind) => {
    const bindHouse = String(bind.house || houseKey).toLowerCase();
    const bindKey = String(bind.keyCode || keyCode);
    return bindHouse === houseKey && bindKey === keyCode;
  });
}

// A rota de uma bind não pode confiar apenas no Map em memória. Em especial
// quando duas casas recebem o mesmo atalho, uma navegação/reload pode deixar
// uma entrada antiga no Map enquanto a aba real já possui outra porta. Antes
// de montar cada lote, reconciliamos o registro com as abas reais do Chrome e
// só devolvemos uma porta ligada à aba que ainda existe.
async function refreshTradingTargetsForHouse(houseKey) {
  const patterns = BETTING_TAB_PATTERNS_BY_HOUSE[houseKey] || [];
  if (patterns.length === 0) return [];

  // Caminho quente: se já existe uma porta top-frame viva para a casa, a
  // própria porta é a melhor prova de que a aba está pronta. Evite query +
  // reinjeção + janela de 700 ms em cada bind; a reconciliação completa fica
  // reservada para cold start, reload ou desconexão.
  const warmTargets = Array.from(activeTradingTabs.values()).filter(
    (info) => info?.port && Number.isInteger(info.tabId) && dynamicBindHouseKey(info.siteName) === houseKey,
  );
  if (warmTargets.length > 0) {
    console.debug(`[Fast Trigger SW] Rota ${houseKey}: caminho quente (${warmTargets.length} porta(s)).`);
    return warmTargets.map((target) => ({ ...target, __warm: true }));
  }

  const liveTabs = await chrome.tabs.query({ url: patterns }).catch(() => []);
  const liveById = new Map(
    liveTabs.filter((tab) => Number.isInteger(tab?.id)).map((tab) => [tab.id, tab]),
  );

  // Elimina somente entradas comprovadamente obsoletas. Não desconectamos a
  // porta aqui: o callback onDisconnect continua sendo o dono do seu ciclo de
  // vida e uma execução já em andamento pode estar aguardando o relatório.
  // Uma consulta vazia pode ocorrer enquanto o Chrome troca de perfil/janela;
  // nunca trate esse quadro transitório como aba fechada. Só remova entradas
  // quando a API confirmou pelo menos uma aba e confirmou que aquele ID não
  // pertence mais à casa.
  if (liveTabs.length > 0) {
    for (const [tabId, info] of activeTradingTabs) {
      if (dynamicBindHouseKey(info?.siteName) !== houseKey) continue;
      const tab = liveById.get(tabId);
      if (!tab && liveById.size > 0) activeTradingTabs.delete(tabId);
    }
  }

  // A injeção é idempotente. Ela cobre abas abertas antes de uma atualização
  // da extensão e dá ao content script a oportunidade de reconectar a porta.
  await Promise.all(
    liveTabs.map((tab) => ensureContentScriptInTab(tab).catch(() => {})),
  );

  // O REGISTER_TAB pode chegar um pouco depois da injeção. Uma espera curta
  // evita que o lote seja descartado por uma condição de corrida, sem jamais
  // trocar foco ou ativar uma aba.
  const deadline = Date.now() + 700;
  let targets = [];
  do {
    targets = liveTabs
      .map((tab) => activeTradingTabs.get(tab.id))
      .filter(
        (info) =>
          info?.port &&
          Number.isInteger(info.tabId) &&
          dynamicBindHouseKey(info.siteName) === houseKey,
      )
      .map((info) => {
        const tab = liveById.get(info.tabId);
        return {
          ...info,
          url: tab?.url || info.url || "",
          windowId: tab?.windowId ?? info.windowId,
        };
      });
    if (targets.length > 0 || Date.now() >= deadline) break;
    // Se a query não enxergou as abas externas, preserve uma porta já ativa;
    // ela continua sendo uma rota válida para o comando.
    if (liveTabs.length === 0) {
      targets = warmTargets;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  } while (true);

  console.log(
    `[Fast Trigger SW] Rota ${houseKey}: ${targets.length}/${liveTabs.length} aba(s) com porta ativa ` +
      `[${targets.map((target) => target.tabId).join(", ") || "nenhuma"}].`,
  );
  return targets;
}

function orderTradingTargetsForBind(targets, expectedTeams) {
  return targets
    .map((tabInfo) => {
      const teams = Array.isArray(tabInfo.eventContext?.teams)
        ? tabInfo.eventContext.teams
        : [];
      const matchesConfiguredGame =
        expectedTeams.length > 0 &&
        teams.some((team) => {
          const normalizedTeam = String(team || "")
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-z0-9]+/g, " ")
            .trim();
          return expectedTeams.some(
            (expectedTeam) =>
              normalizedTeam === expectedTeam ||
              (normalizedTeam.length >= 5 && expectedTeam.includes(normalizedTeam)) ||
              (expectedTeam.length >= 5 && normalizedTeam.includes(expectedTeam)),
          );
        });
      return { tabInfo, matchesConfiguredGame };
    })
    .sort((a, b) => {
      if (a.matchesConfiguredGame !== b.matchesConfiguredGame) {
        return a.matchesConfiguredGame ? -1 : 1;
      }
      return Number(b.tabInfo.lastFocusedAt || 0) - Number(a.tabInfo.lastFocusedAt || 0);
    })
    .map((item) => item.tabInfo);
}

async function resolveDynamicBindRoute(house, keyCode, incomingBinds = null, skipRefresh = false) {
  const houseKey = dynamicBindHouseKey(house);
  if (
    !keyCode ||
    !/^(?:Key[A-Z]|Digit[0-9]|Numpad[0-9]|F(?:[1-9]|1[0-2]))$/.test(keyCode)
  ) {
    return { ok: false, houseKey, reason: "Tecla de bind inválida." };
  }

  const directBinds = sanitizeIncomingDynamicBinds(incomingBinds, houseKey, keyCode);
  const bindStorage = directBinds.length > 0
    ? { dynamicPlayerBinds: {} }
    : await getDynamicBindStorageCache();
  const storedBinds = bindStorage.dynamicPlayerBinds || {};
  const keyAliases = [keyCode];
  const digitAlias = keyCode.match(/^(?:Digit|Numpad)(\d)$/)?.[1];
  if (digitAlias) {
    keyAliases.push(`Digit${digitAlias}`, `Numpad${digitAlias}`, digitAlias);
  }
  const rawBind = directBinds.length > 0
    ? directBinds
    : keyAliases
        .map((alias) => storedBinds[`${houseKey}:${alias}`] || storedBinds[alias])
        .find(Boolean) || null;
  const binds = (Array.isArray(rawBind) ? rawBind : [rawBind]).filter(
    (bind) => bind && (!bind.house || bind.house === houseKey),
  );
  if (binds.length === 0) {
    return {
      ok: false,
      houseKey,
      reason: `Nenhuma bind ${keyCode} configurada para a ${dynamicBindHouseName(houseKey)}.`,
    };
  }

  const normalizeRouteText = (value) =>
    (value || "")
      .toString()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const expectedTeams = binds
    .map((bind) => normalizeRouteText(bind.team))
    .filter(Boolean);
  const currentTargets = skipRefresh
    ? Array.from(activeTradingTabs.values()).filter(
        (info) => info?.port && dynamicBindHouseKey(info.siteName) === houseKey,
      ).map((info) => ({ ...info, __warm: true }))
    : await refreshTradingTargetsForHouse(houseKey);
  const candidates = orderTradingTargetsForBind(currentTargets, expectedTeams);

  const target = candidates[0];
  if (!target) {
    return {
      ok: false,
      houseKey,
      reason: `Nenhuma aba conectada da ${dynamicBindHouseName(houseKey)}.`,
    };
  }
  return { ok: true, houseKey, binds, target };
}

async function dispatchDynamicBindToHouse(
  house,
  keyCode,
  intent,
  requesterPort,
) {
  const commandStakeVal = () => {
    return intent?.stakeVal || intent?.stake ||
      resolveConfiguredStakeForHouse(houseKey) || null;
  };
  if (!dynamicBindTimings.has(String(intent?.actionId || ""))) {
    startDynamicBindTiming({ ...intent, house, keyCode });
  }
  const lowerHouse = (house || "").toLowerCase();
  let houseKey = "bet365";
  if (lowerHouse.includes("betfair")) houseKey = "betfair";
  else if (lowerHouse.includes("betnacional")) houseKey = "betnacional";
  else if (lowerHouse.includes("betmgm")) houseKey = "betmgm";
  else if (lowerHouse.includes("betano")) houseKey = "betano";
  else if (lowerHouse.includes("superbet")) houseKey = "superbet";

  if (!intent.stakeVal) {
    intent.stakeVal = intent.stake ||
      resolveConfiguredStakeForHouse(houseKey) || null;
  }

  if (
    !keyCode ||
    !/^(?:Key[A-Z]|Digit[0-9]|Numpad[0-9]|F(?:[1-9]|1[0-2]))$/.test(keyCode)
  ) {
    try {
      requesterPort.postMessage({
        type: "DYNAMIC_BIND_DISPATCH_RESULT",
        actionId: intent.actionId,
        success: false,
        reason: "Tecla de bind inválida.",
      });
    } catch (e) {}
    return;
  }

  const directBinds = sanitizeIncomingDynamicBinds(intent?.binds, houseKey, keyCode);
  const bindStorage = directBinds.length > 0
    ? { dynamicPlayerBinds: {} }
    : await getDynamicBindStorageCache();
  const storedBinds = bindStorage.dynamicPlayerBinds || {};
  const keyAliases = [keyCode];
  const digitAlias = keyCode.match(/^(?:Digit|Numpad)(\d)$/)?.[1];
  if (digitAlias)
    keyAliases.push(`Digit${digitAlias}`, `Numpad${digitAlias}`, digitAlias);
  const rawBind = directBinds.length > 0
    ? directBinds
    : keyAliases
        .map((alias) => storedBinds[`${houseKey}:${alias}`] || storedBinds[alias])
        .find(Boolean) || null;
  const binds = (Array.isArray(rawBind) ? rawBind : [rawBind]).filter(
    (bind) => bind && (!bind.house || bind.house === houseKey),
  );
  if (binds.length === 0) {
    const houseDisplayName =
      houseKey === "betfair"
        ? "Betfair"
        : houseKey === "betnacional"
          ? "Betnacional"
          : houseKey === "betmgm"
            ? "BetMGM"
            : houseKey === "betano"
              ? "Betano"
          : "Bet365";
    try {
      requesterPort.postMessage({
        type: "DYNAMIC_BIND_DISPATCH_RESULT",
        actionId: intent.actionId,
        success: false,
        house: houseKey,
        reason: `Nenhuma bind ${keyCode} configurada para a ${houseDisplayName}.`,
      });
    } catch (e) {}
    return;
  }
  const normalizeRouteText = (value) =>
    (value || "")
      .toString()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const expectedTeams = binds
    .map((bind) => normalizeRouteText(bind.team))
    .filter(Boolean);

  const candidates = Array.from(activeTradingTabs.values())
    .filter(
      (tabInfo) =>
        tabInfo &&
        tabInfo.port &&
        tabInfo.siteName &&
        tabInfo.siteName.toLowerCase().includes(houseKey),
    )
    .map((tabInfo) => {
      const teams = Array.isArray(tabInfo.eventContext?.teams)
        ? tabInfo.eventContext.teams
        : [];
      const matchesConfiguredGame =
        expectedTeams.length > 0 &&
        teams.some((team) => {
          const normalizedTeam = normalizeRouteText(team);
          return expectedTeams.some(
            (expectedTeam) =>
              normalizedTeam === expectedTeam ||
              (normalizedTeam.length >= 5 &&
                expectedTeam.includes(normalizedTeam)) ||
              (expectedTeam.length >= 5 &&
                normalizedTeam.includes(expectedTeam)),
          );
        });
      return { tabInfo, matchesConfiguredGame };
    })
    .sort((a, b) => {
      if (a.matchesConfiguredGame !== b.matchesConfiguredGame) {
        return a.matchesConfiguredGame ? -1 : 1;
      }
      return (
        Number(b.tabInfo.lastFocusedAt || 0) -
        Number(a.tabInfo.lastFocusedAt || 0)
      );
    })
    .map((item) => item.tabInfo);

  const target = candidates[0];
  if (!target) {
    try {
      requesterPort.postMessage({
        type: "DYNAMIC_BIND_DISPATCH_RESULT",
        actionId: intent.actionId,
        success: false,
        house: houseKey,
        reason: `Nenhuma aba conectada da ${houseKey === "betfair" ? "Betfair" : "Bet365"}.`,
      });
    } catch (e) {}
    return;
  }

  try {
    requesterPort.postMessage({
      type: "DYNAMIC_BIND_DISPATCH_RESULT",
      actionId: intent.actionId,
      success: true,
      pending: true,
      house: houseKey,
      keyCode,
    });

    const route = { houseKey, binds, target };

    // A Bet365 confirma a seleção de forma consistente quando a aba recebe
    // foco real durante a interação. Para o disparo isolado, fazemos essa
    // troca de foco automaticamente e restauramos a janela anterior ao final.
    // O lote simultâneo continua no caminho preparado em segundo plano, que
    // já foi validado manualmente e não deve sofrer saltos sequenciais de foco.
    if (houseKey === "bet365") {
      await executeFocusedDynamicBindRoute(route, {
        ...intent,
        house: houseKey,
        keyCode,
      });
      return;
    }

    if (dynamicBindCanSkipPreparation(houseKey)) {
      const execution = await enqueueDynamicBindDispatch(
        () => executePreparedDynamicBindRoute(route, {
          ...intent,
          house: houseKey,
          keyCode,
        }),
        houseKey,
      );
      if (!execution.ok) {
        throw execution.error || new Error("Falha ao executar a bind da Betfair.");
      }
      return;
    }

    let requiresFocusedFallback = false;
    await enqueueDynamicBindDispatch(async () => {
      const prepareWaiter = waitForDynamicBindPreparation(intent.actionId);
      target.port.postMessage({
        type: "PREPARE_DYNAMIC_BIND",
        __gbrElectronAuthorized: true,
        actionId: intent.actionId,
        house: houseKey,
        keyCode,
        binds,
        stakeVal: intent.stakeVal || intent.stake || null,
      });
      const preparation = await prepareWaiter;
      stampDynamicBindTiming(intent.actionId, "backgroundPreparedAt");

      if (preparation?.success === true) {
        const execution = await executePreparedDynamicBindRoute(route, {
          ...intent,
          house: houseKey,
          keyCode,
        });
        if (!execution.ok) {
          throw execution.error || new Error("Falha ao executar a bind em segundo plano.");
        }
        return;
      }

      requiresFocusedFallback = true;
    }, houseKey);
    // Executa fora da fila anterior. Chamar a rota focada de dentro da mesma
    // cadeia aguardaria a própria fila e poderia bloquear indefinidamente.
    if (requiresFocusedFallback) {
      await executeFocusedDynamicBindRoute(route, {
        ...intent,
        house: houseKey,
        keyCode,
      });
    }
  } catch (error) {
    console.warn(
      "[Fast Trigger SW] Falha ao encaminhar bind contextual:",
      error,
    );
    await restoreDynamicBindTab(intent.actionId);
    try {
      requesterPort.postMessage({
        type: "DYNAMIC_BIND_DISPATCH_RESULT",
        actionId: intent.actionId,
        success: false,
        house: houseKey,
        reason: "A aba da casa perdeu a conexão.",
      });
    } catch (e) {}
  }
}

function sendDynamicBindFailure(requesterPort, action, houseKey, reason) {
  finishDynamicBindTiming(action.actionId, {
    house: houseKey,
    success: false,
    reason,
  });
  try {
    requesterPort.postMessage({
      type: "DYNAMIC_BIND_DISPATCH_RESULT",
      actionId: action.actionId,
      success: false,
      house: houseKey,
      keyCode: action.keyCode,
      reason,
    });
  } catch (e) {}
}

function dynamicBindRequiresFocusedExecution(houseKey) {
  // O Chrome externo já mantém a aba real e o manual por casa confirma que
  // seleção/CDP funcionam sem trocar a janela visível. Forçar foco num lote
  // introduz uma dependência global: uma referência de janela antiga aborta
  // todas as casas. A bind agora prepara e executa cada destino pela própria
  // porta; foco só é usado como fallback explícito de uma casa que não armou.
  return false;
}

function dynamicBindCanSkipPreparation(houseKey) {
  // A Betfair resolve a seleção pelo índice local validado durante o próprio
  // EXECUTE_DYNAMIC_BIND. Um PREPARE separado repetia a resolução e adicionava
  // um round-trip inteiro antes do clique, enquanto o fluxo direto da extensão
  // já executa de imediato com as mesmas proteções.
  return houseKey === "betfair";
}

async function executeFocusedDynamicBindRoute(route, action) {
  await prepareDynamicBindInteractionTransport(
    route.houseKey,
    route.target,
    action.actionId,
  );
  await enqueueDynamicBindDispatch(async () => {
    await prepareDynamicBindTab(route.target, action.actionId);
    stampDynamicBindTiming(action.actionId, "focusedAt");
    const resultPromise = waitForDynamicBindResult(action.actionId);
    stampDynamicBindTiming(action.actionId, "messageSentAt");
    route.target.port.postMessage({
      type: "EXECUTE_DYNAMIC_BIND",
      __gbrElectronAuthorized: true,
      actionId: action.actionId,
      issuedAt: action.issuedAt,
      routedAt: Date.now(),
      intentSource: action.intentSource,
      intentType: action.intentType,
      house: route.houseKey,
      keyCode: action.keyCode,
      binds: route.binds,
      stakeVal: action.stakeVal || action.stake || null,
      focusedExecution: true,
    });
    const result = await resultPromise;
    if (!result) throw new Error("A casa não confirmou a bind no tempo esperado.");
    await result.restorePromise;
    finishDynamicBindTiming(action.actionId, {
      contentMs: result.message?.timing?.contentExecutionMs ?? null,
      success: result.message?.success === true,
    });
  }, dynamicBindRequiresFocusedExecution(route.houseKey) ? "focused" : route.houseKey);
}

async function captureDynamicBindFocusState() {
  const previousFocusedWindow = await chrome.windows
    .getLastFocused()
    .catch(() => null);
  const previousTab = previousFocusedWindow?.id
    ? (await chrome.tabs.query({
        active: true,
        windowId: previousFocusedWindow.id,
      }))[0]
    : null;
  const previousWindow = previousFocusedWindow?.id
    ? await chrome.windows.get(previousFocusedWindow.id).catch(() => null)
    : null;
  return {
    previousFocusedWindowId: previousFocusedWindow?.id,
    previousTabId: previousTab?.id,
    previousWindowState: previousWindow?.state,
  };
}

async function focusDynamicBindTarget(target) {
  if (!target || !Number.isInteger(target.tabId)) {
    throw new Error("Aba da casa indisponível para o disparo.");
  }
  let targetTab = await chrome.tabs.get(target.tabId).catch(() => null);
  const liveTargetInfo = targetTab ? activeTradingTabs.get(targetTab.id) : null;
  if (liveTargetInfo?.port) {
    // Atualiza a referência caso a aba tenha recarregado e o content script
    // tenha registrado uma porta nova com o mesmo tabId.
    target.port = liveTargetInfo.port;
    target.url = targetTab.url || target.url;
    target.windowId = targetTab.windowId;
  }
  // A porta pode sobreviver a uma navegação/recriação da aba e deixar um
  // tabId antigo no cache. Reencontre a aba real pela URL antes de desistir;
  // isso é especialmente importante no disparo simultâneo entre casas.
  if (!liveTargetInfo?.port) target.port = null;
  if (!targetTab || !liveTargetInfo?.port) {
    const houseKey = dynamicBindHouseKey(target.siteName || target.url);
    const refreshed = await refreshTradingTargetsForHouse(houseKey).catch(() => []);
    const recoveredInfo = refreshed.find((info) => info?.port) || null;
    targetTab = recoveredInfo?.tabId
      ? await chrome.tabs.get(recoveredInfo.tabId).catch(() => null)
      : null;
    if (targetTab) {
      target.tabId = targetTab.id;
      target.port = recoveredInfo.port;
      target.url = targetTab.url || target.url;
      target.windowId = targetTab.windowId;
    }
  }
  if (targetTab && !target.port) {
    throw new Error("Aba da casa ainda não possui comunicação ativa.");
  }
  if (!targetTab || targetTab.windowId == null) {
    throw new Error("Janela da casa indisponível.");
  }
  // Algumas instalações podem perder a janela entre a resolução da rota e o
  // foco. Não acesse propriedades de um retorno nulo; para casas DOM podemos
  // prosseguir sem foco e deixar o content script executar na aba real.
  const targetWindow = typeof chrome.windows?.get === "function"
    ? await chrome.windows.get(targetTab.windowId).catch(() => null)
    : null;
  if (!targetWindow) {
    console.warn(`[Fast Trigger SW] Janela ${targetTab.windowId} indisponível; seguindo sem reposicionar foco.`);
    return;
  }
  const activeTabs = await chrome.tabs.query({
    active: true,
    windowId: targetTab.windowId,
  });
  const alreadyReady =
    targetWindow.state !== "minimized" &&
    targetWindow.focused === true &&
    activeTabs[0]?.id === target.tabId;
  if (alreadyReady) return;

  if (targetWindow.state === "minimized") {
    await chrome.windows.update(targetTab.windowId, { state: "normal" });
  }
  if (activeTabs[0]?.id !== target.tabId) {
    await chrome.tabs.update(target.tabId, { active: true });
  }
  if (targetWindow.focused !== true) {
    await chrome.windows.update(targetTab.windowId, { focused: true });
  }
  // Um único frame permite que a Bet365 recalcule o viewport sem inserir um
  // atraso perceptível entre casas.
  await new Promise((resolve) => setTimeout(resolve, 24));
}

async function refreshDynamicBindRouteTarget(route, action) {
  // Nunca reutilize cegamente a porta capturada no começo do lote. Uma casa
  // pode navegar/reconectar entre a leitura do painel e o disparo, sobretudo
  // quando há várias casas no mesmo atalho. Re-resolver pelo Map de portas é
  // barato e impede que uma referência morta de uma casa contamine as outras.
  const refreshed = await resolveDynamicBindRoute(
    route.houseKey,
    action.keyCode,
    route.binds,
  );
  if (!refreshed?.ok || !refreshed.target?.port) {
    throw new Error(
      refreshed?.reason || `A aba conectada da ${dynamicBindHouseName(route.houseKey)} não está disponível.`,
    );
  }
  route.target = refreshed.target;
  route.binds = refreshed.binds || route.binds;
  return route;
}

async function restoreDynamicBindFocusState(state) {
  try {
    if (Number.isInteger(state.previousTabId)) {
      const previousTab = await chrome.tabs.get(state.previousTabId).catch(() => null);
      const activeTabs = previousTab?.windowId
        ? await chrome.tabs.query({ active: true, windowId: previousTab.windowId })
        : [];
      if (previousTab && activeTabs[0]?.id !== state.previousTabId) {
        await chrome.tabs.update(state.previousTabId, { active: true });
      }
    }
    if (Number.isInteger(state.previousFocusedWindowId)) {
      await chrome.windows.update(state.previousFocusedWindowId, { focused: true });
      if (state.previousWindowState === "minimized") {
        await chrome.windows.update(state.previousFocusedWindowId, { state: "minimized" });
      }
    }
  } catch (error) {
    console.warn("[Fast Trigger SW] Não foi possível restaurar o foco original:", error);
  }
}

async function executeFocusedDynamicBindBatchStaged(items, requesterPort) {
  const focusState = await captureDynamicBindFocusState();
  const armedItems = [];

  const cancelArmedItem = (item) => {
    try {
      item.route.target.port.postMessage({
        type: "CANCEL_DYNAMIC_BIND",
        __gbrElectronAuthorized: true,
        actionId: item.action.actionId,
        house: item.route.houseKey,
        keyCode: item.action.keyCode,
      });
    } catch (e) {}
  };

  const cancelBatchBeforeCommit = (failedItem, reason) => {
    armedItems.forEach(cancelArmedItem);
    items.forEach((item) => {
      const itemReason =
        item === failedItem
          ? reason
          : "Disparo simultâneo cancelado antes da confirmação; nenhuma aposta foi enviada.";
      sendDynamicBindFailure(
        requesterPort,
        item.action,
        item.route.houseKey,
        itemReason,
      );
    });
  };

  try {
    // Fase 1: seleciona a odd e preenche a stake em cada casa, sem clicar no
    // botão final. O foco é usado somente onde o DOM da casa exige.
    for (const item of items) {
      const { action, route, reason } = item;
      try {
        await focusDynamicBindTarget(route.target);
        const armPromise = waitForDynamicBindArm(action.actionId);
        route.target.port.postMessage({
          type: "EXECUTE_DYNAMIC_BIND",
          __gbrElectronAuthorized: true,
          actionId: action.actionId,
          issuedAt: action.issuedAt,
          routedAt: Date.now(),
          intentSource: action.intentSource,
          intentType: action.intentType,
          house: route.houseKey,
          keyCode: action.keyCode,
          binds: route.binds,
          stakeVal: action.stakeVal || action.stake || null,
          armOnly: true,
        });
        const armMessage = await armPromise;
        if (armMessage?.success !== true) {
          cancelBatchBeforeCommit(
            item,
            armMessage?.reason ||
              reason ||
              "A casa não confirmou a seleção e a stake no tempo esperado.",
          );
          return;
        }
        armedItems.push(item);
      } catch (error) {
        cancelBatchBeforeCommit(
          item,
          reason || error?.message || "Falha ao preparar a casa para o disparo.",
        );
        return;
      }
    }

    // Fase 2: a última casa armada já está focada. Confirma em ordem reversa
    // para reduzir a distância entre os cliques finais ao mínimo necessário.
    const commitOrder = [...armedItems].reverse();
    const commitPhaseStartedAt = Date.now();
    let previousCommitAt = null;
    for (let commitIndex = 0; commitIndex < commitOrder.length; commitIndex += 1) {
      const item = commitOrder[commitIndex];
      const { action, route } = item;
      try {
        await focusDynamicBindTarget(route.target);
        const resultPromise = waitForDynamicBindResult(action.actionId, 5000);
        route.target.port.postMessage({
          type: "COMMIT_DYNAMIC_BIND",
          __gbrElectronAuthorized: true,
          actionId: action.actionId,
          house: route.houseKey,
          keyCode: action.keyCode,
          stakeVal: action.stakeVal || action.stake || null,
        });
        const result = await resultPromise;
        if (!result) {
          sendDynamicBindFailure(
            requesterPort,
            action,
            route.houseKey,
            "A casa não confirmou o clique final no tempo esperado.",
          );
          const pendingItems = commitOrder.slice(commitIndex + 1);
          pendingItems.forEach(cancelArmedItem);
          pendingItems.forEach((pendingItem) => {
            sendDynamicBindFailure(
              requesterPort,
              pendingItem.action,
              pendingItem.route.houseKey,
              "Execução interrompida porque a casa anterior não confirmou o clique em Apostar.",
            );
          });
          return;
        }

        await result.restorePromise;
        if (result.message?.success !== true) {
          const pendingItems = commitOrder.slice(commitIndex + 1);
          pendingItems.forEach(cancelArmedItem);
          pendingItems.forEach((pendingItem) => {
            sendDynamicBindFailure(
              requesterPort,
              pendingItem.action,
              pendingItem.route.houseKey,
              "Execução interrompida porque a casa anterior não confirmou o clique em Apostar.",
            );
          });
          return;
        }
        const committedAt = Date.now();
        console.log(
          `[Fast Trigger SW] Commit ${route.houseKey} entregue em ${committedAt - commitPhaseStartedAt}ms` +
            (previousCommitAt == null
              ? "."
              : `; intervalo entre casas: ${committedAt - previousCommitAt}ms.`),
        );
        previousCommitAt = committedAt;
      } catch (error) {
        sendDynamicBindFailure(
          requesterPort,
          action,
          route.houseKey,
          error?.message || "Falha ao entregar o clique final na casa.",
        );
        const pendingItems = commitOrder.slice(commitIndex + 1);
        pendingItems.forEach(cancelArmedItem);
        pendingItems.forEach((pendingItem) => {
          sendDynamicBindFailure(
            requesterPort,
            pendingItem.action,
            pendingItem.route.houseKey,
            "Execução interrompida antes do clique final nesta casa.",
          );
        });
        return;
      }
    }
  } finally {
    await restoreDynamicBindFocusState(focusState);
  }
}

async function executeFocusedDynamicBindBatch(items, requesterPort) {
  const focusState = await captureDynamicBindFocusState();

  try {
    // Completa uma casa por vez: selecao, stake e confirmacao imediata.
    for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
      const item = items[itemIndex];
      const { action, route, reason } = item;
      const startedAt = Date.now();

      try {
        await refreshDynamicBindRouteTarget(route, action);
        await prepareDynamicBindInteractionTransport(
          route.houseKey,
          route.target,
          action.actionId,
        );
        // Somente a Bet365 precisa de foco real para materializar o mercado e
        // entregar o clique CDP. Focar Betnacional/Betfair aqui era inútil e,
        // quando Chrome reportava a janela durante uma troca, abortava o lote
        // inteiro com "Janela da casa indisponível" apesar da porta estar viva.
        if (dynamicBindRequiresFocusedExecution(route.houseKey)) {
          await focusDynamicBindTarget(route.target);
          stampDynamicBindTiming(action.actionId, "focusedAt");
        }

        const resultPromise = waitForDynamicBindResult(action.actionId, 12000);
        stampDynamicBindTiming(action.actionId, "messageSentAt");
        route.target.port.postMessage({
          type: "EXECUTE_DYNAMIC_BIND",
          __gbrElectronAuthorized: true,
          actionId: action.actionId,
          issuedAt: action.issuedAt,
          routedAt: Date.now(),
          intentSource: action.intentSource,
          intentType: action.intentType,
          house: route.houseKey,
          keyCode: action.keyCode,
          binds: route.binds,
          stakeVal: action.stakeVal || action.stake || null,
          retryable: route.houseKey === "bet365",
        });

        let result = await resultPromise;
        const firstMessage = result?.message;
        const canRetryWithoutDuplicate =
          result &&
          firstMessage?.retryable === true &&
          firstMessage?.success !== true &&
          firstMessage?.clickAttempted !== true &&
          route.houseKey === "bet365";

        // Retry somente antes de qualquer tentativa no botao final.
        if (canRetryWithoutDuplicate) {
          const retryActionId = `${action.actionId}:retry:${Date.now()}`;
          dynamicBindRetryParents.set(retryActionId, action.actionId);
          await result.restorePromise;
          await focusDynamicBindTarget(route.target);

          const retryResultPromise = waitForDynamicBindResult(
            retryActionId,
            12000,
          );
          route.target.port.postMessage({
            type: "EXECUTE_DYNAMIC_BIND",
            __gbrElectronAuthorized: true,
            actionId: retryActionId,
            issuedAt: Date.now(),
            routedAt: Date.now(),
            intentSource: action.intentSource,
            intentType: action.intentType,
            house: route.houseKey,
            keyCode: action.keyCode,
            binds: route.binds,
            stakeVal: action.stakeVal || action.stake || null,
            retry: true,
            retryable: false,
          });
          result = await retryResultPromise;
        }

        if (!result) {
          sendDynamicBindFailure(
            requesterPort,
            action,
            route.houseKey,
            reason || "A casa nao confirmou a aposta no tempo esperado.",
          );
          continue;
        }

        await result.restorePromise;
        finishDynamicBindTiming(action.actionId, {
          contentMs: result.message?.timing?.contentExecutionMs ?? null,
          success: result.message?.success === true,
        });
        if (result.message?.success !== true) {
          // Cada casa é independente: uma falha na Bet365 não cancela a
          // Betnacional e vice-versa.
          continue;
        }

        console.log(
          `[Fast Trigger SW] Aposta confirmada em ${route.houseKey} em ${Date.now() - startedAt}ms` +
            (itemIndex < items.length - 1
              ? "; seguindo para a proxima casa."
              : "."),
        );
      } catch (error) {
        sendDynamicBindFailure(
          requesterPort,
          action,
          route.houseKey,
          error?.message || "Falha ao confirmar a aposta na casa.",
        );
        continue;
      }
    }
  } finally {
    await restoreDynamicBindFocusState(focusState);
  }
}

async function executePreparedDynamicBindRoute(route, action) {
  await prepareDynamicBindInteractionTransport(
    route.houseKey,
    route.target,
    action.actionId,
  );
  const resultPromise = waitForDynamicBindResult(action.actionId);
  stampDynamicBindTiming(action.actionId, "messageSentAt");
  try {
    route.target.port.postMessage({
      type: "EXECUTE_DYNAMIC_BIND",
      __gbrElectronAuthorized: true,
      actionId: action.actionId,
      issuedAt: action.issuedAt,
      routedAt: Date.now(),
      intentSource: action.intentSource,
      intentType: action.intentType,
      house: route.houseKey,
      keyCode: action.keyCode,
      binds: route.binds,
      stakeVal: action.stakeVal || action.stake || null,
    });
  } catch (error) {
    return { ok: false, error };
  }

  const result = await resultPromise;
  finishDynamicBindTiming(action.actionId, {
    contentMs: result?.message?.timing?.contentExecutionMs ?? null,
    success: result?.message?.success === true,
  });
  return result
    ? { ok: true, result }
    : { ok: false, error: new Error("A casa não confirmou a bind no tempo esperado.") };
}

async function dispatchDynamicBindBatch(actions, requesterPort) {
  console.log("[Fast Trigger SW] Lote de binds recebido", actions.map((action) => ({
    actionId: action?.actionId || "",
    house: dynamicBindHouseKey(action?.house),
    keyCode: action?.keyCode || "",
    binds: Array.isArray(action?.binds) ? action.binds.length : action?.binds ? 1 : 0,
  })));
  actions.forEach((action) => {
    if (action?.stakeVal) return;
    const houseKey = marketHouseKey(action?.house);
    action.stakeVal =
      resolveConfiguredStakeForHouse(houseKey) || null;
  });
  actions.forEach(startDynamicBindTiming);
  // Reconcile todas as casas antes de resolver as rotas. Isso reinjeta o
  // coletor quando necessário e troca referências de abas/portas obsoletas
  // sem focar nenhuma janela. A operação é concorrente por casa, portanto um
  // Chrome lento em uma delas não impede as demais de serem roteadas.
  const housesInBatch = [...new Set(actions.map((action) => dynamicBindHouseKey(action?.house)))];
  await Promise.all(
    housesInBatch.map((houseKey) => refreshTradingTargetsForHouse(houseKey).catch((error) => {
      console.warn(`[Fast Trigger SW] Não foi possível atualizar abas de ${houseKey}:`, error?.message || error);
      return [];
    })),
  );
  const routes = await Promise.all(
    actions.map(async (action) => ({
      action,
      // As casas deste lote já foram reconciliadas acima; não repita a
      // consulta/injeção por ação, que criava uma espera cumulativa visível.
      route: await resolveDynamicBindRoute(action.house, action.keyCode, action.binds, true),
    })),
  );
  actions.forEach((action) => stampDynamicBindTiming(action.actionId, "routeResolvedAt"));

  const available = [];
  routes.forEach(({ action, route }) => {
    console.log("[Fast Trigger SW] Rota de bind resolvida", {
      actionId: action?.actionId || "",
      house: route?.houseKey || dynamicBindHouseKey(action?.house),
      ok: route?.ok === true,
      reason: route?.reason || "",
      tabId: route?.target?.tabId ?? null,
    });
    if (!route.ok) {
      sendDynamicBindFailure(requesterPort, action, route.houseKey, route.reason);
      return;
    }
    available.push({ action, route });
    try {
      requesterPort.postMessage({
        type: "DYNAMIC_BIND_DISPATCH_RESULT",
        actionId: action.actionId,
        success: true,
        pending: true,
        house: route.houseKey,
        keyCode: action.keyCode,
      });
    } catch (e) {}
  });

  if (available.length === 0) return;

  // Todas as casas já têm porta top-frame quente: não faça a rodada extra de
  // PREPARE/ACK. O próprio EXECUTE resolve o alvo e só expande/aguarda se o
  // mercado estiver virtualizado, mantendo a segurança e reduzindo um
  // round-trip por casa.
  if (available.every(({ route }) => route.target?.__warm === true)) {
    await Promise.all(
      available.map(async ({ action, route }) => {
        const result = await enqueueDynamicBindDispatch(
          () => executePreparedDynamicBindRoute(route, action),
          route.houseKey,
        );
        if (!result.ok) {
          sendDynamicBindFailure(
            requesterPort,
            action,
            route.houseKey,
            result.error?.message || "Falha ao disparar a bind.",
          );
        }
      }),
    );
    return;
  }

  if (
    available.length === 1 &&
    dynamicBindCanSkipPreparation(available[0].route.houseKey)
  ) {
    const { action, route } = available[0];
    const result = await enqueueDynamicBindDispatch(
      () => executePreparedDynamicBindRoute(route, action),
      route.houseKey,
    );
    if (!result.ok) {
      sendDynamicBindFailure(
        requesterPort,
        action,
        route.houseKey,
        result.error?.message || "Falha ao disparar a bind da Betfair.",
      );
    }
    return;
  }

  const requiresFocusHop = available.some(({ route }) =>
    dynamicBindRequiresFocusedExecution(route.houseKey),
  );

  if (requiresFocusHop) {
    // Nao aguardamos uma preparacao separada: o fluxo da primeira casa ja
    // prepara o mercado e confirma a aposta antes de trocar de janela.
    await enqueueDynamicBindDispatch(
      () => executeFocusedDynamicBindBatch(available, requesterPort),
      "focused",
    );
    return;
  }

  const preparation = await Promise.all(
    available.map(async ({ action, route }) => {
      const waiter = waitForDynamicBindPreparation(action.actionId);
      try {
        route.target.port.postMessage({
          type: "PREPARE_DYNAMIC_BIND",
          __gbrElectronAuthorized: true,
          actionId: action.actionId,
          house: route.houseKey,
          keyCode: action.keyCode,
          binds: route.binds,
        });
      } catch (error) {
        return { action, route, prepared: false, reason: error?.message || "Falha ao enviar preparação." };
      }
      const result = await waiter;
      stampDynamicBindTiming(action.actionId, "backgroundPreparedAt");
      return {
        action,
        route,
        prepared: result?.success === true,
        reason: result?.reason || "A aba não confirmou que o alvo está pronto.",
      };
    }),
  );

  const preparedRoutes = preparation.filter((item) => item.prepared);
  const fallbackRoutes = preparation.filter((item) => !item.prepared);

  const requiresFocusHopAfterPreparation = preparation.some(({ route }) =>
    dynamicBindRequiresFocusedExecution(route.houseKey),
  );

  if (requiresFocusHopAfterPreparation) {
    // Se uma das casas atuais exige foco, mantém todas no mesmo pipeline
    // focado para evitar que uma troca de janela invalide o DOM da outra.
    await executeFocusedDynamicBindBatch(preparation, requesterPort);
    return;
  }

  // Quando as duas casas já estão prontas, os comandos saem juntos, sem trocar
  // o foco entre abas. Esse é o caminho de menor latência.
  await Promise.all(
    preparedRoutes.map(async ({ action, route }) => {
      const result = await enqueueDynamicBindDispatch(
        () => executePreparedDynamicBindRoute(route, action),
        route.houseKey,
      );
      if (!result.ok) {
        sendDynamicBindFailure(
          requesterPort,
          action,
          route.houseKey,
          result.error?.message || "Falha ao disparar a bind preparada.",
        );
      }
    }),
  );

  // Se uma casa não conseguiu ser armada em segundo plano, ela usa o caminho
  // focado já validado para não transformar uma falha parcial em perda total.
  await Promise.all(
    fallbackRoutes.map(async ({ action, route, reason }) => {
      try {
        // Casas externas (Betnacional/Bet365 no Chrome real) não precisam de
        // preparar/focar uma janela global. O fallback deve enviar o comando
        // diretamente pela porta atual; chamar prepareDynamicBindTab aqui
        // recriava o erro de janela nula e mascarava a execução.
        if (dynamicBindRequiresFocusedExecution(route.houseKey)) {
          await executeFocusedDynamicBindRoute(route, action);
        } else {
          const result = await enqueueDynamicBindDispatch(
            () => executePreparedDynamicBindRoute(route, action),
            route.houseKey,
          );
          if (!result.ok) throw result.error || new Error("Falha ao disparar a bind.");
        }
      } catch (error) {
        sendDynamicBindFailure(
          requesterPort,
          action,
          route.houseKey,
          error?.message || reason || "Falha ao preparar a casa.",
        );
      }
    }),
  );
}

// Limpeza reativa de abas removidas ou atualizadas
chrome.tabs.onRemoved.addListener((tabId) => {
  const removedTab = activeTradingTabs.get(tabId);
  if (removedTab) {
    activeTradingTabs.delete(tabId);
    const sameHouseStillOpen = Array.from(activeTradingTabs.values()).some(
      (tabInfo) => tabInfo.siteName === removedTab.siteName,
    );
    if (!sameHouseStillOpen) invalidateMarketSnapshot(removedTab.siteName);
    broadcastConnectionStatus();
  }
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  const tabInfo = activeTradingTabs.get(tabId);
  if (!tabInfo) return;
  tabInfo.lastFocusedAt = Date.now();
  activeTradingTabs.set(tabId, tabInfo);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const updatedSite = detectSiteFromUrl(tab.url);
  if (updatedSite && (changeInfo.url || changeInfo.status === "loading")) {
    // A navigation can keep the same bookmaker host while changing the event.
    // Do not leave the previous event available for a dashboard click.
    invalidateMarketSnapshot(updatedSite);
  }

  if (changeInfo.status === "loading" && tab.url) {
    const isBetting =
      tab.url.includes("bet365") ||
      tab.url.includes("betfair") ||
      tab.url.includes("betnacional") ||
      tab.url.includes("betmgm") ||
      tab.url.includes("betano");
    if (!isBetting && activeTradingTabs.has(tabId)) {
      activeTradingTabs.delete(tabId);
      broadcastConnectionStatus();
    }
  }

  if (changeInfo.status === "complete" && detectSiteFromUrl(tab.url)) {
    void ensureContentScriptInTab(tab);
  }
});

const GLOBAL_DYNAMIC_BIND_SLOT_PATTERN = /^dynamic-bind-slot-([1-4])$/;
const GLOBAL_DYNAMIC_BIND_SLOTS_STORAGE_KEY = "gbr_global_bind_slots";
// Tempo máximo de espera pelo REGISTER_TAB depois de reinjetar o coletor. O
// atalho global costuma ser a primeira coisa que acorda o service worker, e
// nesse instante `activeTradingTabs` ainda está vazio.
const GLOBAL_BIND_TAB_WAIT_MS = 2600;
const GLOBAL_BIND_TAB_POLL_MS = 80;
// Espelha FT_STARTUP_SAFETY_MS do content script: um comando que chega antes
// disso é descartado pela própria proteção de inicialização da casa.
const GLOBAL_BIND_CONTENT_SAFETY_MS = 2000;

// Combinando acentos: a classe é montada por string para manter o arquivo com
// caracteres imprimíveis, exatamente como o slug do painel.
const GLOBAL_BIND_DIACRITICS_PATTERN = new RegExp("[\\u0300-\\u036f]", "g");

function globalBindSlug(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(GLOBAL_BIND_DIACRITICS_PATTERN, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function globalBindParseNumber(value) {
  const match = String(value ?? "")
    .replace(",", ".")
    .match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function globalBindPlayerName(value) {
  return String(value ?? "")
    .replace(/\s*\(\s*\d+\s*\)\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Espelha canonicalMarket() do painel. O `lineName` enviado à casa só existe em
// mercado de jogador — na Bet365 ele aciona a proteção rígida de linha — então a
// classificação precisa ser idêntica à do botão de odd.
function globalBindCanonicalMarketKey(title) {
  const key = globalBindSlug(title);
  if (
    /chutes?-ao-gol|remates?-a-baliza|finalizacoes?-no-gol|shots?-on-target|on-target-shots?/.test(
      key,
    )
  )
    return "player_shots_on_target";
  if (/marcar-ou-dar-assistencia|gol-ou-assist|goal-or-assist/.test(key))
    return "player_goal_or_assist";
  if (/marcadores?-de-gol|jogador-a-marcar|goalscorer/.test(key))
    return "player_goalscorer";
  if (/faltas?-sofridas|faltas?-recebidas|fouls?-drawn|drawn-fouls?/.test(key))
    return "player_fouls_drawn";
  if (/faltas?|player-fouls?|fouls?-by-player/.test(key)) return "player_fouls";
  if (/cartoes?|player-cards?|cards?-by-player/.test(key)) return "player_cards";
  if (
    /jogador.*chutes|chutes.*jogador|finalizacoes.*jogador|player-shots?|shots?-by-player/.test(
      key,
    )
  )
    return "player_shots";
  return `market:${key || "unknown"}`;
}

// fastTriggerEventSlug() do content script é igual ao slug do painel, exceto por
// não truncar em 120 caracteres. O eventId precisa bater byte a byte com
// FastTriggerGetEventIdentity(), senão a casa recusa a seleção em silêncio.
function globalBindEventSlug(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(GLOBAL_BIND_DIACRITICS_PATTERN, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// A identidade do jogo é `${adapter.siteName.toLowerCase()}:${slug(rótulo)}`, e
// os quatro adaptadores nomeiam a casa exatamente como a chave usada aqui. O
// eventContext do snapshot é o mesmo objeto que o content script guarda em
// window.FastTriggerEventContext, então a comparação só falha quando a aba
// realmente trocou de jogo — que é o caso que queremos bloquear.
function globalBindSnapshotEventId(houseKey, snapshot) {
  const teams = Array.isArray(snapshot?.eventContext?.teams)
    ? snapshot.eventContext.teams.filter(Boolean)
    : [];
  const label =
    snapshot?.eventContext?.eventLabel || teams.join(" x ") || "current-event";
  return `${houseKey}:${globalBindEventSlug(label)}`;
}

// Reconstrói as células de um mercado do snapshot com os mesmos índices, rótulos
// e identidade que o painel publica. É essa equivalência que permite ao slot
// global enviar a mesma mensagem do botão de odd.
function globalBindMarketCells(rawMarket, marketIndex) {
  const marketTitle = String(
    rawMarket?.title || `Mercado ${marketIndex + 1}`,
  ).trim();
  const canonicalKey = globalBindCanonicalMarketKey(marketTitle);
  const isPlayerMarket =
    rawMarket?.isPlayerMarket === true || canonicalKey.startsWith("player_");
  const oddsOf = (row) =>
    Array.isArray(row?.colOdds)
      ? row.colOdds
      : Array.isArray(row?.odds)
        ? row.odds
        : [];
  const sourceRows = Array.isArray(rawMarket?.tableRows)
    ? rawMarket.tableRows
    : Array.isArray(rawMarket?.rows)
      ? rawMarket.rows
      : [];
  const rows =
    sourceRows.length > 0
      ? sourceRows
      : [
          {
            lineLabel: marketTitle,
            colOdds: Array.isArray(rawMarket?.participants)
              ? rawMarket.participants
              : Array.isArray(rawMarket?.selections)
                ? rawMarket.selections
                : [],
          },
        ];
  const columnCount = rows.reduce(
    (max, row) => Math.max(max, oddsOf(row).length),
    0,
  );
  if (columnCount === 0) return [];

  const headers = Array.isArray(rawMarket?.headers) ? rawMarket.headers : [];
  const headerOffset = headers.length > columnCount ? 1 : 0;
  const columnLabels = Array.from({ length: columnCount }, (_, columnIndex) => {
    const itemHeader = rows
      .map((row) => {
        const item = oddsOf(row)[columnIndex];
        return item?.colHeader || item?.name;
      })
      .find(Boolean);
    return (
      String(
        itemHeader || headers[columnIndex + headerOffset] || `${columnIndex + 1}`,
      ).trim() || `${columnIndex + 1}`
    );
  });

  const cells = [];
  rows.forEach((rawRow, rowIndex) => {
    const rawLabel = String(rawRow?.lineLabel || `Opção ${rowIndex + 1}`).trim();
    const playerName = isPlayerMarket
      ? globalBindPlayerName(rawLabel)
      : rows.length === 1
        ? marketTitle
        : rawLabel;
    oddsOf(rawRow).forEach((raw, colIndex) => {
      if (!raw || colIndex >= columnCount) return;
      const optionLabel =
        String(
          raw.colHeader || raw.name || columnLabels[colIndex] || `${colIndex + 1}`,
        ).trim() || `${colIndex + 1}`;
      const odds = globalBindParseNumber(raw.val ?? raw.odds);
      const statusText = String(raw.status ?? raw.odds ?? raw.val ?? "");
      cells.push({
        marketTitle,
        canonicalKey,
        isPlayerMarket,
        rowIndex,
        colIndex,
        playerName,
        rowLabel: rawLabel,
        targetName: String(raw.name || `${playerName} ${optionLabel}`).trim(),
        lineName: isPlayerMarket ? playerName : "",
        optionLabel,
        odds,
        originalOdds: String(raw.val ?? raw.odds ?? ""),
        outcomeId: raw.outcomeId ? String(raw.outcomeId) : "",
        actionable:
          odds !== null &&
          rawMarket?.isSuspended !== true &&
          raw.isClosed !== true &&
          !/closed|locked|suspended|fechado/i.test(statusText),
      });
    });
  });
  return cells;
}

function globalBindDedupeCells(cells) {
  const seen = new Set();
  return cells.filter((cell) => {
    const signature = `${globalBindSlug(cell.marketTitle)}|${cell.rowIndex}|${cell.colIndex}`;
    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
}

// Repete no service worker a resolução que o painel faz antes de disparar: o
// outcome manda, depois a identidade textual e só então o par linha/coluna
// salvo. Cada passagem só é aceita quando aponta para uma única célula — um
// palpite ambíguo colocaria dinheiro na odd errada.
function resolveGlobalBindSelection(bind, houseKey) {
  const houseName = dynamicBindHouseName(houseKey);
  const snapshot = globalThis.marketStatesByHouse.get(houseKey);
  if (!snapshot) {
    return { ok: false, reason: `Sem leitura recente dos mercados da ${houseName}.` };
  }
  const capturedAt = Number(snapshot.capturedAt || 0);
  if (
    snapshot.stale === true ||
    (capturedAt > 0 && Date.now() - capturedAt > MAX_MARKET_SNAPSHOT_AGE_MS)
  ) {
    return {
      ok: false,
      reason: `A leitura dos mercados da ${houseName} está desatualizada.`,
    };
  }

  const groups = Array.isArray(snapshot.groups) ? snapshot.groups : [];
  const cells = groups.flatMap((rawMarket, index) =>
    globalBindMarketCells(rawMarket, index),
  );
  if (cells.length === 0) {
    return { ok: false, reason: `Nenhum mercado lido na aba da ${houseName}.` };
  }

  const target = bind?.panelTarget || {};
  const storedMarket = target.marketTitle || bind?.market || "";
  const wantedOutcome = String(target.outcomeId || bind?.outcomeId || "").trim();
  const wantedMarket = globalBindSlug(storedMarket);
  const wantedCanonical = storedMarket
    ? globalBindCanonicalMarketKey(storedMarket)
    : "";
  const wantedOption = globalBindSlug(
    target.optionLabel || (bind?.lineMode === "exact" ? bind?.line : "") || "",
  );
  const wantedTargetName = globalBindSlug(target.targetName || bind?.selection || "");
  const wantedPlayer = globalBindSlug(
    target.lineName || bind?.player || bind?.rowLabel || "",
  );
  const wantedRow = Number.isInteger(bind?.rowIndex) ? bind.rowIndex : null;
  const wantedCol = Number.isInteger(bind?.colIndex) ? bind.colIndex : null;

  const marketCells = wantedMarket
    ? cells.filter(
        (cell) =>
          globalBindSlug(cell.marketTitle) === wantedMarket ||
          cell.canonicalKey === wantedCanonical,
      )
    : cells;
  const scoped = marketCells.length > 0 ? marketCells : cells;

  const passes = [];
  if (wantedOutcome) {
    passes.push(cells.filter((cell) => cell.outcomeId === wantedOutcome));
  }
  if (wantedTargetName) {
    passes.push(
      scoped.filter((cell) => globalBindSlug(cell.targetName) === wantedTargetName),
    );
  }
  if (wantedPlayer && wantedOption) {
    passes.push(
      scoped.filter(
        (cell) =>
          globalBindSlug(cell.playerName) === wantedPlayer &&
          globalBindSlug(cell.optionLabel) === wantedOption,
      ),
    );
  }
  if (wantedPlayer) {
    passes.push(
      scoped.filter((cell) => globalBindSlug(cell.playerName) === wantedPlayer),
    );
  }
  if (wantedOption) {
    passes.push(
      scoped.filter((cell) => globalBindSlug(cell.optionLabel) === wantedOption),
    );
  }
  if (wantedRow !== null && wantedCol !== null) {
    passes.push(
      scoped.filter((cell) => cell.rowIndex === wantedRow && cell.colIndex === wantedCol),
    );
  }

  const unique = passes
    .map(globalBindDedupeCells)
    .find((candidates) => candidates.length === 1);
  const selection = unique ? unique[0] : null;
  if (!selection) {
    return {
      ok: false,
      reason: `Não foi possível localizar a odd da bind na leitura atual da ${houseName}.`,
    };
  }
  if (!selection.actionable) {
    return { ok: false, reason: "A seleção da bind está suspensa ou indisponível." };
  }

  return {
    ok: true,
    selection,
    eventId: globalBindSnapshotEventId(houseKey, snapshot),
  };
}

function findGlobalBindHouseTab(houseKey) {
  return (
    Array.from(activeTradingTabs.values())
      .filter(
        (tabInfo) =>
          tabInfo &&
          tabInfo.port &&
          String(tabInfo.siteName || "")
            .toLowerCase()
            .includes(houseKey),
      )
      .sort(
        (left, right) =>
          Number(right.lastFocusedAt || 0) - Number(left.lastFocusedAt || 0),
      )[0] || null
  );
}

// O atalho global chega direto do sistema operacional e costuma ser o evento que
// acorda o service worker. `activeTradingTabs` vive em memória, então nesse
// primeiro instante ela está vazia e a rota antiga respondia "Nenhuma aba
// conectada" mesmo com a casa aberta. Reinjetamos o coletor e aguardamos o
// REGISTER_TAB antes de desistir.
async function ensureGlobalBindHouseTab(houseKey) {
  const immediate = findGlobalBindHouseTab(houseKey);
  if (immediate) return immediate;

  void ensureContentScriptsInBettingTabs();
  const deadline = Date.now() + GLOBAL_BIND_TAB_WAIT_MS;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, GLOBAL_BIND_TAB_POLL_MS));
    const target = findGlobalBindHouseTab(houseKey);
    if (target) return target;
  }
  return null;
}

// A casa descarta qualquer comando recebido durante a própria janela de
// inicialização segura. Se o coletor acabou de subir, esperamos o restante dela
// em vez de gastar o disparo.
async function waitForGlobalBindContentSafety(target) {
  const bootedAt = Number(target?.bootedAt || 0);
  if (!bootedAt) return;
  const remaining = GLOBAL_BIND_CONTENT_SAFETY_MS + 150 - (Date.now() - bootedAt);
  if (remaining <= 0) return;
  await new Promise((resolve) =>
    setTimeout(resolve, Math.min(remaining, GLOBAL_BIND_CONTENT_SAFETY_MS + 150)),
  );
}

// Rota principal do slot global: a mesma mensagem que o botão de odd do painel
// envia, com a célula já resolvida aqui. Nada é reencontrado por texto no DOM da
// casa, que era a origem da instabilidade quando o mercado mudava de posição.
async function dispatchGlobalBindThroughPanelRoute(bind, houseKey, target) {
  const resolution = resolveGlobalBindSelection(bind, houseKey);
  if (!resolution.ok) return resolution;

  const cell = resolution.selection;
  const value = cell.originalOdds || String(cell.odds ?? "");
  const intent = createInternalIntent("select_odds", "chrome_command");

  // A Bet365 só entrega o evento nativo do CDP com a janela em primeiro plano.
  // O foco é emprestado e devolvido assim que a casa reporta o resultado.
  if (houseKey === "bet365") {
    await prepareDynamicBindInteractionTransport(houseKey, target, intent.actionId);
    await prepareDynamicBindTab(target, intent.actionId);
  }

  target.port.postMessage({
    type: "SELECT_ODDS",
    actionId: intent.actionId,
    issuedAt: intent.issuedAt,
    intentSource: intent.intentSource,
    intentType: intent.intentType,
    fastMode: true,
    house: houseKey,
    eventId: resolution.eventId,
    name: cell.targetName,
    lineName: cell.lineName,
    optionLabel: cell.optionLabel,
    val: value,
    odds: value,
    marketTitle: cell.marketTitle,
    colIndex: cell.colIndex,
    rowIndex: cell.rowIndex,
    outcomeId: cell.outcomeId,
  });

  return { ok: true, actionId: intent.actionId, selection: cell };
}

function createGlobalBindRequesterPort() {
  return {
    postMessage(message) {
      activePorts.forEach((port) => {
        try {
          port.postMessage(message);
        } catch (error) {}
      });
    },
  };
}

function findStoredDynamicBindById(rawBinds, bindId) {
  if (!rawBinds || typeof rawBinds !== "object" || !bindId) return null;
  for (const rawEntry of Object.values(rawBinds)) {
    const entries = Array.isArray(rawEntry) ? rawEntry : [rawEntry];
    const match = entries.find(
      (bind) => bind && typeof bind === "object" && String(bind.id || "") === bindId,
    );
    if (match) return match;
  }
  return null;
}

function dynamicBindKeyCodeFromStoredBind(bind) {
  const storedCode = String(bind?.keyCode || "").trim();
  if (storedCode) return storedCode;
  const key = String(bind?.key || "").trim().toUpperCase();
  if (/^[A-Z]$/.test(key)) return `Key${key}`;
  if (/^[0-9]$/.test(key)) return `Digit${key}`;
  return key;
}

async function dispatchGlobalDynamicBindSlot(slot) {
  const intent = createInternalIntent("dynamic_bind", "chrome_command");
  const requesterPort = createGlobalBindRequesterPort();
  const local = await getCurrentUserScopedLocal(
    [GLOBAL_DYNAMIC_BIND_SLOTS_STORAGE_KEY, "dynamicPlayerBinds"],
    {
      [GLOBAL_DYNAMIC_BIND_SLOTS_STORAGE_KEY]: {},
      dynamicPlayerBinds: {},
    },
  );
  const assignments = local[GLOBAL_DYNAMIC_BIND_SLOTS_STORAGE_KEY];
  const bindId =
    assignments && typeof assignments === "object"
      ? String(assignments[String(slot)] || "").trim()
      : "";
  const bind = findStoredDynamicBindById(local.dynamicPlayerBinds, bindId);

  if (!bindId || !bind) {
    requesterPort.postMessage({
      type: "DYNAMIC_BIND_DISPATCH_RESULT",
      actionId: intent.actionId,
      success: false,
      pending: false,
      globalSlot: String(slot),
      reason: !bindId
        ? `O slot global ${slot} ainda não possui uma bind.`
        : `A bind do slot global ${slot} não existe mais. Configure o slot novamente.`,
    });
    return;
  }

  if (bind.enabled === false) {
    requesterPort.postMessage({
      type: "DYNAMIC_BIND_DISPATCH_RESULT",
      actionId: intent.actionId,
      success: false,
      pending: false,
      globalSlot: String(slot),
      reason: `A bind do slot global ${slot} está desativada.`,
    });
    return;
  }

  const house = dynamicBindHouseKey(bind.house);
  const keyCode = dynamicBindKeyCodeFromStoredBind(bind);
  const target = await ensureGlobalBindHouseTab(house);
  if (!target) {
    requesterPort.postMessage({
      type: "DYNAMIC_BIND_DISPATCH_RESULT",
      actionId: intent.actionId,
      success: false,
      pending: false,
      house,
      keyCode,
      globalSlot: String(slot),
      reason: `Nenhuma aba conectada da ${dynamicBindHouseName(house)}.`,
    });
    return;
  }
  await waitForGlobalBindContentSafety(target);

  const panelRoute = await dispatchGlobalBindThroughPanelRoute(
    bind,
    house,
    target,
  ).catch((error) => ({
    ok: false,
    reason:
      error instanceof Error ? error.message : "Falha ao enviar a seleção da bind.",
  }));

  if (panelRoute.ok) {
    requesterPort.postMessage({
      type: "DYNAMIC_BIND_DISPATCH_RESULT",
      actionId: panelRoute.actionId,
      success: true,
      pending: false,
      house,
      keyCode,
      globalSlot: String(slot),
      route: "panel",
      reason: "",
    });
    return;
  }

  // Plano B: a rota contextual reencontra o alvo no DOM da casa. Ela é menos
  // precisa, então só entra quando o snapshot não consegue apontar a célula.
  console.warn(
    `[Fast Trigger SW] Slot global ${slot} caiu para a rota contextual:`,
    panelRoute.reason,
  );
  await dispatchDynamicBindToHouse(
    house,
    keyCode,
    {
      ...createInternalIntent("dynamic_bind", "chrome_command"),
      binds: [bind],
      globalSlot: String(slot),
      fallbackReason: panelRoute.reason,
    },
    requesterPort,
  );
}

// Escuta os atalhos globais configurados no Chrome. Os quatro slots são
// comandos explícitos do sistema operacional; portanto não dependem do foco
// da janela do dashboard e reutilizam a mesma rota segura das binds manuais.
chrome.commands.onCommand.addListener(async (command) => {
  console.log(
    "[Fast Trigger SW] 🌐 Atalho capturado no Service Worker:",
    command,
  );
  const globalBindSlot = command.match(GLOBAL_DYNAMIC_BIND_SLOT_PATTERN)?.[1];
  if (globalBindSlot) {
    await dispatchGlobalDynamicBindSlot(globalBindSlot);
  } else if (command === "trigger-betfair") {
    dispatchBetToSpecificHouse("betfair", true);
  } else if (command === "trigger-bet365") {
    dispatchBetToSpecificHouse("bet365", true);
  } else if (command === "trigger-focused") {
    dispatchBetToFocusedTab(true);
  } else if (command === "trigger_place_bet_global") {
    dispatchBetToAllActiveTabs(true);
  }
});

async function dispatchBetToSpecificHouse(
  house,
  isHotkey = false,
  intent = null,
) {
  const patterns =
    house === "betfair"
      ? ["*://*.betfair.com/*", "*://*.betfair.bet.br/*", "*://*.betfair.es/*"]
      : house === "betnacional"
        ? [
            "*://*.betnacional.com/*",
            "*://*.betnacional.bet.br/*",
            "*://*.betnacional.br/*",
          ]
        : house === "betmgm"
          ? ["*://betmgm.bet.br/*", "*://*.betmgm.bet.br/*"]
          : house === "betano"
            ? ["*://betano.bet.br/*", "*://*.betano.bet.br/*"]
            : house === "superbet"
              ? ["*://superbet.bet.br/*", "*://*.superbet.bet.br/*", "*://superbet.com/*", "*://*.superbet.com/*"]
              : ["*://*.bet365.com/*", "*://*.bet365.bet.br/*", "*://*.bet365.es/*"];

  console.log(
    `[Fast Trigger SW] 🎯 Disparando aposta direcionada para a casa: ${house} (isHotkey: ${isHotkey})`,
  );

  try {
    const tabs = await chrome.tabs.query({ url: patterns });
    if (!tabs || tabs.length === 0) {
      console.warn(
        `[Fast Trigger SW] ⚠️ Nenhuma aba encontrada para a casa: ${house}`,
      );
      return;
    }

    const actionIntent = intent || createInternalIntent("trigger_bet");
    const houseStake =
      resolveConfiguredStakeForHouse(house) ||
      latestElectronConfig?.stakeVal ||
      electronConfigCache?.stakeVal ||
      "0.50";
    tabs.forEach((tab) => {
      chrome.tabs.sendMessage(
        tab.id,
        {
          action: "DISPARAR_APOSTA",
          isHotkey,
          stake: houseStake,
          stakeVal: houseStake,
          ...actionIntent,
        },
        { frameId: 0 },
        () => {
          if (chrome.runtime.lastError) {
          }
        },
      );
    });
  } catch (err) {
    console.error(
      `[Fast Trigger SW] Erro no dispatch direcionado para ${house}:`,
      err,
    );
  }
}

async function dispatchBetToFocusedTab(isHotkey = false, intent = null) {
  console.log(
    `[Fast Trigger SW] 🎯 Disparando aposta na aba em FOCO (isHotkey: ${isHotkey})`,
  );
  try {
    const tabs = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });
    if (tabs && tabs.length > 0) {
      const tabHouse = detectSiteFromUrl(tabs[0].url);
      const houseKey = tabHouse ? marketHouseKey(tabHouse) : null;
      const houseStake =
        resolveConfiguredStakeForHouse(houseKey) ||
        latestElectronConfig?.stakeVal ||
        electronConfigCache?.stakeVal ||
        "0.50";
      chrome.tabs.sendMessage(
        tabs[0].id,
        {
          action: "DISPARAR_APOSTA",
          isHotkey,
          stake: houseStake,
          stakeVal: houseStake,
          ...(intent || createInternalIntent("trigger_bet")),
        },
        { frameId: 0 },
        () => {
          if (chrome.runtime.lastError) {
          }
        },
      );
    }
  } catch (e) {}
}

/**
 * Envia a mensagem DISPARAR_APOSTA para TODAS as abas registradas ativas simultaneamente.
 */
async function dispatchBetToAllActiveTabs(isHotkey = false, intent = null) {
  try {
    console.log(
      `[Fast Trigger SW] 🚀 Disparando aposta para ${activeTradingTabs.size} aba(s) ativas! (isHotkey: ${isHotkey})`,
    );
    const actionIntent = intent || createInternalIntent("trigger_bet");

    // 1. Notifica via portas de conexões ativas
    activeTradingTabs.forEach((tabInfo) => {
      if (tabInfo && tabInfo.port) {
        try {
          const tabHouse = marketHouseKey(tabInfo.siteName);
          const houseStake =
            resolveConfiguredStakeForHouse(tabHouse) ||
            latestElectronConfig?.stakeVal ||
            electronConfigCache?.stakeVal ||
            "0.50";
          tabInfo.port.postMessage({
            type: "DISPARAR_APOSTA",
            action: "DISPARAR_APOSTA",
            isHotkey,
            stake: houseStake,
            stakeVal: houseStake,
            ...actionIntent,
          });
        } catch (e) {}
      }
    });

    // 2. Notifica via chrome.tabs.sendMessage para todas as abas das casas registradas
    const tabs = await chrome.tabs.query({
      url: [
        "*://*.bet365.com/*",
        "*://*.bet365.bet.br/*",
        "*://*.bet365.es/*",
        "*://*.betfair.com/*",
        "*://*.betfair.bet.br/*",
        "*://*.betfair.es/*",
        "*://*.betnacional.com/*",
        "*://*.betnacional.bet.br/*",
        "*://*.betnacional.br/*",
        "*://betmgm.bet.br/*",
        "*://*.betmgm.bet.br/*",
        "*://betano.bet.br/*",
        "*://*.betano.bet.br/*",
      ],
    });

    if (tabs && tabs.length > 0) {
      tabs
        .filter((tab) => !activeTradingTabs.has(tab.id))
        .forEach((tab) => {
          chrome.tabs.sendMessage(
            tab.id,
            {
              action: "DISPARAR_APOSTA",
              isHotkey,
              ...actionIntent,
            },
            { frameId: 0 },
            () => {
              if (chrome.runtime.lastError) {
              }
            },
          );
        });
    }
  } catch (err) {
    console.error("[Fast Trigger SW] Erro no dispatch global:", err);
  }
}

// Fallback para mensagens diretas da API de runtime
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "GBR_INSTALLATION_PING" || msg?.action === "GBR_INSTALLATION_PING") {
    const handler = (typeof globalThis !== 'undefined' && globalThis.GbrInstallationState)
      ? globalThis.GbrInstallationState.handleInstallationPing
      : null;
    const manifest = (typeof chrome !== 'undefined' && chrome.runtime?.getManifest)
      ? chrome.runtime.getManifest()
      : { version: '4.3.0' };
    const pong = handler
      ? handler({ message: msg, extensionVersion: manifest.version })
      : { type: 'GBR_INSTALLATION_PONG', version: manifest.version, protocol: '2.0', status: 'ready', safeMode: true };
    sendResponse(pong);
    return false;
  }
  // Recuperação para dashboards que ainda não terminaram de abrir a porta
  // longa (Electron/Chrome). Sem este caminho, `sendMessage(REQUEST_MARKETS)`
  // era ignorado e a sincronização permanecia vazia após reiniciar.
  if (msg?.type === "REQUEST_MARKETS" || msg?.action === "REQUEST_MARKETS") {
    const rawHouse = String(msg.house || "bet365").toLowerCase();
    const houseKey = rawHouse.includes("betnacional")
      ? "betnacional"
      : rawHouse.includes("betfair")
        ? "betfair"
        : rawHouse.includes("betmgm")
          ? "betmgm"
          : rawHouse.includes("betano")
            ? "betano"
            : "bet365";
    const requestId = String(msg.requestId || `runtime-market-sync-${houseKey}-${Date.now()}`).slice(0, 96);
    void forceMarketUpdateForHouse(houseKey, requestId);
    sendResponse({ status: "QUEUED", house: houseKey, requestId });
    return true;
  }

  if (msg?.action === "ENSURE_BET365_MAIN_RUNTIME") {
    const tabId = sender?.tab?.id;
    const senderSite = detectSiteFromUrl(sender?.tab?.url || "");
    if (!Number.isInteger(tabId) || senderSite !== "Bet365" || sender.frameId !== 0) {
      sendResponse({ ready: false, error: "invalid_sender" });
      return true;
    }
    (async () => {
      const ready = await ensureBet365MainWorldRuntimeInTab(tabId);
      if (ready && networkFeedShouldBeEnabled()) {
        await injectNetworkFeedObserver(tabId);
      }
      sendResponse({ ready });
    })().catch(() => sendResponse({ ready: false, error: "main_runtime_failed" }));
    return true;
  }

  if (msg?.action === "GET_NETWORK_FEED_EXPERIMENT") {
    sendResponse({
      enabled: networkFeedExperimentEnabled,
      observations: networkFeedObservations.length,
      metrics: getNetworkFeedMetrics(),
      latest: networkFeedObservations.slice(-20),
    });
    return true;
  }

  // A dashboard Electron is the source of truth for stake/1-click settings.
  // Its tabs API only knows Electron windows, so UPDATE_CONFIG must be relayed
  // explicitly to the real Chrome house tabs registered through Native
  // Messaging. Keep the latest config and replay it whenever a house connects.
  if (msg?.action === "UPDATE_CONFIG" && msg.config && typeof msg.config === "object") {
    const config = { ...msg.config };
    latestElectronConfig = config;
    electronConfigCache = { ...electronConfigCache, ...config };
    activeTradingTabs.forEach((tabInfo) => {
      if (!tabInfo?.port) return;
      try {
        tabInfo.port.postMessage({
          action: "UPDATE_CONFIG",
          config,
          __gbrElectronAuthorized: true,
        });
      } catch (_) {}
    });
    sendResponse({ status: "OK", relayed: activeTradingTabs.size });
    return true;
  }

  if (msg?.action === "GET_DIRECT_ORDER_TELEMETRY") {
    sendResponse({
      metrics: getDirectOrderMetrics(),
      latest: directOrderResults.slice(-20),
    });
    return true;
  }

  if (msg?.action === "SET_NETWORK_FEED_EXPERIMENT") {
    (async () => {
      try {
        const enabled = await setNetworkFeedExperimentEnabled(msg.enabled === true);
        sendResponse({ enabled });
      } catch (error) {
        sendResponse({ enabled: networkFeedExperimentEnabled, error: "network_feed_update_failed" });
      }
    })();
    return true;
  }

  if (msg && msg.action === "PRODUCE_TRUSTED_TEXT") {
    (async () => {
      let tabId =
        sender && sender.tab
          ? sender.tab.id
          : msg && msg.tabId
            ? msg.tabId
            : null;
      // Mensagens originadas pelo preload/bridge Electron podem não carregar
      // sender.tab. Nesse caso, prefira a aba de trading registrada para a
      // Betnacional (ou outra casa ativa) em vez de assumir a aba atualmente
      // focada, que normalmente é o dashboard.
      if (!Number.isInteger(tabId)) {
        try {
          const preferred = [...activeTradingTabs.values()]
            .filter((entry) => entry && entry.active !== false && Number.isInteger(entry.tabId))
            .sort((a, b) => (b.lastSeenAt || 0) - (a.lastSeenAt || 0));
          const house = String(msg?.house || msg?.siteName || '').toLowerCase();
          const sameHouse = house
            ? preferred.find((entry) => String(entry.siteName || '').toLowerCase().includes(house))
            : preferred.find((entry) => String(entry.siteName || '').toLowerCase().includes('betnacional'));
          if (sameHouse) tabId = sameHouse.tabId;
        } catch (_) {}
      }
      if (!tabId) {
        try {
          const tabs = await chrome.tabs.query({
            active: true,
            lastFocusedWindow: true,
          });
          if (tabs && tabs[0]) tabId = tabs[0].id;
        } catch (e) {}
      }

      if (!tabId || typeof msg.text !== "string") {
        sendResponse({
          status: "ERROR",
          message: "Dados de digitação ausentes",
        });
        return;
      }

      const existingTypingTask = trustedTextTasksByTab.get(tabId);
      if (existingTypingTask && existingTypingTask.text === msg.text) {
        const sharedResult = await existingTypingTask.promise;
        sendResponse({ ...sharedResult, deduplicated: true });
        return;
      }

      let resolveTypingTask;
      const typingTaskPromise = new Promise((resolve) => {
        resolveTypingTask = resolve;
      });
      const typingTaskEntry = {
        text: msg.text,
        promise: typingTaskPromise,
      };
      trustedTextTasksByTab.set(tabId, typingTaskEntry);

      const debugTarget = { tabId };
      const typingStartedAt = Date.now();

      try {
        await ensureTrustedDebuggerAttached(tabId);

        // Ctrl+A e Backspace limpam o valor pelo próprio mecanismo de edição.
        // `clearLength` é a rede de segurança quando o atalho não é aceito.
        await clearTrustedTextField(
          debugTarget,
          msg.clearLength,
          msg.preferInsertText === true,
        );

        // Caminho rápido: contenteditable moderno aceita Input.insertText e
        // atualiza o React em uma única chamada CDP. Se o comando for recusado,
        // seguimos automaticamente para a digitação tecla a tecla abaixo.
        if (msg.preferInsertText === true) {
          try {
            await chrome.debugger.sendCommand(debugTarget, "Input.insertText", {
              text: msg.text,
            });
            const successResult = {
              status: "OK",
              trusted: true,
              latencyMs: Date.now() - typingStartedAt,
              inputMode: "insertText",
            };
            resolveTypingTask(successResult);
            sendResponse(successResult);
            return;
          } catch (insertError) {
            console.warn("[Fast Trigger] Input.insertText indisponível; usando teclas:", insertError?.message || insertError);
          }
        }

        // Envia cada caractere como uma tecla completa. Alguns componentes
        // contenteditable da Bet365 atualizam o estado no keydown/keyup e
        // descartam uma inserção feita em bloco por Input.insertText.
        for (const char of msg.text) {
          const isDigit = /^\d$/.test(char);
          const code = isDigit
            ? `Digit${char}`
            : char === ","
              ? "Comma"
              : "Period";
          const virtualKeyCode = isDigit
            ? 48 + Number(char)
            : char === ","
              ? 188
              : 190;

          await chrome.debugger.sendCommand(
            debugTarget,
            "Input.dispatchKeyEvent",
            {
              type: "keyDown",
              key: char,
              code,
              text: char,
              unmodifiedText: char,
              windowsVirtualKeyCode: virtualKeyCode,
              nativeVirtualKeyCode: virtualKeyCode,
            },
          );
          await chrome.debugger.sendCommand(
            debugTarget,
            "Input.dispatchKeyEvent",
            {
              type: "keyUp",
              key: char,
              code,
              windowsVirtualKeyCode: virtualKeyCode,
              nativeVirtualKeyCode: virtualKeyCode,
            },
          );

          await Promise.resolve();
        }

        // O próximo comando já aguarda a conclusão do keyup; não inserimos
        // uma espera fixa aqui para não alongar o caminho quente.

        const successResult = {
          status: "OK",
          trusted: true,
          latencyMs: Date.now() - typingStartedAt,
        };
        resolveTypingTask(successResult);
        sendResponse(successResult);
      } catch (err) {
        console.error("Erro na digitação nativa CDP:", err);
        const errorResult = { status: "ERROR", error: err.message };
        resolveTypingTask(errorResult);
        sendResponse(errorResult);
      } finally {
        // Mantém a sessão somente entre a digitação da stake e o clique final.
        scheduleTrustedDebuggerDetach(tabId);

        // Mantém o resultado por uma janela curta para absorver solicitações
        // equivalentes que já estavam enfileiradas em outros frames.
        setTimeout(() => {
          if (trustedTextTasksByTab.get(tabId) === typingTaskEntry) {
            trustedTextTasksByTab.delete(tabId);
          }
        }, 180);
      }
    })();

    return true;
  }

  if (msg && msg.action === "PRODUCE_TRUSTED_CLICK") {
    (async () => {
      let tabId =
        sender && sender.tab
          ? sender.tab.id
          : msg && msg.tabId
            ? msg.tabId
            : null;
      if (!tabId) {
        try {
          const tabs = await chrome.tabs.query({
            active: true,
            lastFocusedWindow: true,
          });
          if (tabs && tabs[0]) tabId = tabs[0].id;
        } catch (e) {}
      }

      console.log(`[Fast Trigger] PRODUCE_TRUSTED_CLICK resolvido para aba ${tabId} (house=${msg?.house || 'desconhecida'}, senderTab=${sender?.tab?.id ?? 'ausente'})`);

      if (!tabId) {
        sendResponse({ status: "ERROR", message: "Tab ID ausente" });
        return;
      }

      const existingClick = trustedClickTasksByTab.get(tabId);
      if (existingClick) {
        console.warn(`[Fast Trigger] Clique financeiro duplicado ignorado na aba ${tabId}.`);
        sendResponse({ status: "ERROR", error: "trusted_click_duplicate" });
        return;
      }
      const clickTask = { startedAt: Date.now() };
      trustedClickTasksByTab.set(tabId, clickTask);

      const directOrderLearningArmed = msg.directOrderLearning
        ? armAutomaticDirectOrderLearning(msg.directOrderLearning, sender)
        : false;

      const targetX = Math.round(msg.x);
      const targetY = Math.round(msg.y);
      const debugTarget = { tabId: tabId };
      const clickStartedAt = Date.now();
      const fastResponse = msg.fastResponse === true;
      const keepDebuggerAttachedMs = fastResponse
        ? Math.min(900, Math.max(0, Number(msg.keepDebuggerAttachedMs) || 0))
        : 0;

      try {
        // Mantém a sessão CDP aquecida por uma janela curta: anexar e
        // desanexar a cada clique era uma das maiores fontes de latência.
        await ensureTrustedDebuggerAttached(tabId);

        // 2. Dispara os eventos de hardware (Press + Release)
        await chrome.debugger.sendCommand(
          debugTarget,
          "Input.dispatchMouseEvent",
          {
            type: "mousePressed",
            x: targetX,
            y: targetY,
            button: "left",
            clickCount: 1,
          },
        );

        await chrome.debugger.sendCommand(
          debugTarget,
          "Input.dispatchMouseEvent",
          {
            type: "mouseReleased",
            x: targetX,
            y: targetY,
            button: "left",
            clickCount: 1,
          },
        );

        // No caminho rápido, o mouseReleased já é a confirmação de entrega.
        // A desmontagem da sessão ocorre fora do tempo crítico da aposta.
        if (!fastResponse) await detachTrustedDebuggerNow(tabId);

        sendResponse({
          status: "OK",
          trusted: true,
          latencyMs: Date.now() - clickStartedAt,
          directOrderLearningArmed,
        });
      } catch (err) {
        console.error("Erro no clique nativo CDP:", err);
        sendResponse({ status: "ERROR", error: err.message });
      } finally {
        if (trustedClickTasksByTab.get(tabId) === clickTask) {
          trustedClickTasksByTab.delete(tabId);
        }
        scheduleTrustedDebuggerDetach(tabId, keepDebuggerAttachedMs);
      }
    })();

    return true;
  }

  // Telemetria temporária do fluxo de confirmação. O conteúdo é limitado a
  // estado técnico (sem credenciais, cookies ou valores sensíveis) e aparece
  // no log do background/Electron para diagnóstico de uma tentativa.
  if (msg && msg.action === "TRACE_BETFLOW") {
    try {
      const trace = msg.trace && typeof msg.trace === "object" ? msg.trace : {};
      console.log("[BetFlow TRACE]", JSON.stringify({
        at: Date.now(),
        tabId: sender?.tab?.id ?? msg.tabId ?? null,
        ...trace,
      }));
    } catch (e) {
      console.log("[BetFlow TRACE] (payload indisponível)");
    }
    sendResponse({ status: "OK" });
    return true;
  }

  if (msg && msg.action === "NOTIFY_USER") {
    const houseName = msg.house || "Casa de Apostas";
    const stakeVal = msg.stake || "";

    console.log(
      `[Fast Trigger SW] 📢 Transmitindo notificação cross-tab da aposta na ${houseName}`,
    );

    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      if (tabs && tabs.length > 0) {
        chrome.tabs
          .sendMessage(tabs[0].id, {
            action: "SHOW_CROSS_TAB_TOAST",
            house: houseName,
            stake: stakeVal,
          })
          .catch(() => {});
      }
    });

    sendResponse({ status: "OK" });
    return true;
  }
  if (msg && msg.action === "HOUSE_CONNECTED") {
    const tabId = sender.tab ? sender.tab.id : null;
    const house = msg.house;
    const siteName =
      house === "betfair"
        ? "Betfair"
        : house === "betnacional"
          ? "Betnacional"
          : house === "betmgm"
            ? "BetMGM"
            : house === "betano"
              ? "Betano"
              : house === "superbet"
                ? "Superbet"
                : "Bet365";

    console.log(
      `[Fast Trigger SW] 🤝 Handshake HOUSE_CONNECTED recebido: ${siteName} (Aba ID: ${tabId})`,
    );

    if (tabId) {
      activeTradingTabs.set(tabId, {
        tabId: tabId,
        siteName: siteName,
        url: sender.tab ? sender.tab.url : "",
        windowId: sender.tab ? sender.tab.windowId : undefined,
        active: true,
      });
      if (siteName === "Bet365") {
        // HOUSE_CONNECTED é a prova mais confiável de que o content script da
        // aba terminou o boot. Não depender do switch aqui evita o estado
        // impossível em que o painel está conectado, mas o MAIN world nunca
        // recebeu inject.js/networkDispatcher.js. A instalação é passiva; se a
        // aceleração estiver armada, injectNetworkFeedObserver publica depois
        // os controles persistidos.
        void (async () => {
          const mainReady = await ensureBet365MainWorldRuntimeInTab(tabId);
          if (mainReady && networkFeedShouldBeEnabled()) {
            await injectNetworkFeedObserver(tabId);
          }
        })();
      }
    } else {
      const tempId = `temp_${house}_${Date.now()}`;
      activeTradingTabs.set(tempId, {
        tabId: tempId,
        siteName: siteName,
        active: true,
      });
    }

    broadcastConnectionStatus();
    sendResponse({
      status: "OK",
      house: siteName,
      connectionStatus: {
        bet365Active: Array.from(activeTradingTabs.values()).some(
          (t) => t.siteName === "Bet365",
        ),
        betfairActive: Array.from(activeTradingTabs.values()).some(
          (t) => t.siteName === "Betfair",
        ),
        betnacionalActive: Array.from(activeTradingTabs.values()).some(
          (t) => t.siteName === "Betnacional",
        ),
        betmgmActive: Array.from(activeTradingTabs.values()).some(
          (t) => t.siteName === "BetMGM",
        ),
        betanoActive: Array.from(activeTradingTabs.values()).some(
          (t) => t.siteName === "Betano",
        ),
        superbetActive: Array.from(activeTradingTabs.values()).some(
          (t) => t.siteName === "Superbet",
        ),
      },
    });
    return true;
  }

  if (msg && msg.action === "LAUNCH_SELECTED_HOUSES") {
    const houses = msg.houses || [];
    const houseUrlMap = {
      bet365: {
        url: "https://www.bet365.bet.br",
        patterns: [
          "*://*.bet365.com/*",
          "*://*.bet365.bet.br/*",
          "*://*.bet365.es/*",
        ],
      },
      betfair: {
        url: "https://www.betfair.com/sport",
        patterns: [
          "*://*.betfair.com/*",
          "*://*.betfair.bet.br/*",
          "*://*.betfair.es/*",
        ],
      },
      betmgm: {
        url: "https://www.betmgm.bet.br/aposta-esportiva#/home",
        patterns: ["*://betmgm.bet.br/*", "*://*.betmgm.bet.br/*"],
      },
      betano: {
        url: "https://betano.bet.br/",
        patterns: ["*://*.betano.bet.br/*"],
      },
      superbet: {
        url: "https://superbet.bet.br/",
        patterns: [
          "*://superbet.bet.br/*",
          "*://*.superbet.bet.br/*",
          "*://superbet.com/*",
          "*://*.superbet.com/*",
        ],
      },
    };

    (async () => {
      for (const houseKey of houses) {
        const config = houseUrlMap[houseKey];
        if (!config) continue;

        try {
          const existingTabs = await chrome.tabs.query({
            url: config.patterns,
          });
          if (!existingTabs || existingTabs.length === 0) {
            console.log(
              `[Fast Trigger SW] 🚀 Abrindo nova aba para a casa: ${houseKey} (${config.url})`,
            );
            await chrome.tabs.create({ url: config.url, active: false });
          } else {
            console.log(
              `[Fast Trigger SW] ℹ️ Aba já existente para a casa: ${houseKey}`,
            );
          }
        } catch (e) {
          console.error(
            `[Fast Trigger SW] Erro ao verificar/abrir aba para ${houseKey}:`,
            e,
          );
        }
      }

      const connectionStatus = {
        bet365Active: Array.from(activeTradingTabs.values()).some(
          (t) => t.siteName === "Bet365",
        ),
        betfairActive: Array.from(activeTradingTabs.values()).some(
          (t) => t.siteName === "Betfair",
        ),
        betnacionalActive: Array.from(activeTradingTabs.values()).some(
          (t) => t.siteName === "Betnacional",
        ),
        betmgmActive: Array.from(activeTradingTabs.values()).some(
          (t) => t.siteName === "BetMGM",
        ),
        betanoActive: Array.from(activeTradingTabs.values()).some(
          (t) => t.siteName === "Betano",
        ),
        superbetActive: Array.from(activeTradingTabs.values()).some(
          (t) => t.siteName === "Superbet",
        ),
      };

      sendResponse({ status: "OK", connectionStatus: connectionStatus });
    })();

    return true;
  }

  if (msg && msg.action === "OPEN_DASHBOARD") {
    if (typeof chrome !== "undefined" && chrome.tabs && chrome.tabs.create) {
      chrome.tabs.create({
        url: chrome.runtime.getURL("dashboard-app/dist/index.html"),
      });
    }
    sendResponse({ status: "OK" });
    return true;
  }
  if (
    msg &&
    (msg.action === "EXECUTE_DIRECT_TRIGGER" ||
      msg.action === "DISPARAR_APOSTA")
  ) {
    if (!consumeExplicitUserIntent(msg, "trigger_bet")) {
      sendResponse({ status: "BLOCKED", reason: "invalid_or_stale_intent" });
      return true;
    }
    dispatchBetToAllActiveTabs(false, msg);
    sendResponse({ status: "OK" });
    return true;
  }
  if (msg && msg.type === "GET_INITIAL_STATE") {
    sendResponse({
      marketState: currentMarketState,
      connectionStatus: {
        bet365Active: Array.from(activeTradingTabs.values()).some(
          (t) => t.siteName === "Bet365",
        ),
        betfairActive: Array.from(activeTradingTabs.values()).some(
          (t) => t.siteName === "Betfair",
        ),
        betnacionalActive: Array.from(activeTradingTabs.values()).some(
          (t) => t.siteName === "Betnacional",
        ),
        betmgmActive: Array.from(activeTradingTabs.values()).some(
          (t) => t.siteName === "BetMGM",
        ),
        betanoActive: Array.from(activeTradingTabs.values()).some(
          (t) => t.siteName === "Betano",
        ),
        superbetActive: Array.from(activeTradingTabs.values()).some(
          (t) => t.siteName === "Superbet",
        ),
      },
    });
    return true;
  }
  if (msg && msg.type === "SELECT_ODDS_ACTION" && msg.payload) {
    if (!consumeExplicitUserIntent(msg, "select_odds")) {
      sendResponse({ status: "BLOCKED", reason: "invalid_or_stale_intent" });
      return true;
    }
    const targetHouse = (msg.payload.house || "").toLowerCase();
    let deliveredCount = 0;
    activeTradingTabs.forEach((tabInfo) => {
      const matchesHouse =
        !targetHouse ||
        (tabInfo.siteName &&
          tabInfo.siteName.toLowerCase().includes(targetHouse));
      if (!matchesHouse || !tabInfo.port) return;

      try {
        const stakeVal = resolveConfiguredStakeForHouse(targetHouse);
        if (Object.keys(electronConfigCache || {}).length || stakeVal) {
          tabInfo.port.postMessage({
            action: "UPDATE_CONFIG",
            config: { ...electronConfigCache, stakeVal, oneShot: electronConfigCache.oneShot === true, oneClick: electronConfigCache.oneShot === true },
            __gbrElectronAuthorized: true,
          });
        }
        tabInfo.port.postMessage({
          type: "SELECT_ODDS",
          actionId: msg.actionId,
          issuedAt: msg.issuedAt,
          eventId: msg.payload.eventId,
          intentSource: msg.intentSource,
          intentType: msg.intentType,
          fastMode: msg.fastMode === true || msg.payload.fastMode === true,
          house: targetHouse,
          name: msg.payload.name,
          lineName: msg.payload.lineName,
          optionLabel: msg.payload.optionLabel,
          val: msg.payload.odds || msg.payload.val,
          odds: msg.payload.odds || msg.payload.val,
          stake: msg.payload.stake || msg.payload.stakeVal || stakeVal,
          stakeVal: msg.payload.stakeVal || msg.payload.stake || stakeVal,
          marketTitle: msg.payload.marketTitle,
          colIndex: msg.payload.colIndex,
          rowIndex: msg.payload.rowIndex,
          outcomeId: msg.payload.outcomeId,
          __gbrElectronAuthorized: true,
        });
        deliveredCount++;
      } catch (e) {}
    });

    if (deliveredCount === 0) {
      relayNativeCommandToHouse(msg);
    }
    sendResponse({ status: "OK", delivered: deliveredCount > 0 });
    return true;
  }
});
