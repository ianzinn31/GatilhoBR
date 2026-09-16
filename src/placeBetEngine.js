// =========================================================================
// GATILHOBR - MOTOR COMPARTILHADO DE CONFIRMACAO DE APOSTA
// =========================================================================

var FT_ACTION_SELECTORS = [
  // Bet365: prioriza o container clicavel real, evitando filhos como _Text.
  '.bsf-PlaceBetButton',
  '.bss-PlaceBetButton',
  '.qbs-PlaceBetButton',
  '.bs-InPlayPlaceBetButton',
  '.bs-PlaceBetButton',
  '.bs-BtnPlaceBet',
  // Bet365: quando a odd muda, o CTA final vira uma ação combinada
  // "Aceitar Alteração e Fazer aposta" em vez de PlaceBetButton.
  '.bsf-AcceptButton',
  '.bss-AcceptButton',
  '.qbs-AcceptButton',
  // Contratos semanticos reutilizaveis por outras casas.
  'button[class*="PlaceBet"]',
  'button[class*="placeBet"]',
  'button[class*="place-bet"]',
  '[role="button"][class*="PlaceBet"]',
  '[role="button"][class*="place-bet"]',
  // BetMGM/Tiger Sportsbook: CTA sem classe estavel, com testid do betslip.
  'button[data-testid="betslipSubmitButton"]',
  'button[data-testid="betslipPlaceBet"]',
  'button[data-testid*="place" i]',
  'button[data-testid*="submit" i]',
  'button[data-testid*="confirm" i]',
  'button[type="submit"]'
];

const FT_ACTION_KEYWORDS = [
  'fazer aposta',
  'apostar',
  'finalizar aposta',
  'colocar aposta',
  'enviar aposta',
  'confirmar aposta',
  'place bet',
  'confirm bet',
  'submit bet'
];

const FT_ODDS_CHANGE_SELECTORS = [
  '.bs-AcceptButton',
  '[class*="AcceptChanges"]',
  '[class*="AcceptOdds"]',
  '[class*="OddsChange"]',
  '[class*="PriceChange"]',
  '[data-testid*="accept" i][data-testid*="odd" i]',
  '[data-testid*="accept" i][data-testid*="change" i]',
  '[aria-label*="accept changes" i]',
  '[aria-label*="aceitar alterações" i]',
  '[title*="accept changes" i]',
  '[title*="aceitar alterações" i]',
].join(', ');

const FT_ODDS_CHANGE_TEXT = /(?:accept\s+changes|aceitar\s+alteracoes|aceitar\s+alterações|odds?\s+(?:changed|alterada|alteradas)|cotacoes?\s+alterad)/i;
const FT_FINANCIAL_ACTION_TEXT = /(?:apostar|fazer\s+aposta|finalizar\s+aposta|colocar\s+aposta|enviar\s+aposta|confirmar\s+aposta|place\s+bet|submit\s+bet|confirm\s+bet)/i;
const FT_ODDS_POLICY_VALUES = new Set(['reject_changes', 'accept_higher_only', 'accept_any']);
const FT_BET365_FAST_COMMIT_TRANSITION_MS = 700;

let ftPlaceBetInFlight = false;

function ftTrace(event, details = {}) {
  try {
    const payload = { event, ...details };
    console.log('[BetFlow TRACE]', payload);
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({ action: 'TRACE_BETFLOW', trace: payload }, () => {
        void chrome.runtime.lastError;
      });
    }
  } catch (e) {}
}

