// =========================================================================
// FAST TRIGGER PRO - CONFIGURAÇÕES E ESTADO GLOBAL
// =========================================================================

function normalizeStr(str) {
  if (!str) return "";
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\/\-_]/g, " ")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}
if (typeof window !== "undefined") {
  window.normalizeStr = normalizeStr;
}

window.__gbrContentScriptLoaded = true;

var previousFastTriggerConfig =
  window.FastTriggerConfig && typeof window.FastTriggerConfig === "object"
    ? window.FastTriggerConfig
    : {};
window.FastTriggerConfig = {
  triggerKeyStr: "Space",
  stakeVal: "0.50",
  stakeValByHouse: {},
  autoFillStakeBool: true,
  autoAcceptOddsBool: true,
  oddsChangePolicy: "accept_any",
  // Caminho de execução da aposta. `DOM_UI` é o clique único no botão da casa e
  // segue sendo o padrão: `DIRECT_NETWORK` só funciona com a ponte de ordem
  // direta armada e um modelo de requisição configurado pelo usuário, e cai de
  // volta para o DOM quando o caminho direto não está disponível.
  executionMode: "DOM_UI",
  // Auto-resolução do `selectionId` a partir do feed observado (ver
  // `src/core/selectionResolver.js`). Ligada por padrão porque é somente leitura
  // e, sem id inequívoco, o efeito é apenas cair para `DOM_UI`.
  directOrderAutoSelection: true,
  // Casamento por odd única no índice inteiro, sem confirmação de mercado.
  // DESLIGADO por padrão: uma odd que parece única no cache pode pertencer a um
  // mercado que o feed ainda não viu, e o id nomearia outra seleção.
  directOrderAllowOddsOnlyMatch: false,
  showFloatingBtnBool: true,
  // Betfair: varredura da aba "Todos os mercados". Detecta a aba ativa e abre
  // cada grupo recolhido uma única vez, mantendo-o aberto para leitura ao vivo.
  betfairSweepAllMarkets: true,
  betfairSweepMaxGroups: 80,
  ...previousFastTriggerConfig,
};

var previousFastTriggerState =
  window.FastTriggerState && typeof window.FastTriggerState === "object"
    ? window.FastTriggerState
    : {};
window.FastTriggerState = {
  livePort: null,
  lastStateString: "",
  lastBroadcastTime: 0,
  broadcastTimeout: null,
  bootedAt: Date.now(),
  handledActionIds: new Set(),
  selectionPermit: null,
  lastTrustedSelectionHotkeyAt: 0,
  nativeTextEntryInProgress: false,
  bindingCaptureInProgress: false,
  backgroundDispatchInProgress: false,
  fastSelectionInProgress: false,
  configLoaded: false,
  armedDynamicBind: null,
  activeExecutionActionId: null,
  activePreparationActionId: null,
  scrollAssistedExecution: null,
  activeSelectionActionId: null,
  expectedExecutionOddsByAction: new Map(),
  lastDynamicBindFinalClickAttempted: false,
  // Ponte DOM -> `selectionId` do caminho direto. O parser da Bet365 não extrai
  // id de seleção do DOM, então quem souber o id precisa depositá-lo aqui antes
  // do disparo: normalmente o `src/core/selectionResolver.js` no clique/foco da
  // célula (`source: 'auto_*'`), ou o console em diagnóstico (`source: 'manual'`).
  // Sem depósito o modo `DIRECT_NETWORK` cai para o clique no DOM.
  directOrderSelection: null,
  // Reconexão da porta de captura: quantas tentativas seguidas falharam e se o
  // aviso de contexto morto já foi mostrado (uma vez por aba, não a cada 1 s).
  portRetryCount: 0,
  deadRuntimeNotified: false,
  ...previousFastTriggerState,
  bootedAt: Number.isFinite(previousFastTriggerState.bootedAt)
    ? previousFastTriggerState.bootedAt
    : Date.now(),
  handledActionIds:
    previousFastTriggerState.handledActionIds instanceof Set
      ? previousFastTriggerState.handledActionIds
      : new Set(),
  expectedExecutionOddsByAction:
    previousFastTriggerState.expectedExecutionOddsByAction instanceof Map
      ? previousFastTriggerState.expectedExecutionOddsByAction
      : new Map(),
};

const FT_INTENT_MAX_AGE_MS = 30000;
const FT_STARTUP_SAFETY_MS = 300;
// Bet365/Betnacional operam integradas ao aplicativo Electron; a sessão e a
// licença são apresentadas na dashboard oficial, não dentro da página da casa.
window.FastTriggerExternalElectronMode = true;

function consumeFastTriggerIntent(message, expectedType) {
  if (window !== window.top) return false;

  const now = Date.now();
  const actionId = message && message.actionId;
  const issuedAt = Number(message && message.issuedAt);
  const source = message && message.intentSource;
  const intentType = message && message.intentType;
  const allowedSource =
    source === "dashboard_user" || source === "chrome_command";

  // Se o comando é explicitamente autorizado pelo Electron (ex: clique no app desktop oficial),
  // ele tem garantia de autenticidade da dashboard. Não bloqueie por drift de relógio.
  if (message?.__gbrElectronAuthorized === true) {
    if (actionId && window.FastTriggerState?.handledActionIds?.has(actionId)) {
      return false;
    }
    if (actionId && window.FastTriggerState?.handledActionIds) {
      window.FastTriggerState.handledActionIds.add(actionId);
      setTimeout(() => window.FastTriggerState.handledActionIds.delete(actionId), 5000);
    }
    return true;
  }

  if (now - window.FastTriggerState.bootedAt < FT_STARTUP_SAFETY_MS) {
    console.warn(
      "[Fast Trigger Safety] Comando bloqueado durante a inicializacao segura.",
    );
    return false;
  }

  if (
    !actionId ||
    !Number.isFinite(issuedAt) ||
    !allowedSource ||
    intentType !== expectedType ||
    issuedAt > now + 30000 ||
    now - issuedAt > FT_INTENT_MAX_AGE_MS ||
    window.FastTriggerState.handledActionIds.has(actionId)
  ) {
    console.warn(
      "[Fast Trigger Safety] Comando ausente, antigo ou duplicado bloqueado.",
    );
    return false;
  }

  window.FastTriggerState.handledActionIds.add(actionId);
  setTimeout(
    () => window.FastTriggerState.handledActionIds.delete(actionId),
    FT_INTENT_MAX_AGE_MS,
  );
  return true;
}

