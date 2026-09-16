// =========================================================================
// FAST TRIGGER PRO - INJETOR DE STAKE DINÂMICO (SEM VALORES FIXOS)
// =========================================================================

function parseNumericStake(rawValStr) {
  if (!rawValStr) {
    if (window.FastTriggerExpectedExecutionStake) {
      rawValStr = window.FastTriggerExpectedExecutionStake;
    } else if (window.FastTriggerConfig?.stakeValByHouse?.bet365) {
      rawValStr = window.FastTriggerConfig.stakeValByHouse.bet365;
    } else if (window.FastTriggerConfig?.stakeVal) {
      rawValStr = window.FastTriggerConfig.stakeVal;
    } else {
      return 0.50;
    }
  }
  let str = rawValStr.toString().replace(/R\$/gi, '').trim();
  str = str.replace(/[^\d,.]/g, '');
  if (!str) {
    const fallback =
      window.FastTriggerExpectedExecutionStake ||
      window.FastTriggerConfig?.stakeValByHouse?.bet365 ||
      window.FastTriggerConfig?.stakeVal;
    if (fallback && fallback !== rawValStr) return parseNumericStake(fallback);
    return 0.50;
  }

  if (str.includes('.') && str.includes(',')) {
    str = str.replace(/\./g, '').replace(',', '.');
  } else if (str.includes(',')) {
    str = str.replace(',', '.');
  }
  const num = parseFloat(str);
  return isNaN(num) ? 0.50 : num;
}

function stakeTrace(event, details = {}) {
  try {
    const trace = { event: `stake_${event}`, ...details };
    console.log('[BetFlow TRACE]', trace);
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({ action: 'TRACE_BETFLOW', trace }, () => { void chrome.runtime.lastError; });
    }
  } catch (e) {}
}

function formatStakeForBet365(rawValStr) {
  const num = parseNumericStake(rawValStr);
  if (Number.isInteger(num)) {
    return num.toString();
  }
  return num.toFixed(2).replace('.', ',');
}

function readStakeControlValue(control) {
  if (!control) return '';
  const tagName = (control.tagName || '').toUpperCase();
  const isNativeValueControl = tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT';
  return (isNativeValueControl ? control.value : control.textContent || '').trim();
}

// Usa o setter nativo para que campos controlados por React reconheçam a alteração.
function setStakeControlValue(control, value) {
  if (!control) return;

  const tagName = (control.tagName || '').toUpperCase();
  const isNativeValueControl = tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT';

  if (isNativeValueControl) {
    const descriptor = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(control),
      'value'
    );
    if (descriptor && typeof descriptor.set === 'function') {
      descriptor.set.call(control, value);
    } else {
      control.value = value;
    }
    return;
  }

  control.textContent = value;
}

// Expurga classes de estado vazio (-empty)
function purgeGen5EmptyClasses(el) {
  if (!el) return;
  const cleanNode = (node) => {
    if (!node || !node.classList) return;
    const emptyClasses = Array.from(node.classList).filter(c => c.toLowerCase().includes('empty'));
    emptyClasses.forEach(cls => node.classList.remove(cls));
  };

  cleanNode(el);
  const container = el.closest('[class*="StakeBox"], [class*="StakeInputContainer"], [class*="bsf-"], [class*="bss-"]');
  if (container) {
    cleanNode(container);
    container.querySelectorAll('[class*="empty"], [class*="Empty"]').forEach(cleanNode);
  }
}

function isUsableStakeControl(control) {
  if (!control || !control.isConnected) return false;
  const rect = control.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  if (control.hasAttribute('disabled') || control.getAttribute('aria-disabled') === 'true') return false;
  return true;
}