// Diagnóstico somente leitura do estado do cupom/CTA. Mantém-se deliberadamente
// compacto para poder ser enviado pelas DevTools/native bridge sem capturar
// credenciais ou conteúdo sensível da página.
function ftTraceDomState(event, extra = {}) {
  try {
    const actionId = window.FastTriggerState?.activeExecutionActionId || null;
    const button = findReadyPlaceBetButton();
    const rect = (node) => {
      if (!node?.getBoundingClientRect) return null;
      const r = node.getBoundingClientRect();
      return { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
    };
    const visible = (node) => !!(node && node.isConnected && ftIsVisible(node));
    const active = document.activeElement;
    const hit = button ? (() => { const p = ftGetSafeActionPoint(button); return p ? document.elementFromPoint(p.x, p.y) : null; })() : null;
    const slip = Array.from(document.querySelectorAll('[class*="BetSlip" i],[class*="betslip" i],[class*="Betslip" i]')).find(visible);
    ftTrace(event, {
      actionId,
      ctaPresent: !!button,
      ctaVisible: visible(button),
      ctaClass: ftClassText(button).slice(0, 160),
      ctaText: ftNormalizeText(button?.innerText || button?.textContent).slice(0, 100),
      ctaRect: rect(button),
      ctaInBetslip: button ? ftIsBetslipContext(button) : false,
      hitTag: hit?.tagName || null,
      hitClass: ftClassText(hit).slice(0, 120),
      activeTag: active?.tagName || null,
      activeClass: ftClassText(active).slice(0, 120),
      slipVisible: !!slip,
      slipRect: rect(slip),
      ...extra,
    });
  } catch (e) {
    ftTrace(event, { ...extra, snapshotError: String(e?.message || e) });
  }
}

function ftTraceInteractionWindow(durationMs = 1200) {
  // Captura eventos de ponteiro apenas durante a confirmação para descobrir
  // cliques subsequentes no backdrop que possam fechar o cupom. Os listeners
  // são passivos, não impedem nem alteram qualquer evento da página.
  try {
    const started = Date.now();
    const handler = (ev) => {
      const target = ev?.target;
      ftTrace('interaction_event', {
        actionId: window.FastTriggerState?.activeExecutionActionId || null,
        type: ev.type,
        elapsedMs: Date.now() - started,
        targetTag: target?.tagName || null,
        targetClass: ftClassText(target).slice(0, 140),
        targetText: ftNormalizeText(target?.innerText || target?.textContent).slice(0, 80),
        inBetslip: ftIsBetslipContext(target),
      });
    };
    document.addEventListener('pointerdown', handler, true);
    document.addEventListener('mousedown', handler, true);
    document.addEventListener('click', handler, true);
    setTimeout(() => {
      document.removeEventListener('pointerdown', handler, true);
      document.removeEventListener('mousedown', handler, true);
      document.removeEventListener('click', handler, true);
      ftTraceDomState('interaction_window_end');
    }, durationMs);
  } catch (e) {}
}

function ftMarkExecutionStage(stage, details = {}) {
  const actionId = window.FastTriggerState?.activeExecutionActionId;
  if (!actionId || typeof window.FastTriggerExecutionReport?.mark !== "function") {
    return;
  }
  window.FastTriggerExecutionReport.mark(actionId, stage, details);
}

function ftSleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function ftNormalizeText(value) {
  return (value || '')
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function ftParseOddValue(value) {
  const match = String(value ?? '')
    .replace(/R\$/gi, '')
    .replace(/\s/g, '')
    .match(/\d+(?:[.,]\d{1,3})?/);
  if (!match) return null;
  const parsed = Number(match[0].replace(',', '.'));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function ftGetOddsChangePolicy() {
  const config = window.FastTriggerConfig || {};
  const explicit = String(config.oddsChangePolicy || '').trim().toLowerCase();
  if (FT_ODDS_POLICY_VALUES.has(explicit)) return explicit;
  return config.autoAcceptOddsBool === false ? 'reject_changes' : 'accept_any';
}

function ftIsBetslipContext(element) {
  return Boolean(element?.closest?.(
    '[data-testid*="betslip" i], [class*="betslip" i], [class*="bet-slip" i], [class*="Betslip"], form[aria-label*="bet" i]'
  ));
}

function ftIsOddsChangeButton(element) {
  if (!element) return false;

  const className = ftClassText(element);
  const metadata = [
    className,
    element.getAttribute?.('data-testid') || '',
    element.getAttribute?.('aria-label') || '',
    element.getAttribute?.('title') || '',
  ].join(' ');
  const text = [
    element.innerText,
    element.textContent,
    element.getAttribute?.('aria-label'),
    element.getAttribute?.('title'),
  ].filter(Boolean).join(' ');
  const explicitOddsClass = /(?:AcceptChanges|AcceptOdds|OddsChange|PriceChange)/i.test(metadata);
  const knownAcceptClass = /(?:bs-AcceptButton|AcceptButton)/i.test(metadata);
  const explicitText = FT_ODDS_CHANGE_TEXT.test(text);
  const hasFinancialText = FT_FINANCIAL_ACTION_TEXT.test(text);
  const inBetslip = ftIsBetslipContext(element);
  const hasOddsContext = /(?:odd|odds|cotac|price|preco|alterac|change)/i.test(metadata);

  if (explicitOddsClass) return true;
  if (knownAcceptClass && explicitText && !hasFinancialText) return true;
  return explicitText && !hasFinancialText && (inBetslip || hasOddsContext);
}

function ftReadOddsChangeInfo(button) {
  if (!button) return { previous: null, current: null };

  const directNodes = [button];
  button.querySelectorAll?.(
    '[class*="Odds"], [class*="Odd"], [class*="Price"], [class*="Cotacao"], [class*="odds"], [data-testid*="odd" i], [data-testid*="price" i]'
  ).forEach((node) => directNodes.push(node));

  const collectValues = (nodes) => {
    const values = [];
    for (const node of nodes) {
      const text = [
        node.innerText,
        node.textContent,
        node.getAttribute?.('aria-label'),
        node.getAttribute?.('title'),
      ].filter(Boolean).join(' ');
      const matches = text.match(/\b\d+[.,]\d{1,3}\b/g) || [];
      for (const raw of matches) {
        const value = ftParseOddValue(raw);
        if (value !== null && value >= 1.01 && value <= 1000) values.push(value);
      }
    }
    return [...new Set(values)];
  };

  const directValues = collectValues(directNodes);
  if (directValues.length >= 2) {
    return {
      previous: directValues[directValues.length - 2],
      current: directValues[directValues.length - 1],
    };
  }
  if (directValues.length === 1) return { previous: null, current: directValues[0] };

  const ancestorNodes = [];
  let ancestor = button.parentElement;
  let depth = 0;
  while (ancestor && depth < 4) {
    const text = [ancestor.innerText, ancestor.textContent].filter(Boolean).join(' ');
    if (FT_ODDS_CHANGE_TEXT.test(text) || /(?:odd|odds|cotac|price|alterac|change)/i.test(text)) {
      ancestorNodes.push(ancestor);
    }
    ancestor = ancestor.parentElement;
    depth += 1;
  }

  const unique = collectValues(ancestorNodes);
  if (unique.length >= 2) {
    return { previous: unique[unique.length - 2], current: unique[unique.length - 1] };
  }
  return { previous: null, current: unique[0] ?? null };
}

function ftFindReadyOddsChangeButton() {
  const candidates = [];
  const seen = new Set();
  const add = (candidate) => {
    const button = ftResolveActionRoot(candidate);
    if (!button || seen.has(button)) return;
    seen.add(button);
    candidates.push(button);
  };

  try {
    document.querySelectorAll(FT_ODDS_CHANGE_SELECTORS).forEach(add);
    // O texto é usado somente como fallback depois dos contratos semânticos;
    // nunca aceitamos um botão de ação financeira genérico aqui.
    document.querySelectorAll('button, [role="button"]').forEach((button) => {
      if (FT_ODDS_CHANGE_TEXT.test([
        button.innerText,
        button.textContent,
        button.getAttribute?.('aria-label'),
        button.getAttribute?.('title'),
      ].filter(Boolean).join(' '))) add(button);
    });
  } catch (error) {}

  return candidates.find((button) =>
    ftIsOddsChangeButton(button) &&
    ftIsVisible(button) &&
    !ftHasDisabledState(button)
  ) || null;
}

function ftGetExpectedExecutionOdds() {
  const actionId =
    window.FastTriggerState?.activeExecutionActionId ||
    window.FastTriggerState?.activeSelectionActionId;
  const map = window.FastTriggerState?.expectedExecutionOddsByAction;
  if (!actionId || !(map instanceof Map)) return null;
  const value = map.get(actionId);
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function ftSetExpectedExecutionOdds(value) {
  const actionId =
    window.FastTriggerState?.activeExecutionActionId ||
    window.FastTriggerState?.activeSelectionActionId;
  const map = window.FastTriggerState?.expectedExecutionOddsByAction;
  const parsed = ftParseOddValue(value);
  if (!actionId || !(map instanceof Map) || parsed === null) return parsed;
  map.set(actionId, parsed);
  return parsed;
}

function ftClearExpectedExecutionOdds(actionId) {
  const map = window.FastTriggerState?.expectedExecutionOddsByAction;
  if (actionId && map instanceof Map) map.delete(actionId);
}

function ftClassText(element) {
  if (!element) return '';
  if (typeof element.className === 'string') return element.className;
  return element.getAttribute ? (element.getAttribute('class') || '') : '';
}

function ftHasDisabledState(element) {
  if (!element) return true;

  const className = ftClassText(element).toLowerCase();
  const ariaDisabled = (element.getAttribute && element.getAttribute('aria-disabled')) || '';
  const ariaBusy = (element.getAttribute && element.getAttribute('aria-busy')) || '';

  return !!(
    element.disabled ||
    (element.hasAttribute && element.hasAttribute('disabled')) ||
    ariaDisabled.toLowerCase() === 'true' ||
    ariaBusy.toLowerCase() === 'true' ||
    /(^|[\s_-])(disabled|locked|suspended|loading)([\s_-]|$)/i.test(className)
  );
}

function ftIsVisible(element) {
  if (!element || !document.contains(element)) return false;

  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;

  const style = window.getComputedStyle ? window.getComputedStyle(element) : null;
  return !style || (
    style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    Number(style.opacity || 1) > 0
  );
}

function ftResolveActionRoot(candidate) {
  if (!candidate) return null;

  // Elementos semanticos sempre vencem.
  const semantic = candidate.closest && candidate.closest(
    'button, [role="button"], input[type="submit"], input[type="button"]'
  );
  if (semantic) return semantic;

  // Na Bet365 o alvo e um DIV raiz; filhos (_Text, _TopRow etc.) nao devem
  // ser tratados como botoes independentes.
  const bet365Root = candidate.closest && candidate.closest(
    '.bsf-PlaceBetButton, .bss-PlaceBetButton, .qbs-PlaceBetButton, ' +
    '.bs-InPlayPlaceBetButton, .bs-PlaceBetButton, .bs-BtnPlaceBet, ' +
    '.bsf-AcceptButton, .bss-AcceptButton, .qbs-AcceptButton'
  );
  return bet365Root || candidate;
}

function isActionBtnReady(candidate, extraKeywords = [], allowOddsChange = false) {
  const button = ftResolveActionRoot(candidate);
  if (!button || !ftIsVisible(button) || ftHasDisabledState(button)) return false;
  if (!allowOddsChange && ftIsOddsChangeButton(button)) return false;

  // Nunca aceite um submit genérico fora do cupom: na Bet365 existem vários
  // botões de navegação/fechamento que compartilham texto ou type=submit. O
  // CTA financeiro precisa estar dentro do betslip (ou usar uma classe
  // semântica oficial de PlaceBet/AcceptButton).
  const classText = ftClassText(button);
  const hasBet365CommitClass = /(?:PlaceBetButton|PlaceBet|BtnPlaceBet|AcceptButton)/i.test(classText);
  const isBet365Page = /(?:^|\.)bet365\./i.test(String(window.location?.hostname || ''));
  if (isBet365Page && !ftIsBetslipContext(button) && !hasBet365CommitClass) return false;

  // Um filho pode parecer habilitado enquanto o container real esta Disabled.
  let ancestor = button.parentElement;
  let depth = 0;
  while (ancestor && depth < 3) {
    const ancestorClass = ftClassText(ancestor);
    if (/PlaceBet|AcceptChanges|AcceptButton/i.test(ancestorClass) && ftHasDisabledState(ancestor)) {
      return false;
    }
    ancestor = ancestor.parentElement;
    depth++;
  }

  const text = ftNormalizeText(button.innerText || button.textContent);
  const actionKeywords = [
    ...FT_ACTION_KEYWORDS,
    ...(Array.isArray(extraKeywords) ? extraKeywords : []),
  ];
  const matchedKeyword = actionKeywords.find(keyword => text.includes(ftNormalizeText(keyword)));
  if (!matchedKeyword) return false;

  // Evita confundir "Accept cookies" e outros submits genericos com a acao
  // de aceitar uma alteracao de cotacao.
  if (
    ftNormalizeText(matchedKeyword) === 'accept' &&
    !/Accept|PlaceBet/i.test(ftClassText(button))
  ) {
    return false;
  }

  const rect = button.getBoundingClientRect();
  const rawCenterX = rect.left + rect.width / 2;
  const rawCenterY = rect.top + rect.height / 2;
  const isInsideViewport = (
    rawCenterX >= 0 &&
    rawCenterY >= 0 &&
    rawCenterX < window.innerWidth &&
    rawCenterY < window.innerHeight
  );

  // Elementos fora da viewport serao centralizados antes do clique.
  if (!isInsideViewport) return true;

  const centerX = rawCenterX;
  const centerY = rawCenterY;
  const hitTarget = document.elementFromPoint(centerX, centerY);

  return !!(
    hitTarget &&
    (hitTarget === button || button.contains(hitTarget) || hitTarget.contains(button))
  );
}

// Retorna um ponto que comprovadamente pertence ao CTA no momento do clique.
// Em layouts da Bet365 o cupom pode animar/ficar parcialmente coberto; clicar
// sempre no centro (com jitter) acaba atingindo o backdrop e fecha o balão.
function ftGetSafeActionPoint(button) {
  if (!button || !ftIsVisible(button)) return null;
  const rect = button.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const samples = [
    [0.50, 0.50], [0.25, 0.50], [0.75, 0.50],
    [0.50, 0.30], [0.50, 0.70], [0.30, 0.30], [0.70, 0.70],
  ];
  for (const [rx, ry] of samples) {
    const x = Math.round(rect.left + rect.width * rx);
    const y = Math.round(rect.top + rect.height * ry);
    if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) continue;
    const hit = document.elementFromPoint(x, y);
    if (hit && (hit === button || button.contains(hit) || hit.contains(button))) {
      return { x, y };
    }
  }
  return null;
}

// Converte coordenadas do viewport do frame atual para o viewport da página
// principal. O Betnacional pode renderizar o cupom dentro de um iframe; o
// CDP Input.dispatchMouseEvent, porém, sempre recebe coordenadas da aba
// principal (frame 0). Sem essa conversão o evento é entregue fora do botão
// mesmo com o hit-test local validando corretamente.
function ftGetTopViewportPoint(x, y) {
  let topX = Number(x) || 0;
  let topY = Number(y) || 0;
  let current = window;
  const visited = new Set();
  try {
    while (current && current !== current.top && !visited.has(current)) {
      visited.add(current);
      const frame = current.frameElement;
      if (!frame || typeof frame.getBoundingClientRect !== 'function') break;
      const rect = frame.getBoundingClientRect();
      topX += Number(rect.left) || 0;
      topY += Number(rect.top) || 0;
      current = current.parent;
    }
  } catch (_) {
    // Frame cross-origin: mantém o ponto local; o caller registra a origem.
  }
  return { x: Math.round(topX), y: Math.round(topY), inFrame: current !== window };
}

function findReadyPlaceBetButton() {
  const dynamicPayload = (typeof getDynamicEnginePayload === 'function')
    ? getDynamicEnginePayload()
    : (typeof window !== 'undefined' ? window.GatilhoBRDynamicPayload : null);
  const dynamicSelector = dynamicPayload?.selectors?.placeBetButton;
  const selectors = dynamicSelector
    ? [dynamicSelector, ...FT_ACTION_SELECTORS]
    : FT_ACTION_SELECTORS;

  const seen = new Set();
  for (const selector of selectors) {
    let candidates = [];
    try {
      candidates = Array.from(document.querySelectorAll(selector));
    } catch (e) {
      continue;
    }

    for (const candidate of candidates) {
      const button = ftResolveActionRoot(candidate);
      if (!button || seen.has(button)) continue;
      seen.add(button);
      // No Bet365, somente aceite CTAs financeiros que estejam dentro do
      // betslip/cupom. Isso evita capturar submits de login, overlays ou
      // botões da navegação que compartilham texto/classe genérica.
      const isBet365Cta = /(?:^|\.)bs(?:f|s)?-|qbs-|InPlayPlaceBet|PlaceBetButton|BtnPlaceBet|AcceptButton/i
        .test(ftClassText(button));
      if (isBet365Cta && !ftIsBetslipContext(button)) continue;
      if (isActionBtnReady(button)) return button;
    }
  }

  return null;
}

function ftIsExplicitFinalConfirmation(button) {
  const text = ftNormalizeText(button?.innerText || button?.textContent);
  return /(?:confirmar aposta|confirm bet|finalizar aposta|concluir aposta)/i.test(text);
}

function ftFindExplicitSecondStageButton(previousButton, previousText) {
  const current = findReadyPlaceBetButton();
  if (!current || !ftIsExplicitFinalConfirmation(current)) return null;
  const currentText = ftNormalizeText(current.innerText || current.textContent);
  return current !== previousButton || currentText !== previousText ? current : null;
}

function ftHasBet365CommitAcknowledged(clickedButton) {
  if (!clickedButton || !document.contains(clickedButton)) return true;
  if (ftHasDisabledState(clickedButton)) return true;

  const receiptSelectors = [
    '[class*="BetReceipt"]',
    '[class*="betReceipt"]',
    '[class*="ReceiptContent"]',
    '[class*="ConfirmationMessage"]',
  ].join(', ');
  const receipt = Array.from(document.querySelectorAll(receiptSelectors)).find((node) => {
    if (!ftIsVisible(node)) return false;
    const text = ftNormalizeText(node.innerText || node.textContent);
    return /(?:aposta realizada|aposta confirmada|bet placed|sucesso|success)/i.test(text);
  });
  if (receipt) return true;

  // Após uma submissão aceita, a Bet365 oculta/remove a seleção ativa e o CTA
  // deixa de estar pronto. Isso é confirmação de transição, não de resultado.
  return !findReadyPlaceBetButton();
}

async function ftWaitForBet365CommitTransition(
  clickedButton,
  previousText,
  timeoutMs = FT_BET365_FAST_COMMIT_TRANSITION_MS,
) {
  const readTransition = () => {
    const secondButton = ftFindExplicitSecondStageButton(clickedButton, previousText);
    if (secondButton) return { type: 'second-stage', button: secondButton };
    if (ftHasBet365CommitAcknowledged(clickedButton)) return { type: 'acknowledged' };
    return null;
  };

  const immediate = readTransition();
  if (immediate) {
    ftTraceDomState('commit_transition_immediate', { transition: immediate.type });
    return immediate;
  }

  const signalWaiter = window.FastTriggerDom?.waitForSignal;
  if (typeof signalWaiter === 'function') {
    const result = await signalWaiter(readTransition, {
      timeoutMs,
      events: ['click', 'input', 'change'],
      root: document,
    });
    ftTraceDomState('commit_transition_signal_result', { transition: result?.type || 'timeout' });
    return result;
  }

  const pollingWaiter = window.FastTriggerDom?.waitFor;
  if (typeof pollingWaiter === 'function') {
    const result = await pollingWaiter(readTransition, { timeoutMs, intervalMs: 12 });
    ftTraceDomState('commit_transition_poll_result', { transition: result?.type || 'timeout' });
    return result;
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const transition = readTransition();
    if (transition) {
      ftTraceDomState('commit_transition_result', { transition: transition.type });
      return transition;
    }
    await ftSleep(12);
  }
  ftTraceDomState('commit_transition_timeout', { transition: 'timeout' });
  return null;
}

async function waitForStablePlaceBetButton(timeoutMs = 1400, fastMode = false) {
  const immediateButton = findReadyPlaceBetButton();
  if (fastMode && immediateButton) {
    ftMarkExecutionStage('cta', { reasonCode: 'cta_ready' });
    return immediateButton;
  }

  const reactiveWaiter = window.FastTriggerDom?.waitForSignal;
  if (fastMode && typeof reactiveWaiter === 'function') {
    return await reactiveWaiter(
      () => {
        const button = findReadyPlaceBetButton();
        if (button) ftMarkExecutionStage('cta', { reasonCode: 'cta_ready' });
        return button;
      },
      {
        timeoutMs,
        events: ['click', 'input', 'change', 'focusout', 'keydown', 'keyup'],
      },
    );
  }

  const domWaiter = window.FastTriggerDom?.waitFor;
  if (fastMode && typeof domWaiter === 'function') {
    return await domWaiter(
      () => {
        const button = findReadyPlaceBetButton();
        if (button) ftMarkExecutionStage('cta', { reasonCode: 'cta_ready' });
        return button;
      },
      { timeoutMs, intervalMs: 8 },
    );
  }

  const startedAt = Date.now();
  let previousButton = null;
  let stableReads = 0;

  while ((Date.now() - startedAt) < timeoutMs) {
    const button = findReadyPlaceBetButton();

    // Em uma bind já autorizada, a confirmação é o último elo do fluxo. Não
    // pagamos duas leituras estáveis de 20 ms se o botão já está pronto.
    if (fastMode && button) {
      ftMarkExecutionStage('cta', { reasonCode: 'cta_ready' });
      return button;
    }

    if (button && button === previousButton) {
      stableReads++;
      if (stableReads >= 2) {
        ftMarkExecutionStage('cta', { reasonCode: 'cta_ready' });
        return button;
      }
    } else {
      previousButton = button;
      stableReads = button ? 1 : 0;
    }

    await ftSleep(fastMode ? 8 : 20);
  }

  return null;
}

function ftFindPreparedBet365CommitButton() {
  if (typeof window.findBet365ReadyStakeState !== 'function') return null;
  try {
    const ready = window.findBet365ReadyStakeState(window.FastTriggerConfig?.stakeVal);
    const button = ready?.button || null;
    if (!button || button.isConnected === false || !isActionBtnReady(button)) return null;
    ftMarkExecutionStage('cta', { reasonCode: 'cta_ready_with_exact_stake' });
    return button;
  } catch (error) {
    return null;
  }
}

async function dispatchTrustedActionClick(
  button,
  fastMode = false,
  extraKeywords = [],
  dispatchOptions = {},
) {
  ftTrace('click_start', {
    actionId: window.FastTriggerState?.activeExecutionActionId || null,
    className: ftClassText(button).slice(0, 180),
    text: ftNormalizeText(button?.innerText || button?.textContent).slice(0, 120),
    inBetslip: ftIsBetslipContext(button),
  });
  ftTraceDomState('click_state_before_validation', { stage: dispatchOptions.stage || 'commit' });
  if (!button || !ftIsVisible(button)) {
    ftTrace('click_rejected', { reason: 'button_not_visible' });
    return { success: false, reason: 'button_not_visible' };
  }

  const allowOddsChange = dispatchOptions.allowOddsChange === true;
  if (ftIsOddsChangeButton(button) && !allowOddsChange) {
    return { success: false, reason: 'odds_change_requires_policy' };
  }

  // O cupom já está aberto e visível neste ponto. Centralizá-lo novamente
  // pode disparar o fechamento/re-render do betslip da Bet365 e invalidar as
  // coordenadas do CTA. Só faça um ajuste mínimo quando o botão realmente
  // estiver fora da viewport; `nearest` preserva o modal e evita deslocamento
  // sob o ponteiro.
  try {
    const rect = button.getBoundingClientRect();
    const outside = rect.bottom <= 0 || rect.top >= window.innerHeight ||
      rect.right <= 0 || rect.left >= window.innerWidth;
    if (outside) {
      button.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
      ftTraceDomState('click_state_after_scroll', { stage: dispatchOptions.stage || 'commit' });
    }
  } catch (e) {}

  // requestAnimationFrame pode ficar suspenso indefinidamente em uma guia
  // que não está visível. O timeout garante que uma ordem já autorizada não
  // fique enfileirada para disparar somente quando o usuário voltar à guia.
  const fastDispatch =
    fastMode || window.FastTriggerState?.backgroundDispatchInProgress === true;
  if (!fastDispatch) await new Promise(resolve => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const timeoutId = setTimeout(finish, 45);
    requestAnimationFrame(() => {
      clearTimeout(timeoutId);
      finish();
    });
  });

  // O DOM pode ter sido recriado durante o scroll. Nunca clique em referencia obsoleta.
  if (!document.contains(button) || !isActionBtnReady(button, extraKeywords, allowOddsChange)) {
    return { success: false, reason: 'button_became_stale' };
  }

  // Revalida um ponto de hit-test dentro do próprio CTA após o scroll e o
  // possível rerender. Não use jitter: alguns CTAs têm áreas estreitas e o
  // deslocamento pode atingir o backdrop do cupom.
  const safePoint = ftGetSafeActionPoint(button);
  if (!safePoint) {
    ftTrace('click_rejected', { reason: 'button_hit_target_obscured' });
    return { success: false, reason: 'button_hit_target_obscured' };
  }
  const localPoint = safePoint;
  const topPoint = ftGetTopViewportPoint(localPoint.x, localPoint.y);
  const { x, y } = topPoint;
  const hit = document.elementFromPoint(x, y);
  ftTrace('click_point', {
    x, y, localX: localPoint.x, localY: localPoint.y, inFrame: topPoint.inFrame,
    hitTag: hit?.tagName || null,
    hitClass: ftClassText(hit).slice(0, 160),
    rect: (() => { const r = button.getBoundingClientRect(); return { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }; })(),
  });
  ftTraceDomState('click_state_before_native_dispatch', { x, y, stage: dispatchOptions.stage || 'commit' });
  if (dispatchOptions.financial !== false) ftTraceInteractionWindow();

  if (
    typeof chrome === 'undefined' ||
    !chrome.runtime ||
    typeof chrome.runtime.sendMessage !== 'function'
  ) {
    return { success: false, reason: 'trusted_click_unavailable' };
  }

  const response = await new Promise(resolve => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      resolve(value);
    };
    const timeoutId = setTimeout(
      () => finish({ status: 'ERROR', error: 'trusted_click_timeout' }),
      fastDispatch ? 350 : 650,
    );
    ftMarkExecutionStage(dispatchOptions.stage || 'commit', {
      reasonCode: dispatchOptions.reasonCode || 'commit_sent',
      // Rotula o caminho: sem isso o relatorio comparativo nao tem linha de
      // base do DOM para medir contra a ordem direta.
      executionMode: 'DOM_UI',
      // Accepting a changed odd is a separate UI step, not the financial
      // commit. Only the final financial CTA can mark clickAttempted=true.
      clickAttempted: dispatchOptions.financial !== false,
      oddsChangePolicy: dispatchOptions.oddsChangePolicy,
      oddsChangeDecision: dispatchOptions.oddsChangeDecision,
      expectedOdds: dispatchOptions.expectedOdds,
      currentOdds: dispatchOptions.currentOdds,
    });
    chrome.runtime.sendMessage(
      {
        action: 'PRODUCE_TRUSTED_CLICK',
        x,
        y,
        // Ajuda o host Electron a resolver a aba correta quando sender.tab
        // não está disponível no bridge nativo.
        house: dispatchOptions.house || (window.location.hostname.includes('betnacional') ? 'betnacional' : undefined),
        fastResponse: dispatchOptions.fastResponse === true,
        keepDebuggerAttachedMs: dispatchOptions.keepDebuggerAttachedMs,
        directOrderLearning: dispatchOptions.financial !== false
          ? (dispatchOptions.directOrderLearning || null)
          : null,
      },
      result => {
        if (chrome.runtime.lastError) {
          finish({ status: 'ERROR', error: chrome.runtime.lastError.message });
          return;
        }
        finish(result || { status: 'ERROR', error: 'empty_response' });
      }
    );
  });

  ftTraceDomState('click_state_after_native_dispatch', {
    x, y,
    stage: dispatchOptions.stage || 'commit',
    responseStatus: response?.status || null,
    responseTrusted: response?.trusted === true,
    responseError: response?.error || null,
  });

  return {
    success: response.status === 'OK' && response.trusted === true,
    trusted: response.trusted === true,
    latencyMs: response.latencyMs,
    reason: response.error || response.message || null
  };
}

