// =========================================================================
// FAST TRIGGER PRO - ATALHOS FIXOS E CONTEXTUAIS (SINGLE SOURCE OF TRUTH)
// =========================================================================

var ftCachedQuickPresets = {};
var ftCachedDynamicPlayerBinds = {};
var ftLastDynamicExecution = new Map();
var ftDynamicExecutionInFlight = new Map();
var ftDynamicResolutionCache = new Map();
var FT_DYNAMIC_RESOLUTION_TTL_MS = 2500;

function ftScrapeDynamicMarkets(forceRefresh = false) {
  const adapter = window.FastTriggerAdapter;
  if (forceRefresh && typeof adapter?.invalidateMarketCache === "function") {
    adapter.invalidateMarketCache();
  }
  return adapter && typeof adapter.scrapeClean === "function"
    ? adapter.scrapeClean()
    : typeof scrapeBet365Clean === "function"
      ? scrapeBet365Clean()
      : [];
}

function ftGetDynamicMarkets(forceRefresh = false) {
  const marketIndex = window.FastTriggerMarketIndex;
  if (!forceRefresh) {
    const indexedMarkets = marketIndex?.getMarkets?.() || [];
    if (indexedMarkets.length > 0) {
      ftMarkDynamicExecutionStage("target", {
        reasonCode: "market_index_hit",
        indexHit: true,
      });
      return { markets: indexedMarkets, indexed: true };
    }
  }

  const markets = ftScrapeDynamicMarkets(forceRefresh);
  if (Array.isArray(markets) && markets.length > 0) {
    marketIndex?.rebuild?.(markets);
  }
  marketIndex?.noteMiss?.();
  ftMarkDynamicExecutionStage("target", {
    reasonCode: forceRefresh ? "market_index_refresh" : "index_miss",
    indexMiss: true,
  });
  return { markets: Array.isArray(markets) ? markets : [], indexed: false };
}

function ftDynamicResolutionCacheKey(bind, keyCode) {
  return [
    ftCurrentHouse(),
    keyCode || "",
    bind?.id || "",
    bind?.targetType || "",
    bind?.market || "",
    bind?.player || bind?.selection || "",
    bind?.line || "",
    ftBindOutcomeId(bind),
  ].join(":");
}

function ftCachedDynamicResolution(bind, keyCode) {
  const key = ftDynamicResolutionCacheKey(bind, keyCode);
  const marketIndex = window.FastTriggerMarketIndex;
  if (marketIndex?.get) {
    const indexed = marketIndex.get(key, (resolved) =>
      Boolean(
        ftIsTargetAvailable(resolved?.targetElement) &&
          ftBindMatchesCurrentEvent(bind),
      ),
    );
    if (indexed) return indexed;
  }

  const entry = ftDynamicResolutionCache.get(key);
  if (!entry || Date.now() - entry.createdAt > FT_DYNAMIC_RESOLUTION_TTL_MS) {
    ftDynamicResolutionCache.delete(key);
    return null;
  }

  const target = entry.resolved?.targetElement;
  if (!ftIsTargetAvailable(target)) {
    ftDynamicResolutionCache.delete(key);
    return null;
  }

  if (!ftBindMatchesCurrentEvent(bind)) {
    ftDynamicResolutionCache.delete(key);
    return null;
  }
  return entry.resolved;
}