function findBet365StakeEditable() {
  const selectors = [
    '.bsf-StakeBox .bsf-StakeBox_StakeValue-input[contenteditable="true"]',
    '.bss-StakeBox .bss-StakeBox_StakeValue-input[contenteditable="true"]',
    '[class*="StakeBox"] [class*="StakeValue-input"][contenteditable="true"]',
    '[class*="StakeBox"] input[class*="StakeValue"]',
    '[class*="StakeBox"] input[class*="Stake"]'
  ];

  const candidates = Array.from(document.querySelectorAll(selectors.join(', ')));
  return candidates.find(isUsableStakeControl) || null;
}

function isVisibleCurrentBetslipNode(node) {
  if (!node || !node.isConnected) return false;
  const rect = node.getBoundingClientRect?.();
  if (!rect || rect.width <= 0 || rect.height <= 0) return false;
  const slip = node.closest?.(
    '.bss-StandardBetslip, .bsm-BetslipStandardModule, [class*="BetslipStandardModule"]',
  );
  if (!slip) return true;
  const slipClass = typeof slip.className === 'string' ? slip.className : '';
  if (/(?:^|[\s_-])hidden(?:[\s_-]|$)/i.test(slipClass)) return false;
  const slipRect = slip.getBoundingClientRect?.();
  return !slipRect || (slipRect.width > 0 && slipRect.height > 0);
}

function readBet365StakeSummaryValue(node) {
  const text = (node?.innerText || node?.textContent || '')
    .toString()
    .replace(/\s+/g, ' ')
    .trim();
  const match = text.match(
    /(?:^|\s)aposta(?:\s+total)?\s*r\$\s*([\d.]+(?:,\d{1,2})?|[\d,]+(?:\.\d{1,2})?)/i,
  );
  return match?.[1] || '';
}

// Devolve `null` quando não há CTA financeiro habilitado e `undefined` quando o
// localizador não existe no ambiente — nesse caso o contrato antigo continua
// valendo e a validação segue apenas pelo valor.
function findReadyFinancialCta() {
  if (typeof window.findReadyPlaceBetButton !== 'function') return undefined;
  try {
    return window.findReadyPlaceBetButton() || null;
  } catch (error) {
    return null;
  }
}

function findBet365ReadyStakeState(targetValue) {
  const targetNumeric = typeof targetValue === 'number'
    ? targetValue
    : parseNumericStake(targetValue);
  if (!Number.isFinite(targetNumeric) || targetNumeric <= 0) return null;

  // O campo é um contenteditable controlado pela Bet365: o texto que nós mesmos
  // escrevemos nele não prova nada. A prova independente é o CTA financeiro
  // habilitado, que só acende quando o cupom aceitou um valor válido. Sem essa
  // trava a escrita direta se autocertificava e o cupom seguia vazio.
  const button = findReadyFinancialCta();
  if (button === null) return null;

  const liveControl = findBet365StakeEditable();
  const liveValue = readStakeControlValue(liveControl);
  if (
    liveValue &&
    Math.abs(parseNumericStake(liveValue) - targetNumeric) < 0.01
  ) {
    return { button: button || null, evidence: liveControl, targetNumeric };
  }

  // Uma mudança de odd recria o contenteditable, mas o rodapé atual já pode
  // ter aceitado a stake. Só confiamos no resumo visível do cupom corrente.
  const selectors = [
    '.bss-Footer_DetailsContainer',
    '.bsf-StakeBox',
    '.bsf-PlaceBetButton',
    '.bsf-AcceptButton',
  ].join(', ');
  const summaries = Array.from(document.querySelectorAll(selectors) || []);
  const summary = summaries.find((node) => {
    if (!isVisibleCurrentBetslipNode(node)) return false;
    const value = readBet365StakeSummaryValue(node);
    return value && Math.abs(parseNumericStake(value) - targetNumeric) < 0.01;
  }) || null;
  return summary ? { button: button || null, evidence: summary, targetNumeric } : null;
}

function findBet365ConfirmedStakeEvidence(targetNumeric) {
  return findBet365ReadyStakeState(targetNumeric)?.evidence || null;
}