/**
 * Checa rigorosamente se o Modo Disparo Direto (1-Click) esta ativado.
 */
async function isOneShotActive() {
  try {
    const runtimeConfig = window.FastTriggerConfig || {};
    if (window.FastTriggerState?.configLoaded === true && typeof runtimeConfig.oneShot === 'boolean') {
      return runtimeConfig.oneShot;
    }
    if (window.FastTriggerState?.configLoaded === true && typeof runtimeConfig.oneClick === 'boolean') {
      return runtimeConfig.oneClick;
    }

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      const storageData = window.gbrUserScopedStorage
        ? await window.gbrUserScopedStorage.get('local', [
            'autoTriggerDirectBool',
            'oneShot',
            'autoTrigger',
            'fastTriggerAuto',
            'autoTriggerDirect',
          ])
        : {};
      const storedKeys = [
        'autoTriggerDirectBool',
        'oneShot',
        'autoTrigger',
        'fastTriggerAuto',
        'autoTriggerDirect',
      ];
      const hasStoredChoice = storedKeys.some(
        (key) => storageData[key] !== undefined && storageData[key] !== null,
      );
      if (hasStoredChoice) {
        return !!(
          storageData.autoTriggerDirectBool ||
          storageData.oneShot ||
          storageData.autoTrigger ||
          storageData.fastTriggerAuto ||
          storageData.autoTriggerDirect
        );
      }
    }

    const chkEl = document.querySelector('#chk-auto-trigger');
    if (chkEl) return chkEl.checked;

    return false;
  } catch (e) {}
  return false;
}