function ftIsTargetAvailable(element) {
  if (!element?.isConnected || !ftIsVisible(element)) return false;
  const semantic = [
    element.getAttribute?.("data-testid"),
    element.getAttribute?.("aria-disabled"),
    element.getAttribute?.("data-state"),
    element.getAttribute?.("data-status"),
    element.className,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return !(
    element.disabled === true ||
    element.hasAttribute?.("disabled") ||
    element.getAttribute?.("aria-disabled") === "true" ||
    /\b(?:locked|suspended|disabled)\b/.test(semantic)
  );
}

function ftRememberDynamicResolution(bind, keyCode, resolved) {
  if (!resolved?.success || !resolved.targetElement?.isConnected) return;
  ftDynamicResolutionCache.set(ftDynamicResolutionCacheKey(bind, keyCode), {
    createdAt: Date.now(),
    resolved,
  });
  window.FastTriggerMarketIndex?.remember(
    ftDynamicResolutionCacheKey(bind, keyCode),
    resolved,
  );
}

function ftSetDynamicBindFailureReason(reason) {
  if (typeof window === "undefined") return;
  window.FastTriggerState = window.FastTriggerState || {};
  window.FastTriggerState.lastDynamicBindFailureReason =
    (reason || "").toString();
}

function ftMarkDynamicExecutionStage(stage, details = {}) {
  const actionId = window.FastTriggerState?.activeExecutionActionId;
  if (!actionId || typeof window.FastTriggerExecutionReport?.mark !== "function") {
    return;
  }
  window.FastTriggerExecutionReport.mark(actionId, stage, details);
}

function ftDynamicBindWait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// A varredura reativa da Betfair compartilha a fila serial por evento com a
// preparação da bind. Sinalizar a execução em voo permite que a varredura ceda
// a vez em vez de fazer a tecla esperar a rodada inteira de aberturas.
function ftNoteDynamicExecutionInFlight(delta) {
  if (typeof window === "undefined") return;
  window.FastTriggerState = window.FastTriggerState || {};
  const current =
    Number(window.FastTriggerState.dynamicBindExecutionsInFlight) || 0;
  window.FastTriggerState.dynamicBindExecutionsInFlight = Math.max(
    0,
    current + delta,
  );
}

async function ftPrepareDynamicBindMarket(bind) {
  const currentHouse = ftCurrentHouse();
  if (!bind?.market) return;

  if (currentHouse === "betfair") {
    const adapter = window.FastTriggerAdapter;
    if (typeof adapter?.collectExpandedMarkets !== "function") return;
    const expanded = await adapter.collectExpandedMarkets({
      interests: [
        {
          canonicalMarket: bind.market,
          playerKey: bind.player || "",
          line: bind.line || "",
        },
      ],
      batchSize: 4,
      // A execução de uma bind precisa abrir só o mercado alvo. A varredura da
      // aba completa é responsabilidade do coletor reativo e adicionaria
      // latência antes do clique.
      sweepAll: false,
      // A célula precisa continuar materializada até o clique da seleção.
      // O coletor reativo normal continua responsável por restaurar scans
      // somente-leitura; este caminho nasce de uma execução explícita.
      restoreOriginal: false,
      timeoutMs: 650,
    });
    if (Array.isArray(expanded?.groups) && expanded.groups.length > 0) {
      window.FastTriggerMarketIndex?.rebuild?.(expanded.groups);
    }
    return;
  }

  if (currentHouse !== "bet365") return;

  const titleHelper = window.FastTriggerBet365MarketTitle;
  const cleanMarketTitle = (value) => titleHelper?.clean?.(value) || value || "";
  const requestedMarket = ftNormalizeBindText(cleanMarketTitle(bind.market));
  const pods = Array.from(
    document.querySelectorAll(
      '.gl-MarketGroupPod, .gl-MarketGroup, [class*="MarketGroupPod"]',
    ),
  );
  (window.FastTriggerBet365ModernCards?.collect?.(document) || []).forEach(
    (card) => {
      if (!pods.includes(card)) pods.push(card);
    },
  );
  const titleSelectors =
    '.gl-MarketGroupButton_Text, .sip-MarketGroupButton_Text, [class*="MarketGroupButton_Text"], [class*="MarketTitle"]';
  const titleForPod = (pod) =>
    [
      titleHelper?.fromCard?.(pod),
      ...(titleHelper?.aliasesFromCard?.(pod) || []),
      ...Array.from(pod.querySelectorAll(titleSelectors)),
      pod.firstElementChild,
    ]
      .map((node) =>
        typeof node === "string"
          ? cleanMarketTitle(node)
          : cleanMarketTitle(
              (node?.innerText || node?.textContent || "")
                .split("\n")[0]
                .trim(),
            ),
      )
      .filter(Boolean);
  const scoreTitle = (candidateTitle) => {
    const normalizedTitle = ftNormalizeBindText(cleanMarketTitle(candidateTitle));
    if (!normalizedTitle || !requestedMarket) return -1;
    if (normalizedTitle === requestedMarket) return 100;
    if (ftMarketMatch(bind.market, candidateTitle)) return 80;
    if (
      normalizedTitle.length >= 5 &&
      requestedMarket.includes(normalizedTitle)
    )
      return 60;
    if (
      requestedMarket.length >= 5 &&
      normalizedTitle.includes(requestedMarket)
    )
      return 55;
    return -1;
  };
  const marketPod = pods
    .map((pod) => ({
      pod,
      score: titleForPod(pod).reduce(
        (best, title) => Math.max(best, scoreTitle(title)),
        -1,
      ),
    }))
    .filter((item) => item.score >= 0)
    .sort((left, right) => right.score - left.score)[0]?.pod;

  if (!marketPod) return;

  ftMarkScrollAssistedExecution(marketPod);

  const collapsed =
    marketPod.classList.contains("gl-MarketGroupPod-collapsed") ||
    marketPod.getAttribute("aria-expanded") === "false" ||
    marketPod.clientHeight < 45;
  if (collapsed) {
    const expandButton = marketPod.querySelector(
      '.gl-MarketGroupButton, .gl-MarketGroupButton_Text, [class*="MarketGroupButton"], .sc-MarketGroupButtonWithStats, .cm-MarketGroupWithIconsButton, .srb-ButtonWithBetBuilderIcon, [role="button"]',
    );
    if (expandButton && typeof expandButton.click === "function") {
      expandButton.click();
    }
  }

  try {
    const podRect = marketPod.getBoundingClientRect?.();
    const podVisible = podRect && podRect.top >= 0 && podRect.bottom <= (window.innerHeight || 0);
    if (!podVisible) {
      marketPod.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "auto" });
    }
  } catch (error) {}

  // Mercados de jogador usam uma lista virtualizada. Rolar até o jogador
  // configurado força a casa a materializar a linha correta antes do parser.
  if (bind.player) {
    const normalizedPlayer = ftNormalizeBindText(bind.player);
    const playerRow = Array.from(
      marketPod.querySelectorAll(
        '.sip-MarketLabelForSingleRow, [class*="MarketLabelForSingleRow"]',
      ),
    ).find((row) => {
      const playerText =
        row.querySelector(
          '.sip-MarketColumnHeaderWithCount_Name, [class*="MarketColumnHeaderWithCount_Name"]',
        )?.innerText || row.innerText || "";
      const normalizedPlayerText = ftNormalizeBindText(playerText);
      return (
        normalizedPlayerText === normalizedPlayer ||
        (normalizedPlayer.length >= 5 &&
          normalizedPlayerText.includes(normalizedPlayer)) ||
        (normalizedPlayerText.length >= 5 &&
          normalizedPlayer.includes(normalizedPlayerText))
      );
    });
    try {
      ftMarkScrollAssistedExecution(playerRow);
      const rowRect = playerRow?.getBoundingClientRect?.();
      const rowVisible = rowRect && rowRect.top >= 0 && rowRect.bottom <= (window.innerHeight || 0);
      if (!rowVisible) {
        playerRow?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "auto" });
      }
    } catch (error) {}
  }

  const backgroundDispatch =
    window.FastTriggerState?.backgroundDispatchInProgress === true;
  // Mesmo no caminho focado, a Bet365 precisa de pelo menos um ciclo de
  // renderização para atualizar as células depois do scroll. O caminho antigo
  // pulava toda espera durante uma bind em lote e lia o mercado incompleto.
  await ftDynamicBindWait(collapsed ? 60 : backgroundDispatch ? 8 : 16);

  const domWaiter = window.FastTriggerDom?.waitFor;
  if (typeof domWaiter === "function") {
    await domWaiter(
      () => {
        const marketText = ftNormalizeBindText(marketPod.innerText || "");
        const hasPlayer =
          !bind.player ||
          marketText.includes(ftNormalizeBindText(bind.player));
        const hasCells =
          marketPod.querySelectorAll(
            '.gl-ParticipantOddsOnly, .sip-SingleMarketScrollerParticipant, [class*="Participant"]',
          ).length > 0;
        return hasPlayer && hasCells ? marketPod : null;
      },
      {
        timeoutMs: collapsed ? 900 : backgroundDispatch ? 280 : 700,
        intervalMs: 8,
      },
    );
  }
}

function ftIsOutsideViewport(element) {
  if (!element || typeof element.getBoundingClientRect !== "function") return false;
  try {
    const rect = element.getBoundingClientRect();
    const viewportWidth =
      Number(window.innerWidth) || Number(document.documentElement?.clientWidth) || 0;
    const viewportHeight =
      Number(window.innerHeight) || Number(document.documentElement?.clientHeight) || 0;
    if (!viewportWidth || !viewportHeight) return false;
    return (
      rect.bottom <= 0 ||
      rect.top >= viewportHeight ||
      rect.right <= 0 ||
      rect.left >= viewportWidth
    );
  } catch (error) {
    return false;
  }
}

function ftMarkScrollAssistedExecution(element) {
  if (!ftIsOutsideViewport(element) || typeof window === "undefined") return false;
  const state = (window.FastTriggerState = window.FastTriggerState || {});
  const actionId =
    state.activeExecutionActionId || state.activePreparationActionId || null;
  if (!actionId) return false;
  state.scrollAssistedExecution = {
    actionId,
    detectedAt: Date.now(),
  };
  return true;
}

function ftShouldRetryDynamicBind(reason) {
  const normalized = ftNormalizeBindText(reason);
  return !(
    normalized.includes("outra casa") ||
    normalized.includes("nao foi confirmado neste jogo") ||
    normalized.includes("nao corresponde ao jogo") ||
    normalized.includes("mais de uma bind") ||
    normalized.includes("nenhum atalho") ||
    normalized.includes("assinatura") ||
    normalized.includes("rate limit")
  );
}

async function ftWithDeferredDynamicBindSubmit(operation) {
  const state =
    typeof window !== "undefined"
      ? (window.FastTriggerState = window.FastTriggerState || {})
      : null;
  const previousValue = state?.deferDynamicBindSubmit;
  if (state) state.deferDynamicBindSubmit = true;
  try {
    return await operation();
  } finally {
    if (state) state.deferDynamicBindSubmit = previousValue;
  }
}