function isSelectionForCurrentEvent(message) {
  const expectedEventId = String(
    message?.eventId || message?.payload?.eventId || "",
  ).trim();
  if (!expectedEventId) return true;

  // Ações explícitas do painel têm intenção confirmada pelo usuário
  if (message?.intentSource === "dashboard_user" || message?.fastMode === true) {
    return true;
  }

  // Superbet: se a aba atual é Superbet e a mensagem é destinada à Superbet
  if (window.location.hostname.includes("superbet")) {
    return true;
  }

  const readCurrentEventId = window.FastTriggerGetEventIdentity;
  if (typeof readCurrentEventId !== "function") return true;
  const currentEventId = String(readCurrentEventId() || "").trim();
  if (!currentEventId) return true;
  if (currentEventId === expectedEventId) return true;
  if (currentEventId.includes("current-event") || expectedEventId.includes("current-event")) return true;

  const cleanExp = expectedEventId.replace(/^[a-z0-9]+:/, "");
  const cleanCur = currentEventId.replace(/^[a-z0-9]+:/, "");
  if (cleanExp && cleanCur && (cleanCur.includes(cleanExp) || cleanExp.includes(cleanCur))) {
    return true;
  }

  return false;
}

// A Betnacional trata a odd como um toggle. Se duas mensagens rápidas chegam
// para a mesma aba antes de o cupom terminar de renderizar, a segunda pode
// remover a seleção feita pela primeira e deixar a stake sem contexto. O
// service worker já elimina duplicatas pelo actionId, mas versões antigas do
// painel e listeners de recuperação podem emitir intents diferentes para o
// mesmo gesto. Serializamos o pipeline por aba e liberamos uma nova seleção
// pouco depois de a operação terminar.
const BETNACIONAL_SELECTION_PIPELINE_MAX_MS = 5000;
const BETNACIONAL_SELECTION_PIPELINE_COOLDOWN_MS = 450;

function runBetnacionalSelectionWithGuard(message, operation) {
  const state = window.FastTriggerState;
  const now = Date.now();
  const current = state?.betnacionalSelectionDispatch;

  if (
    current &&
    now - Number(current.startedAt || 0) <
      BETNACIONAL_SELECTION_PIPELINE_MAX_MS
  ) {
    console.debug(
      `[Fast Trigger] Betnacional ignorou SELECT_ODDS concorrente ` +
        `(actionId=${message?.actionId || "-"}; em andamento=${current.actionId || "-"}).`,
    );
    return false;
  }

  const entry = {
    actionId: message?.actionId || "-",
    startedAt: now,
  };
  state.betnacionalSelectionDispatch = entry;

  Promise.resolve()
    .then(operation)
    .catch((error) => {
      console.error(
        "[Fast Trigger] Falha no pipeline de seleção da Betnacional:",
        error,
      );
      return false;
    })
    .finally(() => {
      // Mantém uma pequena janela depois do render para impedir que uma
      // mensagem atrasada alterne novamente a mesma seleção.
      setTimeout(() => {
        if (state.betnacionalSelectionDispatch === entry) {
          delete state.betnacionalSelectionDispatch;
        }
      }, BETNACIONAL_SELECTION_PIPELINE_COOLDOWN_MS);
    });

  return true;
}

window.consumeFastTriggerIntent = consumeFastTriggerIntent;

// =========================================================================
// PORTA DE CAPTURA
// =========================================================================
//
// Tudo que o painel mostra chega por esta porta. Se ela cai e não volta, a
// página continua normal e a extensão fica muda: nenhum mercado aparece, sem
// erro visível. Dois casos distintos precisam de tratamentos distintos.
//
//   1) o service worker hibernou / a porta caiu por conta própria — reconectar
//      resolve, e é o caso comum;
//   2) a extensão foi recarregada (ou atualizada) com a aba já aberta — o
//      contexto desta aba está morto, `chrome.runtime.id` desaparece e nenhuma
//      reconexão vai funcionar. Só um recarregamento da página recupera, então
//      o certo é parar de tentar e avisar.

const PORT_RETRY_BASE_MS = 1000;
const PORT_RETRY_MAX_MS = 15000;

/** @returns {boolean} `false` quando o contexto desta aba já foi invalidado */
function fastTriggerRuntimeIsAlive() {
  try {
    return typeof chrome !== "undefined" && !!chrome.runtime && !!chrome.runtime.id;
  } catch (e) {
    return false;
  }
}

// Um aviso por aba: o objetivo é o usuário saber que basta um F5, não encher o
// console nem piscar o flash a cada tentativa.
function notifyDeadFastTriggerRuntime() {
  if (window.FastTriggerState.deadRuntimeNotified) return;
  window.FastTriggerState.deadRuntimeNotified = true;
  console.warn(
    "[Fast Trigger] Contexto da extensao invalidado nesta aba: recarregue a pagina (F5) para retomar a captura.",
  );
  try {
    if (window === window.top && typeof showFlashFeedback === "function") {
      showFlashFeedback("GATILHOBR: recarregue a pagina (F5)");
    }
  } catch (e) {}
}

function scheduleFastTriggerPortRetry() {
  const attempt = Number(window.FastTriggerState.portRetryCount) || 0;
  window.FastTriggerState.portRetryCount = attempt + 1;
  const delay = Math.min(PORT_RETRY_BASE_MS * 2 ** attempt, PORT_RETRY_MAX_MS);
  if (window.FastTriggerState.reconnectTimer) {
    clearTimeout(window.FastTriggerState.reconnectTimer);
  }
  window.FastTriggerState.reconnectTimer = setTimeout(() => {
    window.FastTriggerState.reconnectTimer = null;
    connectPort();
  }, delay);
}