async function resolveOddsChangeBeforeCommit(fastMode = false) {
  const button = ftFindReadyOddsChangeButton();
  if (!button) return { status: 'none' };

  const policy = ftGetOddsChangePolicy();
  const odds = ftReadOddsChangeInfo(button);
  const expected = ftGetExpectedExecutionOdds() ?? odds.previous;

  ftMarkExecutionStage('odds_change', {
    reasonCode: 'odds_change_detected',
    oddsChangePolicy: policy,
    oddsChangeDecision: 'detected',
    expectedOdds: expected,
    currentOdds: odds.current,
  });

  if (policy === 'reject_changes') {
    const reason = 'odds_change_rejected_by_policy';
    if (window.FastTriggerState) window.FastTriggerState.lastDynamicBindFailureReason =
      'A cotação mudou e a política configurada rejeita alterações.';
    ftMarkExecutionStage('odds_change', {
      reasonCode: reason,
      oddsChangePolicy: policy,
      oddsChangeDecision: 'rejected',
      expectedOdds: expected,
      currentOdds: odds.current,
    });
    return { status: 'blocked', policy, reason, expected, current: odds.current };
  }

  if (!Number.isFinite(odds.current)) {
    const reason = 'odds_change_unreadable';
    if (window.FastTriggerState) window.FastTriggerState.lastDynamicBindFailureReason =
      'A casa sinalizou alteração de cotação, mas a nova odd não pôde ser lida com segurança.';
    ftMarkExecutionStage('odds_change', {
      reasonCode: reason,
      oddsChangePolicy: policy,
      oddsChangeDecision: 'blocked_unreadable',
      expectedOdds: expected,
      currentOdds: null,
    });
    return { status: 'blocked', policy, reason, expected, current: null };
  }

  if (policy === 'accept_higher_only') {
    if (!Number.isFinite(expected)) {
      const reason = 'odds_expected_unreadable';
      if (window.FastTriggerState) window.FastTriggerState.lastDynamicBindFailureReason =
        'A política aceita apenas aumento, mas a odd esperada não está disponível.';
      ftMarkExecutionStage('odds_change', {
        reasonCode: reason,
        oddsChangePolicy: policy,
        oddsChangeDecision: 'blocked_expected_unreadable',
        expectedOdds: null,
        currentOdds: odds.current,
      });
      return { status: 'blocked', policy, reason, expected: null, current: odds.current };
    }
    if (odds.current < expected - 0.005) {
      const reason = 'odds_change_lower_rejected';
      if (window.FastTriggerState) window.FastTriggerState.lastDynamicBindFailureReason =
        'A nova odd é menor que a odd esperada; a confirmação foi bloqueada.';
      ftMarkExecutionStage('odds_change', {
        reasonCode: reason,
        oddsChangePolicy: policy,
        oddsChangeDecision: 'rejected_lower',
        expectedOdds: expected,
        currentOdds: odds.current,
      });
      return { status: 'blocked', policy, reason, expected, current: odds.current };
    }
  }

  const clickResult = await dispatchTrustedActionClick(
    button,
    fastMode,
    ['accept changes', 'aceitar alteracoes', 'aceitar alterações'],
    {
      allowOddsChange: true,
      financial: false,
      stage: 'odds_change',
      reasonCode: policy === 'accept_higher_only'
        ? 'odds_change_higher_accepted'
        : 'odds_change_any_accepted',
      oddsChangePolicy: policy,
      oddsChangeDecision: 'accepted',
      expectedOdds: expected,
      currentOdds: odds.current,
    },
  );
  if (!clickResult?.success) {
    const reason = 'odds_change_accept_failed';
    if (window.FastTriggerState) window.FastTriggerState.lastDynamicBindFailureReason =
      'A alteração de cotação foi permitida, mas o aceite não foi entregue.';
    ftMarkExecutionStage('odds_change', {
      reasonCode: reason,
      oddsChangePolicy: policy,
      oddsChangeDecision: 'accept_failed',
      expectedOdds: expected,
      currentOdds: odds.current,
    });
    return { status: 'blocked', policy, reason, expected, current: odds.current };
  }

  ftMarkExecutionStage('odds_change', {
    reasonCode: policy === 'accept_higher_only'
      ? 'odds_change_higher_accepted'
      : 'odds_change_any_accepted',
    oddsChangePolicy: policy,
    oddsChangeDecision: 'accepted',
    expectedOdds: expected,
    currentOdds: odds.current,
  });
  return { status: 'accepted', policy, expected, current: odds.current };
}