async function ftFinalizeDynamicBindSelection(
  isHotkey,
  stakeAlreadyPrepared = false,
) {
  // Uma execução recebida do Electron já representa uma ordem completa
  // autorizada. A configuração da extensão Chrome pode ainda estar sendo
  // hidratada nesta altura; portanto, ela não pode decidir sozinha se a
  // segunda etapa (o CTA financeiro) será enviada.
  const electronDynamicCommit = Boolean(
    window.FastTriggerState?.activeExecutionActionId,
  );
  let oneShotActive = false;
  if (typeof isOneShotActive === "function") {
    oneShotActive = await isOneShotActive();
  } else {
    const config = window.FastTriggerConfig || {};
    oneShotActive = Boolean(
      config.oneClick ||
        config.oneShot ||
        config.autoTriggerDirectBool ||
        config.autoTrigger ||
        config.autoTriggerDirect ||
        config.autoPlaceBet,
    );
  }

  // Em um atalho local sem One-Shot, preparar o cupom é o resultado esperado.
  // Já um COMMIT_DYNAMIC_BIND vindo do Electron deve sempre alcançar o botão
  // Apostar, mesmo antes de o storage local terminar a hidratação.
  if (!oneShotActive && !electronDynamicCommit) return true;

  const adapter = window.FastTriggerAdapter;
  const trigger =
    adapter && typeof adapter.triggerPlaceBet === "function"
      ? adapter.triggerPlaceBet.bind(adapter)
      : typeof triggerPlaceBet === "function"
        ? triggerPlaceBet
        : typeof window.triggerPlaceBet === "function"
          ? window.triggerPlaceBet
          : null;
  if (!trigger) {
    ftSetDynamicBindFailureReason(
      "A selecao foi localizada, mas o motor do botao Apostar nao esta disponivel.",
    );
    return false;
  }

  const betfairFastMode = window.location.hostname.includes("betfair");
  const stateBeforeCommit = window.FastTriggerState;
  const previousDeferred = stateBeforeCommit?.deferDynamicBindSubmit;
  if (electronDynamicCommit && stateBeforeCommit) {
    // O commit autorizado pelo Electron nunca pode herdar a flag de
    // preparação caso uma camada anterior ainda esteja finalizando.
    stateBeforeCommit.deferDynamicBindSubmit = false;
  }
  let confirmed;
  try {
    confirmed = await trigger(
      electronDynamicCommit,
      isHotkey,
      stakeAlreadyPrepared,
      betfairFastMode,
    );
  } finally {
    if (electronDynamicCommit && stateBeforeCommit) {
      stateBeforeCommit.deferDynamicBindSubmit = previousDeferred;
    }
  }
  if (confirmed === false) {
    ftSetDynamicBindFailureReason(
      "A selecao foi localizada, mas o clique no botao Apostar nao foi entregue.",
    );
    return false;
  }
  return true;
}

async function ftCommitArmedDynamicBind(actionId, isHotkey = true) {
  const state =
    typeof window !== "undefined"
      ? (window.FastTriggerState = window.FastTriggerState || {})
      : null;
  const armed = state?.armedDynamicBind;
  const now = Date.now();
  if (
    !armed ||
    armed.actionId !== actionId ||
    armed.committed === true ||
    Number(armed.expiresAt || 0) < now
  ) {
    ftSetDynamicBindFailureReason(
      "A preparação da aposta expirou ou já foi utilizada.",
    );
    if (state) state.armedDynamicBind = null;
    return false;
  }

  armed.committed = true;
  if (armed.scrollAssisted === true && state) {
    state.scrollAssistedExecution = {
      actionId,
      detectedAt: Date.now(),
    };
  }
  try {
    return await ftFinalizeDynamicBindSelection(isHotkey, true);
  } finally {
    if (state?.armedDynamicBind === armed) state.armedDynamicBind = null;
  }
}

