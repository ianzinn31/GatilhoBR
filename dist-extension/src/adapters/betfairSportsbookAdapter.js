// =========================================================================
// FAST TRIGGER PRO - ADAPTER BETFAIR SPORTSBOOK (HUMANIZER UNIVERSAL)
// =========================================================================

(function () {
  'use strict';

  // Mapeamento de Seletores Oficiais & Wildcards para Classes Ofuscadas da Betfair
  const ODD_BUTTON_SELECTOR = 'button.c84e4011151df22b-button, button[class*="-button"], button[class*="button"]:not([disabled]), .ui-runner-price, .runner-price, [data-runner-id], .market-tab-content button, [class*="runner"], [class*="Runner"], button[class*="price"], button[class*="Price"], [class*="selection-button"], [class*="odds-button"]';
  // Estrutura observada no Sportsbook atual: classes possuem hash, mas preservam
  // os sufixos semânticos marketContainer e market-container.
  const MARKET_CONTAINER_SELECTOR = '.d10cc4f3616ce879-card, ._9984e523e7deed39-card, [class*="marketContainer"], [class*="MarketContainer"], [class*="market-container"], [class*="market-card"], [data-market-id]';
  const BETFAIR_REAL_ODD_SELECTOR = [
    '.c84e4011151df22b-button',
    '.ui-runner-price',
    '.runner-price',
    '[data-runner-id]',
    '[data-selection-id]',
    '[data-outcome-id]',
    '[data-testid*="outcome" i]',
    '[data-testid*="odd" i]',
    '[data-testid*="price" i]',
    'button[class*="-button"]',
    'button[class*="price" i]',
    'button[class*="selection-button"]',
    'button[class*="odds-button"]',
    'button[class*="runner-price"]',
    'button[class*="RunnerPrice"]',
  ].join(', ');
  const BETFAIR_RUNNER_LINE_SELECTOR = [
    '._23865a2f4eba37e1-runnerLine',
    '._9e0669e8371c139a-gridRunnerLine',
    '[class*="gridRunnerLine"]',
    '[class*="-runnerLine"]',
    '[class*="runner-line"]',
    '[role="row"]',
  ].join(', ');
  const BETFAIR_GROUP_TITLE_SELECTOR = [
    'h2',
    'h3',
    'h4',
    'h5',
    '[class*="market-title"]',
    '[class*="marketTitle"]',
    '._88ecb80b8b4292b2-content',
    '[data-testid*="market-title" i]',
  ].join(', ');
  const BETFAIR_EXPAND_CONTROL_SELECTOR = [
    '[aria-expanded]',
    'button[aria-controls]',
    '[role="button"][aria-controls]',
    '[data-testid*="market-header" i]',
    '[class*="marketHeader"] button',
    '[class*="market-header"] button',
  ].join(', ');
  const BETFAIR_GROUP_CACHE_TTL_MS = 5000;
  // A aba completa da Betfair ("Todos os mercados") entrega todos os grupos
  // recolhidos. A varredura abre cada grupo uma única vez e o mantém aberto,
  // porque recolher de volta reintroduziria o ciclo de expandir/recolher e o
  // atraso do cache de 5 s em cima de odds ao vivo.
  const BETFAIR_ALL_MARKETS_LABEL_PATTERN = /todos\s+os\s+mercados|all\s+markets/i;
  const BETFAIR_ACTIVE_TAB_SELECTOR = [
    '[role="tab"][aria-selected="true"]',
    '[role="tab"][aria-current="true"]',
    '[role="tab"].active',
    '[aria-selected="true"]',
    '[class*="tab"][class*="active"]',
    '[class*="Tab"][class*="active"]',
    '[class*="tab"][class*="selected"]',
    '[class*="Tab"][class*="selected"]',
  ].join(', ');
  const BETFAIR_ACTIVE_TAB_LABEL_MAX = 60;
  const BETFAIR_SWEEP_BATCH_MIN = 4;
  const BETFAIR_SWEEP_BATCH_MAX = 12;
  const BETFAIR_SWEEP_MAX_GROUPS = 80;
  // Sem rótulo de aba reconhecido, a quantidade de grupos recolhidos com
  // controle seguro é a evidência estrutural de que a aba completa está aberta.
  const BETFAIR_SWEEP_COLLAPSED_HINT = 6;
  const BETFAIR_FAST_STAKE_TIMEOUT_MS = 450;
  const BETFAIR_FAST_SECOND_STAGE_TIMEOUT_MS = 320;
  const BETSLIP_CONTAINER = '.da9deec589aad14e-betslipCollapsed, [class*="betslip"], [class*="Betslip"], [id*="betslip"], .betslip-container, #betslip, .betslip-content';
  const STAKE_INPUT_SELECTOR = 'input[aria-label="Apostar"], input[placeholder="Apostar"], input[name="stake"], input[class*="stake"], input[class*="Stake"], input.ui-stake-input, .betslip-stake-input input';
  const BETFAIR_TRANSACTION_BUTTON_SELECTOR = [
    // Sportsbook atual: o botão transacional preserva estes sufixos, embora
    // o hash do componente mude entre releases.
    'button[class*="actionButton"]',
    'button[class*="transactional"]',
    '[data-testid="action-button-content"]',
  ].join(', ');
  const PLACE_BET_BUTTON_SELECTOR = `${BETFAIR_TRANSACTION_BUTTON_SELECTOR}, .ui-place-bets-button, button.place-bets-btn, button[data-action="place-bets"], button[class*="place-bet"], button[class*="PlaceBet"], button[class*="placeBets"], button[class*="-button"]:not([disabled])`;
  let cachedBetfairStakeInput = null;
  let cachedBetfairBetslipRoot = null;

  // Utilitários com fallback para o módulo humanizer.js global
  const jitter = (min, max) => (typeof randomJitter === 'function') ? randomJitter(min, max) : new Promise(r => setTimeout(r, min + Math.random() * (max - min)));
  const clickFn = async (el, isHotkey = false, fastMode = false) => (typeof simulateHumanClick === 'function') ? await simulateHumanClick(el, isHotkey, fastMode) : (el ? el.click() : false);
  const typeFn = async (el, val) => (typeof simulateHumanTyping === 'function') ? await simulateHumanTyping(el, val) : (el ? (el.value = val) : false);

  function normalizeBetfairStake(value) {
    return (value || '').toString().replace(/R\$/gi, '').trim().replace(',', '.');
  }

  function markBetfairExecutionStage(stage, details = {}) {
    const actionId = window.FastTriggerState?.activeExecutionActionId;
    if (!actionId) return null;
    return window.FastTriggerExecutionReport?.mark?.(actionId, stage, details) || null;
  }

  function finishBetfairExecution(outcome, details = {}) {
    const actionId = window.FastTriggerState?.activeExecutionActionId;
    if (!actionId) return null;
    return window.FastTriggerExecutionReport?.finish?.(actionId, outcome, details) || null;
  }

  function isReusableBetfairBetslipRoot(root) {
    if (!root || root.isConnected === false) return false;
    return typeof document.contains !== 'function' || document.contains(root);
  }

  function findBetfairBetslipRoot() {
    if (isReusableBetfairBetslipRoot(cachedBetfairBetslipRoot)) {
      return cachedBetfairBetslipRoot;
    }
    cachedBetfairBetslipRoot = document.querySelector?.(BETSLIP_CONTAINER) || null;
    return cachedBetfairBetslipRoot;
  }

  function isReusableBetfairStakeInput(input) {
    if (!input || input.isConnected === false || input.disabled || input.readOnly) return false;
    if (typeof document.contains === 'function' && !document.contains(input)) return false;
    if (input.getAttribute('aria-label') === 'Cotações') return false;
    return input.offsetWidth > 0 && input.offsetHeight > 0;
  }

  function findBetfairStakeInput() {
    if (isReusableBetfairStakeInput(cachedBetfairStakeInput)) {
      return cachedBetfairStakeInput;
    }
    cachedBetfairStakeInput = null;
    const betslipRoot = findBetfairBetslipRoot();
    const scopedInput = Array.from(betslipRoot?.querySelectorAll?.(STAKE_INPUT_SELECTOR) || [])
      .find(isReusableBetfairStakeInput) || null;
    cachedBetfairStakeInput = scopedInput || Array.from(document.querySelectorAll(STAKE_INPUT_SELECTOR))
      .find(isReusableBetfairStakeInput) || null;
    return cachedBetfairStakeInput;
  }

  async function waitForBetfairStakeInput(timeoutMs = 900, signalOnly = false) {
    const immediateInput = findBetfairStakeInput();
    if (immediateInput) return immediateInput;

    const domWaiter = signalOnly
      ? window.FastTriggerDom?.waitForSignal
      : window.FastTriggerDom?.waitFor;
    if (typeof domWaiter === 'function') {
      const betslipRoot = findBetfairBetslipRoot();
      return await domWaiter(
        () => findBetfairStakeInput(),
        {
          timeoutMs,
          intervalMs: 8,
          events: ['input', 'change', 'focusin'],
          root: betslipRoot || document,
        },
      );
    }
    return findBetfairStakeInput();
  }

  function setBetfairStakeOnInput(stakeInput, value) {
    if (!stakeInput) return false;

    const cleanVal = normalizeBetfairStake(value);
    const nativeValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (nativeValueSetter) {
      nativeValueSetter.call(stakeInput, cleanVal);
    } else {
      stakeInput.value = cleanVal;
    }

    stakeInput.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      composed: true,
      inputType: 'insertText',
      data: cleanVal
    }));
    stakeInput.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    stakeInput.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
    return normalizeBetfairStake(stakeInput.value) === cleanVal;
  }

  function setBetfairStakeFallback(value, stakeInput = null) {
    return setBetfairStakeOnInput(stakeInput || findBetfairStakeInput(), value);
  }

  async function setBetfairStakeHuman(value, fastMode = false) {
    const cleanVal = normalizeBetfairStake(value);
    const immediateInput = findBetfairStakeInput();
    if (fastMode && immediateInput) {
      return setBetfairStakeOnInput(immediateInput, cleanVal);
    }

    const stakeInput = await waitForBetfairStakeInput(
      fastMode ? BETFAIR_FAST_STAKE_TIMEOUT_MS : 900,
      fastMode,
    );
    if (!stakeInput) return false;

    if (fastMode) return setBetfairStakeOnInput(stakeInput, cleanVal);
    await typeFn(stakeInput, cleanVal);
    if (!fastMode) await new Promise(resolve => setTimeout(resolve, 20));

    if (normalizeBetfairStake(stakeInput.value) === cleanVal) {
      return true;
    }
    return setBetfairStakeFallback(cleanVal);
  }

  const BETFAIR_EXTRA_CONFIRM_KEYWORDS = [
    'confirmar',
    'finalizar',
    'concluir',
    'continuar',
  ];

  function normalizeBetfairButtonText(button) {
    return [
      button?.innerText,
      button?.textContent,
      button?.getAttribute?.('aria-label'),
      button?.getAttribute?.('title'),
    ]
      .filter(Boolean)
      .join(' ')
      .toString()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function isBetfairButtonAvailable(button) {
    if (!button || button.offsetWidth === 0 || button.offsetHeight === 0) return false;
    if (
      button.disabled ||
      button.hasAttribute('disabled') ||
      button.getAttribute('aria-disabled') === 'true' ||
      button.classList.contains('disabled') ||
      button.classList.contains('suspended') ||
      button.classList.contains('loading')
    ) return false;

    const text = normalizeBetfairButtonText(button);
    return Boolean(text) && !/cookie|privacidade|termos|sair|logout|login|criar aposta/.test(text);
  }

  function findBetfairActionButtons(includeGeneric = false) {
    const candidates = [];
    const seen = new Set();
    const append = (node) => {
      const button = node?.matches?.('button, [role="button"]')
        ? node
        : node?.closest?.('button, [role="button"]');
      if (!button || seen.has(button)) return;
      seen.add(button);
      candidates.push(button);
    };

    // Mantém o botão transacional real no topo da lista. Isso evita que a
    // aba "Criar Aposta" ou outros controles da página ganhem prioridade.
    document.querySelectorAll(BETFAIR_TRANSACTION_BUTTON_SELECTOR).forEach(append);
    document.querySelectorAll(PLACE_BET_BUTTON_SELECTOR).forEach(append);
    if (includeGeneric) {
      document.querySelectorAll('button, [role="button"]').forEach(append);
    }

    return candidates.filter(isBetfairButtonAvailable);
  }

  function isBetfairFinalConfirmationText(text) {
    const normalized = (text || '').toString().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return /confirmar|confirm|finalizar|concluir|continuar/.test(normalized);
  }

  function isBetfairSubmitText(text) {
    const normalized = (text || '').toString().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return [
      'fazer aposta',
      'apostar',
      'place bet',
      'place bets',
      'colocar aposta',
      'enviar aposta',
    ].some((keyword) => normalized.includes(keyword));
  }

  async function confirmBetfairBetHuman(fastMode = false, timeoutMs = 0) {
    const state = window.FastTriggerState;
    if (state?.betfairActionClickInProgress === true) return false;
    if (state) state.betfairActionClickInProgress = true;

    try {
      if (typeof window.resolveOddsChangeBeforeCommit === 'function') {
        const oddsChangeResult = await window.resolveOddsChangeBeforeCommit(fastMode);
        if (oddsChangeResult?.status === 'blocked') return false;
      }

      const chooseButton = (btns) => {
      const matching = btns.filter((btn) => {
        const txt = normalizeBetfairButtonText(btn);
        return isBetfairSubmitText(txt) || isBetfairFinalConfirmationText(txt);
      });

      // Se os dois estágios já estiverem montados, começa pelo botão de
      // submissão e deixa o segundo clique para a confirmação explícita.
      return matching.find((btn) => isBetfairSubmitText(normalizeBetfairButtonText(btn))) ||
        matching.find((btn) => isBetfairFinalConfirmationText(normalizeBetfairButtonText(btn))) ||
        null;
      };
      const findValidButton = () =>
        chooseButton(findBetfairActionButtons(false)) ||
        chooseButton(findBetfairActionButtons(true));

      const domWaiter = fastMode
        ? window.FastTriggerDom?.waitForSignal
        : window.FastTriggerDom?.waitFor;
      const validBtn = fastMode && typeof domWaiter === 'function'
        ? await domWaiter(
          findValidButton,
          { timeoutMs: timeoutMs || 650, events: ['click', 'input', 'change'] },
        )
        : findValidButton();

      if (!validBtn || typeof window.dispatchTrustedActionClick !== 'function') {
        console.error('[Betfair Adapter] Botão de confirmação não localizado ou motor nativo indisponível.');
        return false;
      }

      const firstText = normalizeBetfairButtonText(validBtn);
      markBetfairExecutionStage('cta', { reasonCode: 'betfair_cta_ready' });
      console.log(`[Betfair Adapter] CTA transacional localizado: "${firstText}".`);
      const firstResult = await window.dispatchTrustedActionClick(
        validBtn,
        fastMode,
        BETFAIR_EXTRA_CONFIRM_KEYWORDS,
        {
          financial: true,
          stage: 'commit',
          fastResponse: fastMode,
          keepDebuggerAttachedMs: fastMode ? BETFAIR_FAST_SECOND_STAGE_TIMEOUT_MS : 0,
        },
      );
      if (!firstResult?.success) return false;
      if (window.FastTriggerState) {
        window.FastTriggerState.lastDynamicBindFinalClickAttempted = true;
      }

    // Em algumas versões o primeiro clique apenas abre a confirmação final.
    // A Betfair recria o botão, portanto a referência anterior não é reutilizada.
    // Se o primeiro botão já era explicitamente final, preservamos o fluxo de
    // uma etapa e não arriscamos um segundo clique duplicado.
      if (isBetfairFinalConfirmationText(firstText)) return true;

      const configuredSecondTimeout = Number(window.FastTriggerConfig?.betfairSecondStageTimeoutMs);
      const secondTimeout = fastMode
        ? Math.min(900, Math.max(120,
          Number.isFinite(configuredSecondTimeout)
            ? configuredSecondTimeout
            : BETFAIR_FAST_SECOND_STAGE_TIMEOUT_MS,
        ))
        : Math.max(Number(timeoutMs) || 0, 2400);
      const findSecondButton = () => {
      const candidates = findBetfairActionButtons(false);
        return candidates.find((button) => {
        const text = normalizeBetfairButtonText(button);
        const isNewButton = button !== validBtn || text !== firstText;
        // A Betfair pode recriar o CTA mantendo o mesmo texto ou trocar o
        // texto para "Confirmar". Nos dois casos, só aceitamos um novo
        // botão transacional; nunca o botão de navegação "Criar Aposta".
        return isNewButton && (
          isBetfairFinalConfirmationText(text) ||
          isBetfairSubmitText(text)
        );
      }) || null;
      };

      const signalWaiter = window.FastTriggerDom?.waitForSignal;
      const pollingWaiter = window.FastTriggerDom?.waitFor;
      const secondButton = typeof signalWaiter === 'function'
        ? await signalWaiter(findSecondButton, {
          timeoutMs: secondTimeout,
          events: ['click', 'input', 'change'],
        })
        : typeof pollingWaiter === 'function'
          ? await pollingWaiter(findSecondButton, { timeoutMs: secondTimeout, intervalMs: 8 })
          : findSecondButton();

      if (!secondButton) {
        console.log('[Betfair Adapter] Primeiro CTA concluído sem segunda confirmação transacional visível.');
        return true;
      }

      console.log(`[Betfair Adapter] Segundo CTA transacional localizado: "${normalizeBetfairButtonText(secondButton)}".`);
      const secondResult = await window.dispatchTrustedActionClick(
        secondButton,
        fastMode,
        BETFAIR_EXTRA_CONFIRM_KEYWORDS,
        { financial: true, stage: 'commit', fastResponse: fastMode },
      );
      if (!secondResult?.success) {
        console.warn('[Betfair Adapter] Segunda confirmação apareceu, mas o clique não foi entregue.');
        return false;
      }

      console.log('[Betfair Adapter] Confirmação em duas etapas concluída.');
      return true;
    } finally {
      if (state) state.betfairActionClickInProgress = false;
    }
  }

  /**
   * Identifica se o card de mercado da Betfair usa o padrão 'grid' (linhas e colunas) ou 'flex' (lado a lado).
   * @param {Element} card 
   * @returns {'grid' | 'flex'}
   */
  function getMarketType(card) {
    if (!card) return 'flex';
    const hasGridLine = card.querySelector('._9e0669e8371c139a-gridRunnerLine, [class*="gridRunnerLine"], [class*="runnerLine"], [class*="runner-line"], [role="row"]');
    return hasGridLine ? 'grid' : 'flex';
  }

  function normalizeBetfairKey(value) {
    return (value || '')
      .toString()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 160);
  }

  function isBetfairPlayerMarketTitle(value) {
    const title = normalizeBetfairKey(value);
    return /(?:jogador|player|marcador|goalscorer|chutes|remates|finalizacoes|faltas|cartoes|assistencias|passes|desarmes|impedimentos)/.test(title);
  }

  // -------------------------------------------------------------------------
  // Memoização por quadro de leitura (scan frame)
  // -------------------------------------------------------------------------
  // Uma rodada de coleta lê o mesmo nó várias vezes: `findBetfairGroups`
  // confere as odds visíveis, o filtro de grupos confere outra vez e o parse
  // final relê célula por célula. Cada `innerText`/`getComputedStyle` força o
  // navegador a recalcular estilo e layout; na aba "Todos os mercados", com
  // dezenas de grupos abertos, isso vira centenas de milissegundos por rodada
  // e atrasa justamente o caminho que localiza o mercado da bind.
  // Dentro de um bloco síncrono o DOM não muda, então a leitura pode ser
  // reaproveitada. O quadro existe apenas entre `beginBetfairScanFrame` e
  // `endBetfairScanFrame` (sempre em código síncrono) e qualquer clique de
  // expansão o invalida.
  let betfairScanFrameToken = 1;
  let betfairScanFrameDepth = 0;
  const betfairFrameTextCache = new WeakMap();
  const betfairFrameVisibilityCache = new WeakMap();
  const betfairFrameLeafCache = new WeakMap();

  function beginBetfairScanFrame() {
    betfairScanFrameDepth += 1;
    return betfairScanFrameToken;
  }

  function endBetfairScanFrame() {
    betfairScanFrameDepth = Math.max(0, betfairScanFrameDepth - 1);
    if (betfairScanFrameDepth === 0) betfairScanFrameToken += 1;
  }

  function invalidateBetfairScanFrame() {
    betfairScanFrameToken += 1;
  }

  function readBetfairFrameCache(cache, node, slot) {
    if (betfairScanFrameDepth === 0 || !node || node.nodeType !== 1) return undefined;
    const entry = cache.get(node);
    if (!entry || entry.token !== betfairScanFrameToken) return undefined;
    return entry[slot];
  }

  function writeBetfairFrameCache(cache, node, slot, value) {
    if (betfairScanFrameDepth === 0 || !node || node.nodeType !== 1) return value;
    const entry = cache.get(node);
    if (entry && entry.token === betfairScanFrameToken) {
      entry[slot] = value;
    } else {
      cache.set(node, { token: betfairScanFrameToken, [slot]: value });
    }
    return value;
  }

  function readBetfairText(node) {
    const cached = readBetfairFrameCache(betfairFrameTextCache, node, 'text');
    if (cached !== undefined) return cached;
    const value = (node?.innerText || node?.textContent || '')
      .toString()
      .replace(/\s+/g, ' ')
      .trim();
    return writeBetfairFrameCache(betfairFrameTextCache, node, 'text', value);
  }

  function findOwnedBetfairGroupTitle(container) {
    if (!container) return null;
    return Array.from(container.querySelectorAll?.(BETFAIR_GROUP_TITLE_SELECTOR) || [])
      .find((title) =>
        title.closest?.(MARKET_CONTAINER_SELECTOR) === container &&
        Boolean(readBetfairText(title))
      ) || null;
  }

  function isBetfairElementVisible(node) {
    const cached = readBetfairFrameCache(betfairFrameVisibilityCache, node, 'visible');
    if (cached !== undefined) return cached;
    const value = computeBetfairElementVisibility(node);
    return writeBetfairFrameCache(betfairFrameVisibilityCache, node, 'visible', value);
  }

  function computeBetfairElementVisibility(node) {
    if (!node || node.hidden || node.getAttribute?.('aria-hidden') === 'true') return false;
    if (node.closest?.('[hidden], [aria-hidden="true"]')) return false;
    const style = typeof getComputedStyle === 'function' ? getComputedStyle(node) : null;
    if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
    if (node.offsetWidth > 0 || node.offsetHeight > 0) return true;
    return Boolean(node.getClientRects?.().length);
  }

  function betfairOddSemantic(node) {
    return [
      node?.getAttribute?.('data-testid'),
      node?.getAttribute?.('data-state'),
      node?.getAttribute?.('data-status'),
      node?.getAttribute?.('aria-label'),
      node?.className,
    ]
      .filter(Boolean)
      .join(' ')
      .toString()
      .toLowerCase();
  }

  function isBetfairSuspendedOdd(node) {
    const semantic = betfairOddSemantic(node);
    return Boolean(
      node?.disabled === true ||
      node?.hasAttribute?.('disabled') ||
      node?.getAttribute?.('aria-disabled') === 'true' ||
      /(?:^|[^a-z])(?:locked|suspended|disabled|unavailable)(?:[^a-z]|$)/.test(semantic) ||
      node?.querySelector?.('[class*="lock" i], [data-testid*="lock" i], svg[aria-label*="lock" i]')
    );
  }

  function isBetfairRealOddLeaf(node) {
    if (!node || node.nodeType !== 1) return false;
    if (node.closest?.(BETSLIP_CONTAINER)) return false;
    if (node.matches?.('[aria-expanded], [aria-controls]') && !node.matches?.('[data-runner-id], [data-selection-id], [data-outcome-id]')) {
      return false;
    }

    const semantic = betfairOddSemantic(node);
    const exactSelectorMatch = node.matches?.(BETFAIR_REAL_ODD_SELECTOR);
    const hasOddSemantics = /runner|selection|outcome|odds?|price/.test(semantic);
    const hasOddParts = Boolean(node.querySelector?.(
      '.c84e4011151df22b-label, [class*="-label"], [class*="supportingText"], [data-testid*="price" i]'
    ));
    const hasDecimal = /\b\d+(?:[.,]\d+)?\b/.test(readBetfairText(node));
    return Boolean(exactSelectorMatch && (hasOddSemantics || hasOddParts || hasDecimal || isBetfairSuspendedOdd(node)));
  }

  function getBetfairRealOddLeaves(root, visibleOnly = false) {
    if (!root) return [];
    const slot = visibleOnly ? 'leavesVisible' : 'leavesAll';
    const cached = readBetfairFrameCache(betfairFrameLeafCache, root, slot);
    if (cached !== undefined) return cached;
    const candidates = [];
    if (root.matches?.(BETFAIR_REAL_ODD_SELECTOR)) candidates.push(root);
    root.querySelectorAll?.(BETFAIR_REAL_ODD_SELECTOR).forEach((node) => candidates.push(node));
    const realCandidates = [...new Set(candidates)].filter((node) =>
      isBetfairRealOddLeaf(node) && (!visibleOnly || isBetfairElementVisible(node))
    );
    const leaves = realCandidates.filter((node) =>
      !realCandidates.some((other) => other !== node && node.contains?.(other))
    );
    return writeBetfairFrameCache(betfairFrameLeafCache, root, slot, leaves);
  }

  function extractBetfairDecimal(...values) {
    for (const value of values) {
      const match = (value || '').toString().match(/\b\d+(?:[.,]\d+)?\b/);
      if (match) return match[0].replace(',', '.');
    }
    return '';
  }

  function readRealBetfairOddLeaf(node, columnName = '') {
    if (!isBetfairRealOddLeaf(node)) return null;
    const locked = isBetfairSuspendedOdd(node);
    const oddsNode = node.querySelector?.(
      '.c84e4011151df22b-label, [class*="-label"], [data-testid*="price" i], [class*="Odds"]'
    );
    const nameNode = node.querySelector?.(
      '.c84e4011151df22b-supportingText, [class*="-supportingText"], [class*="runnerName"], [class*="selectionName"]'
    );
    const odds = extractBetfairDecimal(
      readBetfairText(oddsNode),
      node.getAttribute?.('data-odds'),
      node.getAttribute?.('data-price'),
      readBetfairText(node),
    );
    if (!odds && !locked) return null;

    const realName = readBetfairText(nameNode);
    const resolvedName = (columnName || realName || '').trim();
    const identityNode = node.closest?.('[data-outcome-id], [data-selection-id], [data-runner-id]');
    const outcomeId = node.getAttribute?.('data-outcome-id') ||
      node.getAttribute?.('data-selection-id') ||
      node.getAttribute?.('data-runner-id') ||
      identityNode?.getAttribute?.('data-outcome-id') ||
      identityNode?.getAttribute?.('data-selection-id') ||
      identityNode?.getAttribute?.('data-runner-id') || '';
    return {
      name: resolvedName,
      rawName: realName || resolvedName,
      colHeader: columnName || realName || '',
      val: odds,
      odds,
      element: node,
      status: locked ? 'suspended' : 'open',
      locked,
      actionable: !locked && Boolean(odds),
      isSuspended: locked,
      outcomeId: outcomeId || undefined,
    };
  }

  function readBetfairColumnIndex(node, fallbackIndex) {
    const sources = [node, node?.closest?.('[data-col-index], [data-column-index], [data-column], [aria-colindex]')];
    for (const source of sources) {
      if (!source) continue;
      const rawZeroBased = source.getAttribute?.('data-col-index') ?? source.getAttribute?.('data-column-index');
      if (rawZeroBased !== null && rawZeroBased !== undefined && rawZeroBased !== '') {
        const zeroBased = Number(rawZeroBased);
        if (Number.isInteger(zeroBased) && zeroBased >= 0) return zeroBased;
      }

      const ariaIndex = Number(source.getAttribute?.('aria-colindex'));
      if (Number.isInteger(ariaIndex) && ariaIndex > 0) return Math.max(0, ariaIndex - 2);

      const named = (source.getAttribute?.('data-column') || source.getAttribute?.('data-side') || '').toLowerCase();
      if (/^(left|back|over|yes)$/.test(named)) return 0;
      if (/^(middle|draw|under|no|lay)$/.test(named)) return 1;
      if (/^(right|away)$/.test(named)) return 2;
    }
    return Math.max(0, Number(fallbackIndex) || 0);
  }

  function collectBetfairRowSlots(lineElement) {
    const directChildren = Array.from(lineElement?.children || []);
    const structuralSlots = directChildren.filter((child) => {
      const semantic = betfairOddSemantic(child);
      return Boolean(
        child.matches?.('[role="cell"], [data-col-index], [data-column-index], [data-column], [data-side]') ||
        /runnercell|runner-cell|selectioncell|selection-cell|oddcell|odd-cell|pricecell|price-cell/.test(semantic) ||
        getBetfairRealOddLeaves(child, false).length > 0
      );
    });

    if (structuralSlots.length > 0) {
      return structuralSlots.flatMap((slot, slotIndex) => {
        const leaves = isBetfairRealOddLeaf(slot)
          ? [slot]
          : getBetfairRealOddLeaves(slot, false);
        if (leaves.length === 0) {
          return [{ index: readBetfairColumnIndex(slot, slotIndex), leaf: null }];
        }
        // Alguns layouts da Betfair envolvem todas as células reais da linha
        // em um único filho estrutural. Manter só a primeira folha fazia odds
        // válidas desaparecerem do snapshot.
        return leaves.map((leaf, leafIndex) => ({
          index: readBetfairColumnIndex(
            leaf,
            readBetfairColumnIndex(slot, slotIndex) + leafIndex,
          ),
          leaf,
        }));
      });
    }

    return getBetfairRealOddLeaves(lineElement, false).map((leaf, leafIndex) => ({
      index: readBetfairColumnIndex(leaf, leafIndex),
      leaf,
    }));
  }

  function buildSparseBetfairRow({ rowIndex, playerName, line, slots, headers = [] }) {
    const normalizedSlots = Array.isArray(slots) ? slots : [];
    const highestIndex = normalizedSlots.reduce(
      (max, slot) => Math.max(max, Number.isInteger(slot?.index) ? slot.index : -1),
      -1,
    );
    const columnCount = Math.max(headers.length, highestIndex + 1);
    const colOdds = Array.from({ length: columnCount }, () => null);
    normalizedSlots.forEach((slot, fallbackIndex) => {
      const index = Number.isInteger(slot?.index) ? slot.index : fallbackIndex;
      if (index < 0 || index >= colOdds.length) return;
      const value = Object.prototype.hasOwnProperty.call(slot || {}, 'value')
        ? slot.value
        : readRealBetfairOddLeaf(slot?.leaf, headers[index] || '');
      colOdds[index] = value || null;
    });

    return {
      rowIndex,
      playerKey: normalizeBetfairKey(playerName),
      playerName,
      line,
      lineLabel: playerName || line || '',
      columns: {
        left: colOdds[0] || null,
        middle: colOdds[1] || null,
        right: colOdds[2] || null,
      },
      colOdds,
      odds: colOdds,
    };
  }

  function classifyBetfairSnapshot(snapshot) {
    if (!snapshot) return 'empty';
    const rows = Array.isArray(snapshot.tableRows) ? snapshot.tableRows : [];
    const selections = rows.length > 0
      ? rows.flatMap((row) => row.colOdds || row.odds || [])
      : (snapshot.participants || snapshot.selections || []);
    const realSelections = selections.filter(Boolean);
    if (realSelections.length === 0) return 'empty';
    if (realSelections.every((selection) => selection.locked || selection.isSuspended || selection.status === 'suspended')) {
      return 'suspended';
    }
    if (rows.some((row) => (row.colOdds || row.odds || []).some((selection) => selection === null))) {
      return 'partial';
    }
    return 'complete';
  }

  function normalizeBetfairOddValue(value) {
    const parsed = Number((value ?? '').toString().replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
  }

  function resolveValidatedBetfairOddTarget(candidate, expectedOdd = '') {
    const button = candidate?.closest?.('button.c84e4011151df22b-button, button') || candidate;
    if (!button || button.isConnected === false) return null;
    if (typeof document.contains === 'function' && !document.contains(button)) return null;
    if (!isBetfairElementVisible(button) || isBetfairSuspendedOdd(button)) return null;

    const expected = normalizeBetfairOddValue(expectedOdd);
    if (expected !== null) {
      const snapshot = readRealBetfairOddLeaf(button);
      const actual = normalizeBetfairOddValue(snapshot?.val);
      if (actual === null || Math.abs(actual - expected) > 0.0001) return null;
    }
    return button;
  }

  function betfairMarketTitleMatches(market, marketTitle) {
    if (!marketTitle) return true;
    const expected = normalizeBetfairKey(marketTitle.replace(/\(.*?\)/g, ''));
    const actual = normalizeBetfairKey(
      market?.title || market?.marketTitle || market?.canonicalMarket || market?.canonicalKey || '',
    );
    return Boolean(
      expected && actual &&
      (expected === actual || expected.includes(actual) || actual.includes(expected))
    );
  }

  function betfairSelectionMatches(selection, targetName, targetOddVal) {
    if (!selection?.element || selection.locked || selection.isSuspended || selection.status === 'suspended') {
      return false;
    }
    const expectedOdd = normalizeBetfairOddValue(targetOddVal);
    const selectionOdd = normalizeBetfairOddValue(selection.val ?? selection.odds);
    if (expectedOdd !== null && (selectionOdd === null || Math.abs(selectionOdd - expectedOdd) > 0.0001)) {
      return false;
    }
    const expectedName = normalizeBetfairKey(targetName);
    if (!expectedName) return true;
    const actualName = normalizeBetfairKey([
      selection.name,
      selection.rawName,
      selection.colHeader,
      selection.optionLabel,
    ].filter(Boolean).join(' '));
    return !actualName || actualName.includes(expectedName) || expectedName.includes(actualName);
  }

  function findIndexedBetfairOddTarget(
    targetName,
    targetOddVal,
    marketTitle,
    colIndex = 0,
    rowIndex = -1,
    lineName = '',
  ) {
    const markets = window.FastTriggerMarketIndex?.getMarkets?.() || [];
    const matchingMarkets = markets.filter((market) => betfairMarketTitleMatches(market, marketTitle));
    const expectedRowLabel = normalizeBetfairKey(lineName || targetName);

    for (const market of matchingMarkets) {
      const rows = market?.tableRows || market?.rows || [];
      if (rows.length > 0) {
        const preferredRows = [];
        if (Number.isInteger(rowIndex) && rowIndex >= 0 && rows[rowIndex]) {
          preferredRows.push(rows[rowIndex]);
        }
        rows.forEach((row) => {
          if (preferredRows.includes(row)) return;
          const rowLabel = normalizeBetfairKey(
            row?.playerName || row?.lineLabel || row?.line || row?.playerKey || '',
          );
          if (!expectedRowLabel || rowLabel.includes(expectedRowLabel) || expectedRowLabel.includes(rowLabel)) {
            preferredRows.push(row);
          }
        });

        for (const row of preferredRows) {
          const selections = row?.colOdds || row?.odds || [];
          const indexedSelection = Number.isInteger(colIndex) && colIndex >= 0
            ? selections[colIndex]
            : null;
          const candidates = indexedSelection
            ? [indexedSelection, ...selections.filter((selection) => selection !== indexedSelection)]
            : selections;
          const match = candidates.find((selection) =>
            betfairSelectionMatches(selection, targetName, targetOddVal)
          );
          const resolved = resolveValidatedBetfairOddTarget(match?.element, targetOddVal);
          if (resolved) return resolved;
        }
      }

      const selections = market?.participants || market?.selections || [];
      const match = selections.find((selection) =>
        betfairSelectionMatches(selection, targetName, targetOddVal)
      );
      const resolved = resolveValidatedBetfairOddTarget(match?.element, targetOddVal);
      if (resolved) return resolved;
    }
    return null;
  }

  function betfairOddIdentity(odd, fallbackIndex = 0) {
    if (!odd) return '';
    const stableId = odd.outcomeId || odd.selectionId || odd.id || '';
    if (stableId) return `id:${stableId}`;
    return `semantic:${normalizeBetfairKey([
      odd.name,
      odd.rawName,
      odd.colHeader,
      odd.line,
    ].filter(Boolean).join('|')) || fallbackIndex}`;
  }

  function betfairSnapshotSelectionCount(snapshot) {
    const rows = snapshot?.tableRows || snapshot?.rows || [];
    if (rows.length > 0) {
      return rows.reduce(
        (total, row) => total + (row.colOdds || row.odds || []).filter(Boolean).length,
        0,
      );
    }
    return (snapshot?.participants || snapshot?.selections || []).filter(Boolean).length;
  }

  function mergeBetfairSimpleSnapshots(target, incoming) {
    const targetOdds = [...(target.participants || target.selections || [])].filter(Boolean);
    const incomingOdds = (incoming.participants || incoming.selections || []).filter(Boolean);
    const seen = new Set(targetOdds.map((odd, index) => betfairOddIdentity(odd, index)));
    incomingOdds.forEach((odd, index) => {
      const identity = betfairOddIdentity(odd, targetOdds.length + index);
      if (!identity || seen.has(identity)) return;
      seen.add(identity);
      targetOdds.push(odd);
    });
    target.participants = targetOdds;
    target.selections = targetOdds;
    target.captureState = classifyBetfairSnapshot(target);
    target.status = target.captureState === 'suspended' ? 'suspended' : 'open';
    return target;
  }

  function betfairTableHeaders(snapshot) {
    const headers = Array.isArray(snapshot?.headers) ? snapshot.headers : [];
    const dataHeaders = snapshot?.hasLabelsCol && headers.length > 0
      ? headers.slice(1)
      : headers;
    return dataHeaders.map((header) => readBetfairText({ textContent: header }));
  }

  function betfairTableRowIdentity(row, fallbackIndex = 0) {
    return normalizeBetfairKey(
      row?.playerKey || row?.playerName || row?.lineLabel || row?.line || '',
    ) || `row-${fallbackIndex}`;
  }

  function cloneSparseBetfairRow(row, columnCount) {
    const source = row?.colOdds || row?.odds || [];
    const colOdds = Array.from({ length: columnCount }, (_, index) => source[index] || null);
    return {
      ...row,
      colOdds,
      odds: colOdds,
      columns: {
        left: colOdds[0] || null,
        middle: colOdds[1] || null,
        right: colOdds[2] || null,
      },
    };
  }

  function mergeBetfairTableSnapshots(target, incoming) {
    const targetRows = target?.tableRows || target?.rows || [];
    const incomingRows = incoming?.tableRows || incoming?.rows || [];
    if (targetRows.length === 0 || incomingRows.length === 0) return null;

    const targetHeaders = betfairTableHeaders(target);
    const incomingHeaders = betfairTableHeaders(incoming);
    const normalizedTargetHeaders = targetHeaders.map(normalizeBetfairKey);
    const normalizedIncomingHeaders = incomingHeaders.map(normalizeBetfairKey);
    if (
      normalizedTargetHeaders.length > 0 &&
      normalizedIncomingHeaders.length > 0 &&
      (
        normalizedTargetHeaders.length !== normalizedIncomingHeaders.length ||
        normalizedTargetHeaders.some((header, index) => header !== normalizedIncomingHeaders[index])
      )
    ) {
      return null;
    }

    const columnCount = Math.max(
      targetHeaders.length,
      incomingHeaders.length,
      ...targetRows.map((row) => (row.colOdds || row.odds || []).length),
      ...incomingRows.map((row) => (row.colOdds || row.odds || []).length),
    );
    const mergedRows = targetRows.map((row) => cloneSparseBetfairRow(row, columnCount));
    const rowsByIdentity = new Map(
      mergedRows.map((row, index) => [betfairTableRowIdentity(row, index), row]),
    );

    incomingRows.forEach((incomingRow, incomingIndex) => {
      const identity = betfairTableRowIdentity(incomingRow, targetRows.length + incomingIndex);
      const existingRow = rowsByIdentity.get(identity);
      if (!existingRow) {
        const cloned = cloneSparseBetfairRow(incomingRow, columnCount);
        rowsByIdentity.set(identity, cloned);
        mergedRows.push(cloned);
        return;
      }

      const incomingCells = incomingRow.colOdds || incomingRow.odds || [];
      incomingCells.forEach((cell, columnIndex) => {
        if (!cell) return;
        const current = existingRow.colOdds[columnIndex];
        const currentLocked = current?.locked || current?.isSuspended || current?.status === 'suspended';
        const incomingOpen = !cell.locked && !cell.isSuspended && cell.status !== 'suspended';
        if (!current || (currentLocked && incomingOpen)) {
          existingRow.colOdds[columnIndex] = cell;
        }
      });
      existingRow.odds = existingRow.colOdds;
      existingRow.columns = {
        left: existingRow.colOdds[0] || null,
        middle: existingRow.colOdds[1] || null,
        right: existingRow.colOdds[2] || null,
      };
    });

    target.headers = target.headers?.length >= incoming.headers?.length
      ? target.headers
      : incoming.headers;
    target.tableRows = mergedRows;
    target.rows = mergedRows;
    target.captureState = classifyBetfairSnapshot(target);
    target.status = target.captureState === 'suspended'
      ? 'suspended'
      : target.captureState === 'partial' ? 'partial' : 'open';
    return target;
  }

  function consolidateBetfairSnapshots(snapshots) {
    const consolidated = new Map();
    (Array.isArray(snapshots) ? snapshots : []).forEach((snapshot) => {
      if (!snapshot) return;
      const canonical = normalizeBetfairKey(
        snapshot.canonicalMarket || snapshot.canonicalKey || snapshot.title,
      );
      const stableMarketKey = snapshot.stableMarketKey || snapshot.groupKey || '';
      const identity = [
        snapshot.eventKey || 'current-event',
        canonical || 'market',
        stableMarketKey ? normalizeBetfairKey(stableMarketKey) : 'semantic',
      ].join('::');
      const existing = consolidated.get(identity);
      if (!existing) {
        consolidated.set(identity, {
          ...snapshot,
          participants: snapshot.participants ? [...snapshot.participants] : snapshot.participants,
          selections: snapshot.selections ? [...snapshot.selections] : snapshot.selections,
          tableRows: snapshot.tableRows
            ? snapshot.tableRows.map((row) => cloneSparseBetfairRow(
              row,
              (row.colOdds || row.odds || []).length,
            ))
            : snapshot.tableRows,
        });
        return;
      }

      const existingIsTable = Boolean((existing.tableRows || existing.rows || []).length);
      const incomingIsTable = Boolean((snapshot.tableRows || snapshot.rows || []).length);
      if (!existingIsTable && !incomingIsTable) {
        mergeBetfairSimpleSnapshots(existing, snapshot);
        return;
      }

      if (existingIsTable && incomingIsTable && mergeBetfairTableSnapshots(existing, snapshot)) {
        return;
      }

      // Formatos incompatíveis não são combinados por índice. Mantemos o
      // snapshot real mais completo e, assim, nunca fabricamos células.
      if (betfairSnapshotSelectionCount(snapshot) > betfairSnapshotSelectionCount(existing)) {
        consolidated.set(identity, snapshot);
      }
    });
    return [...consolidated.values()];
  }

  function normalizeBetfairInterests(interests) {
    if (!Array.isArray(interests)) return [];
    return interests
      .map((interest) => typeof interest === 'string' ? { canonicalMarket: interest } : interest)
      .filter((interest) => interest && interest.canonicalMarket)
      .map((interest) => ({
        canonicalMarket: interest.canonicalMarket === '*' ? '*' : normalizeBetfairKey(interest.canonicalMarket),
        playerKey: normalizeBetfairKey(interest.playerKey || interest.player || ''),
        option: normalizeBetfairKey(interest.option || interest.selection || ''),
        line: interest.line ?? '',
      }))
      .filter((interest) => interest.canonicalMarket);
  }

  function clampBetfairBatchSize(value) {
    return Math.max(4, Math.min(8, Number(value) || 6));
  }

  function clampBetfairSweepBatchSize(value) {
    return Math.max(
      BETFAIR_SWEEP_BATCH_MIN,
      Math.min(BETFAIR_SWEEP_BATCH_MAX, Number(value) || 8),
    );
  }

  function clampBetfairSweepMaxGroups(value) {
    return Math.max(8, Math.min(160, Number(value) || BETFAIR_SWEEP_MAX_GROUPS));
  }

  function isBetfairAllMarketsLabel(value) {
    return BETFAIR_ALL_MARKETS_LABEL_PATTERN.test((value || '').toString());
  }

  /**
   * Lê os rótulos das abas marcadas como ativas no escopo informado.
   * A Betfair também usa `aria-selected` em sub-abas dentro do card, por isso o
   * chamador compara todos os rótulos em vez de confiar no primeiro encontrado.
   * @param {Element} [root]
   * @returns {string[]}
   */
  function readBetfairActiveViewLabels(root) {
    const scope = root || (typeof document !== 'undefined' ? document.body : null);
    if (!scope?.querySelectorAll) return [];
    return Array.from(scope.querySelectorAll(BETFAIR_ACTIVE_TAB_SELECTOR) || [])
      .map((node) => readBetfairText(node))
      .filter((text) => text && text.length <= BETFAIR_ACTIVE_TAB_LABEL_MAX);
  }

  function betfairGroupMatchesInterest(groupRef, interests) {
    const normalized = normalizeBetfairInterests(interests);
    if (normalized.length === 0) return false;
    const marketKey = normalizeBetfairKey(groupRef?.canonicalMarket || groupRef?.title || '');
    return normalized.some((interest) =>
      interest.canonicalMarket === '*' ||
      interest.canonicalMarket === marketKey ||
      (interest.canonicalMarket.length >= 4 && marketKey.includes(interest.canonicalMarket)) ||
      (marketKey.length >= 4 && interest.canonicalMarket.includes(marketKey))
    );
  }

  class BetfairSportsbookAdapter {
    constructor() {
      this.siteName = 'Betfair';
      this.expansionMode = 'expand-needed';
      this.restoreCollapsedGroups = true;
      this.expansionInFlight = false;
      this.groupRegistry = new Map();
      this.eventExpansionQueues = new Map();
      this.groupCacheTtlMs = BETFAIR_GROUP_CACHE_TTL_MS;
      // Varredura da aba completa: ligada por padrão e desligável por config.
      this.sweepAllMarkets = true;
      this.sweepLedgers = new Map();
    }

    /**
     * Identifica a visão ativa da página para separar varreduras por aba.
     * @param {Element} [root]
     * @returns {string}
     */
    resolveBetfairViewKey(root) {
      const labels = readBetfairActiveViewLabels(root);
      const allMarketsLabel = labels.find(isBetfairAllMarketsLabel);
      return normalizeBetfairKey(allMarketsLabel || labels[0] || 'default-view') || 'default-view';
    }

    /**
     * Decide se a aba completa de mercados está aberta. Usa o rótulo da aba
     * ativa e, como as classes da Betfair têm hash, cai para a evidência
     * estrutural de vários grupos recolhidos com controle seguro.
     * @param {Element} [root]
     * @param {Array} [refs] grupos já localizados, para não repetir a varredura do DOM
     * @returns {boolean}
     */
    isAllMarketsViewActive(root, refs = null) {
      if (readBetfairActiveViewLabels(root).some(isBetfairAllMarketsLabel)) return true;
      const groups = Array.isArray(refs) ? refs : this.findBetfairGroups(root, {});
      const collapsedWithControl = groups.filter((groupRef) =>
        groupRef?.state === 'collapsed' &&
        this.isSafeExpandControl(groupRef.expandControl, groupRef.container, groupRef.header)
      );
      return collapsedWithControl.length >= BETFAIR_SWEEP_COLLAPSED_HINT;
    }

    /**
     * Registro dos grupos já abertos pela varredura no escopo atual.
     * Trocar de evento ou de aba começa uma varredura nova.
     * @param {string} scopeKey
     * @returns {Set<string>}
     */
    getSweepLedger(scopeKey) {
      if (!this.sweepLedgers.has(scopeKey)) {
        this.sweepLedgers.clear();
        this.sweepLedgers.set(scopeKey, new Set());
      }
      return this.sweepLedgers.get(scopeKey);
    }

    /**
     * Indica que há execução em voo e a varredura deve ceder a vez. A leitura
     * de mercado e a preparação da bind dividem a mesma fila serial por evento;
     * sem esta pausa a tecla espera a rodada inteira de aberturas terminar.
     * @returns {boolean}
     */
    shouldYieldSweepToExecution() {
      const state = window.FastTriggerState || {};
      return state.backgroundDispatchInProgress === true ||
        Number(state.dynamicBindExecutionsInFlight) > 0;
    }

    /**
     * Verifica se o hostname pertence ao Betfair Sportsbook.
     * @param {string} hostname 
     * @returns {boolean}
     */
    static isMatchingSite(hostname) {
      if (!hostname) return false;
      const host = hostname.toLowerCase();
      return host.includes('betfair.com') || host.includes('betfair.bet.br') || host.includes('betfair.es');
    }

    getEventKey() {
      if (typeof window.FastTriggerGetEventIdentity === 'function') {
        const eventIdentity = window.FastTriggerGetEventIdentity();
        if (eventIdentity) return eventIdentity;
      }
      return `betfair:${normalizeBetfairKey(`${window.location?.pathname || ''}:${window.location?.search || ''}`) || 'current-event'}`;
    }

    getGroupTitle(node, ownedTitleElement = null) {
      const titleElement = ownedTitleElement ||
        findOwnedBetfairGroupTitle(node) ||
        node?.querySelector?.(BETFAIR_GROUP_TITLE_SELECTOR);
      let title = readBetfairText(titleElement).split('\n')[0].trim();
      if (!title || title.toUpperCase() === 'POPULAR') {
        const cardText = readBetfairText(node).toLowerCase();
        if (cardText.includes('gols') || cardText.includes('mais de') || cardText.includes('menos de')) {
          title = 'Mais/menos gols';
        } else if (cardText.includes('escanteios') || cardText.includes('cantos')) {
          title = 'Escanteios / Cartões';
        } else if (cardText.includes('resultado') || cardText.includes('vencedor')) {
          title = 'Resultado Final';
        } else {
          title = 'Mercados Principais (Betfair)';
        }
      }

      const activeSubTab = readBetfairText(node?.querySelector?.(
        '.a7eeca05e87a18d5-pebbleListContainer ._73f692d46fddfae4-active, ._73f692d46fddfae4-active, [aria-selected="true"]'
      ));
      const fullTitle = activeSubTab && !title.toLowerCase().includes(activeSubTab.toLowerCase())
        ? `${title} (${activeSubTab})`
        : title;
      return fullTitle.slice(0, 160);
    }

    resolveExpandControl(node, titleElement = null) {
      if (!node) return null;
      const title = titleElement || node.querySelector?.(BETFAIR_GROUP_TITLE_SELECTOR);
      const candidates = [
        title?.closest?.('[aria-expanded], button[aria-controls], [role="button"][aria-controls]'),
        title?.closest?.('button, [role="button"]'),
        ...Array.from(node.querySelectorAll?.(BETFAIR_EXPAND_CONTROL_SELECTOR) || []),
      ].filter(Boolean);
      return candidates.find((control) => this.isSafeExpandControl(control, node, title)) || null;
    }

    isSafeExpandControl(control, container, titleElement = null) {
      if (!control || !container || !container.contains?.(control)) return false;
      if (control.closest?.(BETSLIP_CONTAINER)) return false;
      if (isBetfairRealOddLeaf(control) || control.closest?.(BETFAIR_REAL_ODD_SELECTOR)) return false;

      const title = titleElement || container.querySelector?.(BETFAIR_GROUP_TITLE_SELECTOR);
      const ariaExpanded = control.getAttribute?.('aria-expanded');
      const semantic = [
        control.getAttribute?.('data-testid'),
        control.getAttribute?.('aria-label'),
        control.getAttribute?.('title'),
        control.className,
      ].filter(Boolean).join(' ').toLowerCase();
      return Boolean(
        ariaExpanded === 'true' ||
        ariaExpanded === 'false' ||
        /market.*(?:header|group)|(?:expand|collapse|accordion)/.test(semantic) ||
        (title && (control === title || control.contains?.(title)))
      );
    }

    hasVisibleRealOdds(container) {
      return getBetfairRealOddLeaves(container, true).length > 0;
    }

    resolveGroupState(container, expandControl) {
      const ariaExpanded = expandControl?.getAttribute?.('aria-expanded') ?? container?.getAttribute?.('aria-expanded');
      const hasVisibleOdds = this.hasVisibleRealOdds(container);
      if (ariaExpanded === 'true') return hasVisibleOdds ? 'expanded' : 'opening';
      if (ariaExpanded === 'false') return 'collapsed';
      if (hasVisibleOdds) return 'expanded';
      return expandControl ? 'unknown' : 'unknown';
    }

    findBetfairGroups(root, options = {}) {
      beginBetfairScanFrame();
      try {
        return this.collectBetfairGroupRefs(root, options);
      } finally {
        endBetfairScanFrame();
      }
    }

    collectBetfairGroupRefs(root, options = {}) {
      const targetRoot = root || document.body;
      if (!targetRoot) return [];
      const eventKey = options.eventKey || this.getEventKey();
      let activePanel = targetRoot.querySelector?.(
        'div[role="tabpanel"]._53517a6b5d288462-visible, ._53517a6b5d288462-visible, [role="tabpanel"]:not([hidden])'
      ) || targetRoot;
      let marketNodes = Array.from(activePanel.querySelectorAll?.(MARKET_CONTAINER_SELECTOR) || []);
      if (marketNodes.length === 0 && activePanel !== targetRoot) {
        activePanel = targetRoot;
        marketNodes = Array.from(activePanel.querySelectorAll?.(MARKET_CONTAINER_SELECTOR) || []);
      }
      if (marketNodes.length === 0) {
        marketNodes = Array.from(activePanel.querySelectorAll?.(BETFAIR_GROUP_TITLE_SELECTOR) || [])
          .map((title) => title.closest?.('section, article'))
          .filter(Boolean);
      }

      const ownedGroupNodes = marketNodes.filter((container) => {
        const titleElement = findOwnedBetfairGroupTitle(container);
        const hasStableMarketKey = Boolean(
          container?.getAttribute?.('data-market-id') ||
          container?.getAttribute?.('data-market-key') ||
          container?.id,
        );
        if (hasStableMarketKey) {
          const ownsRealOdds = getBetfairRealOddLeaves(container, false).some((leaf) =>
            leaf.closest?.(MARKET_CONTAINER_SELECTOR) === container
          );
          if (!titleElement && !ownsRealOdds && !this.resolveExpandControl(container)) return false;
          return true;
        }
        if (!titleElement) return false;
        return this.hasVisibleRealOdds(container) ||
          Boolean(this.resolveExpandControl(container, titleElement));
      });
      // Compatibilidade com versões antigas do DOM: só usa o conjunto amplo
      // quando nenhum grupo estrutural puder ser reconhecido.
      if (ownedGroupNodes.length > 0) marketNodes = ownedGroupNodes;

      const seenContainers = new Set();
      const canonicalOrdinals = new Map();
      const refs = [];
      marketNodes.forEach((container, index) => {
        if (!container || seenContainers.has(container)) return;
        seenContainers.add(container);
        const titleElement = findOwnedBetfairGroupTitle(container) ||
          container.querySelector?.(BETFAIR_GROUP_TITLE_SELECTOR);
        const title = this.getGroupTitle(container, titleElement);
        const canonicalMarket = normalizeBetfairKey(title);
        const marketKey = (
          container.getAttribute?.('data-market-id') ||
          container.getAttribute?.('data-market-key') ||
          container.id ||
          ''
        ).toString();
        const canonicalOrdinal = canonicalOrdinals.get(canonicalMarket) || 0;
        canonicalOrdinals.set(canonicalMarket, canonicalOrdinal + 1);
        const generatedKey = canonicalOrdinal > 0
          ? `${canonicalMarket || 'market'}-${canonicalOrdinal}`
          : canonicalMarket || `market-${index}`;
        const groupKey = normalizeBetfairKey(marketKey || generatedKey);
        const identity = `${eventKey}::${groupKey}::${canonicalMarket}`;
        const previous = this.groupRegistry.get(identity) || {};
        const expandControl = this.resolveExpandControl(container, titleElement);
        const state = this.resolveGroupState(container, expandControl);
        const ref = {
          ...previous,
          eventKey,
          groupKey,
          marketKey: marketKey || undefined,
          stableMarketKey: marketKey || undefined,
          canonicalMarket,
          identity,
          title,
          header: titleElement || expandControl || container,
          expandControl,
          container,
          state,
          // Guardado aqui porque `resolveGroupState` já pagou esta leitura: o
          // filtro de grupos pendentes reaproveita o resultado em vez de
          // varrer as células do mercado outra vez.
          hasVisibleOdds: this.hasVisibleRealOdds(container),
          wasExpanded: state === 'expanded' || state === 'opening',
          attempts: Number(previous.attempts) || 0,
          lastSnapshotHash: previous.lastSnapshotHash,
          lastCollectedAt: previous.lastCollectedAt,
          snapshot: previous.snapshot,
        };
        this.groupRegistry.set(identity, ref);
        refs.push(ref);
      });
      return refs;
    }

    readActualColumnHeaders(node) {
      const title = normalizeBetfairKey(this.getGroupTitle(node));
      const candidates = Array.from(node?.querySelectorAll?.(
        '[role="columnheader"], [data-testid*="column-header" i], [class*="columnHeader"], [class*="column-header"]'
      ) || []);
      const headers = candidates
        .map(readBetfairText)
        .filter((text) => text && normalizeBetfairKey(text) !== title);
      if (headers.length > 0) return [...new Set(headers)];

      const headerNode = node?.querySelector?.('[class*="marketHeader"], [class*="-marketHeader"]');
      const headerText = (headerNode?.innerText || headerNode?.textContent || '').toString();
      return headerText
        .split(/\n+/)
        .map((text) => text.trim())
        .filter((text) => text && normalizeBetfairKey(text) !== title && text.length <= 40);
    }

    parseBetfairMarketNode(node, groupRef) {
      if (!node || !groupRef) return null;
      const base = {
        title: groupRef.title,
        eventKey: groupRef.eventKey,
        groupKey: groupRef.groupKey,
        marketKey: groupRef.marketKey || groupRef.groupKey,
        stableMarketKey: groupRef.stableMarketKey,
        dedupeKey: `${groupRef.canonicalMarket}:${groupRef.groupKey}`,
        canonicalKey: groupRef.canonicalMarket,
        canonicalMarket: groupRef.canonicalMarket,
        groupState: groupRef.state,
        isPlayerMarket: isBetfairPlayerMarketTitle(groupRef.title),
        marketRoot: node,
      };

      if (getMarketType(node) === 'grid') {
        const allRunnerLines = Array.from(node.querySelectorAll?.(BETFAIR_RUNNER_LINE_SELECTOR) || []);
        const runnerLines = allRunnerLines.filter((line) =>
          !allRunnerLines.some((other) => other !== line && line.contains?.(other))
        );
        const preparedRows = runnerLines.map((lineElement, rowIndex) => {
          const nameElement = lineElement.querySelector?.(
            '._23865a2f4eba37e1-runnerName, .c84e4011151df22b-supportingText, [class*="-supportingText"], [class*="runner-name"], [class*="runnerName"], [data-testid*="runner-name" i]'
          );
          return {
            lineElement,
            rowIndex,
            playerName: readBetfairText(nameElement),
            slots: collectBetfairRowSlots(lineElement),
          };
        }).filter((row) => row.slots.length > 0);
        const observedColumnCount = preparedRows.reduce((max, row) =>
          Math.max(max, ...row.slots.map((slot) => Number(slot.index) + 1)),
        0);
        let headers = this.readActualColumnHeaders(node);
        if (observedColumnCount > 0 && headers.length > observedColumnCount) {
          // Cabeçalhos ARIA frequentemente incluem a coluna textual do jogador.
          // Ela é real, mas não é uma célula de odd e não entra em colOdds.
          headers = headers.slice(headers.length - observedColumnCount);
        }
        const tableRows = [];
        preparedRows.forEach(({ lineElement, rowIndex, playerName, slots }) => {
          const row = buildSparseBetfairRow({
            rowIndex,
            playerName,
            line: lineElement.getAttribute?.('data-line') || playerName,
            slots,
            headers,
          });
          if (row.colOdds.some(Boolean)) tableRows.push(row);
        });

        if (tableRows.length > 0) {
          const columnCount = Math.max(headers.length, ...tableRows.map((row) => row.colOdds.length));
          tableRows.forEach((row) => {
            while (row.colOdds.length < columnCount) row.colOdds.push(null);
            row.odds = row.colOdds;
            row.columns = {
              left: row.colOdds[0] || null,
              middle: row.colOdds[1] || null,
              right: row.colOdds[2] || null,
            };
          });
          const snapshot = {
            ...base,
            isTable: true,
            hasLabelsCol: true,
            headers: ['Linha', ...headers],
            tableRows,
            rows: tableRows,
          };
          snapshot.captureState = classifyBetfairSnapshot(snapshot);
          snapshot.status = snapshot.captureState === 'suspended'
            ? 'suspended'
            : snapshot.captureState === 'partial' ? 'partial' : 'open';
          return snapshot;
        }
      }

      const participants = getBetfairRealOddLeaves(node, true)
        .map((leaf) => readRealBetfairOddLeaf(leaf))
        .filter(Boolean);
      if (participants.length === 0) return null;
      const snapshot = {
        ...base,
        isTable: false,
        participants,
        selections: participants,
      };
      snapshot.captureState = classifyBetfairSnapshot(snapshot);
      snapshot.status = snapshot.captureState === 'suspended' ? 'suspended' : 'open';
      return snapshot;
    }

    snapshotSignature(snapshot) {
      if (!snapshot) return '';
      const rows = (snapshot.tableRows || []).map((row) => ({
        label: row.lineLabel,
        odds: (row.colOdds || []).map((odd) => odd
          ? [odd.name, odd.val || odd.odds || '', odd.status, odd.locked === true]
          : null),
      }));
      const selections = (snapshot.participants || snapshot.selections || []).map((odd) => [
        odd?.name,
        odd?.val || odd?.odds || '',
        odd?.status,
        odd?.locked === true,
      ]);
      return JSON.stringify({ title: snapshot.title, rows, selections });
    }

    rememberGroupSnapshot(groupRef, snapshot) {
      if (!groupRef || !snapshot) return;
      const collectedAt = Date.now();
      groupRef.snapshot = snapshot;
      groupRef.lastSnapshotHash = this.snapshotSignature(snapshot);
      groupRef.lastCollectedAt = collectedAt;
      snapshot.lastCollectedAt = collectedAt;
      this.groupRegistry.set(groupRef.identity, groupRef);
    }

    /**
     * Executa a raspagem de mercados no Sportsbook da Betfair separando por Padrão 'grid' e 'flex'.
     * @param {Element} [root] 
     * @returns {Array}
     */
    scrapeClean(root, options = {}) {
      const targetRoot = root || document.body;
      if (!targetRoot) return [];
      const results = [];
      const seenIdentities = new Set();

      beginBetfairScanFrame();
      try {
        // `refs` chega pronto quando a rodada de coleta já varreu o DOM e não
        // clicou em nada: repetir a varredura completa dobraria o custo da
        // aba "Todos os mercados" sem trazer informação nova.
        const refs = Array.isArray(options.refs) && options.refs.length > 0
          ? options.refs
          : this.findBetfairGroups(targetRoot, options);
        refs.forEach((groupRef) => {
          if (seenIdentities.has(groupRef.identity)) return;
          seenIdentities.add(groupRef.identity);
          let snapshot = null;
          if (this.hasVisibleRealOdds(groupRef.container)) {
            snapshot = this.parseBetfairMarketNode(groupRef.container, groupRef);
            if (snapshot) this.rememberGroupSnapshot(groupRef, snapshot);
          } else if (groupRef.snapshot) {
            snapshot = {
              ...groupRef.snapshot,
              groupState: groupRef.state,
              fromCollapsedCache: true,
            };
          }
          if (snapshot) results.push(snapshot);
        });
      } catch (error) {
        console.warn('[Fast Trigger] Erro no scrape Betfair:', error);
      } finally {
        endBetfairScanFrame();
      }
      return consolidateBetfairSnapshots(results);
    }

    /**
     * Decide se um grupo ainda precisa de um clique de expansão sem pagar um
     * parse completo do mercado. A versão antiga usava `attemptGroupCapture`,
     * que parseia e assina cada grupo visível só para descartar o resultado —
     * com dezenas de mercados abertos isso duplicava o custo de cada rodada.
     * @param {object} groupRef
     * @returns {boolean}
     */
    isGroupPendingExpansion(groupRef) {
      if (!groupRef) return false;
      const hasVisibleOdds = typeof groupRef.hasVisibleOdds === 'boolean'
        ? groupRef.hasVisibleOdds
        : this.hasVisibleRealOdds(groupRef.container);
      // Já mostra odds reais: o snapshot sai do DOM ao vivo no `scrapeClean`.
      if (hasVisibleOdds) return false;
      const cacheIsFresh = groupRef.snapshot &&
        Date.now() - Number(groupRef.lastCollectedAt || 0) <= this.groupCacheTtlMs;
      if (cacheIsFresh) return false;
      if (groupRef.state === 'collapsed') return true;
      return groupRef.state === 'unknown' && Boolean(groupRef.expandControl);
    }

    attemptGroupCapture(groupRef) {
      if (!groupRef) return { state: 'empty', snapshot: null };
      if (this.hasVisibleRealOdds(groupRef.container)) {
        const snapshot = this.parseBetfairMarketNode(groupRef.container, groupRef);
        if (snapshot) {
          this.rememberGroupSnapshot(groupRef, snapshot);
          return { state: classifyBetfairSnapshot(snapshot), snapshot };
        }
      }

      const cacheIsFresh = groupRef.snapshot &&
        Date.now() - Number(groupRef.lastCollectedAt || 0) <= this.groupCacheTtlMs;
      if (cacheIsFresh) {
        return { state: classifyBetfairSnapshot(groupRef.snapshot), snapshot: groupRef.snapshot };
      }
      if (groupRef.state === 'collapsed') return { state: 'collapsed-unread', snapshot: null };
      if (groupRef.state === 'unknown' && groupRef.expandControl) {
        return { state: 'collapsed-unread', snapshot: null };
      }
      return { state: groupRef.state === 'opening' ? 'empty' : 'empty', snapshot: null };
    }

    refreshGroupRef(groupRef, root) {
      // O contêiner segue no documento em praticamente toda checagem de
      // estabilidade (uma a cada 25ms). Reconferir o estado no próprio nó custa
      // uma leitura; varrer a página inteira custa todos os grupos abertos.
      const container = groupRef?.container;
      if (container?.isConnected) {
        const expandControl = groupRef.expandControl?.isConnected
          ? groupRef.expandControl
          : this.resolveExpandControl(container);
        groupRef.expandControl = expandControl;
        groupRef.state = this.resolveGroupState(container, expandControl);
        groupRef.hasVisibleOdds = this.hasVisibleRealOdds(container);
        this.groupRegistry.set(groupRef.identity, groupRef);
        return groupRef;
      }
      return this.findBetfairGroups(root, { eventKey: groupRef.eventKey }).find((candidate) =>
        candidate.groupKey === groupRef.groupKey && candidate.canonicalMarket === groupRef.canonicalMarket
      ) || groupRef;
    }

    async waitForBetfairGroupStable(groupRef, expanded, options = {}) {
      const root = options.root || document.body;
      const timeoutMs = Math.max(100, Math.min(2000, Number(options.timeoutMs) || 900));
      return await new Promise((resolve) => {
        let observer = null;
        let intervalId = null;
        let timeoutId = null;
        let stableChecks = 0;
        const cleanup = () => {
          observer?.disconnect?.();
          if (intervalId) clearInterval(intervalId);
          if (timeoutId) clearTimeout(timeoutId);
        };
        const check = () => {
          const current = this.refreshGroupRef(groupRef, root);
          const ariaExpanded = current.expandControl?.getAttribute?.('aria-expanded');
          const hasOdds = this.hasVisibleRealOdds(current.container);
          const reached = expanded
            ? (ariaExpanded === 'true' || current.state === 'expanded') && hasOdds
            : ariaExpanded === 'false' || (!hasOdds && current.state === 'collapsed');
          stableChecks = reached ? stableChecks + 1 : 0;
          if (stableChecks < 2) return;
          cleanup();
          resolve(current);
        };

        if (typeof MutationObserver === 'function') {
          observer = new MutationObserver(check);
          observer.observe(groupRef.container || root, { childList: true, subtree: true, attributes: true });
        }
        intervalId = setInterval(check, 25);
        timeoutId = setTimeout(() => {
          cleanup();
          resolve(null);
        }, timeoutMs);
        check();
      });
    }

    toggleBetfairGroup(groupRef, expanded) {
      const current = this.refreshGroupRef(groupRef, groupRef.container?.ownerDocument?.body || document.body);
      const control = current.expandControl;
      if (!this.isSafeExpandControl(control, current.container, current.header)) return false;
      const ariaExpanded = control.getAttribute?.('aria-expanded');
      if ((expanded && ariaExpanded === 'true') || (!expanded && ariaExpanded === 'false')) return true;

      const state = window.FastTriggerState || (window.FastTriggerState = {});
      const previousExpansionClick = state.betfairExpansionClickInProgress;
      state.betfairExpansionClickInProgress = true;
      control.setAttribute?.('data-fast-trigger-expand-click', 'true');
      try {
        control.click();
        return true;
      } finally {
        control.removeAttribute?.('data-fast-trigger-expand-click');
        state.betfairExpansionClickInProgress = previousExpansionClick === true;
        // O clique muda visibilidade e conteúdo do grupo: nenhuma leitura
        // memoizada antes dele pode ser reaproveitada depois.
        invalidateBetfairScanFrame();
      }
    }

    enqueueBetfairEvent(eventKey, operation) {
      const previous = this.eventExpansionQueues.get(eventKey) || Promise.resolve();
      const current = previous.catch(() => {}).then(operation);
      this.eventExpansionQueues.set(eventKey, current);
      return current.finally(() => {
        if (this.eventExpansionQueues.get(eventKey) === current) {
          this.eventExpansionQueues.delete(eventKey);
        }
      });
    }

    async collectExpandedMarkets(options = {}) {
      const root = options.root || document.body;
      const eventKey = options.eventKey || this.getEventKey();
      const interests = normalizeBetfairInterests(options.interests || []);
      const restoreRequested = options.restoreOriginal !== false && this.restoreCollapsedGroups !== false;
      const maxGroups = clampBetfairSweepMaxGroups(options.maxGroups);

      return await this.enqueueBetfairEvent(eventKey, async () => {
        // Toda a seleção de candidatos é síncrona: um único quadro de leitura
        // cobre a varredura do DOM e o filtro de pendências.
        let refs;
        let sweepEnabled;
        let sweepScope;
        let ledger;
        let restoreOriginal;
        let batchSize;
        let pendingTotal = 0;
        let candidates;
        beginBetfairScanFrame();
        try {
          refs = this.findBetfairGroups(root, { eventKey });
          sweepEnabled = options.sweepAll === true || (
            options.sweepAll !== false &&
            this.sweepAllMarkets !== false &&
            this.isAllMarketsViewActive(root, refs)
          );
          sweepScope = sweepEnabled
            ? `${eventKey}::${this.resolveBetfairViewKey(root)}`
            : '';
          ledger = sweepEnabled ? this.getSweepLedger(sweepScope) : null;
          // Na varredura o grupo aberto permanece aberto: as odds passam a ser
          // lidas ao vivo do DOM, sem novo clique e sem depender do cache.
          restoreOriginal = sweepEnabled ? false : restoreRequested;
          batchSize = sweepEnabled
            ? clampBetfairSweepBatchSize(options.batchSize)
            : clampBetfairBatchSize(options.batchSize);

          if (sweepEnabled) {
            // Um grupo já aberto pela varredura nunca é clicado de novo, mesmo
            // se o usuário recolher na mão depois. A extensão não disputa a
            // tela. O filtro do livro vem primeiro porque é uma consulta de
            // Set: só os grupos que sobram pagam a checagem de estado.
            const pending = refs.filter((groupRef) =>
              !ledger.has(groupRef.identity) && this.isGroupPendingExpansion(groupRef)
            );
            pendingTotal = pending.length;
            // Favoritos, prioridades e binds abrem primeiro para o usuário não
            // esperar a varredura inteira pelo mercado que ele acompanha.
            const prioritized = pending
              .map((groupRef, index) => ({
                groupRef,
                index,
                rank: betfairGroupMatchesInterest(groupRef, interests) ? 0 : 1,
              }))
              .sort((left, right) => left.rank - right.rank || left.index - right.index)
              .map((item) => item.groupRef);
            const remainingBudget = Math.max(0, maxGroups - ledger.size);
            candidates = prioritized.slice(0, Math.min(batchSize, remainingBudget));
          } else {
            const pending = refs.filter((groupRef) =>
              betfairGroupMatchesInterest(groupRef, interests) &&
              this.isGroupPendingExpansion(groupRef)
            );
            pendingTotal = pending.length;
            candidates = pending.slice(0, batchSize);
          }
        } finally {
          endBetfairScanFrame();
        }
        let expandedGroupCount = 0;
        let failedGroupCount = 0;
        let attemptedGroupCount = 0;
        let sweepYielded = false;
        this.expansionInFlight = candidates.length > 0;

        try {
          for (const originalRef of candidates) {
            // A execução de uma bind tem prioridade sobre a varredura: as duas
            // dividem a fila serial do evento, e continuar abrindo grupos aqui
            // faria a tecla esperar a rodada inteira. A varredura retoma no
            // próximo broadcast.
            if (sweepEnabled && this.shouldYieldSweepToExecution()) {
              sweepYielded = true;
              break;
            }
            attemptedGroupCount += 1;
            let groupRef = this.refreshGroupRef(originalRef, root);
            groupRef.wasExpanded = groupRef.state === 'expanded' || groupRef.state === 'opening';
            groupRef.attempts = Number(groupRef.attempts || 0) + 1;
            let openedByCollector = false;
            try {
              groupRef.state = 'opening';
              if (!this.toggleBetfairGroup(groupRef, true)) {
                throw new Error('unsafe_or_missing_expand_control');
              }
              groupRef = await this.waitForBetfairGroupStable(groupRef, true, {
                root,
                timeoutMs: options.timeoutMs,
              });
              if (!groupRef) throw new Error('expand_timeout');
              openedByCollector = true;

              groupRef.state = 'collecting';
              const snapshot = this.parseBetfairMarketNode(groupRef.container, groupRef);
              if (!snapshot) throw new Error('empty_after_expand');
              this.rememberGroupSnapshot(groupRef, snapshot);
              expandedGroupCount += 1;
              ledger?.add(groupRef.identity);

              if (restoreOriginal && !originalRef.wasExpanded) {
                groupRef.state = 'restoring';
                if (!this.toggleBetfairGroup(groupRef, false)) {
                  throw new Error('restore_control_unavailable');
                }
                const restored = await this.waitForBetfairGroupStable(groupRef, false, {
                  root,
                  timeoutMs: options.timeoutMs,
                });
                if (!restored) throw new Error('restore_timeout');
                restored.state = 'collapsed';
                openedByCollector = false;
              } else {
                groupRef.state = 'expanded';
              }
            } catch (error) {
              failedGroupCount += 1;
              // `waitForBetfairGroupStable` devolve null no timeout; sem este
              // fallback o próprio tratamento de erro quebraria a rodada.
              const failedRef = groupRef || originalRef;
              if (restoreOriginal && !originalRef.wasExpanded && openedByCollector) {
                try {
                  failedRef.state = 'restoring';
                  if (this.toggleBetfairGroup(failedRef, false)) {
                    await this.waitForBetfairGroupStable(failedRef, false, {
                      root,
                      timeoutMs: options.timeoutMs,
                    });
                  }
                } catch (restoreError) {}
              }
              failedRef.state = 'failed';
              failedRef.lastError = error?.message || String(error);
              this.groupRegistry.set(failedRef.identity, failedRef);
              // Duas tentativas bastam: insistir a cada rodada transformaria um
              // grupo problemático em cliques infinitos na página da casa.
              if (Number(failedRef.attempts) >= 2) ledger?.add(failedRef.identity);
            }
          }
        } finally {
          this.expansionInFlight = false;
        }

        return {
          // Sem clique nenhum nesta rodada o DOM continua igual ao que acabou
          // de ser varrido: reaproveitar os refs evita a segunda varredura
          // completa da aba a cada broadcast.
          groups: this.scrapeClean(root, {
            eventKey,
            refs: attemptedGroupCount === 0 ? refs : undefined,
          }),
          source: attemptedGroupCount > 0 ? 'expanded-scan' : 'dom-scan',
          attemptedGroupCount,
          expandedGroupCount,
          failedGroupCount,
          eventKey,
          sweepMode: sweepEnabled,
          sweepScope,
          sweepYielded,
          sweptGroupCount: ledger ? ledger.size : 0,
          sweepRemaining: Math.max(0, pendingTotal - attemptedGroupCount),
        };
      });
    }

    /**
     * Localiza e clica no botão BUTTON da Betfair por contexto (Card + Linha + Coluna), garantindo foco no elemento button real.
     * @param {string} targetName 
     * @param {string} targetOddVal 
     * @param {string} marketTitle 
     * @param {number} [colIndex=0]
     * @param {number} [rowIndex=-1]
     * @param {boolean} [isHotkey=false] 
     * @returns {Promise<boolean>}
     */
    async selectOddsOnBetfair(
      targetName,
      targetOddVal,
      marketTitle,
      colIndex = 0,
      rowIndex = -1,
      isHotkey = false,
      lineName = '',
      fastMode = false,
      preResolvedTarget = null,
      explicitStake = null,
    ) {
      if (explicitStake) {
        window.FastTriggerExpectedExecutionStake = String(explicitStake);
        if (window.FastTriggerConfig) {
          window.FastTriggerConfig.stakeVal = String(explicitStake);
        }
      }
      try {
        let targetStageMarked = false;
        let targetSource = 'pre_resolved';
        let targetButton = resolveValidatedBetfairOddTarget(preResolvedTarget, targetOddVal);
        if (!targetButton) {
          targetSource = 'market_index';
          targetButton = findIndexedBetfairOddTarget(
            targetName,
            targetOddVal,
            marketTitle,
            colIndex,
            rowIndex,
            lineName,
          );
        }

        if (targetButton) {
          markBetfairExecutionStage('target', {
            reasonCode: targetSource === 'pre_resolved'
              ? 'betfair_pre_resolved_target'
              : 'betfair_market_index_hit',
            indexHit: true,
          });
          targetStageMarked = true;
        }

        const cards = targetButton
          ? []
          : Array.from(document.querySelectorAll(MARKET_CONTAINER_SELECTOR));

        let targetCard = null;
        if (!targetButton && marketTitle) {
          const cleanMarketTitle = marketTitle.replace(/\(.*?\)/g, '').toLowerCase().trim();

          // O cabeçalho visível é a âncora mais confiável para evitar cards-pai
          // que englobam toda a página ou várias seções.
          const heading = Array.from(document.querySelectorAll('[role="tabpanel"] h2, [role="tabpanel"] h3, [role="tabpanel"] h4'))
            .find(el => {
              const headingText = (el.innerText || '').toLowerCase().trim();
              return headingText.includes(cleanMarketTitle) || cleanMarketTitle.includes(headingText);
            });
          targetCard = heading
            ? heading.closest('.d10cc4f3616ce879-card, [class*="-card"], [class*="marketContainer"], [data-market-id]')
            : null;

          if (!targetCard) {
            targetCard = cards.find(c => {
            const titleEl = c.querySelector('h2, h3, h4, [class*="market-title"], div[role="button"], [role="button"], ._88ecb80b8b4292b2-content');
            const txt = titleEl ? titleEl.innerText.toLowerCase().trim() : c.innerText.toLowerCase();
            return txt.includes(cleanMarketTitle) || cleanMarketTitle.includes(txt);
            });
          }
        }

        const searchCard = targetCard || document.body;

        // 1. Busca por Linha de Grid (._9e0669e8371c139a-gridRunnerLine) + Rótulo da Linha + Coluna
        if (!targetButton && (targetName || lineName)) {
          const cleanLabel = (lineName || targetName).toLowerCase().trim();
          const rows = Array.from(searchCard.querySelectorAll(
            '._23865a2f4eba37e1-runnerLine, [class*="-runnerLine"], [class*="runner-line"]'
          ));

          const targetRow = rows.find(r => {
            const lineNameEl = r.querySelector('._23865a2f4eba37e1-runnerName, .c84e4011151df22b-supportingText, [class*="-supportingText"]');
            const txt = lineNameEl ? lineNameEl.innerText.toLowerCase().trim() : r.innerText.toLowerCase();
            return txt.includes(cleanLabel) || cleanLabel.includes(txt);
          }) || (typeof rowIndex === 'number' && rowIndex >= 0 ? rows[rowIndex] : null);

          if (targetRow) {
            const buttons = Array.from(targetRow.querySelectorAll('.c84e4011151df22b-button, button[class*="-button"], button[class*="button"]:not([disabled]), button'));
            const targetColIdx = (typeof colIndex === 'number' && colIndex >= 0 && colIndex < buttons.length) ? colIndex : 0;
            targetButton = buttons[targetColIdx] || buttons.find(btn => {
              const oddsEl = btn.querySelector('.c84e4011151df22b-label, [class*="-label"]');
              const txt = oddsEl ? oddsEl.innerText.trim() : btn.innerText.trim();
              return targetOddVal && txt.includes(targetOddVal.toString());
            });
          }
        }

        // 2. Busca Global de Fallback
        if (!targetButton) {
          const searchRoots = targetCard ? [targetCard, document.body] : [document.body];
          const cleanName = (targetName || '').toLowerCase().trim();
          const cleanOdd = (targetOddVal || '').toString().trim();

          for (const root of searchRoots) {
            const buttons = Array.from(root.querySelectorAll(
              '.c84e4011151df22b-button, button[class*="-button"], button[class*="button"]:not([disabled]), button'
            ));

            targetButton = buttons.find(btn => {
              if (!btn) return false;
              const txt = (btn.innerText || btn.textContent || '').toLowerCase();

              const nameEl = btn.querySelector('.c84e4011151df22b-supportingText, [class*="-supportingText"]');
              const oddsEl = btn.querySelector('.c84e4011151df22b-label, [class*="-label"]');

              const nameTxt = nameEl ? nameEl.innerText.toLowerCase() : txt;
              const oddsTxt = oddsEl ? oddsEl.innerText.toLowerCase() : txt;

              const matchesName = !cleanName || nameTxt.includes(cleanName) || txt.includes(cleanName);
              const matchesOdd = !cleanOdd || oddsTxt.includes(cleanOdd) || txt.includes(cleanOdd);

              return matchesName && matchesOdd;
            });

            if (targetButton) break;
          }
        }

        // GARANTE O DISPARO NO ELEMENTO BUTTON REAL (E NÃO NO SPAN INTERNO DE TEXTO)
        if (targetButton) {
          const actualBtn = targetButton.closest('button.c84e4011151df22b-button, button') || targetButton;
          if (isBetfairSuspendedOdd(actualBtn)) {
            console.warn('[Fast Trigger Betfair] Odd suspensa/bloqueada; clique recusado.');
            return false;
          }
          if (!targetStageMarked) {
            markBetfairExecutionStage('target', {
              reasonCode: 'betfair_dom_fallback_target',
              indexMiss: true,
            });
          }
          console.log('[Fast Trigger Betfair] 🎯 Botão BUTTON localizado:', actualBtn);

          try {
            actualBtn.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
          } catch (e) {}

          const fastSelectionState = window.FastTriggerState;
          const fastSelection =
            fastMode ||
            isHotkey ||
            window.FastTriggerState?.backgroundDispatchInProgress === true;
          const previousFastSelection = fastSelectionState?.fastSelectionInProgress;
          if (fastSelectionState && fastSelection) {
            fastSelectionState.fastSelectionInProgress = true;
          }
          try {
            if (fastSelection) {
              // Selecionar a odd não é uma ação financeira. O clique DOM evita
              // attach/round-trip CDP; o CTA final continua obrigatoriamente confiável.
              actualBtn.click();
            } else {
              await clickFn(actualBtn, isHotkey, false);
            }
            markBetfairExecutionStage('selection', { reasonCode: 'selection_ready' });
            const pipeline = window.FastTriggerBetfairPipelinePromise;
            if (pipeline && typeof pipeline.then === 'function') {
              const pipelineSuccess = await pipeline;
              if (pipelineSuccess === false) {
                if (window.FastTriggerState?.deferDynamicBindSubmit !== true) {
                  finishBetfairExecution('failed', {
                    reasonCode: 'betfair_pipeline_failed',
                    clickAttempted: window.FastTriggerState?.lastDynamicBindFinalClickAttempted === true,
                  });
                }
                return false;
              }
            }
            if (window.FastTriggerState?.deferDynamicBindSubmit !== true) {
              const clickDelivered = window.FastTriggerState?.lastDynamicBindFinalClickAttempted === true;
              finishBetfairExecution(clickDelivered ? 'click_delivered' : 'prepared', {
                reasonCode: clickDelivered
                  ? 'betfair_financial_click_delivered'
                  : 'betfair_selection_prepared',
                clickAttempted: clickDelivered,
              });
            }
            return true;
          } finally {
            if (fastSelectionState && fastSelection) {
              fastSelectionState.fastSelectionInProgress = previousFastSelection;
            }
          }
        }

        console.warn(`[Fast Trigger Betfair] ⚠️ Botão de odd "${targetName}" (${targetOddVal}) não localizado na Betfair.`);
        markBetfairExecutionStage('target', {
          reasonCode: 'betfair_target_not_found',
          indexMiss: true,
        });
        return false;
      } catch (e) {
        console.error('[Fast Trigger Betfair] Erro ao selecionar odd:', e);
        return false;
      }
    }

    /**
     * Raspa os cards de mercados ao vivo visíveis no Sportsbook da Betfair.
     * @param {Element} [root] 
     * @returns {Array}
     */
    getBetfairLiveMarkets(root) {
      const targetRoot = root || document.body;
      return this.scrapeClean(targetRoot);
    }

    /**
     * Lê a aposta atualmente selecionada no cupom da Betfair.
     * @returns {string}
     */
    scanBetslip() {
      try {
        const betslipContainer = document.querySelector(BETSLIP_CONTAINER);
        if (!betslipContainer) return '';

        const nameEl = betslipContainer.querySelector(
          '.betslip-selection-name, .selection-name, .runner-name, [class*="selection-name"], [class*="SelectionName"], [class*="runner-title"]'
        );
        const oddsEl = betslipContainer.querySelector(
          '.betslip-strike-price, .odds-value, .odds, [class*="strike-price"], [class*="StrikePrice"], [class*="odds-price"]'
        );

        let activeName = nameEl && nameEl.offsetWidth > 0 ? nameEl.innerText.trim() : '';
        let activeOdds = oddsEl && oddsEl.offsetWidth > 0 ? oddsEl.innerText.trim() : '';

        return activeName ? `${activeName} ${activeOdds ? '(' + activeOdds + ')' : ''}` : '';
      } catch (e) {
        return '';
      }
    }

    /**
     * Dispara o fluxo de aposta humanizado no Sportsbook da Betfair.
     * @param {boolean} [isManualTrigger=false] 
     * @returns {Promise<boolean>}
     */
    async triggerPlaceBet(
      isManualTrigger = false,
      isHotkey = false,
      stakeAlreadyPrepared = false,
      fastMode = false,
      explicitStake = null,
    ) {
      try {
        const ensureLicense = (typeof ensureGatilhoBRLicense === 'function')
          ? ensureGatilhoBRLicense
          : (typeof window !== 'undefined' ? window.ensureGatilhoBRLicense : null);
        const hotLicense = typeof window.getHotLicenseSnapshot === 'function'
          ? window.getHotLicenseSnapshot()
          : null;
        const license = hotLicense || (ensureLicense ? await ensureLicense() : null);
        if (!license?.valid && window.FastTriggerExternalElectronMode !== true) {
          if (typeof showFlashFeedback === 'function') showFlashFeedback('🔒 Assinatura expirada ou não autorizada');
          return false;
        }
        if (!isManualTrigger && typeof isOneShotActive === 'function') {
          const activeOneShot = await isOneShotActive();
          if (!activeOneShot) {
            console.log('[Segurança OneShot Betfair] 🔒 Modo 1-Click DESATIVADO.');
            return false;
          }
        }

        const config = window.FastTriggerConfig || {};
        const houseStake = config.stakeValByHouse?.betfair || config.stakeValByHouse?.Betfair;
        const stakeVal =
          explicitStake ||
          window.FastTriggerExpectedExecutionStake ||
          houseStake ||
          config.stakeVal ||
          '0.50';

        const fastDispatch =
          fastMode ||
          isHotkey ||
          window.FastTriggerState?.backgroundDispatchInProgress === true;
        if (!stakeAlreadyPrepared) {
          // 1. Jitter de tempo de reação humana inicial (150ms - 260ms)
          if (!fastDispatch) await jitter(150, 260);

          // 2. Preenchimento de stake via digitação humana (Keystroke Dynamics)
          let attempts = 0;
          let filled = false;
          while (attempts < (fastDispatch ? 1 : 20)) {
            filled = await setBetfairStakeHuman(stakeVal, fastDispatch);
            if (filled) break;
            if (!fastDispatch) await jitter(30, 60);
            attempts++;
          }

          if (!filled) filled = setBetfairStakeFallback(stakeVal);
          if (!filled) return false;
          markBetfairExecutionStage('stake', { reasonCode: 'betfair_stake_ready' });

          // 3. Hesitação comportamental pré-confirmação (120ms - 220ms)
          if (!fastDispatch) await jitter(120, 220);
        }

        // 4. Clique humano no botão de confirmação
        if (fastDispatch) {
          const confirmed = await confirmBetfairBetHuman(true, 650);
          if (confirmed) {
            console.log('[OneShot Betfair Humanizado] 🚀 Aposta confirmada com sucesso na Betfair!');
          }
          return confirmed;
        }

        let confirmAttempts = 0;
        while (confirmAttempts < (fastDispatch ? 24 : 30)) {
          if (await confirmBetfairBetHuman(fastDispatch)) {
            console.log('[OneShot Betfair Humanizado] 🚀 Aposta confirmada com sucesso na Betfair!');
            return true;
          }
          if (!fastDispatch) await jitter(30, 60);
          confirmAttempts++;
        }

        console.warn('[OneShot Betfair Humanizado] ⚠️ Botão de aposta da Betfair não ficou pronto.');
        return false;
      } catch (err) {
        console.error('[OneShot Betfair Humanizado] Erro ao disparar aposta:', err);
        return false;
      }
    }
  }

  // Escuta de clique global em Odds da Betfair com simulação real e humanizada
  if (typeof document !== 'undefined') {
    document.addEventListener('click', (event) => {
      const target = event.target;
      if (!target) return;
      if (
        window.FastTriggerState?.betfairExpansionClickInProgress === true ||
        window.FastTriggerState?.betfairActionClickInProgress === true ||
        target.closest?.('[data-fast-trigger-expand-click="true"]')
      ) return;

      const oddButton = target.closest(ODD_BUTTON_SELECTOR);
      if (!oddButton) return;
      if (isBetfairSuspendedOdd(oddButton)) return;

      console.log('[Betfair Humanizer] 🎯 Clique em odd capturado:', oddButton);

      // O bind prepara seleção e stake antes do clique final. A flag é
      // capturada antes dos awaits para impedir submit duplicado.
      const deferDynamicBindSubmit =
        window.FastTriggerState?.deferDynamicBindSubmit === true;

      const pipeline = (async () => {
        const config = window.FastTriggerConfig || {};
        const houseStake = config.stakeValByHouse?.betfair || config.stakeValByHouse?.Betfair;
        const stakeVal =
          window.FastTriggerExpectedExecutionStake ||
          houseStake ||
          config.stakeVal ||
          '0.50';
        const fastDispatch =
          window.FastTriggerState?.backgroundDispatchInProgress === true ||
          window.FastTriggerState?.fastSelectionInProgress === true;

        // Hesitação humana pós-seleção
        if (!fastDispatch) await jitter(100, 180);

        // Preenchimento de stake via digitação humana
        let attempts = 0;
        let stakePrepared = false;
        while (attempts < (fastDispatch ? 1 : 20)) {
          if (await setBetfairStakeHuman(stakeVal, fastDispatch)) {
            stakePrepared = true;
            break;
          }
          if (!fastDispatch) await jitter(30, 60);
          attempts++;
        }

        if (!stakePrepared) return false;
        markBetfairExecutionStage('stake', { reasonCode: 'betfair_stake_ready' });
        if (deferDynamicBindSubmit) return true;

        // Se o Modo Disparo Direto (One-Shot) estiver ativo, hesita e confirma com simulateHumanClick
        const activeOneShot = (typeof isOneShotActive === 'function') ? await isOneShotActive() : false;
        if (activeOneShot) {
          console.log('[Betfair Humanizer] ⚡ One-Shot ATIVO. Aguardando jitter de confirmação...');
          if (fastDispatch) {
            return await confirmBetfairBetHuman(true, 650);
          }
          if (!fastDispatch) await jitter(120, 220);

          let betAttempts = 0;
          while (betAttempts < 25) {
           if (await confirmBetfairBetHuman(fastDispatch)) break;
            if (!fastDispatch) await jitter(30, 60);
            betAttempts++;
          }
        }
        return true;
      })();

      window.FastTriggerBetfairPipelinePromise = pipeline;
      pipeline.finally(() => {
        if (window.FastTriggerBetfairPipelinePromise === pipeline) {
          window.FastTriggerBetfairPipelinePromise = null;
        }
      });
    }, true);
  }

  if (typeof window !== 'undefined') {
    window.ODD_BUTTON_SELECTOR = ODD_BUTTON_SELECTOR;
    window.BETSLIP_CONTAINER = BETSLIP_CONTAINER;
    window.STAKE_INPUT_SELECTOR = STAKE_INPUT_SELECTOR;
    window.PLACE_BET_BUTTON_SELECTOR = PLACE_BET_BUTTON_SELECTOR;
    window.setBetfairStake = setBetfairStakeHuman;
    window.confirmBetfairBet = confirmBetfairBetHuman;
    window.BetfairSportsbookAdapter = BetfairSportsbookAdapter;
    window.getMarketType = getMarketType;
    window.FastTriggerBetfairTesting = Object.freeze({
      normalizeBetfairKey,
      isBetfairPlayerMarketTitle,
      normalizeBetfairInterests,
      betfairGroupMatchesInterest,
      buildSparseBetfairRow,
      classifyBetfairSnapshot,
      clampBetfairBatchSize,
      clampBetfairSweepBatchSize,
      clampBetfairSweepMaxGroups,
      isBetfairAllMarketsLabel,
      readBetfairActiveViewLabels,
      readBetfairColumnIndex,
      findOwnedBetfairGroupTitle,
      resolveValidatedBetfairOddTarget,
      findIndexedBetfairOddTarget,
      consolidateBetfairSnapshots,
      mergeBetfairTableSnapshots,
      betfairSnapshotSelectionCount,
      setBetfairStakeOnInput,
      setBetfairStakeHuman,
      confirmBetfairBetHuman,
      isBetfairSuspendedOdd,
      readBetfairText,
      isBetfairElementVisible,
      getBetfairRealOddLeaves,
      beginBetfairScanFrame,
      endBetfairScanFrame,
      invalidateBetfairScanFrame,
    });
    window.getBetfairLiveMarkets = (root) => {
      const adapter = new BetfairSportsbookAdapter();
      return adapter.getBetfairLiveMarkets(root);
    };
    window.selectOddsOnBetfair = (targetName, targetOddVal, marketTitle, colIndex, rowIndex, isHotkey, lineName, fastMode, preResolvedTarget) => {
      const adapter = new BetfairSportsbookAdapter();
      return adapter.selectOddsOnBetfair(targetName, targetOddVal, marketTitle, colIndex, rowIndex, isHotkey, lineName, fastMode, preResolvedTarget);
    };
  }
})();