// =========================================================================
// MODO DE EXECUÇÃO: CAMINHO DIRETO (DIRECT_NETWORK) x DOM (DOM_UI)
// =========================================================================
//
// `DOM_UI` é o padrão e o caminho oficial: clique único no botão da casa.
// `DIRECT_NETWORK` só existe quando a ponte `window.GatilhoBRDirectOrder`
// (mundo ISOLATED) está armada e com modelo de requisição configurado.
//
// Regra que impede aposta dobrada: só cai de volta para o clique no DOM quando
// o resultado diz `attempted === false` E o código é indisponibilidade ou
// configuração incompleta. Qualquer recusa de mercado/dinheiro, e qualquer
// resultado em que a requisição possa ter saído (`attempted` verdadeiro ou
// desconhecido), encerra o disparo sem clicar.
const FT_EXECUTION_MODES = new Set(['DOM_UI', 'DIRECT_NETWORK']);
const FT_DIRECT_FALLBACK_CODES = new Set([
  // Despachante indisponível ou sem estado para decidir.
  'disabled', 'no_fetch', 'no_cache', 'unknown_state', 'stale_state',
  // Configuração do modelo de requisição incompleta ou inválida.
  'invalid_config', 'invalid_endpoint', 'host_not_allowed', 'forbidden_header',
  'body_failed',
  // Recusas da própria ponte, antes de qualquer rede.
  'bridge_missing', 'bridge_disarmed', 'bridge_no_template',
  'bridge_no_selection', 'bridge_invalid_stake', 'bridge_no_timer',
  'bridge_post_failed',
]);
const FT_DIRECT_SELECTION_MAX_AGE_MS = 12_000;

function ftGetExecutionMode() {
  const raw = String(window.FastTriggerConfig?.executionMode || '').trim().toUpperCase();
  return FT_EXECUTION_MODES.has(raw) ? raw : 'DOM_UI';
}

// Depósito explícito do `selectionId` para o caminho direto. O parser da Bet365
// não extrai id de seleção do DOM, então quem souber o id precisa informá-lo.
// `frameAt` é o T0 da linha do tempo (chegada do frame que descreve a seleção) e
// `source` diz quem depositou — `auto_*` vem do resolvedor, e só depósito `auto_*`
// pode ser apagado automaticamente.
function ftSetDirectOrderSelection(selectionId, details = {}) {
  if (!window.FastTriggerState) return null;
  const raw = typeof selectionId === 'string'
    ? selectionId.trim()
    : (Number.isFinite(selectionId) ? String(selectionId) : '');
  if (raw === '') {
    window.FastTriggerState.directOrderSelection = null;
    return null;
  }
  const frameAt = Number(details.frameAt);
  const entry = {
    selectionId: raw.slice(0, 96),
    actionId: typeof details.actionId === 'string' && details.actionId
      ? details.actionId
      : (window.FastTriggerState.activeExecutionActionId || ''),
    odds: Number.isFinite(Number(details.odds)) ? Number(details.odds) : null,
    marketId: typeof details.marketId === 'string'
      ? details.marketId.slice(0, 128)
      : (Number.isFinite(Number(details.marketId)) ? String(details.marketId).slice(0, 128) : ''),
    eventId: typeof details.eventId === 'string'
      ? details.eventId.slice(0, 128)
      : (Number.isFinite(Number(details.eventId)) ? String(details.eventId).slice(0, 128) : ''),
    frameAt: Number.isFinite(frameAt) && frameAt > 0 ? frameAt : null,
    source: typeof details.source === 'string' ? details.source.slice(0, 40) : 'manual',
    setAt: Date.now(),
  };
  window.FastTriggerState.directOrderSelection = entry;
  return entry;
}