function ftMarkStakeExecutionStage(reasonCode) {
  const actionId = window.FastTriggerState?.activeExecutionActionId;
  if (!actionId || typeof window.FastTriggerExecutionReport?.mark !== 'function') {
    return;
  }
  window.FastTriggerExecutionReport.mark(actionId, 'stake', { reasonCode });
}

var BET365_STAKE_ROOT_SELECTOR =
  '[data-testid*="betslip" i], [class*="Betslip"], [class*="BetSlip"], [class*="betslip"], [class*="StakeBox"]';

function findBet365StakeWaitRoot() {
  const control = findBet365StakeEditable();
  const scoped = control?.closest?.(BET365_STAKE_ROOT_SELECTOR);
  if (scoped) return scoped;

  // `[class*="Betslip"]` também casa com o contador do cabeçalho, que aparece
  // antes do cupom em ordem de documento e praticamente nunca muta. Observar
  // aquele nó queimava o timeout inteiro sem uma única notificação, deixando só
  // as verificações de t=0 e de t=timeout. Serve de raiz apenas um container que
  // contenha a caixa de stake; na dúvida, o documento inteiro.
  const candidates = Array.from(
    document.querySelectorAll(BET365_STAKE_ROOT_SELECTOR) || [],
  );
  const withStakeBox = candidates.find((node) => {
    try {
      return Boolean(node.querySelector?.('[class*="StakeBox"], [class*="StakeValue"]'));
    } catch (error) {
      return false;
    }
  });
  return withStakeBox || document;
}

async function waitForBet365StakeEditable(timeoutMs = 900) {
  const reactiveWaiter = window.FastTriggerDom?.waitForSignal;
  if (typeof reactiveWaiter === 'function') {
    return await reactiveWaiter(
      () => findBet365StakeEditable(),
      {
        timeoutMs,
        events: ['input', 'beforeinput', 'change', 'focusout', 'keydown', 'keyup'],
        root: findBet365StakeWaitRoot(),
      },
    );
  }

  const domWaiter = window.FastTriggerDom?.waitFor;
  if (typeof domWaiter === 'function') {
    return await domWaiter(
      () => findBet365StakeEditable(),
      { timeoutMs, intervalMs: 8 },
    );
  }

  const startedAt = Date.now();
  let editable = findBet365StakeEditable();

  while (!editable && (Date.now() - startedAt) < timeoutMs) {
    await new Promise(resolve => setTimeout(resolve, 20));
    editable = findBet365StakeEditable();
  }

  return editable;
}

function dispatchStakeInputEvent(control, type, options = {}) {
  if (!control) return;

  try {
    if (type === 'beforeinput' || type === 'input') {
      control.dispatchEvent(new InputEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        ...options
      }));
      return;
    }

    control.dispatchEvent(new Event(type, { bubbles: true, composed: true }));
  } catch (e) {}
}

function writeStakeValueDirect(control, cleanVal) {
  if (!isUsableStakeControl(control)) return false;
  try {
    try {
      control.focus({ preventScroll: true });
    } catch (e) {
      control.focus();
    }

    purgeGen5EmptyClasses(control);
    setStakeControlValue(control, '');
    dispatchStakeInputEvent(control, 'beforeinput', {
      inputType: 'deleteContentBackward',
      data: null,
    });
    dispatchStakeInputEvent(control, 'input', {
      inputType: 'deleteContentBackward',
      data: null,
    });
    dispatchStakeInputEvent(control, 'beforeinput', {
      inputType: 'insertText',
      data: cleanVal,
    });
    setStakeControlValue(control, cleanVal);
    dispatchStakeInputEvent(control, 'input', {
      inputType: 'insertText',
      data: cleanVal,
    });
    dispatchStakeInputEvent(control, 'change');
    // Sem `blur()` aqui: o passo seguinte é a digitação nativa, que exige este
    // campo focado. Tirar o foco ainda dava à Bet365 a chance de repintar a
    // caixa a partir do estado interno dela, que continua vazio.
    return true;
  } catch (e) {
    return false;
  }
}