function ftNormalizeBindText(value) {
  return (value || "")
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function ftLooseBindMatch(left, right) {
  const a = ftNormalizeBindText(left);
  const b = ftNormalizeBindText(right);
  if (!a || !b) return false;
  return (
    a === b ||
    (a.length >= 5 && b.includes(a)) ||
    (b.length >= 5 && a.includes(b))
  );
}

function ftCanonicalPlayerMarket(value) {
  const text = ftNormalizeBindText(value);
  const isPlayerMarket = /\b(jogador|jogadores|player|players)\b/.test(text);
  if (!isPlayerMarket) return "";

  const period = /\b(1 tempo|primeiro tempo|1st half)\b/.test(text)
    ? ":h1"
    : /\b(2 tempo|segundo tempo|2nd half)\b/.test(text)
      ? ":h2"
      : "";

  if (/\b(chute|chutes|finalizacao|finalizacoes|shot|shots)\b/.test(text)) {
    const onTarget =
      /\b(ao gol|a gol|no gol|no alvo|a baliza|on target|target)\b/.test(text);
    return `${onTarget ? "player_shots_on_target" : "player_shots"}${period}`;
  }
  if (/\b(falta|faltas|foul|fouls)\b/.test(text)) {
    if (/\b(recebida|recebidas|sofrida|sofridas|received)\b/.test(text))
      return `player_fouls_received${period}`;
    if (/\b(cometida|cometidas|committed)\b/.test(text))
      return `player_fouls_committed${period}`;
    return `player_fouls${period}`;
  }
  if (/\b(cartao|cartoes|card|cards)\b/.test(text))
    return `player_cards${period}`;
  if (/\b(desarme|desarmes|tackle|tackles)\b/.test(text))
    return `player_tackles${period}`;
  if (/\b(passe|passes|pass|passing)\b/.test(text))
    return `player_passes${period}`;
  return "";
}

function ftPlayerMarketMatch(left, right) {
  const a = ftNormalizeBindText(left);
  const b = ftNormalizeBindText(right);
  const aIsPlayer = /\b(jogador|jogadores|player|players)\b/.test(a);
  const bIsPlayer = /\b(jogador|jogadores|player|players)\b/.test(b);
  if (aIsPlayer !== bIsPlayer) return false;

  const familyA = ftCanonicalPlayerMarket(a);
  const familyB = ftCanonicalPlayerMarket(b);
  if (familyA || familyB) return !!familyA && familyA === familyB;
  return ftLooseBindMatch(a, b);
}

function ftCurrentHouse() {
  const host = window.location.hostname.toLowerCase();
  if (host.includes("betfair")) return "betfair";
  if (host.includes("betnacional")) return "betnacional";
  if (host.includes("betano.bet.br")) return "betano";
  if (host.includes("betmgm")) return "betmgm";
  if (host.includes("superbet")) return "superbet";
  return "bet365";
}

function ftHasBindTeam(bind) {
  const team = ftNormalizeBindText(bind?.team);
  return Boolean(
    team &&
    !["time nao identificado", "time nao informado", "unknown"].includes(team),
  );
}

function ftBindMatchesCurrentEvent(bind) {
  const configuredEvent = ftNormalizeBindText(bind?.eventLabel);
  const configuredEventId = ftNormalizeBindText(bind?.eventId).replace(
    /^[a-z0-9-]+:/,
    "",
  );
  const currentTeams = Array.isArray(window.FastTriggerEventContext?.teams)
    ? window.FastTriggerEventContext.teams.filter(Boolean)
    : [];
  const currentEvent = ftNormalizeBindText(
    window.FastTriggerEventContext?.eventLabel ||
      currentTeams.slice(0, 2).join(" x "),
  );

  if ((configuredEvent || configuredEventId) && currentEvent) {
    const configured = configuredEvent || configuredEventId.replace(/-/g, " ");
    if (!ftLooseBindMatch(configured, currentEvent)) return false;
  }

  if (!ftHasBindTeam(bind)) return true;
  return currentTeams.some((team) => ftLooseBindMatch(bind.team, team));
}

function ftBindKeyAliases(keyCode) {
  const value = (keyCode || "").toString();
  const aliases = [value];
  const digit =
    value.match(/^(?:Digit|Numpad)(\d)$/)?.[1] ||
    (/^\d$/.test(value) ? value : "");
  if (digit) aliases.push(`Digit${digit}`, `Numpad${digit}`, digit);
  const letter =
    value.match(/^Key([A-Z])$/i)?.[1] || (/^[A-Z]$/i.test(value) ? value : "");
  if (letter) aliases.push(`Key${letter.toUpperCase()}`, letter.toUpperCase());
  return [...new Set(aliases)];
}

function ftDynamicBindCandidates(
  keyCode,
  currentHouse = ftCurrentHouse(),
  source = ftCachedDynamicPlayerBinds,
) {
  const rawValues = [];
  ftBindKeyAliases(keyCode).forEach((alias) => {
    const scopedKey = `${currentHouse}:${alias}`;
    if (Object.prototype.hasOwnProperty.call(source, scopedKey))
      rawValues.push(source[scopedKey]);
    if (Object.prototype.hasOwnProperty.call(source, alias))
      rawValues.push(source[alias]);
  });
  const entries = rawValues.flatMap((raw) =>
    Array.isArray(raw) ? raw : raw ? [raw] : [],
  );
  return entries.filter(
    (bind, index, list) =>
      bind &&
      (!bind.house || bind.house === currentHouse) &&
      list.findIndex(
        (item) => item === bind || (item.id && item.id === bind.id),
      ) === index,
  );
}

function ftBindMatchesKeyboardEvent(bind, event) {
  const modifiers = new Set(
    (Array.isArray(bind?.modifiers) ? bind.modifiers : []).map((value) =>
      String(value).toLowerCase(),
    ),
  );
  return (
    modifiers.has("ctrl") === event.ctrlKey &&
    modifiers.has("alt") === event.altKey &&
    modifiers.has("shift") === event.shiftKey &&
    event.metaKey !== true
  );
}

function ftIsOpenOdd(item) {
  if (!item || item.status === "LOCKED" || item.isClosed === true) return false;
  const value = (item.val || item.odds || "").toString().replace(",", ".");
  const numericValue = parseFloat((value.match(/\d+(?:\.\d+)?/) || [])[0]);
  return Number.isFinite(numericValue) && numericValue > 1;
}

function ftNormalizeLine(value) {
  const match = (value || "").toString().match(/(\d+(?:[.,]\d+)?)\s*\+/);
  return match
    ? `${match[1].replace(",", ".")}+`
    : (value || "").toString().replace(/\s+/g, "");
}

function ftLineForSelection(market, selection, colIndex) {
  const headerOffset = market.hasLabelsCol === false ? 0 : 1;
  return (
    selection.colHeader ||
    (Array.isArray(market.headers)
      ? market.headers[colIndex + headerOffset]
      : "") ||
    `${colIndex + 1}+`
  );
}

function ftShowBindFeedback(message) {
  if (typeof showFlashFeedback === "function") {
    showFlashFeedback(message);
  } else {
    console.warn(`[Fast Trigger Binds] ${message}`);
  }
}

function ftMarketMatch(left, right) {
  const titleHelper = window.FastTriggerBet365MarketTitle;
  const cleanLeft = titleHelper?.clean?.(left) || left;
  const cleanRight = titleHelper?.clean?.(right) || right;
  return (
    ftPlayerMarketMatch(cleanLeft, cleanRight) ||
    ftLooseBindMatch(cleanLeft, cleanRight)
  );
}

function ftMarketEntryMatch(requestedMarket, market) {
  if (!market) return false;
  if (ftCurrentHouse() === "bet365") {
    const titleHelper = window.FastTriggerBet365MarketTitle;
    const normalizeTitle = (value) =>
      ftNormalizeBindText(titleHelper?.clean?.(value) || value || "");
    const requested = normalizeTitle(requestedMarket);
    if (!requested) return false;
    const candidates = [
      market.title,
      ...(Array.isArray(market.marketAliases) ? market.marketAliases : []),
    ];
    // Na Bet365, "Escanteios", "Escanteios - Alternativas" e
    // "1º Tempo - Escanteios Asiáticos" coexistem. Inclusão parcial nunca
    // autoriza escolher um mercado; o título/alias limpo precisa ser exato.
    return candidates.some((candidate) => normalizeTitle(candidate) === requested);
  }
  if (ftMarketMatch(requestedMarket, market.title)) return true;
  return Array.isArray(market.marketAliases)
    ? market.marketAliases.some((alias) =>
        ftMarketMatch(requestedMarket, alias),
      )
    : false;
}

function ftSelectionIdentity(item) {
  return [item?.name, item?.rawName, item?.colHeader].filter(Boolean).join(" ");
}

function ftBindOutcomeId(bind) {
  return String(bind?.outcomeId || bind?.panelTarget?.outcomeId || "").trim();
}

// O outcome é a única identidade estável quando o mercado muda de posição na
// página: o rótulo pode ser reescrito e a linha pode subir ou descer, mas o id
// da seleção continua o mesmo. Por isso ele é consultado antes do texto e antes
// dos índices salvos. Binds antigas não têm o campo e seguem pelo caminho velho.
function ftFindBindOutcome(bind, markets) {
  const wanted = ftBindOutcomeId(bind);
  if (!wanted) return null;
  const list = Array.isArray(markets) ? markets : [];
  for (const market of list) {
    if (!market) continue;
    const rows = Array.isArray(market.tableRows) ? market.tableRows : null;
    if (rows && rows.length > 0) {
      for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
        const row = rows[rowIndex] || {};
        const odds = row.colOdds || row.odds || [];
        for (let colIndex = 0; colIndex < odds.length; colIndex += 1) {
          const selection = odds[colIndex];
          if (String(selection?.outcomeId || "").trim() !== wanted) continue;
          return {
            market,
            selection,
            rowIndex,
            colIndex,
            rowLabel: row.lineLabel || "",
            line: ftLineForSelection(market, selection, colIndex),
          };
        }
      }
      continue;
    }
    const selections = market.participants || market.selections || [];
    for (let colIndex = 0; colIndex < selections.length; colIndex += 1) {
      const selection = selections[colIndex];
      if (String(selection?.outcomeId || "").trim() !== wanted) continue;
      return {
        market,
        selection,
        rowIndex: 0,
        colIndex,
        rowLabel: "",
        line: selection.colHeader || selection.name || `${colIndex + 1}`,
      };
    }
  }
  return null;
}

function ftDynamicResolutionFromCandidate(candidate, player) {
  const selection = candidate.selection;
  return {
    success: true,
    marketTitle: candidate.market.title,
    player: player || "",
    targetName: selection.name || selection.rawName || candidate.line,
    targetOdd: selection.val || selection.odds,
    line: candidate.line,
    rowIndex: candidate.rowIndex,
    colIndex: candidate.colIndex,
    outcomeId: selection.outcomeId || "",
    targetElement: selection.element || null,
  };
}