function ftNormalizeDirectSelection(candidate) {
  if (candidate === null || candidate === undefined) return null;
  const raw = typeof candidate === 'object' ? candidate.selectionId : candidate;
  const id = typeof raw === 'string'
    ? raw.trim()
    : (Number.isFinite(raw) ? String(raw) : '');
  if (id === '' || id.length > 96) return null;
  const odds = typeof candidate === 'object' ? Number(candidate.odds) : NaN;
  const frameAt = typeof candidate === 'object' ? Number(candidate.frameAt) : NaN;
  return {
    selectionId: id,
    odds: Number.isFinite(odds) && odds > 0 ? odds : null,
    marketId: typeof candidate === 'object' && candidate.marketId != null
      ? String(candidate.marketId).slice(0, 128)
      : '',
    eventId: typeof candidate === 'object' && candidate.eventId != null
      ? String(candidate.eventId).slice(0, 128)
      : '',
    actionId: typeof candidate === 'object' && typeof candidate.actionId === 'string'
      ? candidate.actionId
      : '',
    frameAt: Number.isFinite(frameAt) && frameAt > 0 ? frameAt : null,
    source: typeof candidate === 'object' && typeof candidate.source === 'string'
      ? candidate.source.slice(0, 40)
      : '',
    setAt: typeof candidate === 'object' && Number.isFinite(Number(candidate.setAt))
      ? Number(candidate.setAt)
      : Date.now(),
  };
}

// Um id de seleção só serve se for recente e da ação em curso: id velho pode
// apontar para outra seleção, que o usuário já trocou na tela. A regra vale
// igual para o gancho do adapter e para o depósito explícito.
function ftAcceptDirectSelection(candidate) {
  const selection = ftNormalizeDirectSelection(candidate);
  if (selection === null) return null;
  if (Date.now() - selection.setAt > FT_DIRECT_SELECTION_MAX_AGE_MS) return null;
  const activeActionId = window.FastTriggerState?.activeExecutionActionId;
  if (activeActionId && selection.actionId && selection.actionId !== activeActionId) return null;
  return selection;
}

function ftResolveDirectOrderSelection() {
  // 1) O adapter da casa, quando souber informar a seleção do cupom.
  const adapter = window.FastTriggerAdapter;
  if (adapter && typeof adapter.getDirectOrderSelection === 'function') {
    try {
      const fromAdapter = ftAcceptDirectSelection(adapter.getDirectOrderSelection());
      if (fromAdapter !== null) return fromAdapter;
    } catch (error) {}
  }

  // 2) Depósito explícito de quem soube o id (feed correlacionado, preset, bind).
  return ftAcceptDirectSelection(window.FastTriggerState?.directOrderSelection);
}

function ftDirectFallback(reason, directOrderLearning = null) {
  console.warn(`[OrdemDireta] Caminho direto indisponível (${reason}); seguindo pelo DOM.`);
  ftMarkExecutionStage('route', {
    executionMode: 'DIRECT_NETWORK',
    reasonCode: `direct_fallback_${reason}`,
    directOrderAttempted: false,
  });
  return { handled: false, success: false, code: reason, directOrderLearning };
}

function ftBlockDirectHotkeyWithoutSelection() {
  const reason = 'bridge_no_selection';
  console.warn(
    '[OrdemDireta] Atalho bloqueado: selecione a odd novamente antes de disparar.',
  );
  ftMarkExecutionStage('route', {
    executionMode: 'DIRECT_NETWORK',
    reasonCode: 'direct_blocked_bridge_no_selection',
    directOrderAttempted: false,
  });
  ftFlashDirectOrder('⛔ Selecione a odd novamente antes de disparar');
  if (window.FastTriggerState) {
    window.FastTriggerState.lastDynamicBindFinalClickAttempted = false;
  }
  return { handled: true, success: false, code: reason };
}

function ftBlockDirectHotkeyUnavailable(reason) {
  const safeReason = String(reason || 'unavailable').slice(0, 48);
  console.warn(
    `[OrdemDireta] Atalho bloqueado antes do CDP: aceleracao indisponivel (${safeReason}).`,
  );
  ftMarkExecutionStage('route', {
    executionMode: 'DIRECT_NETWORK',
    reasonCode: `direct_blocked_${safeReason}`,
    directOrderAttempted: false,
  });
  ftFlashDirectOrder('⛔ Aceleração indisponível — tente novamente');
  if (window.FastTriggerState) {
    window.FastTriggerState.lastDynamicBindFinalClickAttempted = false;
  }
  return { handled: true, success: false, code: safeReason };
}

function ftBuildDirectOrderLearning(selection, stake) {
  if (!selection || !selection.selectionId || !Number.isFinite(stake) || stake <= 0) return null;
  return {
    actionId: window.FastTriggerState?.activeExecutionActionId || '',
    issuedAt: Date.now(),
    selectionId: selection.selectionId,
    marketId: selection.marketId || '',
    eventId: selection.eventId || '',
    stake,
    odds: selection.odds,
  };
}

function ftRefreshDirectOrderLearning(current) {
  if (current && current.selectionId && Number.isFinite(Number(current.stake))) {
    return current;
  }
  if (ftGetExecutionMode() !== 'DIRECT_NETWORK') return null;
  const selection = ftResolveDirectOrderSelection();
  const stake = ftParseOddValue(window.FastTriggerConfig?.stakeVal);
  return ftBuildDirectOrderLearning(selection, stake);
}

function ftFlashDirectOrder(text) {
  if (typeof showFlashFeedback === 'function') {
    try {
      showFlashFeedback(text);
    } catch (error) {}
  }
}

// `no_cache` significa que `window.__gbrMarketStateCache` não existe no MAIN
// world: o observador de frames não está instalado nesta sessão da aba. A
// ponte pede a recuperação automática; este aviso cobre apenas fluxos legados
// não-hotkey enquanto o runtime está sendo preparado.
// Aviso único por aba: o disparo em si já tem o feedback do fluxo visual.
let ftDirectFeedHintShown = false;

function ftFlashDirectFeedHint(code) {
  if (code !== 'no_cache' || ftDirectFeedHintShown) return;
  ftDirectFeedHintShown = true;
  ftFlashDirectOrder('⚡ Preparando aceleração da Bet365');
}

// Mensagens curtas por código: o usuário precisa saber se a aposta saiu.
function ftDescribeDirectCode(result) {
  const code = result?.code || '';
  if (code === 'suspended') return '⛔ Seleção suspensa: ordem não enviada';
  if (code === 'odds_below_min') return '⛔ Odd abaixo do mínimo: ordem não enviada';
  if (code === 'odds_moved') return '⛔ Odd mudou: ordem não enviada';
  if (code === 'stake_above_cap') return '⛔ Stake acima do teto configurado';
  if (code === 'invalid_stake') return '⛔ Stake inválida para ordem direta';
  if (code === 'rate_limited') return '⛔ Limite de disparos atingido';
  if (code === 'in_flight' || code === 'bridge_in_flight') return '⛔ Ordem anterior ainda em andamento';
  if (code === 'invalid_intent' || code === 'replayed_intent') return '⛔ Intenção inválida ou repetida';
  if (code === 'dry_run') {
    // Em ensaio não existe RTT: o despachante valida e para antes de enviar. O
    // número honesto aqui é `bridgeMs`, medido pela ponte (ida ao mundo MAIN +
    // validação), e só existe no valor resolvido por `dispatch`.
    const bridgeMs = Number(result?.bridgeMs);
    if (!Number.isFinite(bridgeMs) || bridgeMs <= 0) {
      return '🧪 [Direto] Ordem validada (dryRun)';
    }
    return `🧪 [Direto] Ordem validada em ${bridgeMs < 1 ? '<1' : Math.round(bridgeMs)} ms (dryRun)`;
  }
  if (code === 'http_error') return `⚠️ Casa recusou a ordem (HTTP ${result?.status || 0})`;
  if (code === 'timeout' || code === 'bridge_timeout') {
    return '⚠️ Sem resposta da casa: confira o cupom antes de repetir';
  }
  if (code === 'aborted') return '⚠️ Ordem cancelada: confira o cupom antes de repetir';
  if (code === 'network_error') return '⚠️ Falha de rede: confira o cupom antes de repetir';
  return `⚠️ Ordem direta recusada (${code || 'desconhecido'})`;
}