function connectPort() {
  try {
    // A Bet365 distribui parte dos mercados em frames internos; eles precisam
    // manter o coletor conectado para alimentar o painel. Nas demais casas,
    // somente o documento principal participa do stream.
    const isBet365Runtime = window.location.hostname.includes("bet365");
    if (window !== window.top && !isBet365Runtime) return;

    if (
      typeof chrome !== "undefined" &&
      chrome.runtime &&
      chrome.runtime.connect
    ) {
      if (window.FastTriggerState.livePort) return;
      if (window.FastTriggerState.reconnectTimer) {
        clearTimeout(window.FastTriggerState.reconnectTimer);
        window.FastTriggerState.reconnectTimer = null;
      }

      const port = chrome.runtime.connect({ name: "content_live_stream" });
      window.FastTriggerState.livePort = port;
      // Conexão de pé: o recuo volta ao início para a próxima queda.
      window.FastTriggerState.portRetryCount = 0;

      let currentSite = window.FastTriggerAdapter
        ? window.FastTriggerAdapter.siteName
        : null;
      if (!currentSite) {
        if (window.location.hostname.includes("betfair"))
          currentSite = "Betfair";
        else if (window.location.hostname.includes("bet365"))
          currentSite = "Bet365";
        else if (window.location.hostname.includes("betnacional"))
          currentSite = "Betnacional";
        else if (window.location.hostname.includes("betmgm"))
          currentSite = "BetMGM";
        else if (window.location.hostname.includes("betano"))
          currentSite = "Betano";
        else if (window.location.hostname.includes("superbet"))
          currentSite = "Superbet";
      }

      if (currentSite) {
        try {
          port.postMessage({
            type: "REGISTER_TAB",
            siteName: currentSite,
            url: window.location.href,
            isTop: window === window.top,
            // O service worker precisa saber quando este coletor subiu: um
            // comando entregue dentro da janela de inicialização segura seria
            // descartado por consumeFastTriggerIntent.
            bootedAt: window.FastTriggerState?.bootedAt || 0,
          });
        } catch (e) {}
      }

      function dispatchFastTriggerCommand(msg, sourcePort = null) {
        const port = sourcePort || window.FastTriggerState?.livePort;
        if (!msg) return;
        if (msg.action === "UPDATE_CONFIG" && msg.config && typeof msg.config === "object") {
          window.FastTriggerConfig = { ...(window.FastTriggerConfig || {}), ...msg.config };
          applyFastTriggerHouseStake();
          window.FastTriggerState.configLoaded = true;
          return;
        }
        // A dashboard Electron é a fonte da stake. A ação encaminhada pelo
        // Native Messaging carrega o valor configurado para que a aba Chrome
        // não dependa de uma configuração/storage separado e possivelmente
        // desatualizado.
        const incomingStakeVal = msg.stakeVal ?? msg.stake ?? msg.payload?.stakeVal ?? msg.payload?.stake;
        if (incomingStakeVal !== undefined && incomingStakeVal !== null && String(incomingStakeVal).trim()) {
          window.FastTriggerConfig = window.FastTriggerConfig || {};
          window.FastTriggerConfig.stakeVal = String(incomingStakeVal);
          window.FastTriggerExpectedExecutionStake = String(incomingStakeVal);
        }
        // Comandos originados da dashboard Electron já passaram pela
        // autenticação/licença central. A autorização é curta e só vale para
        // esta aba/ação; as demais validações de intenção e de contexto
        // continuam obrigatórias.
        if (msg.__gbrElectronAuthorized === true) {
          window.FastTriggerState.electronAuthorizedUntil = Date.now() + 10000;
        }
        const isExecutionMessage =
          msg.type === "EXECUTE_BET" ||
          msg.type === "DISPARAR_APOSTA" ||
          msg.type === "EXECUTE_DIRECT_TRIGGER" ||
          msg.action === "DISPARAR_APOSTA" ||
          msg.type === "EXECUTE_DYNAMIC_BIND" ||
          msg.type === "COMMIT_DYNAMIC_BIND" ||
          msg.type === "CANCEL_DYNAMIC_BIND" ||
          msg.type === "PREPARE_DYNAMIC_BIND" ||
          msg.type === "SELECT_ODDS" ||
          msg.type === "REQUEST_ACCOUNT_BALANCE";

        if (isExecutionMessage) {
          console.debug(
            `[Fast Trigger] Port recebeu ${msg.type || msg.action || "ação"}` +
              ` actionId=${msg.actionId || "-"}` +
              `${msg.type === "SELECT_ODDS" ? ` alvo=${msg.name || "-"} @${msg.val || msg.odds || "-"}` : ""}`,
          );
        }

        // A Bet365 usa vários frames. Somente o documento principal pode
        // selecionar odds, preencher stake ou confirmar uma aposta.
        if (isExecutionMessage && window !== window.top) return;

        if (msg.type === "REQUEST_MARKET_UPDATE") {
          if (window !== window.top) return;

          const requestUpdate = () => {
            if (typeof window.FastTriggerRequestMarketUpdate === "function") {
              window.FastTriggerRequestMarketUpdate(msg.requestId);
              return true;
            }
            return false;
          };

          // `content.js` é carregado depois deste arquivo. Em uma abertura
          // simultânea da casa e do painel, dá uma pequena janela para o
          // coletor terminar de inicializar sem exigir reload da página.
          if (!requestUpdate()) {
            setTimeout(requestUpdate, 100);
            setTimeout(requestUpdate, 350);
          }
        } else if (
          msg.type === "EXECUTE_BET" ||
          msg.type === "DISPARAR_APOSTA" ||
          msg.type === "EXECUTE_DIRECT_TRIGGER" ||
          msg.action === "DISPARAR_APOSTA"
        ) {
          if (!consumeFastTriggerIntent(msg, "trigger_bet")) return;
          if (
            window.FastTriggerAdapter &&
            typeof window.FastTriggerAdapter.triggerPlaceBet === "function"
          ) {
            window.FastTriggerAdapter.triggerPlaceBet(
              true,
              msg.isHotkey === true,
              false,
              msg.fastMode === true ||
                msg.isHotkey === true ||
                msg.intentSource === "dashboard_user",
            );
          } else if (typeof executeCachedTrigger === "function") {
            executeCachedTrigger();
          }
        } else if (msg.type === "PREPARE_DYNAMIC_BIND" && msg.keyCode) {
          const prepareBind = window.ftPrepareDynamicBindByKey;
          if (typeof prepareBind !== "function") {
            port.postMessage({
              type: "DYNAMIC_BIND_PREPARED_RESULT",
              actionId: msg.actionId,
              success: false,
              house: msg.house,
              keyCode: msg.keyCode,
              reason: "Motor de binds ainda não está pronto nesta aba.",
            });
            return;
          }
          window.FastTriggerState.activePreparationActionId = msg.actionId;
          Promise.resolve(prepareBind(msg.keyCode, msg.binds || null))
            .then((result) => {
              if (
                result?.success !== true &&
                window.FastTriggerState?.scrollAssistedExecution?.actionId ===
                  msg.actionId
              ) {
                window.FastTriggerState.scrollAssistedExecution = null;
              }
              port.postMessage({
                type: "DYNAMIC_BIND_PREPARED_RESULT",
                actionId: msg.actionId,
                success: result?.success === true,
                house: msg.house,
                keyCode: msg.keyCode,
                reason: result?.reason || "",
              });
            })
            .catch((error) => {
              console.warn("[Fast Trigger Binds] Falha ao preparar o alvo:", error);
              if (
                window.FastTriggerState?.scrollAssistedExecution?.actionId ===
                msg.actionId
              ) {
                window.FastTriggerState.scrollAssistedExecution = null;
              }
              port.postMessage({
                type: "DYNAMIC_BIND_PREPARED_RESULT",
                actionId: msg.actionId,
                success: false,
                house: msg.house,
                keyCode: msg.keyCode,
                reason: "Falha ao preparar o alvo na casa.",
              });
            })
            .finally(() => {
              if (
                window.FastTriggerState.activePreparationActionId === msg.actionId
              ) {
                window.FastTriggerState.activePreparationActionId = null;
              }
            });
        } else if (msg.type === "EXECUTE_DYNAMIC_BIND" && msg.keyCode) {
          const executionReport = window.FastTriggerExecutionReport;
          executionReport?.start(msg.actionId, {
            house: msg.house,
            keyCode: msg.keyCode,
            intentSource: msg.intentSource,
            intentType: msg.intentType,
            intentAt: msg.issuedAt,
            routedAt: msg.routedAt || Date.now(),
          });
          executionReport?.mark(msg.actionId, "route", {
            reasonCode: "routed",
          });
          window.FastTriggerState.activeExecutionActionId = msg.actionId;
          if (!consumeFastTriggerIntent(msg, "dynamic_bind")) {
            executionReport?.finish(msg.actionId, "blocked", {
              stage: "result",
              reasonCode: "invalid_or_stale_intent",
              clickAttempted: false,
            });
            port.postMessage({
              type:
                msg.armOnly === true
                  ? "DYNAMIC_BIND_ARMED_RESULT"
                  : "DYNAMIC_BIND_EXECUTION_RESULT",
              actionId: msg.actionId,
              success: false,
              house: msg.house,
              keyCode: msg.keyCode,
              reason: "Comando de bind inválido ou expirado.",
            });
            if (window.FastTriggerState.activeExecutionActionId === msg.actionId) {
              window.FastTriggerState.activeExecutionActionId = null;
            }
            window.clearFastTriggerExpectedExecutionOdds?.(msg.actionId);
            return;
          }
          if (msg.armOnly === true) {
            window.FastTriggerState.armedDynamicBind = null;
          }
          window.FastTriggerState.selectionPermit = {
            actionId: msg.actionId,
            expiresAt: Date.now() + 1800,
            used: false,
          };
          const executeBind = window.ftExecuteDynamicPlayerBindByKey;
          if (typeof executeBind !== "function") {
            executionReport?.finish(msg.actionId, "failed", {
              stage: "result",
              reasonCode: "engine_unavailable",
              clickAttempted: false,
            });
            port.postMessage({
              type:
                msg.armOnly === true
                  ? "DYNAMIC_BIND_ARMED_RESULT"
                  : "DYNAMIC_BIND_EXECUTION_RESULT",
              actionId: msg.actionId,
              success: false,
              house: msg.house,
              keyCode: msg.keyCode,
              reason: "Motor de binds ainda não está pronto nesta aba.",
            });
            if (window.FastTriggerState.activeExecutionActionId === msg.actionId) {
              window.FastTriggerState.activeExecutionActionId = null;
            }
            window.clearFastTriggerExpectedExecutionOdds?.(msg.actionId);
            return;
          }
          window.FastTriggerState.lastTrustedSelectionHotkeyAt = Date.now();
          // Uma rota focada pelo service worker deve usar o mesmo transporte
          // de interação da execução local. As demais rotas preservam o modo
          // rápido em segundo plano.
          window.FastTriggerState.backgroundDispatchInProgress =
            msg.focusedExecution !== true;
          const executeStartedAt = performance.now();
          const finishExecutionReport = (success, armOnly = false) => {
            const clickAttempted =
              window.FastTriggerState?.lastDynamicBindFinalClickAttempted === true;
            const outcome = armOnly
              ? success !== false
                ? "prepared"
                : "failed"
              : success === true && clickAttempted
                ? "committed"
                : success === true
                  ? "prepared"
                  : clickAttempted
                    ? "ambiguous"
                    : "failed";
            executionReport?.finish(msg.actionId, outcome, {
              stage: "result",
              reasonCode:
                success === false
                  ? clickAttempted
                    ? "commit_result_ambiguous"
                    : armOnly
                      ? "preparation_failed"
                      : "execution_failed"
                  : "",
              clickAttempted,
            });
          };
          Promise.resolve(
            executeBind(
              msg.keyCode,
              true,
              msg.binds || null,
              msg.retry === true,
              msg.armOnly === true,
            ),
          )
            .then((success) => {
              console.log("[Fast Trigger Binds] EXECUTE_DYNAMIC_BIND concluído", {
                house: msg.house,
                actionId: msg.actionId,
                armOnly: msg.armOnly === true,
                success: success !== false,
                clickAttempted:
                  window.FastTriggerState?.lastDynamicBindFinalClickAttempted === true,
                reason: success === false
                  ? window.FastTriggerState?.lastDynamicBindFailureReason || ""
                  : "",
              });
              if (msg.armOnly === true) {
                if (success !== false) {
                  window.FastTriggerState.armedDynamicBind = {
                    actionId: msg.actionId,
                    keyCode: msg.keyCode,
                    house: msg.house,
                    expiresAt: Date.now() + 12_000,
                    committed: false,
                    scrollAssisted:
                      window.FastTriggerState?.scrollAssistedExecution?.actionId ===
                      msg.actionId,
                  };
                } else {
                  if (window.FastTriggerState?.armedDynamicBind?.actionId === msg.actionId) {
                    window.FastTriggerState.armedDynamicBind = null;
                  }
                  window.clearFastTriggerExpectedExecutionOdds?.(msg.actionId);
                  if (
                    window.FastTriggerState?.scrollAssistedExecution?.actionId ===
                    msg.actionId
                  ) {
                    window.FastTriggerState.scrollAssistedExecution = null;
                  }
                }
                port.postMessage({
                  type: "DYNAMIC_BIND_ARMED_RESULT",
                  actionId: msg.actionId,
                  success: success !== false,
                  house: msg.house,
                  keyCode: msg.keyCode,
                  clickAttempted:
                    window.FastTriggerState?.lastDynamicBindFinalClickAttempted === true,
                  timing: { contentExecutionMs: performance.now() - executeStartedAt },
                  reason:
                    success === false
                      ? window.FastTriggerState?.lastDynamicBindFailureReason ||
                        "A seleção e a stake não puderam ser preparadas."
                      : "",
                });
                finishExecutionReport(success, true);
                return;
              }
              port.postMessage({
                type: "DYNAMIC_BIND_EXECUTION_RESULT",
                actionId: msg.actionId,
                success: success !== false,
                house: msg.house,
                keyCode: msg.keyCode,
                clickAttempted:
                  window.FastTriggerState?.lastDynamicBindFinalClickAttempted === true,
                timing: { contentExecutionMs: performance.now() - executeStartedAt },
                retryable: msg.retryable === true,
                reason:
                  success === false
                    ? window.FastTriggerState?.lastDynamicBindFailureReason ||
                      "A seleção configurada não pôde ser executada."
                    : "",
              });
              finishExecutionReport(success, false);
            })
            .catch((error) => {
              console.error(
                "[Fast Trigger Binds] Falha na execução encaminhada pelo painel:",
                error,
              );
              if (msg.armOnly === true) {
                window.clearFastTriggerExpectedExecutionOdds?.(msg.actionId);
                if (
                  window.FastTriggerState?.scrollAssistedExecution?.actionId ===
                  msg.actionId
                ) {
                  window.FastTriggerState.scrollAssistedExecution = null;
                }
              }
              finishExecutionReport(false, msg.armOnly === true);
              port.postMessage({
                type:
                  msg.armOnly === true
                    ? "DYNAMIC_BIND_ARMED_RESULT"
                    : "DYNAMIC_BIND_EXECUTION_RESULT",
                actionId: msg.actionId,
                success: false,
                house: msg.house,
                keyCode: msg.keyCode,
                timing: { contentExecutionMs: performance.now() - executeStartedAt },
                reason: "Falha ao executar a bind na casa.",
              });
            })
            .finally(() => {
              window.FastTriggerState.backgroundDispatchInProgress = false;
              window.FastTriggerState.lastTrustedSelectionHotkeyAt = 0;
              if (window.FastTriggerState.activeExecutionActionId === msg.actionId) {
                window.FastTriggerState.activeExecutionActionId = null;
              }
              if (msg.armOnly !== true) {
                window.clearFastTriggerExpectedExecutionOdds?.(msg.actionId);
                if (
                  window.FastTriggerState?.scrollAssistedExecution?.actionId ===
                  msg.actionId
                ) {
                  window.FastTriggerState.scrollAssistedExecution = null;
                }
              }
              if (typeof window.FastTriggerRequestMarketUpdate === "function") {
                setTimeout(() => window.FastTriggerRequestMarketUpdate(), 0);
              }
            });
        } else if (msg.type === "COMMIT_DYNAMIC_BIND" && msg.actionId) {
          const executionReport = window.FastTriggerExecutionReport;
          window.FastTriggerState.activeExecutionActionId = msg.actionId;
          executionReport?.mark(msg.actionId, "commit");
          const armed = window.FastTriggerState?.armedDynamicBind;
          const commitBind = window.ftCommitArmedDynamicBind;
          if (
            !armed ||
            armed.actionId !== msg.actionId ||
            Number(armed.expiresAt || 0) < Date.now() ||
            typeof commitBind !== "function"
          ) {
            if (armed?.actionId === msg.actionId) {
              window.FastTriggerState.armedDynamicBind = null;
            }
            port.postMessage({
              type: "DYNAMIC_BIND_EXECUTION_RESULT",
              actionId: msg.actionId,
              success: false,
              house: msg.house,
              keyCode: msg.keyCode,
              reason: "A preparação da aposta expirou antes da confirmação.",
            });
            executionReport?.finish(msg.actionId, "blocked", {
              stage: "result",
              reasonCode: "preparation_expired",
              clickAttempted: false,
            });
            window.clearFastTriggerExpectedExecutionOdds?.(msg.actionId);
            if (
              window.FastTriggerState?.scrollAssistedExecution?.actionId ===
              msg.actionId
            ) {
              window.FastTriggerState.scrollAssistedExecution = null;
            }
            return;
          }

          window.FastTriggerState.backgroundDispatchInProgress = true;
          if (armed.scrollAssisted === true) {
            window.FastTriggerState.scrollAssistedExecution = {
              actionId: msg.actionId,
              detectedAt: Date.now(),
            };
          }
          // A interação do usuário já foi validada na fase de armamento. O
          // commit não adiciona novo jitter entre os cliques das casas.
          Promise.resolve(commitBind(msg.actionId, false))
            .then((success) => {
              const clickAttempted =
                window.FastTriggerState?.lastDynamicBindFinalClickAttempted === true;
              port.postMessage({
                type: "DYNAMIC_BIND_EXECUTION_RESULT",
                actionId: msg.actionId,
                success: success !== false,
                house: msg.house,
                keyCode: msg.keyCode,
                reason:
                  success === false
                    ? window.FastTriggerState?.lastDynamicBindFailureReason ||
                      "O clique final não foi entregue."
                    : "",
              });
              executionReport?.finish(
                msg.actionId,
                success === true && clickAttempted
                  ? "committed"
                  : success === true
                    ? "prepared"
                    : clickAttempted
                      ? "ambiguous"
                      : "failed",
                {
                  stage: "result",
                  reasonCode:
                    success === false
                      ? clickAttempted
                        ? "commit_result_ambiguous"
                        : "commit_failed"
                      : "",
                  clickAttempted,
                },
              );
            })
            .catch((error) => {
              console.error(
                "[Fast Trigger Binds] Falha ao confirmar bind armada:",
                error,
              );
              const clickAttempted =
                window.FastTriggerState?.lastDynamicBindFinalClickAttempted === true;
              executionReport?.finish(
                msg.actionId,
                clickAttempted ? "ambiguous" : "failed",
                {
                stage: "result",
                  reasonCode: clickAttempted
                    ? "commit_exception"
                    : "commit_exception_before_click",
                  clickAttempted,
                },
              );
              window.FastTriggerState.armedDynamicBind = null;
              port.postMessage({
                type: "DYNAMIC_BIND_EXECUTION_RESULT",
                actionId: msg.actionId,
                success: false,
                house: msg.house,
                keyCode: msg.keyCode,
                reason: "Falha ao entregar o clique final na casa.",
              });
            })
            .finally(() => {
              window.FastTriggerState.backgroundDispatchInProgress = false;
              if (window.FastTriggerState.activeExecutionActionId === msg.actionId) {
                window.FastTriggerState.activeExecutionActionId = null;
              }
              window.clearFastTriggerExpectedExecutionOdds?.(msg.actionId);
              if (
                window.FastTriggerState?.scrollAssistedExecution?.actionId ===
                msg.actionId
              ) {
                window.FastTriggerState.scrollAssistedExecution = null;
              }
              if (typeof window.FastTriggerRequestMarketUpdate === "function") {
                setTimeout(() => window.FastTriggerRequestMarketUpdate(), 0);
              }
            });
        } else if (msg.type === "CANCEL_DYNAMIC_BIND" && msg.actionId) {
          if (
            window.FastTriggerState?.armedDynamicBind?.actionId ===
            msg.actionId
          ) {
            window.FastTriggerState.armedDynamicBind = null;
          }
          if (
            window.FastTriggerState?.scrollAssistedExecution?.actionId ===
            msg.actionId
          ) {
            window.FastTriggerState.scrollAssistedExecution = null;
          }
        } else if (msg.type === "SELECT_ODDS" && (msg.name || msg.val)) {
          if (window.FastTriggerSecurity) {
            if (window.FastTriggerSecurity.isBlocked()) return;
            if (!window.FastTriggerSecurity.checkRateLimit("action", 15, 5000))
              return;
          }
          if (!consumeFastTriggerIntent(msg, "select_odds")) return;
          if (!isSelectionForCurrentEvent(msg)) {
            console.warn(
              "[Fast Trigger Safety] Seleção bloqueada: o evento exibido não corresponde ao evento atual da casa.",
            );
            return;
          }
          window.FastTriggerState.activeSelectionActionId = msg.actionId;
          window.FastTriggerState.activeExecutionActionId = msg.actionId;
          window.FastTriggerState.lastDynamicBindFinalClickAttempted = false;
          window.FastTriggerExecutionReport?.start?.(msg.actionId, {
            house: msg.house || '',
            intentSource: msg.intentSource || '',
            intentType: msg.intentType || 'select_odds',
            issuedAt: msg.issuedAt,
          });
          window.FastTriggerExecutionReport?.mark?.(msg.actionId, 'route', {
            reasonCode: 'direct_selection_routed',
          });
          window.setFastTriggerExpectedExecutionOdds?.(msg.val || msg.odds);
          const explicitMsgStake =
            msg.stake ||
            msg.stakeVal ||
            msg.payload?.stake ||
            msg.payload?.stakeVal ||
            window.FastTriggerConfig?.stakeVal ||
            "";
          if (explicitMsgStake) {
            window.FastTriggerExpectedExecutionStake = String(explicitMsgStake);
            window.FastTriggerConfig = window.FastTriggerConfig || {};
            window.FastTriggerConfig.stakeVal = String(explicitMsgStake);
          }
          const selectionActionId = msg.actionId;
          setTimeout(() => {
            if (
              window.FastTriggerState?.activeSelectionActionId ===
              selectionActionId
            ) {
              window.FastTriggerState.activeSelectionActionId = null;
              window.clearFastTriggerExpectedExecutionOdds?.(selectionActionId);
            }
            if (
              window.FastTriggerState?.activeExecutionActionId ===
              selectionActionId
            ) {
              window.FastTriggerState.activeExecutionActionId = null;
            }
          }, 5000);
          window.FastTriggerState.selectionPermit = {
            actionId: msg.actionId,
            expiresAt: Date.now() + 1500,
            used: false,
          };
          const isBetfairSite = window.location.hostname.includes("betfair");
          const isBet365Site = window.location.hostname.includes("bet365");
          const isBetnacionalSite =
            window.location.hostname.includes("betnacional");
          const isBetmgmSite = window.location.hostname.includes("betmgm");
          const isBetanoSite = window.location.hostname.includes("betano.bet.br");
          const isSuperbetSite = window.location.hostname.includes("superbet");
          const targetHouse = (msg.house || "").toLowerCase();
          const adapter = window.FastTriggerAdapter;
          // Compatibilidade com bundles antigos da dashboard: toda seleção
          // emitida com intenção explícita do painel também usa o caminho
          // rápido, mesmo que ainda não traga a flag `fastMode`.
          const fastMode =
            msg.fastMode === true || msg.intentSource === "dashboard_user";

          const runBetnacionalSelection = () => {
            if (
              adapter &&
              typeof adapter.selectOddsOnBetnacional === "function"
            ) {
              return adapter.selectOddsOnBetnacional(
                msg.name,
                msg.val || msg.odds,
                msg.marketTitle,
                msg.colIndex,
                msg.rowIndex,
                false,
                msg.lineName,
                fastMode,
                explicitMsgStake,
              );
            }
            if (typeof window.selectOddsOnBetnacional === "function") {
              return window.selectOddsOnBetnacional(
                msg.name,
                msg.val || msg.odds,
                msg.marketTitle,
                msg.colIndex,
                msg.rowIndex,
                false,
                msg.lineName,
                fastMode,
                explicitMsgStake,
              );
            }
            return false;
          };

          if (
            targetHouse === "betnacional" ||
            (isBetnacionalSite && !targetHouse)
          ) {
            runBetnacionalSelectionWithGuard(msg, runBetnacionalSelection);
          } else if (
            targetHouse === "betano" ||
            (isBetanoSite && !targetHouse)
          ) {
            if (adapter && typeof adapter.selectOddsOnBetano === "function") {
              adapter.selectOddsOnBetano(
                msg.name,
                msg.val || msg.odds,
                msg.marketTitle,
                msg.colIndex,
                msg.rowIndex,
                false,
                msg.lineName,
                fastMode,
                msg.optionLabel,
                msg.outcomeId,
                explicitMsgStake,
              );
            }
          } else if (
            targetHouse === "betmgm" ||
            (isBetmgmSite && !targetHouse)
          ) {
            if (adapter && typeof adapter.selectOddsOnBetmgm === "function") {
              adapter.selectOddsOnBetmgm(
                msg.name,
                msg.val || msg.odds,
                msg.marketTitle,
                msg.colIndex,
                msg.rowIndex,
                false,
                msg.lineName,
                fastMode,
                msg.optionLabel,
                msg.outcomeId,
                explicitMsgStake,
              );
            } else if (typeof window.selectOddsOnBetmgm === "function") {
              window.selectOddsOnBetmgm(
                msg.name,
                msg.val || msg.odds,
                msg.marketTitle,
                msg.colIndex,
                msg.rowIndex,
                false,
                msg.lineName,
                fastMode,
                msg.optionLabel,
                msg.outcomeId,
                explicitMsgStake,
              );
            }
          } else if (
            targetHouse === "superbet" ||
            isSuperbetSite ||
            targetHouse.includes("superbet")
          ) {
            const activeSuperbetAdapter =
              window.FastTriggerAdapter ||
              (typeof window.SuperbetAdapter === "function" ? new window.SuperbetAdapter() : null) ||
              adapter;
            if (activeSuperbetAdapter && typeof activeSuperbetAdapter.selectOddsOnSuperbet === "function") {
              activeSuperbetAdapter.selectOddsOnSuperbet(
                msg.name,
                msg.val || msg.odds,
                msg.marketTitle,
                msg.colIndex,
                msg.rowIndex,
                false,
                msg.lineName,
                fastMode,
                msg.optionLabel,
                msg.outcomeId,
                explicitMsgStake,
              );
            } else if (typeof window.selectOddsOnSuperbet === "function") {
              window.selectOddsOnSuperbet(
                msg.name,
                msg.val || msg.odds,
                msg.marketTitle,
                msg.colIndex,
                msg.rowIndex,
                false,
                msg.lineName,
                fastMode,
                msg.optionLabel,
                msg.outcomeId,
                explicitMsgStake,
              );
            }
          } else if (
            targetHouse === "betfair" ||
            (isBetfairSite && !targetHouse)
          ) {
            if (adapter && typeof adapter.selectOddsOnBetfair === "function") {
              adapter.selectOddsOnBetfair(
                msg.name,
                msg.val || msg.odds,
                msg.marketTitle,
                msg.colIndex,
                msg.rowIndex,
                false,
                msg.lineName,
                fastMode,
                null,
                explicitMsgStake,
              );
            } else if (typeof selectOddsOnBetfair === "function") {
              selectOddsOnBetfair(
                msg.name,
                msg.val || msg.odds,
                msg.marketTitle,
                msg.colIndex,
                msg.rowIndex,
                false,
                msg.lineName,
                fastMode,
                null,
                explicitMsgStake,
              );
            }
          } else if (
            targetHouse === "bet365" ||
            (isBet365Site && !targetHouse)
          ) {
            if (typeof selectOddsOnPage === "function") {
              selectOddsOnPage(
                msg.name,
                msg.val || msg.odds,
                msg.marketTitle,
                msg.colIndex,
                msg.rowIndex,
                false,
                msg.lineName,
                msg.optionLabel,
                null,
                fastMode,
                explicitMsgStake,
              );
            }
          } else {
            if (isBetnacionalSite) {
              runBetnacionalSelectionWithGuard(msg, runBetnacionalSelection);
            } else if (isBetfairSite) {
              if (
                adapter &&
                typeof adapter.selectOddsOnBetfair === "function"
              ) {
                adapter.selectOddsOnBetfair(
                  msg.name,
                  msg.val || msg.odds,
                  msg.marketTitle,
                  msg.colIndex,
                  msg.rowIndex,
                  false,
                  msg.lineName,
                  fastMode,
                  null,
                  explicitMsgStake,
                );
              }
            } else if (isBetmgmSite) {
              if (adapter && typeof adapter.selectOddsOnBetmgm === "function") {
                adapter.selectOddsOnBetmgm(
                  msg.name,
                  msg.val || msg.odds,
                  msg.marketTitle,
                  msg.colIndex,
                  msg.rowIndex,
                  false,
                  msg.lineName,
                  fastMode,
                  msg.optionLabel,
                  msg.outcomeId,
                  explicitMsgStake,
                );
              }
            } else if (typeof selectOddsOnPage === "function") {
              selectOddsOnPage(
                msg.name,
                msg.val || msg.odds,
                msg.marketTitle,
                msg.colIndex,
                msg.rowIndex,
                false,
                msg.lineName,
                msg.optionLabel,
                null,
                fastMode,
                explicitMsgStake,
              );
            }
          }
        } else if (msg.type === "REQUEST_ACCOUNT_BALANCE") {
          const balance =
            typeof getBet365AccountBalance === "function"
              ? getBet365AccountBalance()
              : "";
          if (window.FastTriggerState.livePort) {
            window.FastTriggerState.livePort.postMessage({
              type: "ACCOUNT_BALANCE_RESPONSE",
              balance: balance,
            });
          }
        }
      }

      window.dispatchFastTriggerCommand = dispatchFastTriggerCommand;
      port.onMessage.addListener((msg) => dispatchFastTriggerCommand(msg, port));

      port.onDisconnect.addListener(() => {
        if (window.FastTriggerState.livePort === port) {
          window.FastTriggerState.livePort = null;
        }
        // Contexto morto não reconecta: insistir a cada segundo só esconderia o
        // problema do usuário, que precisa recarregar a página.
        if (!fastTriggerRuntimeIsAlive()) {
          if (window.FastTriggerState.reconnectTimer) {
            clearTimeout(window.FastTriggerState.reconnectTimer);
            window.FastTriggerState.reconnectTimer = null;
          }
          notifyDeadFastTriggerRuntime();
          return;
        }
        if (window.FastTriggerState.reconnectTimer) {
          clearTimeout(window.FastTriggerState.reconnectTimer);
        }
        window.FastTriggerState.reconnectTimer = setTimeout(() => {
          window.FastTriggerState.reconnectTimer = null;
          connectPort();
        }, 1000);
      });
    }
  } catch (e) {
    // O `connect` lançou: sem retentativa a captura desta aba morria aqui em
    // silêncio, com um único `console.warn` que ninguém vê.
    window.FastTriggerState.livePort = null;
    if (!fastTriggerRuntimeIsAlive()) {
      notifyDeadFastTriggerRuntime();
      return;
    }
    console.warn("[Fast Trigger] Erro ao conectar porta:", e);
    scheduleFastTriggerPortRetry();
  }
}