function ftResolveDynamicMarketSelectionBind(bind) {
  if (!bind || bind.house !== ftCurrentHouse()) {
    return { success: false, reason: "Este atalho pertence a outra casa." };
  }

  if (ftHasBindTeam(bind) && !ftBindMatchesCurrentEvent(bind)) {
    return {
      success: false,
      reason: `${bind.team} não foi confirmado neste jogo.`,
    };
  }

  let marketSource = ftGetDynamicMarkets();
  let markets = marketSource.markets;

  // Alvo cravado no painel: o outcome vem antes do título do mercado, então
  // reordenar a página não desfaz a bind.
  let pinned = ftFindBindOutcome(bind, markets);
  if (!pinned && marketSource.indexed && ftBindOutcomeId(bind)) {
    marketSource = ftGetDynamicMarkets(true);
    markets = marketSource.markets;
    pinned = ftFindBindOutcome(bind, markets);
  }
  if (pinned && ftIsOpenOdd(pinned.selection)) {
    return ftDynamicResolutionFromCandidate(pinned, "");
  }

  let market = markets.find(
    (item) => ftMarketEntryMatch(bind.market, item),
  );
  if (!market && marketSource.indexed) {
    marketSource = ftGetDynamicMarkets(true);
    markets = marketSource.markets;
    market = markets.find((item) => ftMarketEntryMatch(bind.market, item));
  }
  if (!market) {
    return {
      success: false,
      reason: `Mercado "${bind.market}" não está disponível.`,
    };
  }

  const requestedSelection = ftNormalizeBindText(bind.selection || bind.line);
  const requestedRow = ftNormalizeBindText(bind.rowLabel);
  const resolveFromMarket = (candidateMarket) => {
    const candidates = [];

    if (candidateMarket.isTable && Array.isArray(candidateMarket.tableRows)) {
      candidateMarket.tableRows.forEach((row, rowIndex) => {
        const odds = row.colOdds || row.odds || [];
        odds.forEach((selection, colIndex) => {
          candidates.push({
            selection,
            rowIndex,
            colIndex,
            rowLabel: row.lineLabel || "",
            line: ftLineForSelection(candidateMarket, selection, colIndex),
          });
        });
      });
    } else {
      const selections = candidateMarket.participants || candidateMarket.selections || [];
      selections.forEach((selection, colIndex) => {
        candidates.push({
          selection,
          rowIndex: 0,
          colIndex,
          rowLabel: "",
          line: selection.colHeader || selection.name || `${colIndex + 1}`,
        });
      });
    }

    const openCandidates = candidates.filter((candidate) =>
      ftIsOpenOdd(candidate.selection),
    );
    let resolved = openCandidates.find((candidate) => {
      const sameSelection =
        requestedSelection &&
        ftLooseBindMatch(
          requestedSelection,
          ftSelectionIdentity(candidate.selection),
        );
      const sameRow =
        !requestedRow || ftLooseBindMatch(requestedRow, candidate.rowLabel);
      return sameSelection && sameRow;
    });

    if (
      !resolved &&
      Number.isInteger(bind.rowIndex) &&
      Number.isInteger(bind.colIndex)
    ) {
      resolved = openCandidates.find(
        (candidate) =>
          candidate.rowIndex === Number(bind.rowIndex) &&
          candidate.colIndex === Number(bind.colIndex),
      );
    }

    if (!resolved && bind.line) {
      resolved = openCandidates.find(
        (candidate) =>
          ftNormalizeLine(candidate.line) === ftNormalizeLine(bind.line) &&
          (!requestedRow || ftLooseBindMatch(requestedRow, candidate.rowLabel)),
      );
    }

    return resolved;
  };

  let resolved = resolveFromMarket(market);
  if (!resolved && marketSource.indexed) {
    // Um mercado pode continuar presente no índice depois de uma suspensão,
    // mas com todas as seleções marcadas como fechadas. Releia o DOM antes de
    // desistir, pois a casa costuma reativar os mesmos nós ao reabrir.
    marketSource = ftGetDynamicMarkets(true);
    markets = marketSource.markets;
    market = markets.find((item) => ftMarketEntryMatch(bind.market, item));
    if (market) resolved = resolveFromMarket(market);
  }

  if (!resolved) {
    return {
      success: false,
      reason: market
        ? `A opção "${bind.selection || bind.line}" não está aberta em ${market.title}.`
        : `Mercado "${bind.market}" não está disponível.`,
    };
  }

  return {
    success: true,
    marketTitle: market.title,
    player: "",
    targetName:
      resolved.selection.name || resolved.selection.rawName || resolved.line,
    targetOdd: resolved.selection.val || resolved.selection.odds,
    line: resolved.line,
    rowIndex: resolved.rowIndex,
    colIndex: resolved.colIndex,
    outcomeId: resolved.selection.outcomeId || "",
    targetElement: resolved.selection.element || null,
  };
}

function ftResolveDynamicPlayerBind(bind) {
  if (!bind || bind.house !== ftCurrentHouse()) {
    return { success: false, reason: "Este atalho pertence a outra casa." };
  }

  const teamIsInEvent = ftBindMatchesCurrentEvent(bind);
  if (!teamIsInEvent) {
    return {
      success: false,
      reason: `${bind.team} não foi confirmado neste jogo.`,
    };
  }

  let marketSource = ftGetDynamicMarkets();
  let markets = marketSource.markets;

  // Linha exata cravada no painel: o outcome identifica a célula mesmo que a
  // linha do atleta tenha subido, descido ou perdido o rótulo. Estratégias
  // dinâmicas (primeira/próxima/maior linha) continuam lendo a oferta ao vivo.
  if (bind.lineMode === "exact") {
    let pinned = ftFindBindOutcome(bind, markets);
    if (!pinned && marketSource.indexed && ftBindOutcomeId(bind)) {
      marketSource = ftGetDynamicMarkets(true);
      markets = marketSource.markets;
      pinned = ftFindBindOutcome(bind, markets);
    }
    if (pinned && ftIsOpenOdd(pinned.selection)) {
      return ftDynamicResolutionFromCandidate(pinned, pinned.rowLabel || bind.player);
    }
  }

  const findPlayerMarket = (items) => items.find(
    (item) =>
      item &&
      (item.isTable || item.isPlayerMarket) &&
      (ftPlayerMarketMatch(bind.market, item.title) ||
        (Array.isArray(item.marketAliases) &&
          item.marketAliases.some((alias) =>
            ftPlayerMarketMatch(bind.market, alias),
          ))),
  );
  let market = findPlayerMarket(markets);
  if (!market && marketSource.indexed) {
    marketSource = ftGetDynamicMarkets(true);
    markets = marketSource.markets;
    market = findPlayerMarket(markets);
  }
  if (!market) {
    return {
      success: false,
      reason: `Mercado "${bind.market}" não está disponível.`,
    };
  }

  const rows = Array.isArray(market.tableRows) ? market.tableRows : [];
  const rowIndex = rows.findIndex((row) =>
    ftLooseBindMatch(bind.player, row.lineLabel),
  );
  if (rowIndex === -1) {
    return {
      success: false,
      reason: `${bind.player} não está disponível em ${market.title}.`,
    };
  }

  const row = rows[rowIndex];
  const odds = row.colOdds || row.odds || [];
  let colIndex = -1;
  let requestedLine = "";

  if (bind.lineMode === "exact" && bind.line) {
    requestedLine = ftNormalizeLine(bind.line);
    colIndex = odds.findIndex(
      (item, index) =>
        ftNormalizeLine(ftLineForSelection(market, item, index)) ===
          requestedLine && ftIsOpenOdd(item),
    );
  } else {
    colIndex = odds.findIndex(ftIsOpenOdd);
  }

  // Durante uma atualização da Bet365 o nome visual da coluna pode ficar
  // vazio, mas o índice e o elemento da célula continuam estáveis. Para binds
  // exatas, use o índice salvo como fallback somente depois de tentar o rótulo
  // textual; isso evita perder a seleção por uma lacuna momentânea do DOM.
  if (
    colIndex === -1 &&
    bind.lineMode === "exact" &&
    Number.isInteger(bind.colIndex ?? bind.columnIndex)
  ) {
    const requestedColumn = Number(bind.colIndex ?? bind.columnIndex);
    const fallbackSelection = odds[requestedColumn];
    const lineLabelUnavailable =
      fallbackSelection &&
      (fallbackSelection.lineLabelAvailable === false ||
        !ftNormalizeLine(fallbackSelection.colHeader));
    if (
      requestedColumn >= 0 &&
      requestedColumn < odds.length &&
      lineLabelUnavailable
    ) {
      colIndex = ftIsOpenOdd(fallbackSelection) ? requestedColumn : -1;
    }
  }

  if (colIndex === -1) {
    return {
      success: false,
      reason:
        requestedLine
          ? `A linha ${requestedLine} de ${bind.player} não está disponível.`
          : `Nenhuma linha aberta para ${bind.player}.`,
    };
  }

  const selection = odds[colIndex];
  const line = ftLineForSelection(market, selection, colIndex);

  return {
    success: true,
    marketTitle: market.title,
    player: row.lineLabel || bind.player,
    targetName: selection.name || `${bind.player} ${line}`.trim(),
    targetOdd: selection.val || selection.odds,
    line,
    rowIndex,
    colIndex,
    outcomeId: selection.outcomeId || "",
    targetElement: selection.element || null,
  };
}

