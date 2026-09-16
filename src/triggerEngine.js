// =========================================================================
// FAST TRIGGER PRO - RESOLUÇÃO DE BOTÕES E EXECUÇÃO DE APOSTAS
// =========================================================================

function normalizeStr(str) {
  if (!str) return "";
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

if (typeof window !== "undefined") {
  window.normalizeStr = normalizeStr;
}

function isElementClickable(el) {
  if (
    !el ||
    !document.contains(el) ||
    el.offsetWidth === 0 ||
    el.offsetHeight === 0
  )
    return false;
  try {
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  } catch (e) {
    return true;
  }
}

function getActivePlaceBetBtn() {
  try {
    if (typeof window.findReadyPlaceBetButton === "function") {
      return window.findReadyPlaceBetButton();
    }

    const dynamicPayload =
      typeof getDynamicEnginePayload === "function"
        ? getDynamicEnginePayload()
        : typeof window !== "undefined"
          ? window.GatilhoBRDynamicPayload
          : null;

    const dynBtnSelector = dynamicPayload?.selectors?.placeBetButton;
    const selectorsList = [
      dynBtnSelector,
      ".bs-InPlayPlaceBetButton",
      ".bs-PlaceBetButton",
      '[class*="BtnPlaceBet"]',
      'button[class*="PlaceBet"]',
      '[class*="PlaceBetButton"]',
      ".bs-BtnPlaceBet",
      'button[type="submit"]',
    ]
      .filter(Boolean)
      .join(", ");

    const btns = document.querySelectorAll(selectorsList);
    for (let i = 0; i < btns.length; i++) {
      const b = btns[i];
      const className = b
        ? typeof b.className === "string"
          ? b.className
          : ""
        : "";
      const disabled =
        b &&
        (b.disabled ||
          b.hasAttribute("disabled") ||
          b.getAttribute("aria-disabled") === "true" ||
          /disabled|locked|suspended/i.test(className));
      if (b && document.contains(b) && b.offsetWidth > 0 && !disabled) {
        if (isElementClickable(b)) return b;
      }
    }
  } catch (e) {}
  return null;
}

function getActiveAcceptOddsBtn() {
  try {
    const acceptBtns = document.querySelectorAll(
      '.bs-AcceptButton, button[class*="accept"], [class*="AcceptButton"], [class*="AcceptOdds"]',
    );
    for (let i = 0; i < acceptBtns.length; i++) {
      const b = acceptBtns[i];
      if (b && document.contains(b) && b.offsetWidth > 0 && !b.disabled) {
        if (isElementClickable(b)) return b;
      }
    }
  } catch (e) {}
  return null;
}

var isGatilhoBRLicenseValid = false;
var noticeEl = null;

function removeBet365HeaderNotice() {
  if (noticeEl && noticeEl.parentNode) {
    noticeEl.parentNode.removeChild(noticeEl);
    noticeEl = null;
  }
}

var ALLOWED_HOSTS = [
  "bet365.com",
  "bet365.bet.br",
  "bet365.es",
  "betfair.com",
  "betfair.bet.br",
  "betfair.es",
  "betnacional.com",
  "betnacional.bet.br",
  "betnacional.br",
  "betano.bet.br",
];

function isBettingSite() {
  if (
    typeof window === "undefined" ||
    !window.location ||
    !window.location.hostname
  )
    return false;
  const currentHost = window.location.hostname.toLowerCase();
  return ALLOWED_HOSTS.some((host) => currentHost.includes(host));
}

function renderBet365HeaderNotice(reason, customMessage) {
  try {
    // A autenticação/licença é exibida e administrada pela dashboard Electron.
    // No modo integrado, não mostrar uma barra enganosa na casa dizendo que o
    // usuário precisa autenticar novamente na extensão.
    if (window.FastTriggerExternalElectronMode === true) {
      removeBet365HeaderNotice();
      return;
    }
    if (!isBettingSite()) {
      removeBet365HeaderNotice();
      return;
    }

    let msgText = "GatilhoBR: Faça login na extensão para ativar o motor.";
    if (reason === "trial_expired") {
      msgText =
        "GatilhoBR: Seu período de teste de 24h encerrou. Renove sua licença.";
    } else if (reason === "license_expired") {
      msgText =
        "GatilhoBR: Sua assinatura expirou. Renove para liberar o motor.";
    } else if (
      customMessage &&
      !customMessage.includes("RLS") &&
      !customMessage.includes("Perfil não encontrado")
    ) {
      msgText = customMessage;
    }

    if (!noticeEl) {
      noticeEl = document.createElement("div");
      noticeEl.id = "gatilhobr-license-notice";
      noticeEl.style.cssText = `
        background: linear-gradient(90deg, #1f0a0d, #2d0d12);
        border-bottom: 1.5px solid #ff4757;
        color: #ff6b81;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 12px;
        font-weight: bold;
        padding: 8px 16px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        z-index: 9999999;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        width: 100vw;
        box-sizing: border-box;
      `;

      const textSpan = document.createElement("span");
      textSpan.id = "gatilhobr-notice-text";
      textSpan.innerHTML = `🔒 <strong>${msgText}</strong>`;

      const btnOpen = document.createElement("button");
      btnOpen.innerText = "⚡ Abrir Painel";
      btnOpen.style.cssText = `
        background: #ff4757;
        border: none;
        color: #ffffff;
        padding: 5px 12px;
        border-radius: 4px;
        font-size: 11px;
        font-weight: 800;
        cursor: pointer;
        transition: all 0.2s ease;
      `;

      btnOpen.onclick = () => {
        if (
          typeof chrome !== "undefined" &&
          chrome.runtime &&
          chrome.runtime.sendMessage
        ) {
          chrome.runtime.sendMessage({ action: "OPEN_DASHBOARD" });
        }
      };

      noticeEl.appendChild(textSpan);
      noticeEl.appendChild(btnOpen);
      document.body.appendChild(noticeEl);
    } else {
      const textSpan = document.getElementById("gatilhobr-notice-text");
      if (textSpan) {
        textSpan.innerHTML = `🔒 <strong>${msgText}</strong>`;
      }
    }
  } catch (e) {}
}

async function verifyEngineLicense() {
  try {
    if (typeof window !== "undefined" && window.FastTriggerExternalElectronMode === true) {
      isGatilhoBRLicenseValid = true;
      removeBet365HeaderNotice();
      console.log("[GatilhoBR Engine] ⚡ Modo Integrado Electron: Licença Válida & Motor Ativo.");
      return;
    }
    const checkFn =
      typeof ensureGatilhoBRLicense === "function"
        ? ensureGatilhoBRLicense
        : typeof window !== "undefined" && window.ensureGatilhoBRLicense
          ? window.ensureGatilhoBRLicense
          : null;

    if (checkFn) {
      const res = await checkFn();
      if (res && res.valid) {
        isGatilhoBRLicenseValid = true;
        removeBet365HeaderNotice();
        console.log("[GatilhoBR Engine] ⚡ Licença Válida & Motor Ativo.");
      } else {
        isGatilhoBRLicenseValid = false;
        const msg =
          res?.message ||
          "GatilhoBR: Acesso não autorizado. Assine para liberar o motor.";
        renderBet365HeaderNotice(res ? res.reason : "unauthorized", msg);
        console.warn(
          "[GatilhoBR Engine] 🔒 Acesso não autorizado. Injeção do motor interrompida.",
        );
      }
    } else {
      isGatilhoBRLicenseValid = false;
      renderBet365HeaderNotice(
        "license_checker_unavailable",
        "Validação de licença indisponível.",
      );
    }
  } catch (err) {
    console.error(
      "[GatilhoBR Engine] Erro na validação de licença do engine:",
      err,
    );
    isGatilhoBRLicenseValid = false;
    renderBet365HeaderNotice(
      "license_check_failed",
      "Não foi possível validar sua licença.",
    );
  }
}

if (isBettingSite()) {
  verifyEngineLicense();
}

if (
  typeof chrome !== "undefined" &&
  chrome.storage &&
  chrome.storage.onChanged
) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (
      area === "local" &&
      (changes.gbr_auth_token || changes.gbr_license_status)
    ) {
      verifyEngineLicense();
    }
  });
}

let triggerTimestamps = [];