function fastTriggerCurrentHouse() {
  const host = String(window.location?.hostname || "").toLowerCase();
  if (host.includes("betfair")) return "betfair";
  if (host.includes("betnacional")) return "betnacional";
  if (host.includes("betmgm")) return "betmgm";
  if (host.includes("betano")) return "betano";
  if (host.includes("superbet")) return "superbet";
  return "bet365";
}

function applyFastTriggerHouseStake() {
  const config = window.FastTriggerConfig || {};
  const byHouse = config.stakeValByHouse;
  const currentHouse = fastTriggerCurrentHouse();
  let houseValue = null;
  if (byHouse && typeof byHouse === "object" && !Array.isArray(byHouse)) {
    // Aceita mapas vindos do Electron com capitalização/nome amigável
    // diferente (Betnacional, betNacional, BETNACIONAL etc.).
    const key = Object.keys(byHouse).find((candidate) =>
      String(candidate).trim().toLowerCase() === currentHouse.toLowerCase()
    );
    houseValue = key !== undefined ? byHouse[key] : null;
  }

  if (houseValue !== undefined && houseValue !== null && String(houseValue).trim()) {
    config.stakeVal = String(houseValue);
    window.FastTriggerExpectedExecutionStake = String(houseValue);
  } else if (config.stakeVal) {
    window.FastTriggerExpectedExecutionStake = String(config.stakeVal);
  }
}