// Foca e confere: a Bet365 pode mover o foco enquanto o cupom anima, e a
// digitação nativa do CDP vai para onde o foco estiver. Quem chama decide se
// tenta de novo — antes essa checagem era um retorno silencioso.
function focusStakeControl(control) {
  if (!isUsableStakeControl(control)) return false;
  try {
    try {
      control.focus({ preventScroll: true });
    } catch (e) {
      control.focus();
    }
  } catch (e) {
    return false;
  }
  return document.activeElement === control;
}

// 160 ms é o teto de espera, não o custo: o waiter reativo resolve no primeiro
// mutation em que o CTA acende. Os 48 ms anteriores estouravam antes de a Bet365
// habilitar o botão, então o caminho DOM era descartado mesmo quando funcionava.
async function waitForDirectStakeAcceptance(targetNumeric, timeoutMs = 160) {
  const reactiveWaiter = window.FastTriggerDom?.waitForSignal;
  if (typeof reactiveWaiter === 'function') {
    return await reactiveWaiter(
      () => {
        const evidence = findBet365ConfirmedStakeEvidence(targetNumeric);
        if (!evidence) return null;
        return evidence;
      },
      {
        timeoutMs,
        events: ['input', 'beforeinput', 'change', 'focusout', 'keydown', 'keyup'],
        root: findBet365StakeWaitRoot(),
      },
    );
  }

  const startedAt = performance.now();
  let stableReads = 0;

  while (performance.now() - startedAt < timeoutMs) {
    const liveControl = findBet365StakeEditable();
    const evidence = findBet365ConfirmedStakeEvidence(targetNumeric);

    // A prova de CTA já está dentro de `findBet365ConfirmedStakeEvidence`; aqui
    // só exigimos que ela se repita, para não aceitar um quadro intermediário.
    stableReads = evidence ? stableReads + 1 : 0;
    if (stableReads >= 2) return evidence || liveControl;

    await new Promise(resolve => setTimeout(resolve, 6));
  }
  return null;
}

async function requestTrustedStakeText(control, cleanVal, fastMode = false) {
  if (
    !isUsableStakeControl(control) ||
    typeof chrome === 'undefined' ||
    !chrome.runtime ||
    !chrome.runtime.sendMessage
  ) {
    return false;
  }

  // O tamanho do valor atual vira a rajada de limpeza do lado do CDP: se o
  // atalho de "selecionar tudo" não for interpretado, os dígitos novos não
  // podem se concatenar com o valor antigo.
  const clearLength = readStakeControlValue(control).length;

  try {
    if (!focusStakeControl(control)) {
      await new Promise(resolve => setTimeout(resolve, 12));
      if (!focusStakeControl(control)) {
        console.warn(
          '[Fast Trigger Stake] O campo de stake nao aceitou o foco; a digitacao nativa foi ignorada.',
        );
        return false;
      }
    }

    if (window.FastTriggerState) {
      window.FastTriggerState.nativeTextEntryInProgress = true;
    }

    const response = await new Promise(resolve => {
      chrome.runtime.sendMessage({
        action: 'PRODUCE_TRUSTED_TEXT',
        text: cleanVal,
        clearLength,
        // Na Bet365 o contenteditable pode refletir Input.insertText somente
        // no DOM, sem atualizar o estado React/CTA. Use teclas reais pelo CDP
        // para que keydown/keyup sejam processados pela própria casa.
        preferInsertText: false,
      }, result => {
        if (chrome.runtime.lastError) {
          resolve({ status: 'ERROR', error: chrome.runtime.lastError.message });
          return;
        }
        resolve(result);
      });
    });

    if (response && response.status === 'OK') {
      console.log(
        `[Fast Trigger Stake] Digitação nativa concluída em ${response.latencyMs || '<3'}ms.`
      );
      return true;
    }

    // Sem este aviso, um CDP indisponível (DevTools aberto, permissão negada)
    // ficava invisível e o sintoma aparecia só como stake vazia.
    console.warn(
      '[Fast Trigger Stake] Digitacao nativa indisponivel:',
      response?.error || response?.message || 'sem resposta do service worker',
    );
  } catch (e) {
    console.warn('[Fast Trigger Stake] Falha ao solicitar digitacao nativa:', e);
  } finally {
    setTimeout(() => {
      if (window.FastTriggerState) {
        window.FastTriggerState.nativeTextEntryInProgress = false;
      }
    }, 80);
  }

  return false;
}