async function ftExecuteDynamicPlayerBind(
  bind,
  keyCode,
  isHotkey = true,
  allowImmediateRetry = false,
  deferFinalCommit = false,
) {
  ftSetDynamicBindFailureReason("");
  if (typeof window !== "undefined" && window.FastTriggerState) {
    window.FastTriggerState.lastDynamicBindClickAttempted = false;
    window.FastTriggerState.lastDynamicBindFinalClickAttempted = false;
  }
  // No modo integrado a autorização já foi validada pelo Electron e anexada
  // ao comando. Não faça uma consulta assíncrona ao storage/rede em cada casa
  // do lote: esse round-trip era repetido por bind e adicionava centenas de
  // milissegundos antes mesmo de localizar a odd. O fallback local permanece
  // intacto para uso standalone da extensão.
  const externalElectronMode = window.FastTriggerExternalElectronMode === true;
  const ensureLicense = externalElectronMode
    ? null
    : typeof ensureGatilhoBRLicense === "function"
      ? ensureGatilhoBRLicense
      : typeof window !== "undefined"
        ? window.ensureGatilhoBRLicense
        : null;
  const hotLicense = externalElectronMode
    ? { valid: true, source: "electron" }
    : typeof window.getHotLicenseSnapshot === "function"
      ? window.getHotLicenseSnapshot()
      : null;
  const license = hotLicense || (ensureLicense ? await ensureLicense() : null);
  if (!license?.valid && window.FastTriggerExternalElectronMode !== true) {
    ftShowBindFeedback("Assinatura expirada ou não autorizada.");
    return false;
  }

  if (window.FastTriggerSecurity) {
    if (window.FastTriggerSecurity.isBlocked()) {
      if (typeof ftShowBindFeedback === "function") {
        ftShowBindFeedback("Extensão pausada por segurança.");
      }
      return false;
    }
    if (!window.FastTriggerSecurity.checkRateLimit("action", 15, 5000)) {
      if (typeof ftShowBindFeedback === "function") {
        ftShowBindFeedback("Rate limit excedido.");
      }
      return false;
    }
  }

  const lastRun = ftLastDynamicExecution.get(keyCode) || 0;
  if (!allowImmediateRetry && Date.now() - lastRun < 700) return false;
  ftLastDynamicExecution.set(keyCode, Date.now());

  const resolveCurrentTarget = () =>
    bind.targetType === "market_selection"
      ? ftResolveDynamicMarketSelectionBind(bind)
      : ftResolveDynamicPlayerBind(bind);
  // Caminho quente: primeiro tenta o índice atual. A preparação/expansão só
  // ocorre se o alvo realmente não estiver materializado.
  let resolved = ftCachedDynamicResolution(bind, keyCode) || resolveCurrentTarget();
  for (let attempt = 0; !resolved?.success && attempt < 3; attempt += 1) {
    await ftPrepareDynamicBindMarket(bind);
    resolved = resolveCurrentTarget();
    if (resolved.success) {
      ftRememberDynamicResolution(bind, keyCode, resolved);
      break;
    }
    if (!ftShouldRetryDynamicBind(resolved.reason)) break;
    if (attempt < 2) await ftDynamicBindWait(
      window.FastTriggerState?.backgroundDispatchInProgress === true
        ? 4 + attempt * 8
        : 16 + attempt * 24,
    );
  }
  if (!resolved.success) {
    ftSetDynamicBindFailureReason(resolved.reason);
    ftShowBindFeedback(resolved.reason);
    return false;
  }

  ftMarkDynamicExecutionStage("target", {
    reasonCode: "target_ready",
  });
  window.setFastTriggerExpectedExecutionOdds?.(resolved.targetOdd);

  console.log(
    `[Fast Trigger Binds] ${keyCode}: ${resolved.player || resolved.targetName} -> ${resolved.line} ` +
      `(${resolved.targetOdd}) em ${resolved.marketTitle}.`,
  );

  const currentHouse =
    typeof ftCurrentHouse === "function" ? ftCurrentHouse() : "";

  if (
    currentHouse === "betnacional" ||
    window.location.hostname.includes("betnacional")
  ) {
    if (
      window.FastTriggerAdapter &&
      typeof window.FastTriggerAdapter.selectOddsOnBetnacional === "function"
    ) {
      const result = await ftWithDeferredDynamicBindSubmit(() =>
        window.FastTriggerAdapter.selectOddsOnBetnacional(
          resolved.targetName,
          resolved.targetOdd,
          resolved.marketTitle,
          resolved.colIndex,
          resolved.rowIndex,
          isHotkey,
          resolved.player || "",
          true,
          resolved.targetElement || null,
        ),
      );
      if (result === false) {
        ftSetDynamicBindFailureReason(
          "A seleção foi localizada, mas o clique não foi confirmado na Betnacional.",
        );
        return false;
      }
      ftMarkDynamicExecutionStage("selection", {
        reasonCode: "selection_ready",
      });
      return deferFinalCommit
        ? true
        : ftFinalizeDynamicBindSelection(isHotkey, true);
    } else if (typeof window.selectOddsOnBetnacional === "function") {
      const result = await ftWithDeferredDynamicBindSubmit(() =>
        window.selectOddsOnBetnacional(
          resolved.targetName,
          resolved.targetOdd,
          resolved.marketTitle,
          resolved.colIndex,
          resolved.rowIndex,
          isHotkey,
          resolved.player || "",
          true,
          resolved.targetElement || null,
        ),
      );
      if (result === false) {
        ftSetDynamicBindFailureReason(
          "A seleção foi localizada, mas o clique não foi confirmado na Betnacional.",
        );
        return false;
      }
      ftMarkDynamicExecutionStage("selection", {
        reasonCode: "selection_ready",
      });
      return deferFinalCommit
        ? true
        : ftFinalizeDynamicBindSelection(isHotkey, true);
    }
  }

  if (
    currentHouse === "betfair" ||
    window.location.hostname.includes("betfair")
  ) {
    if (
      window.FastTriggerAdapter &&
      typeof window.FastTriggerAdapter.selectOddsOnBetfair === "function"
    ) {
      const result = await ftWithDeferredDynamicBindSubmit(() =>
        window.FastTriggerAdapter.selectOddsOnBetfair(
          resolved.targetName,
          resolved.targetOdd,
          resolved.marketTitle,
          resolved.colIndex,
          resolved.rowIndex,
          isHotkey,
          resolved.player || "",
          true,
          resolved.targetElement || null,
        ),
      );
      if (result === false) {
        ftSetDynamicBindFailureReason(
          "A seleção foi localizada, mas o clique não foi confirmado na Betfair.",
        );
        return false;
      }
      ftMarkDynamicExecutionStage("selection", {
        reasonCode: "selection_ready",
      });
      return deferFinalCommit
        ? true
        : ftFinalizeDynamicBindSelection(isHotkey, true);
    }
  }

  if (
    currentHouse === "betmgm" ||
    window.location.hostname.includes("betmgm")
  ) {
    if (
      window.FastTriggerAdapter &&
      typeof window.FastTriggerAdapter.selectOddsOnBetmgm === "function"
    ) {
      const result = await ftWithDeferredDynamicBindSubmit(() =>
        window.FastTriggerAdapter.selectOddsOnBetmgm(
          resolved.targetName,
          resolved.targetOdd,
          resolved.marketTitle,
          resolved.colIndex,
          resolved.rowIndex,
          isHotkey,
          resolved.player || "",
          true,
          resolved.line || "",
          resolved.outcomeId || "",
        ),
      );
      if (result === false) {
        ftSetDynamicBindFailureReason(
          "A seleção foi localizada, mas o clique não foi confirmado na BetMGM.",
        );
        return false;
      }
      ftMarkDynamicExecutionStage("selection", {
        reasonCode: "selection_ready",
      });
      return deferFinalCommit
        ? true
        : ftFinalizeDynamicBindSelection(isHotkey, true);
    }
  }

  if (
    currentHouse === "betano" ||
    window.location.hostname.includes("betano.bet.br")
  ) {
    const adapter = window.FastTriggerAdapter;
    if (adapter && typeof adapter.selectOddsOnBetano === "function") {
      const result = await ftWithDeferredDynamicBindSubmit(() =>
        adapter.selectOddsOnBetano(
          resolved.targetName,
          resolved.targetOdd,
          resolved.marketTitle,
          resolved.colIndex,
          resolved.rowIndex,
          isHotkey,
          resolved.player || "",
          true,
          resolved.line || "",
          resolved.outcomeId || "",
        ),
      );
      if (result === false) {
        ftSetDynamicBindFailureReason(
          "A seleção foi localizada, mas o clique não foi confirmado na Betano.",
        );
        return false;
      }
      ftMarkDynamicExecutionStage("selection", { reasonCode: "selection_ready" });
      return deferFinalCommit ? true : ftFinalizeDynamicBindSelection(isHotkey, true);
    }
  }

  if (
    currentHouse === "superbet" ||
    window.location.hostname.includes("superbet")
  ) {
    const adapter = window.FastTriggerAdapter;
    if (adapter && typeof adapter.selectOddsOnSuperbet === "function") {
      const result = await ftWithDeferredDynamicBindSubmit(() =>
        adapter.selectOddsOnSuperbet(
          resolved.targetName,
          resolved.targetOdd,
          resolved.marketTitle,
          resolved.colIndex,
          resolved.rowIndex,
          isHotkey,
          resolved.player || "",
          true,
          resolved.line || "",
          resolved.outcomeId || "",
        ),
      );
      if (result === false) {
        ftSetDynamicBindFailureReason(
          "A seleção foi localizada, mas o clique não foi confirmado na Superbet.",
        );
        return false;
      }
      ftMarkDynamicExecutionStage("selection", { reasonCode: "selection_ready" });
      return deferFinalCommit ? true : ftFinalizeDynamicBindSelection(isHotkey, true);
    }
  }

  const selectFn =
    typeof selectOddsOnPage === "function"
      ? selectOddsOnPage
      : window.selectOddsOnPage;
  if (typeof selectFn !== "function") {
    ftSetDynamicBindFailureReason("Motor de seleção indisponível.");
    ftShowBindFeedback("Motor de seleção indisponível.");
    return false;
  }

  const result = await ftWithDeferredDynamicBindSubmit(() =>
    selectFn(
      resolved.targetName,
      resolved.targetOdd,
      resolved.marketTitle,
      resolved.colIndex,
      resolved.rowIndex,
      isHotkey,
      resolved.player || "",
      resolved.line,
      resolved.targetElement,
    ),
  );
  if (result === false) {
    ftSetDynamicBindFailureReason(
      `A seleção foi localizada, mas o botão não confirmou o clique em ${resolved.marketTitle}.`,
    );
    return false;
  }
  ftMarkDynamicExecutionStage("selection", {
    reasonCode: "selection_ready",
  });
  // O seletor genérico da Bet365 apenas clica na odd; ele não preenche o
  // cupom. Deixe o adapter executar a etapa de stake explicitamente. As casas
  // com adapter próprio continuam usando a stake já preparada.
  const selectionPreparedStake = currentHouse === "bet365" ? false : true;
  if (deferFinalCommit && currentHouse === "bet365") {
    // No armOnly da bind simultânea o commit é separado, mas a Bet365 ainda
    // precisa receber a stake antes de ficar armada; caso contrário o clique
    // final chega com o cupom vazio.
    const configuredStake =
      window.FastTriggerExpectedExecutionStake ||
      window.FastTriggerConfig?.stakeValByHouse?.bet365 ||
      window.FastTriggerConfig?.stakeVal ||
      "0,50";
    const prepared = typeof pollAndFillStake === "function"
      ? await pollAndFillStake(2, true)
      : typeof fillBet365StakeGen5 === "function"
        ? await fillBet365StakeGen5(configuredStake, true)
        : false;
    if (!prepared) return false;
  }
  return deferFinalCommit
    ? true
    : ftFinalizeDynamicBindSelection(isHotkey, selectionPreparedStake);
}