async function ftTryDirectNetworkOrder(options = {}) {
  const bridge = window.GatilhoBRDirectOrder;
  if (
    options.autoRecoverRuntime === true &&
    bridge &&
    typeof bridge.ensureMainRuntime === 'function'
  ) {
    const runtimeReady = await bridge.ensureMainRuntime();
    if (runtimeReady !== true) {
      return options.failClosedUnavailable === true
        ? ftBlockDirectHotkeyUnavailable('bridge_runtime_missing')
        : ftDirectFallback('bridge_runtime_missing');
    }
    // Se o usuário clicou enquanto o service worker acordava, o resolver ainda
    // guarda a célula exata. Repetir o depósito é somente leitura e republica o
    // estado para o MAIN recém-instalado; não repete clique nem ordem.
    try {
      window.FastTriggerSelectionResolver?.retry?.();
    } catch (error) {}
  }

  const selection = ftResolveDirectOrderSelection();
  if (selection === null) {
    if (options.failClosedNoSelection === true) {
      return ftBlockDirectHotkeyWithoutSelection();
    }
    return ftDirectFallback('bridge_no_selection');
  }

  const stake = ftParseOddValue(window.FastTriggerConfig?.stakeVal);
  if (stake === null) {
    return options.failClosedUnavailable === true
      ? ftBlockDirectHotkeyUnavailable('bridge_invalid_stake')
      : ftDirectFallback('bridge_invalid_stake');
  }
  const directOrderLearning = ftBuildDirectOrderLearning(selection, stake);

  if (!bridge || typeof bridge.dispatch !== 'function') {
    return options.failClosedUnavailable === true
      ? ftBlockDirectHotkeyUnavailable('bridge_missing')
      : ftDirectFallback('bridge_missing', directOrderLearning);
  }
  if (typeof bridge.isReady === 'function' && bridge.isReady() !== true) {
    const reason = bridge.isArmed?.() === true ? 'bridge_no_template' : 'bridge_disarmed';
    // `bridge_no_template` é a única exceção: a primeira execução deliberada
    // precisa passar pela UI para aprender o modelo real da conta. Qualquer
    // outra indisponibilidade local em hotkey falha fechado antes do CDP.
    if (options.failClosedUnavailable === true && reason !== 'bridge_no_template') {
      void bridge.ensureMainRuntime?.();
      return ftBlockDirectHotkeyUnavailable(reason);
    }
    return ftDirectFallback(reason, directOrderLearning);
  }

  // A política de alteração de odd do usuário vale igual no caminho direto: a
  // odd de referência é a que ele viu na tela quando a seleção foi preparada.
  const policy = ftGetOddsChangePolicy();
  const expected = ftGetExpectedExecutionOdds();
  const reference = Number.isFinite(expected) && expected > 0
    ? expected
    : (selection.odds !== null ? selection.odds : null);
  const request = { selectionId: selection.selectionId, stake };
  if (reference !== null) {
    if (policy === 'reject_changes') {
      request.expectedOdds = reference;
      request.oddsTolerance = 0;
    } else if (policy === 'accept_higher_only') {
      request.minOdds = reference;
    }
  }

  // T1 da linha do tempo: `commitSentAt` é carimbado aqui, imediatamente antes
  // de a ponte despachar. `frameSeenAt` é o T0 que veio junto com a seleção.
  ftMarkExecutionStage('commit', {
    executionMode: 'DIRECT_NETWORK',
    oddsChangePolicy: policy,
    expectedOdds: reference,
    frameSeenAt: selection.frameAt,
    selectionSource: selection.source,
  });

  let result = null;
  try {
    result = await bridge.dispatch(request);
  } catch (error) {
    // Exceção na ponte deixa o destino da ordem desconhecido: não clica depois.
    console.error('[OrdemDireta] Falha ao despachar pela ponte:', error);
    ftMarkExecutionStage('result', {
      executionMode: 'DIRECT_NETWORK',
      reasonCode: 'direct_bridge_threw',
    });
    return { handled: true, success: false, code: 'bridge_threw' };
  }

  if (result === null || typeof result !== 'object') {
    ftMarkExecutionStage('result', {
      executionMode: 'DIRECT_NETWORK',
      reasonCode: 'direct_no_result',
    });
    return { handled: true, success: false, code: 'bridge_no_result' };
  }

  if (window.FastTriggerState) {
    window.FastTriggerState.lastDirectOrderResult = {
      actionId: result.actionId || '',
      selectionId: result.selectionId || selection.selectionId,
      ok: result.ok === true,
      code: result.code || '',
      attempted: result.attempted,
      status: Number(result.status) || 0,
      rtt: Number(result.rtt) || 0,
      totalMs: Number(result.totalMs) || 0,
      frameAt: selection.frameAt,
      source: selection.source,
      at: Date.now(),
    };
  }

  // T2 da linha do tempo: RTT medido pelo despachante no mundo MAIN. `resultAt`
  // é carimbado pelo próprio relatório ao registrar este estágio.
  ftMarkExecutionStage('result', {
    executionMode: 'DIRECT_NETWORK',
    reasonCode: `direct_${result.code || 'unknown'}`,
    directOrderAttempted: result.attempted === true,
    expectedOdds: reference,
    currentOdds: Number.isFinite(Number(result.odds)) ? Number(result.odds) : null,
    rttMs: Number(result.rtt) || 0,
    totalMs: Number(result.totalMs) || 0,
  });

  if (result.ok === true) {
    // Aviso de sucesso é do `content.js`, que escuta o resultado publicado pelo
    // MAIN world — evita dois flashes para a mesma ordem.
    return { handled: true, success: true, code: result.code };
  }

  // Só volta ao DOM quando nada saiu para a casa e a causa é disponibilidade.
  if (result.attempted === false && FT_DIRECT_FALLBACK_CODES.has(result.code)) {
    if (options.failClosedUnavailable === true && result.code !== 'bridge_no_template') {
      void bridge.ensureMainRuntime?.();
      return ftBlockDirectHotkeyUnavailable(result.code);
    }
    ftFlashDirectFeedHint(result.code);
    return ftDirectFallback(result.code);
  }

  // Recusa que nasceu na própria ponte não gera mensagem no MAIN world, então o
  // aviso na tela sai daqui. O resto é responsabilidade do `content.js`.
  //
  // O ensaio é a exceção: o `content.js` deixa de avisar `dry_run` de propósito,
  // porque o resultado publicado pelo MAIN world não carrega `bridgeMs`. O toast
  // com o tempo medido só pode nascer aqui.
  if (result.code === 'dry_run' || !(Number(result.dispatcherVersion) > 0)) {
    ftFlashDirectOrder(ftDescribeDirectCode(result));
  }
  return { handled: true, success: false, code: result.code };
}

/**
 * Dispara uma única confirmação nativa e retorna assim que o clique é
 * entregue. O processamento posterior da casa não bloqueia outra casa.
 */