function loadConfig() {
  if (typeof chrome !== "undefined" && chrome.storage) {
    const scoped = window.gbrUserScopedStorage;
    if (scoped) {
      scoped
        .get("sync", window.FastTriggerConfig)
        .then((data) => {
          window.FastTriggerConfig = { ...window.FastTriggerConfig, ...data };
          // O merge da nuvem traz o padrão de fábrica (`DOM_UI`) para toda chave
          // ausente na `storage.sync` e troca o objeto de configuração. Reaplicar
          // as preferências locais aqui evita que o boot apague a escolha do
          // usuário guardada em `gbr_direct_order_prefs`.
          try {
            window.FastTriggerDirectOrderPrefs?.apply?.();
          } catch (error) {}
          window.FastTriggerState.configLoaded = true;
          applyFastTriggerHouseStake();
          if (typeof applyFloatingButtonState === "function")
            applyFloatingButtonState();
        })
        .catch(() => {});
    }
  }
}

if (
  typeof chrome !== "undefined" &&
  chrome.runtime &&
  chrome.runtime.onMessage
) {
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (!request || typeof request !== "object") return;

    if (request.action === "FAST_TRIGGER_PING") {
      if (sendResponse) {
        try { sendResponse({ status: "OK", ready: true }); } catch (_) {}
      }
      return true;
    }

    if (request.action === "UPDATE_CONFIG" && request.config) {
      if (
        request.config.stakeValByHouse &&
        typeof request.config.stakeValByHouse === "object" &&
        !Array.isArray(request.config.stakeValByHouse)
      ) {
        window.FastTriggerConfig.stakeValByHouse = request.config.stakeValByHouse;
      }
      const incomingStake =
        request.config.stakeVal ?? request.config.stake ??
        request.config.stakeValue ?? request.config.configuredStake;
      if (incomingStake !== undefined && incomingStake !== null && String(incomingStake).trim()) {
        window.FastTriggerConfig.stakeVal = String(incomingStake);
      }
      if (typeof request.config.oneShot === "boolean") {
        window.FastTriggerConfig.oneShot = request.config.oneShot;
        window.FastTriggerConfig.oneClick = request.config.oneShot;
      }
      if (
        request.config.oddsChangePolicy === "reject_changes" ||
        request.config.oddsChangePolicy === "accept_higher_only" ||
        request.config.oddsChangePolicy === "accept_any"
      ) {
        window.FastTriggerConfig.oddsChangePolicy = request.config.oddsChangePolicy;
        window.FastTriggerConfig.autoAcceptOddsBool =
          request.config.oddsChangePolicy !== "reject_changes";
      }
      if (
        request.config.executionMode === "DOM_UI" ||
        request.config.executionMode === "DIRECT_NETWORK"
      ) {
        window.FastTriggerConfig.executionMode = request.config.executionMode;
      }
      if (typeof request.config.directOrderAutoSelection === "boolean") {
        window.FastTriggerConfig.directOrderAutoSelection =
          request.config.directOrderAutoSelection;
      }
      if (typeof request.config.directOrderAllowOddsOnlyMatch === "boolean") {
        window.FastTriggerConfig.directOrderAllowOddsOnlyMatch =
          request.config.directOrderAllowOddsOnlyMatch;
      }
      window.FastTriggerState.configLoaded = true;
      applyFastTriggerHouseStake();
      if (sendResponse) {
        try { sendResponse({ status: "OK", handled: true }); } catch (_) {}
      }
      return true;
    }

    const isCommand =
      request.type === "SELECT_ODDS" ||
      request.action === "SELECT_ODDS" ||
      request.type === "SELECT_ODDS_ACTION" ||
      request.action === "DISPARAR_APOSTA" ||
      request.type === "DISPARAR_APOSTA" ||
      request.action === "EXECUTE_DIRECT_TRIGGER";

    if (isCommand && typeof window.dispatchFastTriggerCommand === "function") {
      try {
        window.dispatchFastTriggerCommand(request, window.FastTriggerState?.livePort);
        if (sendResponse) {
          try { sendResponse({ status: "OK", handled: true }); } catch (_) {}
        }
        return true;
      } catch (err) {
        console.error("[Fast Trigger] Erro ao processar mensagem direta:", err);
      }
    }
  });
}