function isRateLimitExceeded() {
  const now = Date.now();
  triggerTimestamps = triggerTimestamps.filter((t) => now - t < 5000);

  if (triggerTimestamps.length >= 3) {
    console.warn(
      "[GatilhoBR Engine] ⚠️ Trava de Segurança Ativa: Limite de 3 disparos em 5s atingido.",
    );
    if (typeof showFlashFeedback === "function") {
      showFlashFeedback("⚠️ Trava de Segurança (Max 3 disparos em 5s)");
    }
    return true;
  }

  triggerTimestamps.push(now);
  return false;
}

async function executeCachedTrigger(isHotkey = false) {
  const electronAuthorized = Number(window.FastTriggerState?.electronAuthorizedUntil) > Date.now();
  if (!isGatilhoBRLicenseValid && !electronAuthorized && window.FastTriggerExternalElectronMode !== true) {
    console.warn(
      "[GatilhoBR Engine] 🔒 Execução de aposta bloqueada: Assinatura Necessária.",
    );
    if (typeof showFlashFeedback === "function") {
      showFlashFeedback("🔒 GatilhoBR: Assinatura Necessária");
    }
    return false;
  }

  if (isRateLimitExceeded()) {
    return false;
  }

  const jitterFn =
    typeof randomJitter === "function"
      ? (min, max) => randomJitter(min, max, isHotkey)
      : (min, max) =>
          new Promise((r) => setTimeout(r, min + Math.random() * (max - min)));

  const isBet365Host = /(?:^|\.)bet365\./i.test(
    String(window.location?.hostname || ''),
  );
  if (!isBet365Host && isHotkey) {
    await jitterFn(12, 35);
  } else if (!isBet365Host) {
    await jitterFn(210, 420);
  }

  let stakeReady = true;
  if (typeof pollAndFillStake === "function") {
    stakeReady = await pollAndFillStake(
      10,
      isHotkey || window.FastTriggerState?.backgroundDispatchInProgress === true,
    );
  }

  const stakeVal =
    window.FastTriggerExpectedExecutionStake ||
    window.FastTriggerConfig?.stakeValByHouse?.bet365 ||
    (window.FastTriggerConfig ? window.FastTriggerConfig.stakeVal : null) ||
    "0,50";

  if (typeof triggerPlaceBet === "function") {
    if (!stakeReady) {
      console.warn(
        "[FT Engine] Confirmacao cancelada: stake ainda nao foi validada.",
      );
      if (typeof showFlashFeedback === "function") {
        showFlashFeedback("Stake nao validada - aposta mantida no cupom");
      }
      return false;
    }

    const clicked = await triggerPlaceBet(true, isHotkey, true);
    const currentBetslip =
      typeof scanActiveBetslip === "function" ? scanActiveBetslip() : "";
    const infoText = currentBetslip ? ` [${currentBetslip}]` : "";
    if (typeof showFlashFeedback === "function") {
      showFlashFeedback(
        clicked
          ? `⚡ DISPARADO: R$ ${stakeVal}${infoText}`
          : "Clique enviado sem confirmacao do cupom",
      );
    }
    return clicked;
  }

  console.error(
    "[FT Engine] Motor de clique nativo indisponivel; confirmacao bloqueada.",
  );
  return false;
}

function extractFirstLineHeader(innerText) {
  if (!innerText) return "";
  let line = innerText.split("\n")[0].trim();
  const cleaned = line
    .replace(/CA$/gi, "")
    .replace(/CA\b/gi, "")
    .replace(/[⭐★☆]/g, "")
    .trim();
  return window.FastTriggerBet365MarketTitle?.clean?.(cleaned) || cleaned;
}

function matchOddText(candidateText, targetOddStr) {
  if (!candidateText || !targetOddStr) return false;

  const candNorm = normalizeStr(candidateText);
  const targetNorm = normalizeStr(targetOddStr);

  if (
    candNorm === targetNorm ||
    candNorm.includes(targetNorm) ||
    targetNorm.includes(candNorm)
  )
    return true;

  const candNums = (candidateText.match(/\d+(?:[\.,]\d+)?/g) || []).map((n) =>
    parseFloat(n.replace(",", ".")),
  );
  const targetNums = (targetOddStr.match(/\d+(?:[\.,]\d+)?/g) || []).map((n) =>
    parseFloat(n.replace(",", ".")),
  );

  if (candNums.length > 0 && targetNums.length > 0) {
    return targetNums.some((tn) => candNums.includes(tn));
  }

  return false;
}

function localizarBlocoMercadoExato(tituloAlvoExtensao, pods) {
  if (!tituloAlvoExtensao || !pods || pods.length === 0) return null;

  const titleHelper = window.FastTriggerBet365MarketTitle;
  const cleanTarget = titleHelper?.clean?.(tituloAlvoExtensao) || tituloAlvoExtensao;
  const targetClean = cleanTarget.toLowerCase().trim();
  const targetNorm = normalizeStr(cleanTarget);
  if (!targetNorm) return null;

  const exactMatches = [];

  for (const pod of pods) {
    if (!pod || pod.offsetWidth === 0 || pod.tagName === "BUTTON") continue;
    const cls = pod.className || "";
    if (typeof cls === "string" && cls.includes("MarketGroupButton")) continue;

    const headerEl =
      pod.querySelector(
        ".gl-MarketGroupButton_Text, .gl-MarketGroupPod_HeaderLabel, .gl-MarketGroup_HeaderText, " +
          '.sip-MarketGroupButton, [class*="MarketGroupButton_Text"], [class*="MarketGroupButton"], [class*="MarketTitle"], ' +
          ".sc-MarketGroupButtonWithStats, .cm-MarketGroupWithIconsButton, .srb-ButtonWithBetBuilderIcon",
      ) || pod.firstElementChild;
    if (!headerEl) continue;

    const rawText = headerEl.innerText || "";
    const cleanHeader =
      titleHelper?.fromCard?.(pod) || extractFirstLineHeader(rawText);
    const headerNorm = normalizeStr(cleanHeader);

    if (!headerNorm) continue;

    // MATCH EXATO (Prioridade Máxima): ex "partidagols" === "partidagols" (NÃO ignora se houver "maisopcoes")
    if (headerNorm === targetNorm) {
      exactMatches.push({ pod, headerNorm });
    }
  }

  // Se encontrou correspondências exatas de título de mercado, usa estritamente a exata
  if (exactMatches.length > 0) {
    const withParticipants = exactMatches.filter((item) =>
      item.pod.querySelector(
        '[class*="Participant"], [class*="Odds"], [class*="Value"], button',
      ),
    );
    const pool = withParticipants.length > 0 ? withParticipants : exactMatches;
    // Ordena do menor para o maior para pegar o container mais direto do mercado
    pool.sort(
      (a, b) =>
        a.pod.querySelectorAll("*").length - b.pod.querySelectorAll("*").length,
    );
    return pool[0].pod;
  }

  return null;
}

function forceInteractionReset() {
  try {
    if (
      document.activeElement &&
      typeof document.activeElement.blur === "function"
    ) {
      document.activeElement.blur();
    }
  } catch (e) {}
}

function markScrollAssistedExecution(element) {
  if (!element || typeof element.getBoundingClientRect !== "function") return false;
  try {
    const rect = element.getBoundingClientRect();
    const viewportWidth =
      Number(window.innerWidth) || Number(document.documentElement?.clientWidth) || 0;
    const viewportHeight =
      Number(window.innerHeight) || Number(document.documentElement?.clientHeight) || 0;
    const outsideViewport =
      viewportWidth > 0 &&
      viewportHeight > 0 &&
      (rect.bottom <= 0 ||
        rect.top >= viewportHeight ||
        rect.right <= 0 ||
        rect.left >= viewportWidth);
    const state = window.FastTriggerState;
    const actionId = state?.activeExecutionActionId;
    if (!outsideViewport || !state || !actionId) return false;
    state.scrollAssistedExecution = {
      actionId,
      detectedAt: Date.now(),
    };
    return true;
  } catch (error) {
    return false;
  }
}