async function writeStakeValueToVisibleControl(control, cleanVal, fastMode = false) {
  if (!isUsableStakeControl(control)) return null;
  const targetNumeric = parseNumericStake(cleanVal);

  if (fastMode && writeStakeValueDirect(control, cleanVal)) {
    const acceptedControl = await waitForDirectStakeAcceptance(targetNumeric);
    if (acceptedControl) {
      console.log('[Fast Trigger Stake] Stake aceita pelo caminho DOM instantaneo.');
      ftMarkStakeExecutionStage('stake_ready');
      return acceptedControl;
    }
    console.log('[Fast Trigger Stake] DOM nao confirmou a stake; usando entrada nativa.');
  }

  // Caminho principal: foco direto e digitação nativa. Isso atualiza o estado
  // interno do contenteditable controlado pela Bet365, não apenas seu texto.
  const trustedControl = findBet365StakeEditable() || control;
  const trustedTypingSucceeded = await requestTrustedStakeText(trustedControl, cleanVal, fastMode);
  if (trustedTypingSucceeded) {
    const acceptedControl = await waitForDirectStakeAcceptance(targetNumeric, fastMode ? 450 : 320);
    ftMarkStakeExecutionStage(acceptedControl ? 'stake_typed' : 'stake_typed_unconfirmed');
    // Não trate texto visível como sucesso. Sem CTA/estado confirmado a
    // próxima tentativa usará o caminho seguro, em vez de confirmar cupom
    // vazio ou manter um valor apenas visual.
    return acceptedControl || null;
  }

  // Fallback sintético para ambientes onde o CDP não estiver disponível.
  control.focus();
  if (!fastMode) await new Promise(resolve => setTimeout(resolve, 10));
  if (!isUsableStakeControl(control)) return null;

  setStakeControlValue(control, '');
  dispatchStakeInputEvent(control, 'beforeinput', {
    inputType: 'deleteContentBackward',
    data: null
  });
  dispatchStakeInputEvent(control, 'input', {
    inputType: 'deleteContentBackward',
    data: null
  });

  for (const char of cleanVal) {
    if (!isUsableStakeControl(control)) return null;

    dispatchStakeInputEvent(control, 'beforeinput', {
      inputType: 'insertText',
      data: char
    });
    setStakeControlValue(control, readStakeControlValue(control) + char);
    dispatchStakeInputEvent(control, 'input', {
      inputType: 'insertText',
      data: char
    });
    if (!fastMode) await new Promise(resolve => setTimeout(resolve, 3));
  }

  dispatchStakeInputEvent(control, 'change');
  // Não dispare `blur` artificialmente aqui. Na Bet365 o `blur` do campo é
  // tratado como clique fora do cupom durante a animação de abertura; quando
  // o preenchimento sintético era usado, esse evento podia desmontar/fechar o
  // bet slip imediatamente após inserir a stake. O CTA financeiro consegue
  // validar o valor a partir dos eventos `input`/`change`; mantemos o foco no
  // controle até a etapa explícita de confirmação.
  ftMarkStakeExecutionStage('stake_fallback_typed');
  return control;
}