async function ftExecuteDynamicPlayerBindByKey(
  keyCode,
  isHotkey = true,
  incomingBinds = null,
  allowImmediateRetry = false,
  deferFinalCommit = false,
) {
  const currentHouse = ftCurrentHouse();
  ftSetDynamicBindFailureReason("");
  if (incomingBinds) {
    const incomingEntries = Array.isArray(incomingBinds)
      ? incomingBinds
      : [incomingBinds];
    ftCachedDynamicPlayerBinds[`${currentHouse}:${keyCode}`] =
      incomingEntries.length === 1 ? incomingEntries[0] : incomingEntries;
  }

  let candidates = ftDynamicBindCandidates(keyCode, currentHouse);
  if (candidates.length === 0 && !incomingBinds) {
    await ftLoadBindCache();
    candidates = ftDynamicBindCandidates(keyCode, currentHouse);
  }
  if (candidates.length === 0) {
    const reason = `Nenhum atalho ${keyCode} configurado para esta casa.`;
    ftSetDynamicBindFailureReason(reason);
    ftShowBindFeedback(reason);
    return false;
  }

  const teamAwareCandidates = candidates.filter(ftHasBindTeam);
  const eligible =
    teamAwareCandidates.length === 0
      ? candidates
      : candidates.filter(ftBindMatchesCurrentEvent);
  if (eligible.length === 0) {
    const reason = `Nenhuma bind da tecla ${keyCode} corresponde ao jogo atual.`;
    ftSetDynamicBindFailureReason(reason);
    ftShowBindFeedback(reason);
    return false;
  }
  if (eligible.length > 1) {
    const reason = `Há mais de uma bind da tecla ${keyCode} para este jogo. Use teclas diferentes.`;
    ftSetDynamicBindFailureReason(reason);
    ftShowBindFeedback(reason);
    return false;
  }
  const executionKey = `${currentHouse}:${keyCode}:${deferFinalCommit ? "prepare" : "execute"}`;
  const inFlight = ftDynamicExecutionInFlight.get(executionKey);
  if (inFlight) {
    console.debug(
      `[Fast Trigger Binds] Execução duplicada agrupada: ${executionKey}.`,
    );
    return inFlight;
  }

  const execution = Promise.resolve().then(() =>
    ftExecuteDynamicPlayerBind(
      eligible[0],
      keyCode,
      isHotkey,
      allowImmediateRetry,
      deferFinalCommit,
    ),
  );
  ftDynamicExecutionInFlight.set(executionKey, execution);
  ftNoteDynamicExecutionInFlight(1);
  try {
    return await execution;
  } finally {
    ftNoteDynamicExecutionInFlight(-1);
    if (ftDynamicExecutionInFlight.get(executionKey) === execution) {
      ftDynamicExecutionInFlight.delete(executionKey);
    }
  }
}