function validateFastBet365Target(
  targetElement,
  marketTitle,
  targetName,
  lineName,
  optionLabel,
  colIndex,
  rowIndex,
) {
  if (!isFastSelectionTargetUsable(targetElement)) {
    return { status: "target-unusable", element: null };
  }

  const modernCard =
    window.FastTriggerBet365ModernCards?.closest?.(targetElement) ||
    targetElement.closest?.('[class~="rrb-5c"]') ||
    null;
  if (!modernCard) return { status: "legacy-target", element: targetElement };

  const current = resolveBet365ModernGridSelection(
    marketTitle,
    targetName,
    lineName,
    optionLabel,
    colIndex,
    rowIndex,
  );
  if (current.status !== "resolved") return current;

  const requestedButton =
    targetElement.closest?.('[class*="Participant"], button, [role="button"]') ||
    targetElement;
  const currentButton =
    current.element?.closest?.('[class*="Participant"], button, [role="button"]') ||
    current.element;
  if (!currentButton || currentButton !== requestedButton) {
    return {
      status: "modern-target-recycled",
      card: current.card,
      market: current.market,
      element: null,
    };
  }

  return current;
}

async function dispatchDirectClick(
  el,
  isHotkey = false,
  fastSelection = false,
) {
  if (!el || !el.isConnected) return false;

  // Comandos originados pelo Electron carregam uma autorização curta no
  // estado da aba. Este valor precisa ser resolvido dentro desta pipeline
  // também; antes ele era usado abaixo sem declaração e abortava exatamente
  // depois da stake ser validada (ReferenceError: electronAuthorized).
  const electronAuthorized =
    Number(window.FastTriggerState?.electronAuthorizedUntil) > Date.now();

  const targetBtn = el.closest('[class*="Participant"]') || el;
  if (window.FastTriggerState) {
    window.FastTriggerState.lastDynamicBindClickAttempted = false;
  }

  // Botões da dashboard e binds convergem nesta função. Em modo direto, o
  // runtime MAIN precisa existir ANTES de depositar/clicar a célula, porque é
  // ele que captura a identidade React oficial e semeia o cache. A recuperação
  // é automática e cacheada pela ponte; falha aqui encerra antes de qualquer
  // clique, stake ou CTA financeiro.
  if (
    String(window.FastTriggerConfig?.executionMode || '').toUpperCase() ===
    'DIRECT_NETWORK'
  ) {
    const bridge = window.GatilhoBRDirectOrder;
    const runtimeReady =
      bridge && typeof bridge.ensureMainRuntime === 'function'
        ? await bridge.ensureMainRuntime()
        : false;
    if (runtimeReady !== true) {
      if (window.FastTriggerState) {
        window.FastTriggerState.lastDynamicBindFailureReason =
          'A aceleração da Bet365 não ficou pronta antes da seleção.';
      }
      if (typeof showFlashFeedback === 'function') {
        showFlashFeedback('⛔ Preparando Bet365 — tente novamente');
      }
      return false;
    }
  }

  // Auto-resolução do `selectionId` para o caminho `DIRECT_NETWORK`. A célula
  // acionada é a única fonte confiável de identidade, e o depósito precisa
  // acontecer ANTES do clique para chegar fresco à confirmação. Falha aqui não
  // interrompe nada: sem id o motor segue pelo clique no DOM.
  try {
    window.FastTriggerSelectionResolver?.deposit?.(targetBtn);
  } catch (error) {}

  try {
    markScrollAssistedExecution(targetBtn);
    if (typeof targetBtn.scrollIntoView === "function") {
      targetBtn.scrollIntoView({
        block: "center",
        inline: "center",
        behavior: "instant",
      });
    }
    if (
      !window.FastTriggerState?.backgroundDispatchInProgress &&
      !fastSelection
    ) {
      await new Promise((r) => setTimeout(r, 15));
    }

    if (typeof simulateHumanClick === "function") {
      const clicked = await simulateHumanClick(targetBtn, isHotkey, fastSelection);
      if (window.FastTriggerState) {
        window.FastTriggerState.lastDynamicBindClickAttempted = clicked !== false;
      }
      if (clicked === false) return false;
    } else {
      if (typeof targetBtn.click === "function") {
        if (window.FastTriggerState) {
          window.FastTriggerState.lastDynamicBindClickAttempted = true;
        }
        targetBtn.click();
      }
    }

    console.log("[FT Engine] 1️⃣ Odd clicada no DOM com sucesso");
    document
      .querySelectorAll("[data-ft-clicked]")
      .forEach((c) => delete c.dataset.ftClicked);

    // Com perfil direto aprendido, o clique recém-entregue já pode ter
    // depositado a identidade exata da seleção. Nesse caso a ordem segue agora,
    // sem esperar o cupom visual nem escrever a stake no DOM. Ausência de id ou
    // de template preserva o caminho visual, necessário ao primeiro aprendizado.
    if (
      String(window.FastTriggerConfig?.executionMode || '').toUpperCase() ===
        'DIRECT_NETWORK' &&
      window.GatilhoBRDirectOrder?.isReady?.() === true
    ) {
      try {
        window.FastTriggerSelectionResolver?.retry?.();
      } catch (error) {}
      const exactSelection = window.FastTriggerExecution?.resolveSelection?.();
      const directOneShot =
        typeof isOneShotActive === 'function' ? await isOneShotActive() : false;
      if (exactSelection?.selectionId && directOneShot && typeof triggerPlaceBet === 'function') {
        console.log('[FT Engine] 2️⃣ Seleção exata pronta; confirmando pela rota direta.');
        const confirmed = await triggerPlaceBet(false, true, true, true);
        if (!confirmed && window.FastTriggerState) {
          window.FastTriggerState.lastDynamicBindFailureReason =
            'A seleção direta foi resolvida, mas a Bet365 não confirmou a ordem.';
        }
        return confirmed;
      }
    }

    console.log("[FT Engine] 2️⃣ Iniciando preenchimento da stake...");

    let stakeSuccess = false;
    const fastStakeFlow =
      isHotkey ||
      fastSelection ||
      window.FastTriggerState?.backgroundDispatchInProgress === true;
    if (typeof pollAndFillStake === "function") {
      stakeSuccess = await pollAndFillStake(2, fastStakeFlow);
    } else if (typeof fillBet365StakeGen5 === "function") {
      const activeStake =
        window.FastTriggerExpectedExecutionStake ||
        window.FastTriggerConfig?.stakeValByHouse?.bet365 ||
        window.FastTriggerConfig?.stakeVal ||
        "0,50";
      stakeSuccess = await fillBet365StakeGen5(activeStake, fastStakeFlow);
    }

    const activeOneShot =
      electronAuthorized ||
      (typeof isOneShotActive === "function" ? await isOneShotActive() : false);
    const deferDynamicBindSubmit =
      window.FastTriggerState?.deferDynamicBindSubmit === true;
    if (deferDynamicBindSubmit && !stakeSuccess) {
      if (window.FastTriggerState) {
        window.FastTriggerState.lastDynamicBindFailureReason =
          "A seleção foi clicada, mas a stake não ficou pronta no cupom.";
      }
      return false;
    }
    if (activeOneShot && !deferDynamicBindSubmit) {
      if (!stakeSuccess) {
        if (window.FastTriggerState) {
          window.FastTriggerState.lastDynamicBindFailureReason =
            "O clique foi localizado, mas a stake não foi validada para o One-Shot.";
        }
        console.warn(
          "[FT Engine] One-Click cancelado: stake nao foi validada no cupom.",
        );
        if (typeof showFlashFeedback === "function") {
          showFlashFeedback("Stake nao validada - confirme o cupom");
        }
        return false;
      }

      console.log("[FT Engine] 3️⃣ Modo 1-Click ATIVO. Confirmando aposta...");
      if (typeof triggerPlaceBet === "function") {
        const confirmed = await triggerPlaceBet(false, isHotkey, true, fastSelection);
        if (!confirmed && window.FastTriggerState) {
          window.FastTriggerState.lastDynamicBindFailureReason =
            "O clique foi entregue, mas a Bet365 não confirmou a seleção no cupom.";
        }
        return confirmed;
      }
    }

    return true;
  } catch (err) {
    console.error("[FT Engine] Erro durante a execução da pipeline:", err);
    return false;
  }
}