// 1. ROLA O ELEMENTO INSTANTANEAMENTE (SEM SMOOTH SCROLL)
function scrollToOddInstant(oddEl) {
  if (!oddEl) return;
  try {
    // Evite reposicionar a página inteira quando a odd já está visível. O
    // `block:center` anterior podia deslocar o bet slip flutuante para baixo do
    // ponteiro e, em seguida, o clique sintético era interpretado como clique
    // fora do cupom. `nearest` só rola o mínimo necessário.
    const rect = oddEl.getBoundingClientRect?.();
    const viewportH = window.innerHeight || document.documentElement?.clientHeight || 0;
    const visible = rect && rect.top >= 0 && rect.bottom <= viewportH;
    if (visible) return;
    oddEl.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
  } catch (e) {
    oddEl.scrollIntoView(false);
  }
}

async function performBet365StakeFill(valStr, fastMode = false) {
  try {
    if (!valStr) {
      valStr =
        window.FastTriggerExpectedExecutionStake ||
        window.FastTriggerConfig?.stakeVal;
    }

    if (!valStr) {
      console.warn('[Fast Trigger Stake] Nenhuma stake configurada no painel.');
      return false;
    }

    const targetNumeric = parseNumericStake(valStr);
    const cleanVal = formatStakeForBet365(valStr);
    let currentDomValue = '';

    console.log(`[Fast Trigger Stake] Injetando stake dinâmica R$ ${targetNumeric} (clean: ${cleanVal})`);
    stakeTrace('start', { targetNumeric, fastMode });

    // O cupom pode chegar aqui já pronto (inclusive após uma renderização rápida
    // da Bet365). Valide antes de esperar pelo contenteditable: essa espera era o
    // principal custo variável entre apostas idênticas.
    if (findBet365ReadyStakeState(targetNumeric)) {
      ftMarkStakeExecutionStage('stake_ready_preexisting');
      console.log(`[Fast Trigger Stake] Stake R$ ${targetNumeric} já estava pronta; preenchimento ignorado.`);
      return true;
    }

    for (let fillAttempt = 0; fillAttempt < 3; fillAttempt++) {
      if (findBet365ReadyStakeState(targetNumeric)) {
        ftMarkStakeExecutionStage('stake_ready_preexisting');
        return true;
      }

      // O cupom pode substituir o contenteditable enquanto anima. Cada nova
      // tentativa parte do campo atualmente conectado e visível.
      const editableTarget = await waitForBet365StakeEditable(
        fillAttempt === 0 ? (fastMode ? 350 : 1200) : (fastMode ? 250 : 500),
      );
      if (!editableTarget) {
        stakeTrace('editable_missing', { attempt: fillAttempt + 1 });
        console.warn(
          `[Fast Trigger Stake] Campo de stake nao encontrado na tentativa ${fillAttempt + 1}.`,
        );
        continue;
      }

      const existingDomTxt = readStakeControlValue(editableTarget);
      // "Já preenchida" também precisa de prova independente. O valor que sobrou
      // de uma escrita que a Bet365 recusou fazia esta leitura se
      // autocertificar: a tentativa 2 encontrava o próprio resíduo da tentativa
      // 1 e devolvia sucesso com o cupom vazio.
      if (existingDomTxt && findBet365ConfirmedStakeEvidence(targetNumeric)) {
        console.log(`[Fast Trigger Stake] Stake R$ ${targetNumeric} já está preenchida e validada no cupom.`);
        return true;
      }

      // Tente insertText apenas na primeira passagem rápida; se a casa não
      // refletir o valor no React, as tentativas seguintes usam teclas nativas.
      const writtenControl = await writeStakeValueToVisibleControl(
        editableTarget,
        cleanVal,
        fastMode && fillAttempt === 0,
      );
      if (!writtenControl) { stakeTrace('write_failed', { attempt: fillAttempt + 1 }); continue; }

      // Não valida a referência antiga: o React pode trocá-la após o input.
      for (let checkAttempt = 0; checkAttempt < (fastMode ? 14 : 20); checkAttempt++) {
        const evidence = findBet365ConfirmedStakeEvidence(targetNumeric);
        const visibleControl = findBet365StakeEditable();
        if (visibleControl) currentDomValue = readStakeControlValue(visibleControl);

        if (evidence) {
          stakeTrace('validated', { attempt: fillAttempt + 1, checkAttempt: checkAttempt + 1, evidence: evidence === visibleControl ? 'input' : 'summary' });
          if (evidence === visibleControl) {
            console.log(
              `[Fast Trigger Stake] STAKE DINÂMICA R$ ${targetNumeric} INJETADA E VALIDADA NO DOM. Valor atual:`,
              currentDomValue
            );
          } else {
            console.log(
              `[Fast Trigger Stake] STAKE DINÂMICA R$ ${targetNumeric} CONFIRMADA NO RESUMO VISÍVEL DO CUPOM.`,
            );
            ftMarkStakeExecutionStage('stake_ready_from_summary');
          }
          return true;
        }

        await new Promise(resolve => setTimeout(resolve, fastMode ? 8 : 20));
      }
    }

    console.warn(
      '[Fast Trigger Stake] O campo visível não confirmou o valor após as tentativas. Valor lido no campo:',
      currentDomValue || '(vazio)',
      '| CTA financeiro habilitado:',
      findReadyFinancialCta() ? 'sim' : 'nao',
    );
    stakeTrace('failed', { currentDomValue: String(currentDomValue || '').slice(0, 40), ctaReady: Boolean(findReadyFinancialCta?.()) });
    return false;
  } catch (err) {
    console.error('[Fast Trigger Stake] Erro ao preencher stake dinâmica:', err);
    return false;
  }
}