async function ftPrepareDynamicBindByKey(keyCode, incomingBinds = null) {
  const currentHouse = ftCurrentHouse();
  if (incomingBinds) {
    const incomingEntries = Array.isArray(incomingBinds)
      ? incomingBinds
      : [incomingBinds];
    ftCachedDynamicPlayerBinds[`${currentHouse}:${keyCode}`] =
      incomingEntries.length === 1 ? incomingEntries[0] : incomingEntries;
  }

  let candidates = ftDynamicBindCandidates(keyCode, currentHouse);
  if (candidates.length === 0 && !incomingBinds) {
    await ftLoadBindCache();
    candidates = ftDynamicBindCandidates(keyCode, currentHouse);
  }
  if (candidates.length === 0) {
    const reason = `Nenhum atalho ${keyCode} configurado para esta casa.`;
    ftSetDynamicBindFailureReason(reason);
    return { success: false, reason };
  }

  const eligible = candidates.filter(ftBindMatchesCurrentEvent);
  if (eligible.length !== 1) {
    const reason =
      eligible.length === 0
        ? `Nenhuma bind da tecla ${keyCode} corresponde ao jogo atual.`
        : `Há mais de uma bind da tecla ${keyCode} para este jogo.`;
    ftSetDynamicBindFailureReason(reason);
    return { success: false, reason };
  }

  const bind = eligible[0];
  const resolveCurrentTarget = () =>
    bind.targetType === "market_selection"
      ? ftResolveDynamicMarketSelectionBind(bind)
      : ftResolveDynamicPlayerBind(bind);

  // Caminho quente: na maior parte dos disparos o mercado e a seleção já
  // estão materializados. Resolver antes de rolar/expandir evita que a
  // pré-varredura da Bet365 segure o lote inteiro por 32–600ms.
  let resolved = ftCachedDynamicResolution(bind, keyCode) || resolveCurrentTarget();
  if (resolved.success) {
    ftRememberDynamicResolution(bind, keyCode, resolved);
    return resolved;
  }

  // Fallback preservado para mercados recolhidos ou listas virtualizadas.
  await ftPrepareDynamicBindMarket(bind);
  resolved = resolveCurrentTarget();
  if (resolved.success) ftRememberDynamicResolution(eligible[0], keyCode, resolved);
  if (!resolved.success) ftSetDynamicBindFailureReason(resolved.reason);
  return resolved;
}

function ftLoadBindCache() {
  if (
    typeof chrome === "undefined" ||
    !chrome.storage ||
    !chrome.storage.local ||
    !window.gbrUserScopedStorage
  )
    return;
  return window.gbrUserScopedStorage
    .get("local", ["ftQuickPresets", "dynamicPlayerBinds"])
    .then((res) => {
      ftCachedQuickPresets = res.ftQuickPresets || {};
      ftCachedDynamicPlayerBinds = res.dynamicPlayerBinds || {};
    })
    .catch(() => {
      ftCachedQuickPresets = {};
      ftCachedDynamicPlayerBinds = {};
    });
}

ftLoadBindCache();

if (
  typeof chrome !== "undefined" &&
  chrome.storage &&
  chrome.storage.onChanged
) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    if (
      Object.keys(changes).some(
        (key) =>
          key.endsWith("_ftQuickPresets") ||
          key.endsWith("_dynamicPlayerBinds"),
      )
    ) {
      ftLoadBindCache();
    }
  });
}

window.addEventListener(
  "keydown",
  (event) => {
    if (
      window !== window.top ||
      !event.isTrusted ||
      event.repeat ||
      event.metaKey ||
      (window.FastTriggerState &&
        window.FastTriggerState.bindingCaptureInProgress) ||
      (window.FastTriggerState &&
        window.FastTriggerState.nativeTextEntryInProgress) ||
      (window.FastTriggerState &&
        Date.now() - window.FastTriggerState.bootedAt < 2000)
    ) {
      return;
    }

    const activeEl = document.activeElement;
    if (
      activeEl &&
      (["INPUT", "TEXTAREA", "SELECT"].includes(activeEl.tagName) ||
        activeEl.isContentEditable)
    ) {
      return;
    }

    const currentHouse = ftCurrentHouse();
    const dynamicBinds = ftDynamicBindCandidates(event.code, currentHouse).filter((bind) =>
      ftBindMatchesKeyboardEvent(bind, event),
    );
    const fixedPreset = ftCachedQuickPresets[event.code];
    const fixedPresetAllowed = Boolean(
      fixedPreset && !event.ctrlKey && !event.altKey && !event.shiftKey,
    );
    if (dynamicBinds.length === 0 && !fixedPresetAllowed) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    if (window.FastTriggerState) {
      window.FastTriggerState.lastTrustedSelectionHotkeyAt = Date.now();
    }

    if (dynamicBinds.length > 0) {
      void ftExecuteDynamicPlayerBindByKey(event.code).catch((error) => {
        console.error(
          "[Fast Trigger Binds] Falha no atalho contextual:",
          error,
        );
      });
      return;
    }

    void (async () => {
      const targetName = fixedPreset.player || fixedPreset.selection || "";
      const targetOddVal = fixedPreset.line || fixedPreset.selection || "";
      const marketTitle = fixedPreset.market || "";
      const colIndex = fixedPreset.colIndex;
      const rowIndex = fixedPreset.rowIndex;

      if (typeof selectOddsOnPage === "function") {
        await selectOddsOnPage(
          targetName,
          targetOddVal,
          marketTitle,
          colIndex,
          rowIndex,
          true,
        );
      } else if (typeof window.selectOddsOnPage === "function") {
        await window.selectOddsOnPage(
          targetName,
          targetOddVal,
          marketTitle,
          colIndex,
          rowIndex,
          true,
        );
      } else {
        console.error("[Fast Trigger Binds] Motor de seleção não localizado.");
      }
    })();
  },
  true,
);

if (typeof window !== "undefined") {
  window.ftResolveDynamicPlayerBind = ftResolveDynamicPlayerBind;
  window.ftResolveDynamicMarketSelectionBind =
    ftResolveDynamicMarketSelectionBind;
  window.ftPlayerMarketMatch = ftPlayerMarketMatch;
  window.ftBindMatchesKeyboardEvent = ftBindMatchesKeyboardEvent;
  window.ftPrepareDynamicBindByKey = ftPrepareDynamicBindByKey;
  window.ftExecuteDynamicPlayerBindByKey = ftExecuteDynamicPlayerBindByKey;
  window.ftCommitArmedDynamicBind = ftCommitArmedDynamicBind;
}