function isFastSelectionTargetUsable(el) {
  if (!el || !el.isConnected) return false;
  const target =
    el.closest('[class*="Participant"], button, [role="button"]') || el;
  if (
    !target.isConnected ||
    target.offsetWidth === 0 ||
    target.offsetHeight === 0
  )
    return false;
  if (
    target.hasAttribute("disabled") ||
    target.getAttribute("aria-disabled") === "true" ||
    target.classList.contains("disabled") ||
    /suspended|locked|disabled/i.test(String(target.className || ""))
  )
    return false;
  if (typeof isSelectionLocked === "function" && isSelectionLocked(target))
    return false;
  return true;
}

let isExecutingTrigger = false;

function normalizePlayerSelectionIdentity(value) {
  const clean = (value || "")
    .toString()
    .replace(/\d+\s*\+/g, " ")
    .replace(/\(\s*\d+\s*\)\s*$/g, " ")
    .replace(/\s+\d+\s*$/g, " ")
    .replace(/^\s*\d{1,3}\s+(?=[A-Za-zÀ-ÿ])/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return normalizeStr(clean);
}

function resolveBet365ModernGridSelection(
  marketTitle,
  targetName,
  lineName,
  optionLabel,
  colIndex,
  rowIndex,
) {
  if (typeof document === "undefined") return { status: "not-modern" };

  const requestedMarket = normalizeStr(
    window.FastTriggerBet365MarketTitle?.clean?.(marketTitle) || marketTitle,
  );
  if (!requestedMarket) return { status: "not-modern" };

  const cards =
    window.FastTriggerBet365ModernCards?.collect?.(document) ||
    Array.from(document.querySelectorAll('[class~="rrb-5c"]')).filter(
      (card) => !card.parentElement?.closest?.('[class~="rrb-5c"]'),
    );
  const card = cards.find((candidate) => {
    const titleHelper = window.FastTriggerBet365MarketTitle;
    const titles = [
      titleHelper?.fromCard?.(candidate),
      ...(titleHelper?.aliasesFromCard?.(candidate) || []),
      candidate.querySelector?.('[role="button"] span')?.textContent,
    ]
      .map((title) => normalizeStr(titleHelper?.clean?.(title) || title || ""))
      .filter(Boolean);
    return titles.includes(requestedMarket);
  });
  if (!card) {
    return {
      status: cards.length > 0 ? "modern-market-not-found" : "not-modern",
      cards,
    };
  }

  if (typeof parseBet365ModernCard !== "function") {
    return { status: "modern-parser-unavailable", card };
  }

  const market = parseBet365ModernCard(card);
  if (!market) {
    return { status: "modern-market-unreadable", card, market };
  }

  const requestedOption = normalizeStr(optionLabel);
  const requestedTarget = normalizeStr(targetName);

  // Resultado Final, Chance Dupla e outros mercados de linha única usam o
  // card moderno rrb/rgl, mas não formam uma tabela. Antes, encontrar esse
  // card exato encerrava a busca como "unreadable" e impedia justamente o
  // fallback simples que a dashboard já havia capturado. A resolução abaixo
  // permanece restrita ao card de título exato e só aceita identidade única
  // ou a coluna salva dentro desse mesmo card.
  if (market.isTable !== true) {
    const selections = Array.isArray(market.participants)
      ? market.participants
      : Array.isArray(market.selections)
        ? market.selections
        : [];
    const requestedNames = [targetName, optionLabel, lineName]
      .map((value) => normalizeStr(value || ""))
      .filter(Boolean);
    const exactMatches = selections.filter((candidate) => {
      const candidateNames = [
        candidate?.name,
        candidate?.rawName,
        candidate?.colHeader,
      ]
        .map((value) => normalizeStr(value || ""))
        .filter(Boolean);
      return requestedNames.some((requested) =>
        candidateNames.includes(requested),
      );
    });

    let selection = exactMatches.length === 1 ? exactMatches[0] : null;
    if (!selection && exactMatches.length > 1) {
      return { status: "modern-target-ambiguous", card, market };
    }
    if (!selection && Number.isInteger(colIndex)) {
      selection = selections[colIndex] || null;
    }
    if (!selection) {
      return { status: "modern-option-not-found", card, market };
    }

    const element = selection.element || null;
    const className =
      typeof element?.className === "string" ? element.className : "";
    const locked =
      !element ||
      !element.isConnected ||
      selection.isClosed === true ||
      element.hasAttribute?.("disabled") ||
      element.getAttribute?.("aria-disabled") === "true" ||
      /disabled|suspended|locked/i.test(className);

    return {
      status: locked ? "modern-selection-locked" : "resolved",
      card,
      market,
      row: null,
      selection,
      element,
    };
  }

  if (!Array.isArray(market.tableRows)) {
    return { status: "modern-market-unreadable", card, market };
  }

  const requestedPlayer = normalizePlayerSelectionIdentity(
    market.isPlayerMarket === true ? lineName || targetName : lineName,
  );
  let row = requestedPlayer
    ? market.tableRows.find(
        (candidate) =>
          normalizePlayerSelectionIdentity(candidate?.lineLabel || "") ===
          requestedPlayer,
      )
    : null;
  let selection = null;

  if (!row && market.isPlayerMarket !== true && requestedTarget) {
    // Totais/handicaps asiáticos têm uma coluna de linha (ex.: `4.5`) e
    // colunas de resultado (`Mais de`/`Menos de`). O painel preserva a
    // identidade composta capturada pelo parser (`4.5 Menos de`). Ela não é
    // um jogador e não pode passar pelo normalizador de atleta. Casamos a
    // célula pelo nome estrutural exato; posição sozinha nunca autoriza clique.
    const matches = [];
    market.tableRows.forEach((candidateRow) => {
      const candidateOdds = candidateRow?.colOdds || candidateRow?.odds || [];
      candidateOdds.forEach((candidateSelection) => {
        const candidateOption = normalizeStr(
          candidateSelection?.colHeader || candidateSelection?.rawName || "",
        );
        if (requestedOption && candidateOption !== requestedOption) return;
        const explicitIdentity = normalizeStr(candidateSelection?.name || "");
        const structuralIdentity = normalizeStr(
          [candidateRow?.lineLabel || "", candidateSelection?.colHeader || ""]
            .filter(Boolean)
            .join(" "),
        );
        if (
          explicitIdentity === requestedTarget ||
          structuralIdentity === requestedTarget
        ) {
          matches.push({ row: candidateRow, selection: candidateSelection });
        }
      });
    });
    if (matches.length > 1) {
      return { status: "modern-target-ambiguous", card, market };
    }
    if (matches.length === 1) {
      row = matches[0].row;
      selection = matches[0].selection;
    }
  }

  if (!row && !requestedPlayer && !requestedTarget && Number.isInteger(rowIndex)) {
    row = market.tableRows[rowIndex] || null;
  }
  if (!row) return { status: "modern-player-not-found", card, market };

  const odds = row.colOdds || row.odds || [];
  if (!selection && requestedOption) {
    selection = odds.find(
        (candidate) =>
          normalizeStr(candidate?.colHeader || candidate?.rawName || "") ===
          requestedOption,
      ) || null;
  }
  if (!selection && Number.isInteger(colIndex)) {
    selection = odds[colIndex] || null;
  }
  if (!selection) {
    return { status: "modern-option-not-found", card, market, row };
  }

  const element = selection.element || null;
  const className = typeof element?.className === "string" ? element.className : "";
  const locked =
    !element ||
    !element.isConnected ||
    selection.isClosed === true ||
    element.hasAttribute?.("disabled") ||
    element.getAttribute?.("aria-disabled") === "true" ||
    /disabled|suspended|locked/i.test(className);

  return {
    status: locked ? "modern-selection-locked" : "resolved",
    card,
    market,
    row,
    selection,
    element,
  };
}

async function selectOddsOnPage(
  targetName,
  targetOddVal,
  marketTitle,
  colIndex,
  rowIndex,
  isHotkey = false,
  lineName = "",
  optionLabel = "",
  targetElement = null,
  fastMode = false,
) {
  const electronAuthorized = Number(window.FastTriggerState?.electronAuthorizedUntil) > Date.now();
  if (!isGatilhoBRLicenseValid && !electronAuthorized && window.FastTriggerExternalElectronMode !== true) {
    console.warn(
      "[GatilhoBR Engine] 🔒 Seleção de odd bloqueada: Assinatura Necessária.",
    );
    if (typeof showFlashFeedback === "function") {
      showFlashFeedback("🔒 GatilhoBR: Assinatura Necessária");
    }
    return false;
  }

  const now = Date.now();
  const state = window.FastTriggerState || {};
  const permit = state.selectionPermit;
  const hasDashboardPermit =
    !isHotkey &&
    permit &&
    permit.used !== true &&
    Number(permit.expiresAt) >= now;
  const hasTrustedHotkeyPermit =
    isHotkey &&
    Number(state.lastTrustedSelectionHotkeyAt) > 0 &&
    now - Number(state.lastTrustedSelectionHotkeyAt) <= 1500;

  if (!hasDashboardPermit && !hasTrustedHotkeyPermit) {
    console.warn(
      "[FT Engine Safety] Seleção bloqueada: nenhuma ação recente do usuário foi confirmada.",
    );
    return false;
  }

  if (hasDashboardPermit) {
    permit.used = true;
  }
  if (hasTrustedHotkeyPermit) {
    state.lastTrustedSelectionHotkeyAt = 0;
  }

  if (isExecutingTrigger) {
    console.warn(
      "[FT Engine] ⚠️ Disparo ignorado: um clique/processo já está em andamento.",
    );
    return false;
  }
  isExecutingTrigger = true;

  try {
    if (isFastSelectionTargetUsable(targetElement)) {
      const validatedTarget = validateFastBet365Target(
        targetElement,
        marketTitle,
        targetName,
        lineName,
        optionLabel,
        colIndex,
        rowIndex,
      );
      if (
        validatedTarget.status !== "resolved" &&
        validatedTarget.status !== "legacy-target"
      ) {
        console.error(
          `[FT Engine Safety] Referência rápida rejeitada (${validatedTarget.status}) antes do clique em "${marketTitle}".`,
        );
        return false;
      }
      forceInteractionReset();
      const directResult = await dispatchDirectClick(
        validatedTarget.element,
        isHotkey,
        true,
      );
      if (directResult || window.FastTriggerState?.lastDynamicBindClickAttempted) {
        return directResult;
      }
      console.warn(
        "[FT Engine] O alvo mapeado ficou inválido antes do clique; refazendo a busca no DOM.",
      );
    }

    const jitterFn =
      typeof randomJitter === "function"
        ? (min, max) => randomJitter(min, max, isHotkey)
        : (min, max) =>
            new Promise((r) =>
              setTimeout(r, min + Math.random() * (max - min)),
            );

    if (window.FastTriggerState?.backgroundDispatchInProgress) {
      // A guia foi preparada pelo service worker; evita timers que o Chrome
      // pode congelar em páginas sem foco.
    } else if (fastMode) {
      // Cliques no painel já carregam uma intenção explícita recente. Não
      // introduza a hesitação aleatória usada pelo clique manual na casa.
    } else if (isHotkey) {
      await jitterFn(12, 35);
    } else {
      await jitterFn(210, 420);
    }

    forceInteractionReset();

    const normTargetName = normalizeStr(targetName);
    const normTargetOdd = normalizeStr(targetOddVal);
    const normLineName = normalizeStr(lineName);

    let pods = Array.from(
      document.querySelectorAll(
        '.gl-MarketGroupPod, .gl-MarketGroup, [class*="MarketGroupPod"], [class*="MarketGroup"], [class*="MarketCard"], [class*="MarketGroup_Wrapper"]',
      ),
    );
    (window.FastTriggerBet365ModernCards?.collect?.(document) || []).forEach(
      (card) => {
        if (!pods.includes(card)) pods.push(card);
      },
    );

    let targetPod = localizarBlocoMercadoExato(marketTitle, pods);

    if (targetPod) {
      const isCollapsed =
        targetPod.classList.contains("gl-MarketGroupPod-collapsed") ||
        targetPod.getAttribute("aria-expanded") === "false" ||
        targetPod.clientHeight < 45;
      if (isCollapsed) {
        const expandHeaderBtn = targetPod.querySelector(
          '.gl-MarketGroupButton, .gl-MarketGroupButton_Text, [class*="MarketGroupButton"], ' +
            '.sc-MarketGroupButtonWithStats, .cm-MarketGroupWithIconsButton, .srb-ButtonWithBetBuilderIcon, [role="button"]',
        );
        if (expandHeaderBtn) {
          console.log(
            `[FT Engine] 📂 Mercado "${marketTitle}" recolhido. Expandindo bloco...`,
          );
          expandHeaderBtn.click();
          await new Promise((r) => setTimeout(r, fastMode ? 16 : 80));
        }
      }
    }

    if (!targetPod && normTargetName && normTargetOdd) {
      targetPod = pods.find((p) => {
        if (!p || p.offsetWidth === 0) return false;
        const normPodTxt = normalizeStr(p.innerText);
        return (
          normPodTxt.includes(normTargetName) &&
          normPodTxt.includes(normTargetOdd)
        );
      });
    }

    const searchRoot =
      targetPod ||
      document.querySelector(
        ".ipe-EventViewDetail_MarketGrid, .gl-MarketGrid",
      ) ||
      document.body;

    // A UI rrb/rrd/rgl atual usa DIVs sem role/button. Resolve primeiro o
    // card de título exato e a interseção jogador + coluna; assim "Chutes"
    // nunca é confundido com "Chutes ao Gol" e não cai nos seletores Gen5.
    const modernSelection = resolveBet365ModernGridSelection(
      marketTitle,
      targetName,
      lineName,
      optionLabel,
      colIndex,
      rowIndex,
    );
    if (modernSelection.status === "resolved") {
      const resolvedRowLabel = modernSelection.row?.lineLabel || "";
      const resolvedOptionLabel =
        modernSelection.selection?.colHeader ||
        modernSelection.selection?.name ||
        optionLabel ||
        targetName ||
        "";
      console.log(
        `[FT Engine] Celula moderna resolvida: mercado="${modernSelection.market.title}", ` +
          `linha="${resolvedRowLabel || "(sem linha)"}", coluna="${resolvedOptionLabel}".`,
        modernSelection.element,
      );
      return await dispatchDirectClick(
        modernSelection.element,
        isHotkey,
        fastMode,
      );
    }
    if (modernSelection.status === "modern-selection-locked") {
      console.warn(
        `[FT Engine] Selecao moderna indisponivel: ${lineName || targetName} ${optionLabel || ""}.`,
      );
      return false;
    }
    if (modernSelection.status !== "not-modern") {
      console.error(
        `[FT Engine Safety] Mercado moderno não confirmou o alvo exato (${modernSelection.status}): ` +
          `mercado="${marketTitle}", jogador="${lineName || targetName}", coluna="${optionLabel || colIndex}".`,
      );
      return false;
    }

    // A-1. REUTILIZA O MESMO MAPA ESTRUTURAL QUE ALIMENTA A DASHBOARD.
    // O parser da Bet365 ja relaciona mercado -> jogador -> coluna -> elemento.
    // Usar essa referencia evita reconstruir a intersecao com seletores antigos
    // (e, principalmente, evita cruzar "Gol/Assist." com colunas de outro mercado).
    if (typeof scrapeBet365Clean === "function") {
      try {
        const liveMarkets = scrapeBet365Clean();
        const requestedMarket = normalizeStr(
          window.FastTriggerBet365MarketTitle?.clean?.(marketTitle) || marketTitle,
        );
        const mappedMarket = liveMarkets.find((market) => {
          const mappedTitle = normalizeStr(
            window.FastTriggerBet365MarketTitle?.clean?.(market?.title || "") ||
              market?.title ||
              "",
          );
          return mappedTitle && requestedMarket && mappedTitle === requestedMarket;
        });

        if (mappedMarket?.isTable && Array.isArray(mappedMarket.tableRows)) {
          const requestedPlayer = normalizePlayerSelectionIdentity(
            lineName || targetName,
          );
          let mappedRow = null;

          if (requestedPlayer) {
            mappedRow =
              mappedMarket.tableRows.find(
                (row) =>
                  normalizePlayerSelectionIdentity(row?.lineLabel || "") ===
                  requestedPlayer,
              ) || null;
          } else if (
            typeof rowIndex === "number" &&
            rowIndex >= 0 &&
            rowIndex < mappedMarket.tableRows.length
          ) {
            mappedRow = mappedMarket.tableRows[rowIndex];
          }

          if (mappedRow) {
            const mappedOdds = mappedRow.colOdds || mappedRow.odds || [];
            const requestedOption = normalizeStr(optionLabel);
            let mappedSelection = null;

            if (requestedOption) {
              mappedSelection =
                mappedOdds.find(
                  (item) =>
                    normalizeStr(item?.colHeader || item?.rawName || "") ===
                    requestedOption,
                ) || null;
            }

            if (
              !mappedSelection &&
              typeof colIndex === "number" &&
              colIndex >= 0 &&
              colIndex < mappedOdds.length
            ) {
              mappedSelection = mappedOdds[colIndex];
            }

            const mappedElement = mappedSelection?.element || null;
            const elementInsideExpectedMarket =
              !targetPod ||
              (mappedElement && targetPod.contains(mappedElement));
            const mappedClass =
              mappedElement && typeof mappedElement.className === "string"
                ? mappedElement.className
                : "";
            const mappedLocked =
              !mappedElement ||
              !mappedElement.isConnected ||
              mappedSelection?.isClosed === true ||
              mappedElement.hasAttribute("disabled") ||
              mappedElement.getAttribute("aria-disabled") === "true" ||
              /disabled|suspended|locked/i.test(mappedClass);

            if (mappedElement && elementInsideExpectedMarket && !mappedLocked) {
              console.log(
                `[FT Engine] Celula mapeada pelo parser: mercado="${mappedMarket.title}", ` +
                  `jogador="${mappedRow.lineLabel}", coluna="${mappedSelection.colHeader || optionLabel}".`,
                mappedElement,
              );
              if (await dispatchDirectClick(mappedElement, isHotkey, fastMode)) return true;
            }

            if (mappedSelection && mappedLocked) {
              console.warn(
                `[FT Engine] Selecao mapeada, mas indisponivel: ` +
                  `${mappedRow.lineLabel} ${mappedSelection.colHeader || optionLabel}.`,
              );
              return false;
            }
          }
        } else if (mappedMarket) {
          const mappedSelections =
            mappedMarket.participants || mappedMarket.selections || [];
          const requestedSelectionNames = [targetName, optionLabel, lineName]
            .map((value) => normalizeStr(value || ""))
            .filter(Boolean);
          let mappedSelection = mappedSelections.find((item) => {
            const itemNames = [item?.name, item?.rawName, item?.colHeader]
              .map((value) => normalizeStr(value || ""))
              .filter(Boolean);
            return requestedSelectionNames.some((requested) =>
              itemNames.some(
                (candidate) =>
                  candidate === requested ||
                  candidate.includes(requested) ||
                  requested.includes(candidate),
              ),
            );
          });

          if (
            !mappedSelection &&
            typeof colIndex === "number" &&
            colIndex >= 0 &&
            colIndex < mappedSelections.length
          ) {
            mappedSelection = mappedSelections[colIndex];
          }

          if (!mappedSelection && targetOddVal) {
            const requestedOdd = parseFloat(
              String(targetOddVal).replace(",", "."),
            );
            const sameOdd = mappedSelections.filter((item) => {
              const currentOdd = parseFloat(
                String(item?.val || item?.odds || "").replace(",", "."),
              );
              return (
                Number.isFinite(requestedOdd) &&
                Number.isFinite(currentOdd) &&
                Math.abs(requestedOdd - currentOdd) < 0.0001
              );
            });
            if (sameOdd.length === 1) mappedSelection = sameOdd[0];
          }

          const mappedElement = mappedSelection?.element || null;
          const elementInsideExpectedMarket =
            !targetPod || (mappedElement && targetPod.contains(mappedElement));
          const mappedClass =
            mappedElement && typeof mappedElement.className === "string"
              ? mappedElement.className
              : "";
          const mappedLocked =
            !mappedElement ||
            !mappedElement.isConnected ||
            mappedSelection?.isClosed === true ||
            mappedElement.hasAttribute("disabled") ||
            mappedElement.getAttribute("aria-disabled") === "true" ||
            /disabled|suspended|locked/i.test(mappedClass);

          if (mappedElement && elementInsideExpectedMarket && !mappedLocked) {
            console.log(
              `[FT Engine] Celula simples mapeada pelo parser: mercado="${mappedMarket.title}", ` +
                `opcao="${mappedSelection.name || mappedSelection.rawName || targetName}".`,
              mappedElement,
            );
            if (await dispatchDirectClick(mappedElement, isHotkey, fastMode)) {
              return true;
            }
          }

          if (mappedSelection && mappedLocked) {
            console.warn(
              `[FT Engine] Selecao simples mapeada, mas indisponivel em ${mappedMarket.title}.`,
            );
            return false;
          }
        }
      } catch (mappedSelectionError) {
        console.warn(
          "[FT Engine] Falha no mapa estrutural; usando compatibilidade DOM.",
          mappedSelectionError,
        );
      }
    }

    // A0. GRID HORIZONTAL GEN5: resolve pela intersecao exata jogador + coluna.
    // Nunca deixa o fallback universal confundir srb-HScrollPlaceHeader (ex: 2+)
    // com uma celula de odd.
    const hScrollPods = Array.from(
      searchRoot.querySelectorAll(
        '.gl-MarketGroupPod, .gl-MarketGroup, [class*="MarketGroupPod"], [class*="MarketGroup"]',
      ),
    ).filter(
      (pod) =>
        pod.querySelector(".srb-HScrollParticipantMarket") &&
        pod.querySelector(".srb-HScrollPlaceColumnMarket"),
    );
    const normMarketTitle = normalizeStr(marketTitle);
    const hScrollScope =
      targetPod ||
      hScrollPods.find((pod) => {
        const firstLine = (pod.innerText || "").trim().split("\n")[0];
        const normFirstLine = normalizeStr(firstLine);
        return (
          normMarketTitle &&
          (normFirstLine.includes(normMarketTitle) ||
            normMarketTitle.includes(normFirstLine))
        );
      }) ||
      (hScrollPods.length === 1 ? hScrollPods[0] : null);
    const hScrollPlayerCol = hScrollScope?.querySelector(
      ".srb-HScrollParticipantMarket",
    );
    const hScrollOddsCols = hScrollScope
      ? Array.from(
          hScrollScope.querySelectorAll(".srb-HScrollPlaceColumnMarket"),
        )
      : [];

    if (hScrollPlayerCol && hScrollOddsCols.length > 0) {
      const playerNodes = Array.from(
        hScrollPlayerCol.querySelectorAll(".srb-ParticipantLabelWithTeam"),
      ).filter((node) => node.offsetWidth > 0 || node.offsetHeight > 0);

      const requestedHeaderMatch =
        (optionLabel || "").toString().match(/\d+\s*\+/) ||
        (targetName || "").toString().match(/\d+\s*\+/) ||
        (targetOddVal || "").toString().match(/\d+\s*\+/);
      const requestedHeader = requestedHeaderMatch
        ? requestedHeaderMatch[0].replace(/\s+/g, "")
        : (optionLabel || "").toString().trim();
      const compositePlayerName = (targetName || "")
        .toString()
        .replace(/\d+\s*\+/g, "")
        .trim();
      const playerNeedle = normalizePlayerSelectionIdentity(
        lineName || compositePlayerName,
      );

      let resolvedRowIndex = -1;
      if (playerNeedle) {
        resolvedRowIndex = playerNodes.findIndex((node) => {
          const nameEl = node.querySelector(
            ".srb-ParticipantLabelWithTeam_Name",
          );
          const playerText = normalizePlayerSelectionIdentity(
            nameEl ? nameEl.innerText : node.innerText,
          );
          return playerText === playerNeedle;
        });
      }
      if (
        resolvedRowIndex === -1 &&
        !playerNeedle &&
        typeof rowIndex === "number" &&
        rowIndex >= 0 &&
        rowIndex < playerNodes.length
      ) {
        resolvedRowIndex = rowIndex;
      }

      let resolvedColIndex = -1;
      if (requestedHeader) {
        const normalizedHeader = normalizeStr(requestedHeader);
        resolvedColIndex = hScrollOddsCols.findIndex((col) => {
          const header = col.querySelector(".srb-HScrollPlaceHeader");
          return (
            normalizeStr(header ? header.innerText : "") === normalizedHeader
          );
        });
      }
      if (
        resolvedColIndex === -1 &&
        typeof colIndex === "number" &&
        colIndex >= 0 &&
        colIndex < hScrollOddsCols.length
      ) {
        resolvedColIndex = colIndex;
      }

      if (resolvedRowIndex === -1 || resolvedColIndex === -1) {
        console.error(
          `[FT Engine] Grid horizontal localizado, mas a intersecao nao foi resolvida: ` +
            `jogador="${lineName || compositePlayerName}", coluna="${requestedHeader || colIndex}".`,
        );
        return false;
      }

      const targetColumn = hScrollOddsCols[resolvedColIndex];
      const columnCells = Array.from(
        targetColumn.querySelectorAll(".gl-ParticipantOddsOnly"),
      );
      const targetCell = columnCells[resolvedRowIndex] || null;
      const cellClass =
        targetCell && typeof targetCell.className === "string"
          ? targetCell.className
          : "";
      const isLocked =
        !targetCell ||
        targetCell.hasAttribute("disabled") ||
        targetCell.getAttribute("aria-disabled") === "true" ||
        /disabled|suspended|locked/i.test(cellClass);

      if (isLocked) {
        console.warn(
          `[FT Engine] Selecao indisponivel no grid: ` +
            `${lineName || compositePlayerName} ${requestedHeader || `${resolvedColIndex + 1}+`}.`,
        );
        return false;
      }

      const headerElement = targetColumn.querySelector(
        ".srb-HScrollPlaceHeader",
      );
      const resolvedHeader = headerElement
        ? headerElement.innerText.trim()
        : `${resolvedColIndex + 1}+`;
      const playerElement = playerNodes[resolvedRowIndex]?.querySelector(
        ".srb-ParticipantLabelWithTeam_Name",
      );
      const resolvedPlayer = playerElement
        ? playerElement.innerText.trim()
        : lineName || compositePlayerName;

      console.log(
        `[FT Engine] Intersecao do grid localizada: jogador="${resolvedPlayer}", ` +
          `coluna="${resolvedHeader}", odd="${targetOddVal}".`,
        targetCell,
      );
      if (await dispatchDirectClick(targetCell, isHotkey, fastMode)) return true;
    }

    // A1. MERCADOS HORIZONTAIS DE JOGADORES (sip-MarketLabelForSingleRow)
    const sipRows = Array.from(
      searchRoot.querySelectorAll(
        '.sip-MarketLabelForSingleRow, [class*="MarketLabelForSingleRow"]',
      ),
    );

    if (sipRows.length > 0) {
      let targetSipRow = null;
      const sipPlayerNeedle = normalizePlayerSelectionIdentity(
        lineName || targetName,
      );
      if (sipPlayerNeedle) {
        targetSipRow = sipRows.find((row) => {
          const headerNode = row.querySelector(
            '.sip-MarketColumnHeaderWithCount, [class*="MarketColumnHeaderWithCount"]',
          );
          if (!headerNode) return false;
          const cleanHeaderPlayer = normalizePlayerSelectionIdentity(
            headerNode.innerText,
          );
          return cleanHeaderPlayer === sipPlayerNeedle;
        });
      }

      if (
        !targetSipRow &&
        !sipPlayerNeedle &&
        typeof rowIndex === "number" &&
        rowIndex >= 0 &&
        rowIndex < sipRows.length
      ) {
        targetSipRow = sipRows[rowIndex];
      }

      if (!targetSipRow && sipPlayerNeedle) {
        console.error(
          `[FT Engine] Jogador não confirmado no mercado: "${lineName || targetName}".`,
        );
        return false;
      }

      if (targetSipRow) {
        const scrollerOptions = Array.from(
          targetSipRow.querySelectorAll(
            '.sip-SingleMarketScrollerParticipant, [class*="SingleMarketScrollerParticipant"][class*="Participant_General"]',
          ),
        );

        let targetOption = null;
        const requestedOptionLabel = (optionLabel || "").replace(/\s+/g, "");
        if (requestedOptionLabel) {
          targetOption = scrollerOptions.find((opt) => {
            const optionName = opt.querySelector(
              '.sip-SingleMarketScrollerParticipant_Name, [class*="ScrollerParticipant_Name"]',
            );
            return (
              (optionName ? optionName.innerText : "").replace(/\s+/g, "") ===
              requestedOptionLabel
            );
          });
        }
        if (targetOddVal) {
          targetOption =
            targetOption ||
            scrollerOptions.find((opt) =>
              matchOddText(opt.innerText, targetOddVal),
            );
        }

        if (
          !targetOption &&
          typeof colIndex === "number" &&
          colIndex >= 0 &&
          colIndex < scrollerOptions.length
        ) {
          targetOption = scrollerOptions[colIndex];
        }

        if (targetOption) {
          if (await dispatchDirectClick(targetOption, isHotkey, fastMode)) return true;
        }
      }
    }

    // A2. TABELAS DE LINHA TRADICIONAIS COM COLUNA DE RÓTULOS (gl-Market_General-haslabels)
    const hasLabelsCol = targetPod
      ? targetPod.querySelector(
          '.gl-Market_General-haslabels, [class*="haslabels"]',
        ) !== null
      : false;

    if (hasLabelsCol && targetPod) {
      const colunas = Array.from(
        targetPod.querySelectorAll('.gl-Market, [class*="Market_General"]'),
      );
      const labelCol =
        targetPod.querySelector(
          '.gl-Market_General-haslabels, [class*="haslabels"]',
        ) || colunas[0];

      const itensLinha = Array.from(labelCol.children).filter((item) => {
        const text = item.innerText ? item.innerText.trim() : "";
        const isHeader =
          item.classList.contains("gl-MarketColumnHeader") ||
          item.classList.contains("sip-StartingPlayersMarketHeader") ||
          item.classList.contains("sip-MarketHeaderLabel");
        return text !== "" && !isHeader;
      });

      let targetIndex = -1;
      const traditionalPlayerNeedle =
        normalizePlayerSelectionIdentity(lineName);
      if (traditionalPlayerNeedle) {
        targetIndex = itensLinha.findIndex((item) => {
          const firstTextLine =
            (item.innerText || "")
              .split(/\r?\n/)
              .map((part) => part.trim())
              .find(Boolean) || "";
          return (
            normalizePlayerSelectionIdentity(firstTextLine) ===
              traditionalPlayerNeedle ||
            normalizePlayerSelectionIdentity(item.innerText) ===
              traditionalPlayerNeedle
          );
        });
      } else if (normTargetName) {
        targetIndex = itensLinha.findIndex((item) =>
          normalizeStr(item.innerText).includes(normTargetName),
        );
      }
      if (
        targetIndex === -1 &&
        !traditionalPlayerNeedle &&
        typeof rowIndex === "number" &&
        rowIndex >= 0
      ) {
        targetIndex = rowIndex;
      }

      if (targetIndex !== -1) {
        const oddCols = Array.from(
          targetPod.querySelectorAll(
            '.gl-Market_General-columnheader, [class*="columnheader"]',
          ),
        ).filter((col) => col !== labelCol);
        const finalOddCols =
          oddCols.length > 0
            ? oddCols
            : colunas.filter((col) => col !== labelCol);

        let targetBtn = null;

        // 🎯 NÍVEL 1: SE A ODD PERMANECEU A MESMA (Match exato da odd na linha do jogador)
        if (targetOddVal || normTargetOdd) {
          const checkOddStr = targetOddVal || normTargetOdd;
          for (const col of finalOddCols) {
            const botoes = Array.from(col.children).filter((item) => {
              const text = item.innerText ? item.innerText.trim() : "";
              const isHeader =
                item.classList.contains("gl-MarketColumnHeader") ||
                item.classList.contains("sip-StartingPlayersMarketHeader") ||
                item.classList.contains("sip-MarketHeaderLabel");
              return text !== "" && !isHeader;
            });
            const btnCandidate = botoes[targetIndex];
            if (
              btnCandidate &&
              matchOddText(btnCandidate.innerText, checkOddStr)
            ) {
              targetBtn = btnCandidate;
              break;
            }
          }
        }

        // 🎯 NÍVEL 2: SE A ODD MUDOU, BUSCA PELO CABEÇALHO DA COLUNA (ex: "4+", "3+", "5+")
        if (!targetBtn) {
          const targetColHeader =
            (`${optionLabel || ""} ${targetName || ""}`.match(
              /\b\d+\+\b|\b\d+\.\d+\b/,
            ) || [])[0];

          if (targetColHeader) {
            const matchedColIdx = finalOddCols.findIndex((col) => {
              const hText =
                col.querySelector('.gl-MarketColumnHeader, [class*="Header"]')
                  ?.innerText ||
                col.innerText ||
                "";
              return hText.includes(targetColHeader);
            });
            if (matchedColIdx !== -1) {
              const botoes = Array.from(
                finalOddCols[matchedColIdx].children,
              ).filter((item) => {
                const text = item.innerText ? item.innerText.trim() : "";
                const isHeader =
                  item.classList.contains("gl-MarketColumnHeader") ||
                  item.classList.contains("sip-StartingPlayersMarketHeader") ||
                  item.classList.contains("sip-MarketHeaderLabel");
                return text !== "" && !isHeader;
              });
              targetBtn = botoes[targetIndex];
            }
          }
        }

        // 🎯 NÍVEL 3: CÁLCULO DE OFFSET MATEMÁTICO DO ÍNDICE DA COLUNA (Garantia se a odd mudar)
        if (!targetBtn) {
          // O dashboard envia colIndex relativo somente as colunas de odds.
          // Nao se subtrai a coluna de rotulo/jogador.
          const targetColIdx =
            typeof colIndex === "number" &&
            colIndex >= 0 &&
            colIndex < finalOddCols.length
              ? colIndex
              : 0;

          const colunaOdd = finalOddCols[targetColIdx];
          if (colunaOdd) {
            const botoesOdd = Array.from(colunaOdd.children).filter((item) => {
              const text = item.innerText ? item.innerText.trim() : "";
              const isHeader =
                item.classList.contains("gl-MarketColumnHeader") ||
                item.classList.contains("sip-StartingPlayersMarketHeader") ||
                item.classList.contains("sip-MarketHeaderLabel");
              return text !== "" && !isHeader;
            });
            targetBtn = botoesOdd[targetIndex];
          }
        }

        if (targetBtn) {
          console.log(
            "[FT Engine] 🎯 Botão de odd localizado com sucesso:",
            targetBtn,
          );
          if (await dispatchDirectClick(targetBtn, isHotkey, fastMode)) return true;
        }
      }
    }

    // Em mercado de jogador, falhar na confirmação do nome encerra a busca.
    // Nunca cai no fallback universal por odd ou posição, pois isso pode
    // selecionar outro atleta.
    if (normalizePlayerSelectionIdentity(lineName)) {
      console.error(
        `[FT Engine] Seleção cancelada: jogador "${lineName}" não foi confirmado no DOM.`,
      );
      return false;
    }

    // B. GRIDS E SELEÇÃO DE ODD NA PÁGINA / SEARCH ROOT
    const allCandidateElements = Array.from(
      searchRoot.querySelectorAll(
        '.gl-Participant, [class*="Participant"], [class*="Odds"], [class*="Value"], [class*="Price"], button, [role="button"]',
      ),
    );

    const directButtons = allCandidateElements.filter((btn) => {
      if (!btn || btn.offsetWidth === 0 || btn.offsetHeight === 0) return false;
      const isSuspended =
        btn.classList.contains("disabled") ||
        btn.classList.contains("gl-Participant_Suspended");
      if (isSuspended) return false;

      // Evita selecionar containers maiores que agrupam múltiplos botões de odd distintos
      const multiButtons = btn.querySelectorAll(
        '[class*="ParticipantCentered"], [class*="ParticipantStacked"], [class*="ParticipantOddOnly"], [class*="ParticipantSelectButton"]',
      );
      if (multiButtons.length > 1) return false;

      return true;
    });

    let targetButton = null;

    // Extrai o valor da odd em formato numérico e o nome sem números para busca resiliente
    const targetOddNum = (targetOddVal.match(/\d+(?:[\.,]\d+)?/) ||
      normTargetName.match(/\d+(?:[\.,]\d+)?/))?.[0];
    const cleanNameTxt = normTargetName.replace(/\d+(?:[\.,]\d+)?/g, "").trim();

    // Passo 1: Busca estrita no texto do botão ou elementos aninhados de Nome + Odd
    if (normTargetName || targetOddVal) {
      targetButton = directButtons.find((btn) => {
        const txt = (btn.innerText || btn.textContent || "").trim();
        if (!txt) return false;

        const normTxt = normalizeStr(txt);
        const nameNode = btn.querySelector('[class*="Name"], [class*="Label"]');
        const nameTxt = nameNode ? normalizeStr(nameNode.innerText) : normTxt;

        // Match exato de string normalizada
        if (normTxt === normTargetName || normTxt === normTargetOdd)
          return true;

        const hasName = cleanNameTxt
          ? normTxt.includes(cleanNameTxt) || nameTxt.includes(cleanNameTxt)
          : true;
        const hasOdd = targetOddNum
          ? matchOddText(txt, targetOddNum) ||
            normTxt.includes(normalizeStr(targetOddNum))
          : true;

        return hasName && hasOdd;
      });
    }

    // Passo 2: Se não encontrou estrito, busca por substring do nome ou número da odd no bloco da linha/botão
    if (!targetButton && (cleanNameTxt || targetOddNum)) {
      targetButton = directButtons.find((btn) => {
        const txt = (btn.innerText || btn.textContent || "").trim();
        if (!txt) return false;
        const normTxt = normalizeStr(txt);

        const parentRow = btn.closest(
          '.gl-MarketRow, tr, [class*="MarketRow"], [class*="ParticipantRow"]',
        );
        const rowTxt = parentRow ? normalizeStr(parentRow.innerText) : normTxt;

        const hasName = cleanNameTxt ? rowTxt.includes(cleanNameTxt) : true;
        const hasOdd = targetOddNum
          ? matchOddText(txt, targetOddNum) ||
            normTxt.includes(normalizeStr(targetOddNum))
          : true;

        return hasName && hasOdd;
      });
    }

    // Passo 3: Varredura Universal Fallback em todo o documento (usando busca estrita de pod ou contexto da página)
    if (!targetButton) {
      const globalElements = Array.from(
        document.querySelectorAll(
          '.gl-Participant, [class*="Participant"], [class*="Odds"], [class*="Value"], button, [role="button"]',
        ),
      ).filter((btn) => {
        if (!btn || btn.offsetWidth === 0 || btn.offsetHeight === 0)
          return false;
        const multiButtons = btn.querySelectorAll(
          '[class*="ParticipantCentered"], [class*="ParticipantStacked"], [class*="ParticipantOddOnly"], [class*="ParticipantSelectButton"]',
        );
        return multiButtons.length <= 1;
      });

      if (cleanNameTxt || targetOddNum) {
        targetButton = globalElements.find((btn) => {
          const txt = (btn.innerText || btn.textContent || "").trim();
          if (!txt) return false;
          const normTxt = normalizeStr(txt);

          const hasName = cleanNameTxt ? normTxt.includes(cleanNameTxt) : true;
          const hasOdd = targetOddNum
            ? matchOddText(txt, targetOddNum) ||
              normTxt.includes(normalizeStr(targetOddNum))
            : true;

          return hasName && hasOdd;
        });
      }
    }

    if (targetButton) {
      console.log(
        `[Fast Trigger] 🎯 Botão correto localizado e clicado com sucesso!`,
        targetButton,
      );
      try {
        targetButton.scrollIntoView({
          block: "center",
          inline: "center",
          behavior: "instant",
        });
      } catch (e) {}
      if (await dispatchDirectClick(targetButton, isHotkey, fastMode)) return true;
    } else {
      console.error(
        `[Fast Trigger] ❌ Botão da odd "${targetName || marketTitle}" (${targetOddVal}) não encontrado.`,
      );
    }
  } catch (e) {
    console.error("[Fast Trigger] Erro na seleção de odd:", e);
  } finally {
    forceInteractionReset();
    setTimeout(() => {
      isExecutingTrigger = false;
    }, 150);
  }
  return false;
}

if (typeof window !== "undefined") {
  window.selectOddsOnPage = selectOddsOnPage;
  window.FastTriggerBet365Testing = Object.freeze({
    normalizePlayerSelectionIdentity,
    resolveBet365ModernGridSelection,
    markScrollAssistedExecution,
    localizarBlocoMercadoExato,
    validateFastBet365Target,
  });
}