let activeStakeFillPromise = null;

async function fillBet365StakeGen5(valStr, fastMode = false) {
  // O content script é carregado em todos os frames da Bet365. Apenas o
  // documento principal pode operar o cupom e solicitar digitação nativa.
  if (typeof window !== 'undefined' && window !== window.top) {
    return false;
  }

  if (activeStakeFillPromise) {
    return activeStakeFillPromise;
  }

  const fillPromise = performBet365StakeFill(valStr, fastMode);
  activeStakeFillPromise = fillPromise;

  try {
    return await fillPromise;
  } finally {
    if (activeStakeFillPromise === fillPromise) {
      activeStakeFillPromise = null;
    }
  }
}

async function handleOddSelectionWithInstantScroll(oddElement) {
  if (!oddElement) return false;
  scrollToOddInstant(oddElement);
  // Depósito do `selectionId` antes do clique: mesma regra do motor de gatilho.
  try {
    window.FastTriggerSelectionResolver?.deposit?.(oddElement);
  } catch (error) {}
  oddElement.click();
  const stakeVal =
    window.FastTriggerExpectedExecutionStake ||
    window.FastTriggerConfig?.stakeValByHouse?.bet365 ||
    window.FastTriggerConfig?.stakeVal ||
    '0,50';
  const valStr = formatStakeForBet365(stakeVal);
  return await fillBet365StakeGen5(valStr);
}

async function injectStakeGen5Direct(valStr) {
  return await fillBet365StakeGen5(valStr);
}

async function pollAndFillStake(attempts = 2, fastMode = false) {
  const stakeVal =
    window.FastTriggerExpectedExecutionStake ||
    window.FastTriggerConfig?.stakeValByHouse?.bet365 ||
    window.FastTriggerConfig?.stakeVal ||
    '0,50';
  const valStr = formatStakeForBet365(stakeVal);
  return await fillBet365StakeGen5(valStr, fastMode);
}