async function triggerPlaceBet(
  isManualTrigger = false,
  isHotkey = false,
  stakeAlreadyPrepared = false,
  fastMode = false,
) {
  ftTrace('trigger_start', { actionId: window.FastTriggerState?.activeExecutionActionId || null, isHotkey, fastMode, stakeAlreadyPrepared });
  if (ftPlaceBetInFlight) {
    console.warn('[OneShot] Disparo ignorado: uma confirmacao ja esta em andamento.');
    return false;
  }

  if (window.FastTriggerState) {
    window.FastTriggerState.lastDynamicBindFinalClickAttempted = false;
  }

  ftPlaceBetInFlight = true;
  try {
    let directOrderLearning = null;
    const ensureLicense = (typeof ensureGatilhoBRLicense === 'function')
      ? ensureGatilhoBRLicense
      : (typeof window !== 'undefined' ? window.ensureGatilhoBRLicense : null);
    const hotLicense = typeof window.getHotLicenseSnapshot === 'function'
      ? window.getHotLicenseSnapshot()
      : null;
    const license = hotLicense || (ensureLicense ? await ensureLicense() : null);
    const electronAuthorized = Number(window.FastTriggerState?.electronAuthorizedUntil) > Date.now();
    if (!license?.valid && !electronAuthorized && window.FastTriggerExternalElectronMode !== true) {
      if (typeof showFlashFeedback === 'function') {
        showFlashFeedback('🔒 Assinatura expirada ou não autorizada');
      }
      return false;
    }

    if (!isManualTrigger && !(await isOneShotActive()) && !electronAuthorized) {
      console.log('[Seguranca OneShot] Modo 1-Click desativado; aposta mantida no cupom.');
      return false;
    }

    // Caminho direto antes de qualquer interação com o DOM: as travas de
    // licença e de 1-Click acima valem para os dois modos. Quando a ponte
    // resolve a ordem (`handled`), o clique no DOM não acontece.
    // Ações autorizadas pelo Electron usam a confirmação visual da aba real.
    // Isso evita que uma rota direta sem sessão/anti-fraude válida encerre o
    // fluxo antes do botão "Apostar" ser confirmado.
    if (ftGetExecutionMode() === 'DIRECT_NETWORK' && !electronAuthorized) {
      // Hotkey é uma ordem para a seleção recém-clicada, não uma autorização
      // genérica para confirmar qualquer cupom que tenha ficado aberto. Sem id
      // recente, falha fechado antes do CDP/CTA. Fluxos não-hotkey preservam o
      // fallback controlado necessário ao primeiro aprendizado.
      const direct = await ftTryDirectNetworkOrder({
        failClosedNoSelection: isHotkey === true,
        failClosedUnavailable: isHotkey === true,
        autoRecoverRuntime: true,
      });
      if (direct.handled) {
        // Quando o comando foi autorizado pelo Electron, uma falha de
        // disponibilidade da ponte direta não deve impedir a confirmação
        // visual. A Bet365 pode recusar a rota de rede (sessão/anti-fraude)
        // mesmo com o cupom pronto; nesse caso continuamos pelo CTA DOM,
        // entregue via clique nativo. Só fazemos fallback para códigos de
        // ponte sem tentativa de ordem, evitando risco de duplicidade.
        const directCode = String(direct.code || '');
        const canFallbackToDom =
          electronAuthorized &&
          direct.success !== true &&
          (FT_DIRECT_FALLBACK_CODES.has(directCode) || /^bridge_/.test(directCode));
        if (canFallbackToDom) {
          console.warn(`[OneShot] Rota direta indisponível (${directCode}); usando confirmação visual.`);
        } else {
          if (window.FastTriggerState) {
            // Nenhum clique foi entregue: o relato de bind não pode dizer que houve.
            window.FastTriggerState.lastDynamicBindFinalClickAttempted = false;
          }
          return direct.success === true;
        }
      }
      directOrderLearning = direct.directOrderLearning || null;
    }

    const fastDispatch =
      fastMode ||
      isHotkey ||
      window.FastTriggerState?.backgroundDispatchInProgress === true;
    const activeActionId = window.FastTriggerState?.activeExecutionActionId;
    const scrollAssisted = Boolean(
      activeActionId &&
        window.FastTriggerState?.scrollAssistedExecution?.actionId === activeActionId,
    );
    if (!fastDispatch && isHotkey && typeof randomJitter === 'function') {
      await randomJitter(12, 35, true);
    }

    const oddsChangeResult = await resolveOddsChangeBeforeCommit(fastDispatch);
    if (oddsChangeResult.status === 'blocked') {
      console.warn('[OneShot] Confirmação bloqueada pela política de alteração de odd:', oddsChangeResult.reason);
      return false;
    }

    // O caminho comum continua imediato. Quando a seleção exigiu scroll, a
    // Bet365 pode remontar o cupom depois dos 450 ms antigos; o teto maior só
    // mantém a espera reativa viva e retorna no primeiro sinal de CTA pronto.
    const placeBetButtonTimeout = fastDispatch
      ? scrollAssisted
        ? 1600
        : 450
      : 1400;
    // Quando o preenchimento acabou de provar a stake exata e o CTA financeiro
    // já está habilitado, confirme no mesmo turno. A prova é refeita agora para
    // não confiar em botão/stake antigos após um rerender ou mudança de odd.
    let button = stakeAlreadyPrepared
      ? ftFindPreparedBet365CommitButton()
      : null;
    if (!button) {
      button = await waitForStablePlaceBetButton(placeBetButtonTimeout, fastDispatch);
    }
    if (!button) {
      ftTrace('cta_not_found');
      console.warn('[OneShot] Botao de confirmacao nao ficou habilitado e estavel.');
      return false;
    }

    // Reconsulta imediatamente antes do clique para sobreviver a rerenders React/SPA.
    const latestButton = findReadyPlaceBetButton();
    if (latestButton && (!ftIsBetslipContext(button) || ftIsBetslipContext(latestButton))) {
      button = latestButton;
    }

    // No primeiro uso o selectionId pode chegar no mesmo clique DOM que abriu
    // o cupom. Releia imediatamente antes da confirmação para que essa própria
    // aposta ensine o perfil; não obrigue o usuário a tentar uma segunda vez.
    directOrderLearning = ftRefreshDirectOrderLearning(directOrderLearning);

    const firstText = ftNormalizeText(button.innerText || button.textContent);
    const clickResult = await dispatchTrustedActionClick(
      button,
      fastDispatch,
      [],
      {
        financial: true,
        stage: 'commit',
        fastResponse: fastDispatch,
        keepDebuggerAttachedMs: fastDispatch
          ? FT_BET365_FAST_COMMIT_TRANSITION_MS
          : 0,
        directOrderLearning,
      },
    );

    if (window.FastTriggerState) {
      window.FastTriggerState.lastDynamicBindFinalClickAttempted =
        clickResult.success === true;
    }

    if (!clickResult.success) {
      ftTrace('click_result', { success: false, reason: clickResult.reason || null });
      console.error('[OneShot] Clique nativo nao foi entregue:', clickResult.reason || 'erro desconhecido');
      return false;
    }

    console.log(
      `[OneShot] Clique nativo isTrusted=true entregue${clickResult.latencyMs != null ? ` em ${clickResult.latencyMs}ms` : ''}.`
    );
    ftTrace('click_result', { success: true, latencyMs: clickResult.latencyMs || 0 });

    const transition = await ftWaitForBet365CommitTransition(
      button,
      firstText,
      fastDispatch ? FT_BET365_FAST_COMMIT_TRANSITION_MS : 1400,
    );
    if (transition?.type === 'second-stage') {
      ftTrace('transition', { type: 'second-stage' });
      directOrderLearning = ftRefreshDirectOrderLearning(directOrderLearning);
      const secondResult = await dispatchTrustedActionClick(
        transition.button,
        fastDispatch,
        [],
        {
          financial: true,
          stage: 'commit',
          fastResponse: fastDispatch,
          directOrderLearning,
        },
      );
      if (!secondResult?.success) {
        console.warn('[OneShot] A confirmação final apareceu, mas o clique não foi entregue.');
        return false;
      }
      console.log('[OneShot] Confirmação explícita da segunda etapa entregue.');
      return true;
    }
    if (transition?.type === 'acknowledged') {
      ftTrace('transition', { type: 'acknowledged' });
      console.log('[OneShot] Bet365 reconheceu a transição do envio.');
      return true;
    }

    console.warn(
      '[OneShot] Clique entregue, mas a Bet365 não alterou o cupom; nenhuma nova tentativa financeira foi feita.',
    );
    ftTrace('transition', { type: 'none' });
    return false;
  } catch (err) {
    console.error('[OneShot] Erro ao confirmar aposta:', err);
    return false;
  } finally {
    ftPlaceBetInFlight = false;
  }
}

if (typeof window !== 'undefined') {
  window.isOneShotActive = isOneShotActive;
  window.isActionBtnReady = isActionBtnReady;
  window.findReadyPlaceBetButton = findReadyPlaceBetButton;
  window.waitForStablePlaceBetButton = waitForStablePlaceBetButton;
  window.dispatchTrustedActionClick = dispatchTrustedActionClick;
  window.resolveOddsChangeBeforeCommit = resolveOddsChangeBeforeCommit;
  window.isFastTriggerOddsChangeButton = ftIsOddsChangeButton;
  window.findFastTriggerOddsChangeButton = ftFindReadyOddsChangeButton;
  window.setFastTriggerExpectedExecutionOdds = ftSetExpectedExecutionOdds;
  window.clearFastTriggerExpectedExecutionOdds = ftClearExpectedExecutionOdds;
  window.setFastTriggerDirectOrderSelection = ftSetDirectOrderSelection;
  window.FastTriggerExecution = {
    modes: [...FT_EXECUTION_MODES],
    mode: ftGetExecutionMode,
    fallbackCodes: [...FT_DIRECT_FALLBACK_CODES],
    setSelection: ftSetDirectOrderSelection,
    resolveSelection: ftResolveDirectOrderSelection,
    tryDirectOrder: ftTryDirectNetworkOrder,
    describeCode: ftDescribeDirectCode,
  };
  window.FastTriggerOddsPolicy = {
    values: [...FT_ODDS_POLICY_VALUES],
    get: ftGetOddsChangePolicy,
    parse: ftParseOddValue,
    read: ftReadOddsChangeInfo,
  };
  window.FastTriggerPlaceBetTesting = Object.freeze({
    ftIsExplicitFinalConfirmation,
    ftFindExplicitSecondStageButton,
    ftHasBet365CommitAcknowledged,
    ftWaitForBet365CommitTransition,
    ftRefreshDirectOrderLearning,
  });
  window.triggerPlaceBet = triggerPlaceBet;
}