function getBet365AccountBalance() {
  try {
    const dynamicPayload = (typeof getDynamicEnginePayload === 'function')
      ? getDynamicEnginePayload()
      : (typeof window !== 'undefined' ? window.GatilhoBRDynamicPayload : null);

    const dynBalanceSelector = dynamicPayload?.selectors?.balance;

    // 1. SELETORES DIRETOS AMPLIADOS (Gen5 Rebrand & Gen4)
    const balanceSelectors = [
      dynBalanceSelector,
      '[class*="Balance"]',
      '[class*="UserBalance"]',
      '[class*="HeaderMembers"]',
      '[class*="MembersHeader"]',
      '.hm-MainHeaderMembersWide_MembersMenuRebrand',
      '.hm-MainHeaderRHS_Balance',
      '.hm-Balance',
      '[class*="Header"]'
    ].filter(Boolean);

    let foundText = '';

    for (const sel of balanceSelectors) {
      const nodes = Array.from(document.querySelectorAll(sel));
      for (const el of nodes) {
        if (!el || el.offsetWidth === 0 || el.offsetHeight === 0) continue;
        const txt = (el.innerText || el.textContent || '').trim();

        if (txt && (txt.includes('R$') || txt.includes('$') || txt.includes('BRL') || /\d+[\.,]\d{2}/.test(txt))) {
          const match = txt.match(/(?:R\$\s*|BRL\s*|\$\s*)?([\d.]+(?:,\d{2})?|[\d,]+(?:\.\d{2})?)/i);
          if (match && match[1]) {
            foundText = match[1];
            console.log(`[Fast Trigger] 💰 Saldo localizado via seletor "${sel}":`, txt, '->', foundText);
            break;
          }
        }
      }
      if (foundText) break;
    }

    // 2. FALLBACK POR VARREDURA DE TEXTO ("R$") NOS ELEMENTOS DO CABEÇALHO / HEADER
    if (!foundText) {
      const headerEls = Array.from(document.querySelectorAll('header, [class*="Header"], [class*="Members"], nav, [class*="TopBar"]'));
      for (const el of headerEls) {
        if (!el || el.offsetWidth === 0) continue;
        const txt = (el.innerText || el.textContent || '').trim();
        if (txt && txt.includes('R$')) {
          const match = txt.match(/R\$\s*([\d.]+(?:,\d{2})?|[\d,]+(?:\.\d{2})?)/i);
          if (match && match[1]) {
            foundText = match[1];
            console.log('[Fast Trigger] 💰 Saldo localizado via fallback de texto ("R$"):', txt, '->', foundText);
            break;
          }
        }
      }
    }

    if (!foundText) {
      console.warn('[Fast Trigger] ⚠️ Elemento de saldo da conta não encontrado no DOM.');
      return '0,00';
    }

    let cleanBalance = foundText.replace(/[^\d,.]/g, '').trim();
    if (!cleanBalance) return '0,00';

    console.log('[Fast Trigger] 💰 Saldo final extraído do DOM:', cleanBalance);
    return cleanBalance;
  } catch (err) {
    console.error('[Fast Trigger] Erro ao raspar saldo da conta (Isolado):', err);
    return '0,00';
  }
}



if (typeof window !== 'undefined') {
  window.formatStakeForBet365 = formatStakeForBet365;
  window.purgeGen5EmptyClasses = purgeGen5EmptyClasses;
  // Reutilizados pelos adapters que possuem inputs React controlados. O
  // adapter tenta primeiro o setter DOM (caminho instantâneo) e só recorre à
  // digitação nativa quando a própria página rejeita esse valor.
  window.writeStakeValueDirect = writeStakeValueDirect;
  window.requestTrustedStakeText = requestTrustedStakeText;
  window.findBet365ReadyStakeState = findBet365ReadyStakeState;
  window.FastTriggerStakeTesting = Object.freeze({
    parseNumericStake,
    readBet365StakeSummaryValue,
    isVisibleCurrentBetslipNode,
    findBet365ReadyStakeState,
    findBet365ConfirmedStakeEvidence,
    performBet365StakeFill,
  });
  window.scrollToOddInstant = scrollToOddInstant;
  window.fillBet365StakeGen5 = fillBet365StakeGen5;
  window.handleOddSelectionWithInstantScroll = handleOddSelectionWithInstantScroll;
  window.pollAndFillStake = pollAndFillStake;
  window.getBet365AccountBalance = getBet365AccountBalance;
}

if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request && request.action === 'GET_ACCOUNT_BALANCE') {
      const balance = getBet365AccountBalance();
      sendResponse({ balance: balance });
      return true;
    }
  });
}
