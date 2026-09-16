// =========================================================================
// FAST TRIGGER PRO - ADAPTER BETNACIONAL (SUPORTE COMPLETO ONE-SHOT & AUTO-SUBMIT)
// =========================================================================

(function () {
  "use strict";

  const BETNACIONAL_STAKE_SELECTOR =
    'input.is_CurrencyField, input[class*="is_CurrencyField"], [data-testid="betslip-container"] input, input[placeholder*="0,00"], input[placeholder*="R$"]';

  const BETNACIONAL_MARKET_ROOT_SELECTOR =
    '[data-testid="market-group-item"], div.is_SectionMarketsItem, [class*="is_SectionMarketsItem"], div.MuiAccordion-root, [class*="MuiAccordion-root"]';

  const BETNACIONAL_ODD_SELECTOR =
    '[class*="is_SectionMarketsItemOdds"], [data-testid^="odd-"], [data-testid^="suspended-outcome-"]';

  // A mesma bind pode chegar por mais de um port/listener durante uma
  // atualização da página. A Betnacional trata a seleção como toggle:
  // o segundo clique na mesma odd remove o que o primeiro acabou de adicionar.
  // Mantemos a janela somente enquanto a operação está em andamento para não
  // impedir uma nova ação legítima depois que o fluxo terminou.
  const BETNACIONAL_SELECTION_DEDUP_TIMEOUT_MS = 5000;
  const BETNACIONAL_SELECTION_COOLDOWN_MS = 450;
  const BETNACIONAL_COLD_BETSLIP_TIMEOUT_MS = 1800;
  const BETNACIONAL_COLLAPSED_SIGNAL_TIMEOUT_MS = 420;
  const BETNACIONAL_NATIVE_OPENING_GRACE_MS = 96;

  // Diagnóstico temporário removido após validação do fluxo.
  function betnacionalFlowTrace() {}

  // Quando a ação veio da dashboard Electron, ela já passou pela sessão e
  // licença centrais do aplicativo. A extensão no Chrome não compartilha o
  // storage de autenticação da dashboard; tentar renová-lo aqui gera um falso
  // "assinatura expirada" antes mesmo de tocar na odd. Esta permissão é
  // deliberadamente curta, por aba, e só substitui a consulta de licença —
  // todas as verificações de contexto, seleção e stake do adapter continuam
  // sendo executadas normalmente.
  function hasBetnacionalElectronAuthorization() {
    return (
      typeof window !== "undefined" &&
      Number(window.FastTriggerState?.electronAuthorizedUntil || 0) > Date.now()
    );
  }

  async function ensureBetnacionalExecutionLicense() {
    if (hasBetnacionalElectronAuthorization()) {
      return { valid: true, source: "electron-bridge" };
    }
    const hotLicense =
      typeof window.getHotLicenseSnapshot === "function"
        ? window.getHotLicenseSnapshot()
        : null;
    if (hotLicense?.valid) return hotLicense;

    const ensureLicense =
      typeof ensureGatilhoBRLicense === "function"
        ? ensureGatilhoBRLicense
        : typeof window !== "undefined"
          ? window.ensureGatilhoBRLicense
          : null;
    return ensureLicense ? await ensureLicense() : null;
  }

  function getBetnacionalBetslipWaitTimeout(fastDispatch) {
    const baseTimeout = fastDispatch ? 650 : 1100;
    const warmed =
      typeof window !== "undefined" &&
      window.FastTriggerState?.betnacionalBetslipWarm === true;
    return warmed
      ? baseTimeout
      : Math.max(baseTimeout, BETNACIONAL_COLD_BETSLIP_TIMEOUT_MS);
  }

  function normalizeBetnacionalText(value) {
    return (value || "")
      .toString()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeBetnacionalOdd(value) {
    const match = (value || "")
      .toString()
      .replace(",", ".")
      .match(/\d+(?:\.\d+)?/);
    return match ? match[0].replace(".", "") : "";
  }

  // Retém apenas os nós folha do conjunto. Percorrer os ancestrais de cada
  // nó evita o filtro O(n²) que comparava cada elemento com todos os demais.
  function keepBetnacionalLeafNodes(nodes, boundary = null) {
    const nodeSet = new Set(nodes);
    return nodes.filter((node) => {
      let parent = node?.parentElement;
      while (parent && parent !== boundary) {
        if (nodeSet.has(parent)) return false;
        parent = parent.parentElement;
      }
      return true;
    });
  }

  function getBetnacionalMarketRoots(mainNode) {
    if (!mainNode?.querySelectorAll) return [];

    // Contrato atual da NSX: cada mercado possui exatamente um wrapper com
    // data-testid="market-group-item". Preferir esse nó evita confundir o
    // título e as próprias células de odd com mercados independentes.
    const contractRoots = Array.from(
      mainNode.querySelectorAll('[data-testid="market-group-item"]'),
    ).filter(
      (root) =>
        root.querySelectorAll('[data-testid="market-name"]').length === 1 &&
        root.querySelectorAll(BETNACIONAL_ODD_SELECTOR).length > 0,
    );
    if (contractRoots.length > 0) {
      return keepBetnacionalLeafNodes(contractRoots, mainNode);
    }

    const roots = Array.from(
      mainNode.querySelectorAll(BETNACIONAL_MARKET_ROOT_SELECTOR),
    ).filter(isBetnacionalMarketRoot);

    return keepBetnacionalLeafNodes(roots, mainNode);
  }

  function isBetnacionalMarketRoot(element) {
    if (!element) return false;
    const className = (element.className || "").toString();
    const testId = element.getAttribute?.("data-testid") || "";
    return (
      testId === "market-group-item" ||
      /is_SectionMarketsItem|MuiAccordion-root/.test(className)
    ) &&
      !/Odds|Header|Body|Title/.test(className);
  }

  function getBetnacionalMarketTitleCandidates(marketRoot) {
    if (!marketRoot) return [];

    const candidates = [];
    const addText = (value) => {
      const normalized = (value || "")
        .toString()
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      candidates.push(...normalized);
    };

    const titleNodes = marketRoot.querySelectorAll(
      '[class*="is_SectionMarketsItemHeaderTitle"], [class*="ItemHeaderTitle"], [class*="MuiAccordionSummary-content"], [class*="is_SectionMarketsItemBody"]',
    );
    titleNodes.forEach((node) => addText(node.innerText || node.textContent));

    // Alguns layouts exibem o título do card como "Mercados de resultados"
    // e o nome real do mercado ("Resultado Final") somente dentro do body.
    addText(marketRoot.innerText || marketRoot.textContent);

    return [...new Set(candidates)];
  }

  function getBetnacionalMarketVariantLabels(marketRoot) {
    if (!marketRoot?.querySelectorAll) return [];

    const selectors = [
      '[class*="ChipSelectItemWrapper"]',
      '[class*="ChipSelectItemLabel"]',
      '[class*="MuiChip-root"]',
      '[role="tab"]',
      '[aria-pressed]',
      '[aria-selected]',
      '[data-state="active"]',
    ];
    const ignored = /^(ca|ao vivo|popular|populares|criar aposta|multi|home)$/i;
    const labels = [];

    for (const element of Array.from(
      marketRoot.querySelectorAll(selectors.join(", ")),
    )) {
      if (
        !element ||
        element.offsetWidth === 0 ||
        element.offsetHeight === 0 ||
        element.closest('header, nav, footer') ||
        element.matches?.(BETNACIONAL_ODD_SELECTOR) ||
        element.closest?.(BETNACIONAL_ODD_SELECTOR)
      ) {
        continue;
      }
      const text = (element.innerText || element.textContent || "")
        .split("\n")[0]
        .replace(/^CA\s+/i, "")
        .replace(/\s+/g, " ")
        .trim();
      if (
        !text ||
        text.length < 2 ||
        text.length > 80 ||
        ignored.test(text) ||
        /\d+[.,]\d+/.test(text) ||
        /R\$/.test(text)
      ) {
        continue;
      }
      labels.push(text);
    }

    return [...new Set(labels)];
  }

  function findBetnacionalMarketRoot(mainNode, marketTitle, targetElement = null) {
    if (targetElement?.isConnected) {
      // A célula da odd também contém "is_SectionMarketsItem" no nome da
      // classe. Não usamos um closest() genérico aqui: ele pode parar na
      // própria odd e impedir a subida até o card real do mercado.
      let exactRoot = targetElement.closest('[data-testid="market-group-item"]');
      if (!isBetnacionalMarketRoot(exactRoot)) {
        exactRoot = null;
        let ancestor = targetElement.parentElement;
        while (ancestor && ancestor !== mainNode) {
          if (isBetnacionalMarketRoot(ancestor)) {
            exactRoot = ancestor;
            break;
          }
          ancestor = ancestor.parentElement;
        }
      }
      if (exactRoot && mainNode?.contains?.(exactRoot)) return exactRoot;
    }

    const requested = normalizeBetnacionalText(marketTitle);
    if (!requested) return null;

    let best = null;
    for (const root of getBetnacionalMarketRoots(mainNode)) {
      for (const candidate of getBetnacionalMarketTitleCandidates(root)) {
        const normalizedCandidate = normalizeBetnacionalText(candidate);
        if (!normalizedCandidate) continue;

        let score = -1;
        if (normalizedCandidate === requested) score = 100;
        else if (normalizedCandidate.includes(requested)) score = 82;
        else if (
          requested.length >= 4 &&
          requested.includes(normalizedCandidate)
        ) {
          score = 76;
        }

        if (!best || score > best.score) best = { root, score };
      }
    }

    return best && best.score >= 0 ? best.root : null;
  }

  function findBetnacionalStakeInput() {
    return (
      Array.from(document.querySelectorAll(BETNACIONAL_STAKE_SELECTOR)).find(
        (input) => {
          if (
            !input ||
            (input.tagName || "").toUpperCase() !== "INPUT" ||
            input.offsetWidth === 0 ||
            input.offsetHeight === 0 ||
            input.disabled ||
            input.readOnly
          ) {
            return false;
          }
          return !(
            input.placeholder?.toLowerCase().includes("buscar") ||
            input.getAttribute("type") === "search"
          );
        },
      ) || null
    );
  }

  function isBetnacionalBetslipElement(element) {
    if (!element || !element.isConnected) return false;
    if (element.offsetWidth === 0 || element.offsetHeight === 0) return false;
    if (
      element.closest(
        'header, nav, footer, [class*="Profile"], [class*="profile"], [class*="UserMenu"], [class*="user-menu"], [data-testid*="profile"], [data-testid*="Profile"]',
      )
    ) {
      return false;
    }
    return true;
  }

  function findBetnacionalBetslipToggle() {
    const roots = Array.from(
      document.querySelectorAll(
        '[data-testid="betslip-container"], [class*="BetslipDrawer"], [class*="betslip-drawer"], [class*="Betslip"], [class*="betslip"], button[data-testid*="betslip"], [aria-label*="betslip" i]',
      ),
    ).filter(isBetnacionalBetslipElement);

    const candidates = [];
    for (const root of roots) {
      candidates.push(root);
      candidates.push(
        ...Array.from(
          root.querySelectorAll(
            'button, [role="button"], [class*="_cur-pointer"], [class*="Betslip"], [class*="betslip"]',
          ),
        ),
      );
    }

    const semanticCandidate = candidates
      .filter(isBetnacionalBetslipElement)
      .map((element) => {
        const text = (element.innerText || element.textContent || "")
          .toLowerCase()
          .trim();
        const className = (element.className || "").toString();
        let score = 0;
        if (/\b(simples|cupom|boletim)\b/.test(text)) score += 40;
        if (/seleç|selecao/.test(text)) score += 20;
        if (/\d+[.,]\d+/.test(text)) score += 10;
        // No layout atual o container do cupom envolve um cabeçalho
        // `_cur-pointer` que é o verdadeiro controle de expansão. Priorize
        // esse filho em relação ao container pai, que apenas agrupa o DOM.
        if (/_cur-pointer/.test(className)) score += 25;
        if (element.tagName === "BUTTON" || element.getAttribute("role") === "button") score += 10;
        return { element, score };
      })
      .filter(({ score }) => score > 0)
      .sort((left, right) => right.score - left.score)[0]?.element;

    if (semanticCandidate) return semanticCandidate;

    // O botão recolhido do cupom usa classes geradas e pode não conter
    // "Betslip" no nome. Nesse estado, ainda há atributos/textos semânticos
    // no próprio controle; varremos somente controles visíveis e excluímos
    // cabeçalho, perfil e navegação para não clicar em uma ação aleatória.
    const genericCandidates = Array.from(
      document.querySelectorAll(
        'button, [role="button"], [data-testid], [aria-label], [title], [class*="_cur-pointer"]',
      ),
    );
    const genericTarget = genericCandidates
      .filter(isBetnacionalBetslipElement)
      .map((element) => {
        const label = [
          element.innerText,
          element.textContent,
          element.getAttribute("aria-label"),
          element.getAttribute("title"),
          element.getAttribute("data-testid"),
          (element.className || "").toString(),
        ]
          .filter(Boolean)
          .join(" ");
        const normalizedLabel = normalizeBetnacionalText(label);
        const hasCouponToken =
          /(betslip|bet slip|cupom|boletim|bilhete|palpite)/i.test(label);
        const hasSelectionToken =
          /selecoes|selecao|aposta simples|apostas|bet slip|betslip/i.test(
            normalizedLabel,
          );
        // Classes geradas não são suficientes para identificar o cupom. Sem
        // um marcador textual/semântico explícito, qualquer botão da página
        // poderia ganhar os pontos do tipo do elemento e virar um alvo falso.
        if (!hasCouponToken && !hasSelectionToken) return null;
        let score = 0;

        if (hasCouponToken) score += 90;
        if (hasSelectionToken) score += 45;
        if (element.getAttribute("aria-expanded") === "false") score += 25;
        if (
          element.tagName === "BUTTON" ||
          element.getAttribute("role") === "button"
        ) {
          score += 12;
        }
        if (/data-testid/i.test(label)) score += 4;

        return { element, score };
      })
      .filter(Boolean)
      .filter(({ score }) => score > 0)
      .sort((left, right) => right.score - left.score)[0]?.element;

    if (genericTarget) return genericTarget;

    const textNode = Array.from(document.querySelectorAll("span, p, div")).find(
      (element) => {
        if (!isBetnacionalBetslipElement(element)) return false;
        const text = (element.innerText || element.textContent || "")
          .trim()
          .toLowerCase();
        return /^(simples|cupom|boletim|seleç(?:ão|oes)|selecao)$/.test(text);
      },
    );
    if (!textNode) return null;

    return (
      textNode.closest(
        'button, [role="button"], [class*="_cur-pointer"], [class*="Betslip"], [class*="betslip"]',
      ) || textNode
    );
  }

  function getBetnacionalBetslipToggleControl() {
    const pillEl = findBetnacionalBetslipToggle();
    if (!pillEl) return null;
    return pillEl.matches?.('button, [role="button"], [class*="_cur-pointer"]')
      ? pillEl
      : pillEl.querySelector?.(
          'button, [role="button"], [class*="_cur-pointer"]',
        ) || pillEl;
  }

  function hasBetnacionalExpandedBetslipEvidence(toggleControl) {
    if (!toggleControl?.isConnected) return false;

    const rootSelector =
      '[data-testid="betslip-container"], [class*="BetslipDrawer"], [class*="betslip-drawer"], [class*="Betslip"], [class*="betslip"]';
    const betslipRoot =
      toggleControl.closest?.(rootSelector) ||
      document.querySelector?.(rootSelector) ||
      null;
    const stateOwners = [
      toggleControl,
      toggleControl.closest?.("[aria-expanded]"),
      betslipRoot,
    ].filter(Boolean);

    for (const owner of stateOwners) {
      if (owner.getAttribute?.("aria-expanded") === "true") return true;
      const state = normalizeBetnacionalText(
        [
          owner.getAttribute?.("data-state"),
          owner.getAttribute?.("data-expanded"),
          owner.getAttribute?.("data-open"),
          (owner.className || "").toString(),
        ]
          .filter(Boolean)
          .join(" "),
      );
      if (/\b(open|opened|opening|expanded|active)\b/.test(state)) return true;
    }

    if (!betslipRoot || betslipRoot === toggleControl) return false;

    // No layout sem aria-expanded, o corpo aberto já aumenta o container antes
    // de o React montar o input. Essa evidência impede que o clique automático
    // feche o card durante a animação de abertura nativa da Betnacional.
    const rootHeight = Number(betslipRoot.offsetHeight) || 0;
    const toggleHeight = Number(toggleControl.offsetHeight) || 0;
    if (rootHeight > 0 && toggleHeight > 0 && rootHeight > toggleHeight + 16) {
      return true;
    }

    const expandedBody = betslipRoot.querySelector?.(
      '[data-testid="betslip-submit"], input.is_CurrencyField, input[class*="is_CurrencyField"], [class*="BetslipContent"], [class*="betslip-content"], [class*="BetslipBody"], [class*="betslip-body"]',
    );
    return Boolean(
      expandedBody &&
        expandedBody.isConnected &&
        expandedBody.offsetWidth > 0 &&
        expandedBody.offsetHeight > 0,
    );
  }

  function getBetnacionalStakeWaitRoot() {
    const selector =
      '[data-testid="betslip-container"], [class*="BetslipDrawer"], [class*="betslip-drawer"], [class*="Betslip"], [class*="betslip"]';
    const input = findBetnacionalStakeInput();
    return input?.closest?.(selector) || document.querySelector(selector) || document;
  }

  async function waitForBetnacionalStakeInput(timeoutMs = 900) {
    const domWaiter = window.FastTriggerDom?.waitFor;
    if (typeof domWaiter === "function") {
      return await domWaiter(
        () => findBetnacionalStakeInput(),
        { timeoutMs, intervalMs: 8, root: getBetnacionalStakeWaitRoot() },
      );
    }
    return findBetnacionalStakeInput();
  }

  /**
   * Aguarda a Betnacional montar e abrir nativamente o cupom após a seleção.
   *
   * Este fluxo é deliberadamente observacional. A própria NSX abre o bilhete
   * ao selecionar a odd; tentar localizar e clicar um suposto controle de
   * expansão pode confundir cards promocionais como "Criar Aposta Multi" com
   * o cupom e adicionar uma seleção indesejada. Se o input não aparecer, a
   * execução falha fechada sem clicar em qualquer segundo elemento da página.
   */
  async function ensureBetnacionalBetslipExpanded(timeoutMs = 900) {
    const probe = () => {
      const input = findBetnacionalStakeInput();
      if (input && typeof window !== "undefined") {
        window.FastTriggerState = window.FastTriggerState || {};
        window.FastTriggerState.betnacionalBetslipWarm = true;
      }
      return input;
    };

    const immediateInput = probe();
    if (immediateInput) return immediateInput;

    const domWaiter = window.FastTriggerDom?.waitFor;
    if (typeof domWaiter === "function") {
      // O accordion inteiro pode ser substituído durante a transição. Observar
      // `document`, e não o root antigo do cupom, preserva o sinal do novo nó
      // sem autorizar qualquer clique adicional.
      return await domWaiter(probe, {
        timeoutMs,
        intervalMs: 8,
        root: document,
      });
    }

    return await new Promise((resolve) => {
      let settled = false;
      let observer = null;
      let timeoutId = null;

      const finish = (input) => {
        if (settled) return;
        settled = true;
        observer?.disconnect();
        if (timeoutId !== null) clearTimeout(timeoutId);
        resolve(input || null);
      };

      const check = () => {
        const input = probe();
        if (input) finish(input);
      };

      if (typeof MutationObserver === "function" && document.documentElement) {
        observer = new MutationObserver(check);
        observer.observe(document.documentElement, {
          subtree: true,
          childList: true,
          attributes: true,
        });
      }
      timeoutId = setTimeout(() => finish(findBetnacionalStakeInput()), timeoutMs);
      queueMicrotask(check);
    });
  }

  function getCertainlyCollapsedBetnacionalBetslipControl(expectedOdd) {
    const root = document.querySelector?.('[data-testid="betslip-container"]');
    if (!root || !isBetnacionalBetslipElement(root)) return null;
    if (findBetnacionalStakeInput()) return null;
    if (
      root.querySelector?.(
        '[data-testid="betslip-submit"], input.is_CurrencyField, input[class*="is_CurrencyField"]',
      )
    ) {
      return null;
    }

    const control =
      root.querySelector?.(':scope > [class*="_cur-pointer"]') ||
      Array.from(root.children || []).find((child) =>
        /(?:^|\s)_cur-pointer(?:\s|$)/.test(
          typeof child?.className === "string" ? child.className : "",
        ),
      ) ||
      null;
    if (!control || !isBetnacionalBetslipElement(control)) return null;
    if (hasBetnacionalExpandedBetslipEvidence(control)) return null;

    const rootHeight = Number(root.offsetHeight) || 0;
    const controlHeight = Number(control.offsetHeight) || 0;
    if (
      !rootHeight ||
      !controlHeight ||
      rootHeight > controlHeight + 8 ||
      rootHeight > 72
    ) {
      return null;
    }

    const rawText = root.innerText || root.textContent || "";
    const text = normalizeBetnacionalText(rawText);
    if (!/^simples\b/.test(text)) return null;
    const expectedNormalizedOdd = normalizeBetnacionalOdd(expectedOdd);
    if (
      expectedNormalizedOdd &&
      normalizeBetnacionalOdd(rawText) !== expectedNormalizedOdd
    ) {
      return null;
    }

    return control;
  }

  async function observeBetnacionalBetslipAfterSelection(
    expectedOdd,
    timeoutMs = BETNACIONAL_COLD_BETSLIP_TIMEOUT_MS,
  ) {
    const immediateInput = findBetnacionalStakeInput();
    if (immediateInput) return immediateInput;

    const signalProbe = () => {
      const input = findBetnacionalStakeInput();
      if (input) return { type: "input", element: input };
      const control =
        getCertainlyCollapsedBetnacionalBetslipControl(expectedOdd);
      return control ? { type: "collapsed", element: control } : null;
    };
    const domWaiter = window.FastTriggerDom?.waitFor;
    const signal =
      typeof domWaiter === "function"
        ? await domWaiter(signalProbe, {
            timeoutMs: Math.min(
              timeoutMs,
              BETNACIONAL_COLLAPSED_SIGNAL_TIMEOUT_MS,
            ),
            intervalMs: 8,
            root: document,
          })
        : signalProbe();

    if (signal?.type === "input") return signal.element;
    if (signal?.type === "collapsed") {
      // A casa ainda recebe uma pequena janela para concluir a abertura que
      // possa já estar em andamento. Se corpo/input aparecer, não tocamos no
      // controle. Somente o estado recolhido exato e estável recebe um clique.
      const openedNatively = await ensureBetnacionalBetslipExpanded(
        BETNACIONAL_NATIVE_OPENING_GRACE_MS,
      );
      if (openedNatively) return openedNatively;

      const stableControl =
        getCertainlyCollapsedBetnacionalBetslipControl(expectedOdd);
      if (stableControl && typeof stableControl.click === "function") {
        stableControl.click();
        const state =
          typeof window !== "undefined"
            ? (window.FastTriggerState = window.FastTriggerState || {})
            : null;
        if (state) state.betnacionalBetslipAssistAt = Date.now();
        return await ensureBetnacionalBetslipExpanded(timeoutMs);
      }
    }

    return await ensureBetnacionalBetslipExpanded(timeoutMs);
  }

  function parseBetnacionalStake(value) {
    const raw = (value || "").toString().replace(/R\$/gi, "").trim();
    if (!raw) return NaN;
    const clean = raw.replace(/[^\d,.-]/g, "");
    if (!clean) return NaN;
    return Number.parseFloat(
      clean.includes(",")
        ? clean.replace(/\./g, "").replace(",", ".")
        : clean,
    );
  }

  async function waitForStableBetnacionalStake(
    targetNumeric,
    timeoutMs = 180,
    requireSubmitReady = false,
  ) {
    if (!Number.isFinite(targetNumeric)) return null;

    const readReadyStake = () => {
      const liveInput = findBetnacionalStakeInput();
      const liveValue = liveInput?.value || liveInput?.textContent || "";
      const liveNumeric = parseBetnacionalStake(liveValue);
      // O data-testid do CTA não é estável entre versões da NSX. Resolva o
      // botão dentro do mesmo cupom do input e aceite o contrato semântico
      // exibido pela casa (Apostar/Confirmar), sem varrer a página inteira.
      const betslipRoot = liveInput?.closest?.(
        '[data-testid="betslip-container"], [class*="Betslip"], [class*="betslip"], form, [class*="Drawer"], [class*="Panel"]',
      );
      const submitCandidates = betslipRoot
        ? Array.from(
            betslipRoot.querySelectorAll(
              '[data-testid="betslip-submit"], button, [role="button"], input[type="submit"], a, div._cur-pointer',
            ),
          )
        : [];
      const submitButton = submitCandidates.find((candidate) => {
        if (!candidate || candidate.offsetWidth <= 0 || candidate.offsetHeight <= 0) return false;
        if (
          candidate.disabled ||
          candidate.hasAttribute("disabled") ||
          candidate.getAttribute("aria-disabled") === "true" ||
          candidate.classList.contains("disabled") ||
          candidate.classList.contains("Mui-disabled")
        ) return false;
        const label = normalizeBetnacionalText(
          [
            candidate.innerText,
            candidate.textContent,
            candidate.getAttribute("aria-label"),
            candidate.getAttribute("title"),
            candidate.getAttribute("data-testid"),
          ]
            .filter(Boolean)
            .join(" "),
        );
        return /\b(apostar|fazer aposta|finalizar aposta|confirmar aposta|place bet)\b/.test(label);
      });
      const submitReady =
        !requireSubmitReady ||
        Boolean(
          submitButton &&
            submitButton.isConnected &&
            submitButton.offsetWidth > 0 &&
            submitButton.offsetHeight > 0 &&
            !submitButton.disabled &&
            !submitButton.hasAttribute("disabled") &&
            submitButton.getAttribute("aria-disabled") !== "true" &&
            !submitButton.classList.contains("disabled") &&
            !submitButton.classList.contains("Mui-disabled"),
        );
      const matches =
        Boolean(liveInput?.isConnected) &&
        Number.isFinite(liveNumeric) &&
        Math.abs(targetNumeric - liveNumeric) < 0.01 &&
        submitReady;

      return matches ? liveInput : null;
    };

    // Caminho quente: se React já consolidou o valor e habilitou o CTA, não
    // adiciona nenhuma espera ao disparo.
    const immediateInput = readReadyStake();
    if (immediateInput) return immediateInput;

    const reactiveWaiter = window.FastTriggerDom?.waitForSignal;
    if (typeof reactiveWaiter === "function") {
      return await reactiveWaiter(readReadyStake, {
        timeoutMs,
        events: ["input", "beforeinput", "change", "focusout", "keydown", "keyup"],
        root: getBetnacionalStakeWaitRoot(),
      });
    }

    // Abas em segundo plano têm timers curtos fortemente limitados pelo
    // Chrome. A validação anterior exigia quatro setTimeout(8), então podia
    // expirar mesmo com a stake correta visível. Agora aguardamos os sinais
    // reais do input e as mutações usadas pelo React para habilitar o CTA.
    return await new Promise((resolve) => {
      let settled = false;
      let observer = null;
      let timeoutId = null;

      const cleanup = () => {
        observer?.disconnect();
        document.removeEventListener("input", check, true);
        document.removeEventListener("change", check, true);
        document.removeEventListener("focusout", check, true);
        if (timeoutId !== null) clearTimeout(timeoutId);
      };

      const finish = (input) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(input || null);
      };

      function check() {
        if (settled) return;
        const readyInput = readReadyStake();
        if (readyInput) finish(readyInput);
      }

      observer = new MutationObserver(check);
      observer.observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
      });
      document.addEventListener("input", check, true);
      document.addEventListener("change", check, true);
      document.addEventListener("focusout", check, true);

      // O timeout apenas limita uma UI que realmente não ficou pronta. Antes
      // de falhar, faz uma leitura final para cobrir timers desacelerados.
      timeoutId = setTimeout(() => finish(readReadyStake()), timeoutMs);
      queueMicrotask(check);
    });
  }

  function getBetnacionalOddCellLabel(oddCell, marketRoot) {
    if (!oddCell || !marketRoot) return "";
    const clean = (value) => (value || "").replace(/\s+/g, " ").trim();
    const isOnlyOdd = (value) =>
      !value || /^\d+(?:[.,]\d+)?$/.test(value) || /R\$/.test(value);

    // Layouts simples renderizam nome e valor como células irmãs:
    // [LDU][11.00][Empate][1.10][Mirassol][17.00].
    const allCells = Array.from(
      marketRoot.querySelectorAll(BETNACIONAL_ODD_SELECTOR),
    );
    const index = allCells.indexOf(oddCell);
    for (let position = index - 1; position >= 0 && position >= index - 3; position -= 1) {
      const previous = allCells[position];
      if (!previous || previous === oddCell) continue;
      const previousTestId = previous.getAttribute("data-testid") || "";
      const previousText = clean(previous.innerText || previous.textContent);
      if (
        !/^odd-/i.test(previousTestId) &&
        !/^suspended-outcome-/i.test(previousTestId) &&
        !isOnlyOdd(previousText)
      ) {
        return previousText;
      }
    }

    // Alguns mercados encapsulam o valor em um wrapper; nesse caso, procura
    // uma célula de nome entre os irmãos diretos do ancestral mais próximo.
    let ancestor = oddCell.parentElement;
    for (let depth = 0; ancestor && depth < 4; depth += 1, ancestor = ancestor.parentElement) {
      const siblings = Array.from(ancestor.children);
      const siblingIndex = siblings.findIndex(
        (sibling) => sibling === oddCell || sibling.contains(oddCell),
      );
      if (siblingIndex < 0) continue;
      for (let position = siblingIndex - 1; position >= 0; position -= 1) {
        const candidate = siblings[position];
        const candidateText = clean(candidate.innerText || candidate.textContent);
        if (candidateText && !isOnlyOdd(candidateText)) return candidateText;
      }
    }

    return "";
  }

  class BetnacionalAdapter {
    constructor() {
      this.siteName = "Betnacional";
    }

    /**
     * Verifica se o hostname pertence à Betnacional.
     * @param {string} hostname
     * @returns {boolean}
     */
    static isMatchingSite(hostname) {
      if (!hostname) return false;
      const host = hostname.toLowerCase();
      return (
        host.includes("betnacional.com") ||
        host.includes("betnacional.bet.br") ||
        host.includes("betnacional.br") ||
        host.includes("betnacional")
      );
    }

    /**
     * Raspagem dos mercados da Betnacional usando seletores reais do frontend NSX Enterprise:
     * - Contêineres de mercado: data-testid="market-group-item" (com
     *   suporte ao layout legado div.is_SectionMarketsItem)
     * - Título do mercado: span.is_SectionMarketsItemHeaderTitle
     * - Células de odd: div.is_SectionMarketsItemOdds / data-testid="odd-*"
     * - Rótulo da seleção: span.is_SectionMarketsOddsTitle
     * - Cotação: span.is_SectionMarketsOddsNumber
     * @param {Element} [root]
     * @returns {Array}
     */
    scrapeClean(root) {
      const mainNode =
        (typeof document !== "undefined"
          ? document.querySelector("main") ||
            document.querySelector("#ns-content-body")
          : null) ||
        root ||
        (typeof document !== "undefined" ? document.body : null);
      if (!mainNode) return [];

      const extractedGroups = [];
      const seenSignatures = new Set();

      try {
        // 1. Seleção dos contêineres principais de mercado
        let marketElements = getBetnacionalMarketRoots(mainNode);

        if (marketElements.length === 0) {
          const oddsElements = Array.from(
            mainNode.querySelectorAll(BETNACIONAL_ODD_SELECTOR),
          );
          const containerSet = new Set();
          oddsElements.forEach((el) => {
            const item =
              el.closest(
                '[data-testid="market-group-item"], div.is_SectionMarketsItem, [class*="is_SectionMarketsItem"], section, article',
              ) || el.parentElement?.parentElement;
            if (item && item !== mainNode && item !== document.body) {
              const cls = (item.className || "").toString();
              if (!cls.includes("Odds")) {
                containerSet.add(item);
              }
            }
          });
          marketElements = Array.from(containerSet);
        }

        const targetElements = marketElements;

        targetElements.forEach((marketEl, marketIndex) => {
          if (
            marketEl.closest(
              'header, nav, footer, [class*="Header"], [class*="header"]',
            )
          )
            return;

          const innerTextLower = (marketEl.innerText || "").toLowerCase();

          // EXCLUSÃO RIGOROSA: Ignora cards de Especiais ("Você aposta X e pode ganhar Y")
          if (
            /voc[êe]\s+aposta|pode\s+ganhar|supercota|super\s+odd|especiais/i.test(
              innerTextLower,
            )
          ) {
            return;
          }

          const bodyEl = marketEl.querySelector(
            '[class*="is_SectionMarketsItemBody"]',
          );
          if (bodyEl) {
            const bodyClass = bodyEl.className || "";
            const bodyStyle = bodyEl.getAttribute("style") || "";
            if (
              bodyClass.includes("_o-0") ||
              bodyClass.includes("_gridTemplateRows-_platformweb_0fr") ||
              bodyStyle.includes("opacity: 0")
            ) {
              return;
            }
          }

          // 2. Extração do Título do Mercado
          let marketTitle = "";

          const titleSpan = marketEl.querySelector(
            '[class*="is_SectionMarketsItemHeaderTitle"], [class*="ItemHeaderTitle"], div.MuiAccordionSummary-content',
          );
          if (titleSpan && titleSpan.innerText) {
            const cleanTitle = titleSpan.innerText
              .replace(/^CA\s+/i, "")
              .split("\n")[0]
              .trim();
            if (
              cleanTitle &&
              cleanTitle.length > 1 &&
              !/^(ca|ao vivo|populares|criar aposta|multi|home)$/i.test(
                cleanTitle,
              )
            ) {
              marketTitle = cleanTitle;
            }
          }

          if (!marketTitle) {
            const headerBtn = marketEl.querySelector(
              'button[class*="is_Button"], button',
            );
            if (headerBtn && headerBtn.innerText) {
              const cleanBtnText = headerBtn.innerText
                .replace(/^CA\s+/i, "")
                .split("\n")[0]
                .trim();
              if (
                cleanBtnText &&
                cleanBtnText.length > 1 &&
                !/^(ca|ao vivo|populares|criar aposta|multi|home)$/i.test(
                  cleanBtnText,
                )
              ) {
                marketTitle = cleanBtnText;
              }
            }
          }

          if (!marketTitle) {
            const lines = (marketEl.innerText || "")
              .trim()
              .split("\n")
              .map((s) => s.trim())
              .filter(Boolean);
            for (const line of lines) {
              const cleanLine = line.replace(/^CA\s+/i, "").trim();
              if (
                cleanLine &&
                cleanLine.length > 2 &&
                !/^(ca|ao vivo|populares|criar aposta|multi|home|\d+[.,]\d+)$/i.test(
                  cleanLine,
                )
              ) {
                marketTitle = cleanLine;
                break;
              }
            }
          }

          if (!marketTitle) marketTitle = `Mercado ${marketIndex + 1}`;

          const containerMarketTitle = marketTitle;
          // A casa mistura o nome do card ("Marcador" / "Mercados de
          // resultados") com chips ativos que representam o mercado real
          // ("Próximo marcador" / "Resultado Final"). Preserve os nomes de
          // mercado e ignore apenas chips que são filtros de período/coluna.
          const ignoredChipAliases = new Set([
            "tempo regular",
            "1 tempo",
            "2 tempo",
            "a qualquer momento",
            "casa",
            "visitante",
            "mais",
            "menos",
            "mais de",
            "menos de",
          ]);
          const variantLabels = getBetnacionalMarketVariantLabels(marketEl);
          const semanticVariants = variantLabels.filter(
            (label) => !ignoredChipAliases.has(normalizeBetnacionalText(label)),
          );

          // "Mercados de resultados" é só o agrupador visual. O primeiro
          // chip semântico representa o mercado efetivamente ofertado, como
          // "Resultado Final". Usá-lo como título mantém a bind estável.
          if (
            /^(mercados?\s+de\s+resultados?|resultados?)$/i.test(
              normalizeBetnacionalText(containerMarketTitle),
            ) &&
            semanticVariants.length > 0
          ) {
            marketTitle = semanticVariants[0];
          }

          const marketAliases = [
            marketTitle,
            containerMarketTitle,
            ...variantLabels,
          ].filter(Boolean);

          // Mercados de jogador da NSX usam uma célula de nome e um wrapper
          // de odds por linha. Como cada jogador pode ter apenas uma coluna
          // (por exemplo, "1+"), a heurística antiga que exigia duas odds por
          // linha descartava o mercado inteiro e o parser perdia os nomes.
          const normalizedStructureTitle =
            normalizeBetnacionalText(marketTitle);
          const isExplicitPlayerMarket =
            /\b(jogador|jogadores|player|players)\b/.test(
              normalizedStructureTitle,
            ) ||
            marketEl.querySelector(
              '[data-testid*="player" i], [class*="PlayerName"], [class*="player-name"]',
            ) !== null;
          const playerOutcomeRows = Array.from(
            marketEl.querySelectorAll(
              '[class*="is_SectionMarketOutcomesRow"]',
            ),
          ).filter(
            (row) =>
              row.querySelectorAll(BETNACIONAL_ODD_SELECTOR).length > 0,
          );
          if (isExplicitPlayerMarket && playerOutcomeRows.length > 0) {
            const outcomeHeaderElements = Array.from(
              marketEl.querySelectorAll(
                '[class*="is_SectionMarketOutcomesColumnTitles"], [class*="is_SectionMarketOutcomesColumnTitle"], [class*="OutcomeColumnTitle"], [class*="ColumnTitle"]',
              ),
            );
            const outcomeHeaders = [
              ...new Set(
                outcomeHeaderElements
                  .flatMap((element) =>
                    (element.innerText || element.textContent || "")
                      .split("\n")
                      .map((value) => value.trim()),
                  )
                  .filter(Boolean),
              ),
            ];
            const tableRows = [];
            const selections = [];
            let allLocked = true;

            playerOutcomeRows.forEach((rowEl, rowIndex) => {
              const oddCells = Array.from(
                rowEl.querySelectorAll(BETNACIONAL_ODD_SELECTOR),
              ).filter((cell) => {
                if (!cell || cell.offsetWidth === 0 || cell.offsetHeight === 0)
                  return false;
                const cellText = (cell.innerText || cell.textContent || "")
                  .trim();
                const testId = cell.getAttribute("data-testid") || "";
                return (
                  /^odd-/i.test(testId) ||
                  /^suspended-outcome-/i.test(testId) ||
                  /\d+[.,]\d+/.test(cellText) ||
                  cell.querySelector(
                    '[class*="is_SectionMarketsOddsNumber"], [class*="OddsNumber"], svg[data-testid="LockIcon"]',
                  ) !== null
                );
              });
              if (oddCells.length === 0) return;

              const directRowChildren = Array.from(rowEl.children);
              const lineLabel =
                directRowChildren
                  .filter(
                    (element) =>
                      !oddCells.some(
                        (cell) =>
                          element === cell || element.contains(cell),
                      ),
                  )
                  .map((element) =>
                    (element.innerText || element.textContent || "")
                      .replace(/\s+/g, " ")
                      .trim(),
                  )
                  .find(
                    (value) =>
                      value &&
                      !/^\d+(?:[.,]\d+)?$/.test(value) &&
                      !oddCells.some((cell) =>
                        (cell.innerText || cell.textContent || "")
                          .replace(/\s+/g, " ")
                          .trim() === value,
                      ),
                  ) ||
                "";
              if (!lineLabel) return;

              const colOdds = [];
              oddCells.forEach((cell, colIndex) => {
                const testId = cell.getAttribute("data-testid") || "";
                const isLocked =
                  cell.hasAttribute("disabled") ||
                  cell.disabled ||
                  cell.classList.contains("Mui-disabled") ||
                  cell.classList.contains("disabled") ||
                  cell.getAttribute("aria-disabled") === "true" ||
                  /^suspended-outcome-/i.test(testId) ||
                  cell.querySelector(
                    'svg[data-testid="LockIcon"], svg[class*="LockIcon"]',
                  ) !== null;
                if (!isLocked) allLocked = false;

                const titleEl = cell.querySelector(
                  '[class*="is_SectionMarketsOddsTitle"], [class*="OddsTitle"]',
                );
                const numberEl = cell.querySelector(
                  '[class*="is_SectionMarketsOddsNumber"], [class*="OddsNumber"]',
                );
                const optionName = titleEl?.innerText?.trim() || "";
                const fullText = (cell.innerText || cell.textContent || "")
                  .replace(/\s+/g, " ")
                  .trim();
                const oddMatch = (numberEl?.innerText || fullText).match(
                  /\d+(?:[.,]\d+)?/,
                );
                const oddValue = oddMatch
                  ? oddMatch[0].replace(",", ".")
                  : "";
                const colHeader =
                  outcomeHeaders[colIndex] || optionName || `${colIndex + 1}+`;
                const selectionName = optionName
                  ? `${optionName} ${lineLabel}`
                  : `${lineLabel} ${colHeader}`;
                const selection = {
                  name: selectionName.trim(),
                  colHeader,
                  lineName: lineLabel,
                  odds: isLocked ? "🔒 FECHADO" : oddValue,
                  val: oddValue,
                  element: cell,
                  locked: isLocked,
                  status: isLocked ? "LOCKED" : "open",
                  marketId:
                    cell.getAttribute("data-market-id") ||
                    marketEl.getAttribute("data-market-id") ||
                    `${marketIndex}`,
                  outcomeId:
                    cell.getAttribute("data-outcome-id") ||
                    testId ||
                    `${marketIndex}_${rowIndex}_${colIndex}`,
                  rowIndex,
                  colIndex,
                };
                colOdds.push(selection);
                selections.push(selection);
              });

              if (colOdds.length > 0) {
                tableRows.push({ lineLabel, colOdds, odds: colOdds });
              }
            });

            if (tableRows.length > 0) {
              const oddsSig = tableRows
                .flatMap((row) => row.colOdds)
                .map((selection) => `${selection.name}:${selection.val}`)
                .join("|");
              const signature = `${marketTitle.toLowerCase()}::player::${oddsSig}`;
              if (!seenSignatures.has(signature)) {
                seenSignatures.add(signature);
                extractedGroups.push({
                  title: marketTitle,
                  marketAliases: [...new Set(marketAliases)],
                  isTable: true,
                  isPlayerMarket: true,
                  hasLabelsCol: true,
                  headers: ["Jogador/Contagem", ...outcomeHeaders],
                  tableRows,
                  rows: tableRows.map((row) => ({
                    label: row.lineLabel,
                    odds: row.colOdds,
                  })),
                  participants: selections,
                  selections,
                  isSuspended: allLocked,
                });
              }
              return;
            }
          }

          // 3. Checagem de Estrutura em Tabela (ex: Mais/Menos gols, Handicap)
          const rawColHeaderEls = Array.from(
            marketEl.querySelectorAll(
              '[class*="HeaderCol"], [class*="ColTitle"]:not([class*="HeaderTitle"]), [class*="ColumnTitle"], [data-testid*="column-title"]',
            ),
          );
          const colHeaderEls = rawColHeaderEls.filter(
            (element) =>
              !rawColHeaderEls.some(
                (other) => other !== element && element.contains(other),
              ),
          );
          const colHeaders = [
            ...new Set(
              colHeaderEls
                .map((el) => el.innerText.trim())
                .filter(
                  (txt) =>
                    txt &&
                    txt.length > 0 &&
                    txt.length < 80 &&
                    normalizeBetnacionalText(txt) !==
                      normalizeBetnacionalText(marketTitle) &&
                    !marketAliases.some(
                      (alias) =>
                        normalizeBetnacionalText(alias) ===
                        normalizeBetnacionalText(txt),
                    ) &&
                    !/^(ca|ao vivo|populares|tempo regular|1º tempo)$/i.test(
                      txt,
                    ),
                ),
            ),
          ];

          const contractRows = Array.from(
            marketEl.querySelectorAll(
              '[class*="is_SectionMarketOutcomesRow"]',
            ),
          ).filter(
            (row) =>
              row.querySelectorAll(
                '[data-testid^="odd-"], [data-testid^="suspended-outcome-"]',
              ).length >= 2,
          );
          const rowContainers = contractRows.length
            ? contractRows
            : Array.from(marketEl.querySelectorAll("div, section")).filter(
                (r) => {
                  const oddsInside = r.querySelectorAll(
                    '[data-testid^="odd-"], [data-testid^="suspended-outcome-"]',
                  );
                  const isDirectRow = !Array.from(
                    r.querySelectorAll("div"),
                  ).some(
                    (child) =>
                      child !== r &&
                      child.querySelectorAll(
                        '[data-testid^="odd-"], [data-testid^="suspended-outcome-"]',
                      ).length >= 2,
                  );
                  return oddsInside.length >= 2 && isDirectRow;
                },
              );

          const tableMarketName = normalizeBetnacionalText(marketTitle);
          const isKnownTableMarket =
            /\b(gols|handicap|escanteios|cartoes|chutes|finalizacoes|faltas|impedimentos|laterais|tiros de meta)\b/.test(
              tableMarketName,
            );
          const isKnownSimpleMarket =
            /\b(resultado final|proximo time a marcar|dupla chance|chance dupla|empate anula|ambas.*marcam|ambos.*marcam|vencedor)\b/.test(
              tableMarketName,
            );

          if (
            rowContainers.length > 0 &&
            !isKnownSimpleMarket &&
            (colHeaders.length >= 2 || isKnownTableMarket)
          ) {
            const tableRows = [];
            let allLocked = true;

            rowContainers.forEach((rowEl, rowIdx) => {
              let lineLabel = "";
              const oddBtnsInRow = Array.from(
                rowEl.querySelectorAll(BETNACIONAL_ODD_SELECTOR),
              ).filter((element) => {
                const testId = element.getAttribute("data-testid") || "";
                const text = (element.innerText || element.textContent || "")
                  .replace(/\s+/g, " ")
                  .trim();
                return (
                  /^odd-/i.test(testId) ||
                  /^suspended-outcome-/i.test(testId) ||
                  element.querySelector(
                    '[class*="is_SectionMarketsOddsNumber"], [class*="OddsNumber"], svg[data-testid="LockIcon"]',
                  ) !== null ||
                  /^\d+(?:[.,]\d+)?$/.test(text)
                );
              });

              const rowTexts = Array.from(rowEl.children)
                .filter(
                  (element) =>
                    !oddBtnsInRow.some(
                      (odd) => element === odd || element.contains(odd),
                    ),
                )
                .map((el) =>
                  (el.innerText || el.textContent || "")
                    .replace(/\s+/g, " ")
                    .trim(),
                )
                .filter(
                  (txt) =>
                    txt &&
                    !/^\d+(?:[.,]\d+)?$/.test(txt) &&
                    !/^(ca|ao vivo)$/i.test(txt),
                );

              if (rowTexts.length > 0) lineLabel = rowTexts[0];
              if (!lineLabel) lineLabel = `Linha ${rowIdx + 1}`;

              const colOdds = [];
              oddBtnsInRow.forEach((btn, btnIdx) => {
                const isLocked =
                  btn.hasAttribute("disabled") ||
                  btn.disabled ||
                  btn.classList.contains("Mui-disabled") ||
                  btn.querySelector('svg[data-testid="LockIcon"]') !== null;
                if (!isLocked) allLocked = false;

                let optionName = "";
                let oddValue = "";
                const titleEl = btn.querySelector(
                  '[class*="is_SectionMarketsOddsTitle"], [class*="OddsTitle"]',
                );
                const numberEl = btn.querySelector(
                  '[class*="is_SectionMarketsOddsNumber"], [class*="OddsNumber"]',
                );
                if (titleEl) optionName = titleEl.innerText.trim();
                if (numberEl) oddValue = numberEl.innerText.trim();

                if (!oddValue) {
                  const fullText = (btn.innerText || "").trim();
                  const m = fullText.match(/\d+[.,]\d+/);
                  if (m) oddValue = m[0];
                }

                const colHeader =
                  colHeaders[btnIdx] ||
                  optionName ||
                  (btnIdx === 0 ? "Mais de" : "Menos de");
                const fullName = optionName
                  ? `${optionName} ${lineLabel}`
                  : `${colHeader} ${lineLabel}`;

                colOdds.push({
                  name: fullName,
                  colHeader: colHeader,
                  odds: isLocked ? "🔒 FECHADO" : oddValue,
                  val: oddValue,
                  element: btn,
                  locked: isLocked,
                  status: isLocked ? "LOCKED" : "open",
                  marketId: `${marketIndex}`,
                  outcomeId: `${marketIndex}_${rowIdx}_${btnIdx}`,
                });
              });

              if (colOdds.length > 0) {
                tableRows.push({
                  lineLabel: lineLabel,
                  colOdds: colOdds,
                });
              }
            });

            if (tableRows.length > 0) {
              const oddsSig = tableRows
                .flatMap((r) => r.colOdds)
                .map((o) => `${o.name}:${o.val}`)
                .join("|");
              const signature = `${marketTitle.toLowerCase()}::${oddsSig}`;

              if (!seenSignatures.has(signature)) {
                seenSignatures.add(signature);
                extractedGroups.push({
                  title: marketTitle,
                  marketAliases: [...new Set(marketAliases)],
                  isTable: true,
                  headers:
                    colHeaders.length > 0
                      ? colHeaders
                      : ["Mais de", "Menos de"],
                  tableRows: tableRows,
                  isSuspended: allLocked,
                  selections: tableRows.flatMap((r) => r.colOdds),
                  participants: tableRows.flatMap((r) => r.colOdds),
                });
              }
              return;
            }
          }

          // 4. Captura de Mercados Simples (ex: 1X2 Resultado Final)
          let oddElements = Array.from(
            marketEl.querySelectorAll(BETNACIONAL_ODD_SELECTOR),
          );

          if (oddElements.length === 0) {
            const candidates = Array.from(
              marketEl.querySelectorAll(
                'button.MuiButton-root, button[role="button"], button[data-outcome], button[data-odd], div, button',
              ),
            );
            oddElements = candidates.filter((el) => {
              if (!el || el.offsetWidth === 0 || el.offsetHeight === 0)
                return false;
              const txt = (el.innerText || el.textContent || "").trim();
              return /\d+[.,]\d+/.test(txt);
            });
          }

          const buttons = oddElements.filter((btn) => {
            if (!btn || btn.offsetWidth === 0 || btn.offsetHeight === 0)
              return false;
            if (
              btn.closest('header, nav, [class*="Header"], [class*="header"]')
            )
              return false;

            const txt = (btn.innerText || btn.textContent || "").trim();
            const textLower = txt.toLowerCase();

            if (
              /r\s*\$|saldo|dep[óo]sito|minhas?\s+apostas|extrato|minha\s+conta|promo[çc][õo]es|cassino|aviator|tigrinho|menu|entrar|cadastrar|voc[êe]\s+aposta|pode\s+ganhar/i.test(
                textLower,
              )
            ) {
              return false;
            }

            const hasNumericOdd =
              /\d+[.,]\d+/.test(txt) ||
              btn.hasAttribute("data-odd") ||
              btn.hasAttribute("data-outcome-id") ||
              btn.querySelector('[class*="is_SectionMarketsOddsNumber"]') !==
                null;
            const hasSuspendedMarker = /^suspended-outcome-/i.test(
              btn.getAttribute("data-testid") || "",
            );
            const isLockedIcon =
              btn.querySelector(
                'svg[data-testid="LockIcon"], svg[class*="LockIcon"]',
              ) !== null;

            return hasNumericOdd || hasSuspendedMarker || isLockedIcon;
          });

          if (buttons.length === 0) return;

          const marketOdds = [];
          let allLocked = true;

          buttons.forEach((btn, btnIdx) => {
            const isLocked =
              btn.hasAttribute("disabled") ||
              btn.disabled ||
              btn.classList.contains("Mui-disabled") ||
              btn.classList.contains("disabled") ||
              btn.getAttribute("aria-disabled") === "true" ||
              btn.querySelector('svg[data-testid="LockIcon"]') !== null ||
              btn.querySelector('svg[class*="LockIcon"]') !== null ||
              /^suspended-outcome-/i.test(
                btn.getAttribute("data-testid") || "",
              );

            if (!isLocked) allLocked = false;

            const marketId =
              btn.getAttribute("data-market-id") ||
              marketEl.getAttribute("data-market-id") ||
              `${marketIndex}`;
            const outcomeId =
              btn.getAttribute("data-outcome-id") ||
              btn.getAttribute("data-odd") ||
              btn.getAttribute("data-testid") ||
              `${marketIndex}_${btnIdx}`;

            let optionLabel = "";
            let oddValue = "";

            const titleEl = btn.querySelector(
              '[class*="is_SectionMarketsOddsTitle"], [class*="OddsTitle"]',
            );
            const numberEl = btn.querySelector(
              '[class*="is_SectionMarketsOddsNumber"], [class*="OddsNumber"]',
            );

            if (titleEl && titleEl.innerText) {
              optionLabel = titleEl.innerText.trim();
            }
            if (numberEl && numberEl.innerText) {
              oddValue = numberEl.innerText.trim();
            }

            if (!optionLabel || !oddValue) {
              const fullText = (btn.innerText || btn.textContent || "").trim();
              const lines = fullText
                .split("\n")
                .map((s) => s.trim())
                .filter(Boolean);

              if (lines.length >= 2) {
                if (!optionLabel) optionLabel = lines[0];
                if (!oddValue) oddValue = lines[1];
              } else if (lines.length === 1) {
                const numericMatch = fullText.match(/\d+[.,]\d+/);
                if (numericMatch) {
                  if (!oddValue) oddValue = numericMatch[0];
                  if (!optionLabel)
                    optionLabel = fullText.replace(oddValue, "").trim();
                } else {
                  if (!optionLabel) optionLabel = fullText;
                }
              }
            }

            if (!optionLabel) {
              optionLabel = getBetnacionalOddCellLabel(btn, marketEl);
            }

            if (isLocked) {
              oddValue = "🔒 FECHADO";
            }

            marketOdds.push({
              name: optionLabel || `Opção ${btnIdx + 1}`,
              colHeader: optionLabel || `Opção ${btnIdx + 1}`,
              lineName: "",
              odds: isLocked ? "🔒 FECHADO" : oddValue,
              val: oddValue,
              element: btn,
              locked: isLocked,
              status: isLocked ? "LOCKED" : "open",
              marketId: marketId,
              outcomeId: outcomeId,
              rowIndex: Math.floor(btnIdx / 3),
              colIndex: btnIdx % 3,
            });
          });

          if (marketOdds.length > 0) {
            const oddsSig = marketOdds
              .map((o) => `${o.name}:${o.val}`)
              .join("|");
            const signature = `${marketTitle.toLowerCase()}::${oddsSig}`;

            if (seenSignatures.has(signature)) return;
            seenSignatures.add(signature);

            extractedGroups.push({
              title: marketTitle,
              marketAliases: [...new Set(marketAliases)],
              isTable: false,
              isSuspended: allLocked,
              selections: marketOdds,
              participants: marketOdds,
            });
          }
        });
      } catch (err) {
        console.error("[Betnacional Scraper] Erro ao raspar mercados:", err);
      }

      return extractedGroups;
    }

    /**
     * Lê a seleção e odd ativas no cupom de apostas da Betnacional.
     * @returns {string}
     */
    scanBetslip() {
      try {
        const betslipContainer = document.querySelector(
          '[data-testid="betslip-container"], [class*="Betslip"], [class*="betslip"]',
        );
        if (!betslipContainer) return "";

        const nameEl = betslipContainer.querySelector(
          '[class*="Selection"], [class*="selection"], [class*="Outcome"], [class*="outcome"], [class*="Team"], [class*="team"], span, p',
        );
        const oddsEl = betslipContainer.querySelector(
          '[class*="Odd"], [class*="odd"], [class*="Value"], [class*="value"], [class*="Price"], [class*="price"]',
        );

        const activeName =
          nameEl && nameEl.offsetWidth > 0 ? nameEl.innerText.trim() : "";
        const activeOdds =
          oddsEl && oddsEl.offsetWidth > 0 ? oddsEl.innerText.trim() : "";

        return activeName
          ? `${activeName} ${activeOdds ? "(" + activeOdds + ")" : ""}`
          : "";
      } catch (e) {
        return "";
      }
    }

    /**
     * Agrupa execuções idênticas que chegam simultaneamente ao mesmo frame.
     * Isso evita que o comportamento de toggle da casa remova a seleção
     * adicionada pela primeira execução.
     */
    async selectOddsOnBetnacional(
      targetName,
      targetOddVal,
      marketTitle,
      colIndex = 0,
      rowIndex = 0,
      isHotkey = false,
      lineName = "",
      fastMode = false,
      targetElement = null,
      explicitStake = null,
    ) {
      if (explicitStake != null && explicitStake !== "") {
        window.FastTriggerExpectedExecutionStake = explicitStake;
      }
      // Valida antes de tocar na odd. Assim uma renovação de sessão nunca
      // acontece com o bilhete já aberto e a etapa de stake reutiliza o cache
      // quente imediatamente.
      const license = await ensureBetnacionalExecutionLicense();
      if (!license?.valid && !hasBetnacionalElectronAuthorization() && window.FastTriggerExternalElectronMode !== true) {
        if (typeof showFlashFeedback === "function") {
          showFlashFeedback("🔒 Assinatura expirada ou não autorizada");
        }
        return false;
      }

      const state =
        typeof window !== "undefined"
          ? (window.FastTriggerState = window.FastTriggerState || {})
          : null;
      const pageIdentity =
        typeof location !== "undefined" ? location.pathname : "";
      const targetIdentity = [
        targetElement?.getAttribute?.("data-testid") || "",
        marketTitle,
        lineName,
        targetName,
        targetOddVal,
        colIndex,
        rowIndex,
      ]
        .map((value) => (value || "").toString().trim().toLowerCase())
        .join("~");
      const selectionKey = `${pageIdentity}|${targetIdentity}`;
      const now = Date.now();
      const existing = state?.betnacionalSelectionInFlight;
      const pipeline = state?.betnacionalSelectionPipeline;

      // Além da deduplicação por identidade, não permitimos que uma segunda
      // seleção diferente entre no mesmo cupom enquanto o primeiro fluxo
      // ainda está montando a stake. No One-Shot, duas seleções simultâneas
      // não são uma operação válida: a Betnacional alterna a odd e o cupom
      // perde o estado necessário para confirmar.
      if (
        pipeline &&
        now - Number(pipeline.startedAt || 0) <
          BETNACIONAL_SELECTION_DEDUP_TIMEOUT_MS
      ) {
        if (pipeline.key === selectionKey && pipeline.promise) {
          console.debug(
            `[Betnacional Adapter] Seleção repetida agrupada: ${targetName || "(sem nome)"}.`,
          );
          return pipeline.promise;
        }
        console.debug(
          `[Betnacional Adapter] Seleção concorrente ignorada: ${targetName || "(sem nome)"}.`,
        );
        return false;
      }

      if (
        existing?.key === selectionKey &&
        existing.promise &&
        now - existing.startedAt < BETNACIONAL_SELECTION_DEDUP_TIMEOUT_MS
      ) {
        console.log(
          `[Betnacional Adapter] Comando duplicado agrupado: ${targetName || "(sem nome)"} (${targetOddVal || "sem odd"}).`,
        );
        return existing.promise;
      }

      const operation = this._selectOddsOnBetnacional(
        targetName,
        targetOddVal,
        marketTitle,
        colIndex,
        rowIndex,
        isHotkey,
        lineName,
        fastMode,
        targetElement,
        explicitStake,
      );

      if (!state) return operation;

      const entry = {
        key: selectionKey,
        startedAt: now,
        promise: operation,
      };
      state.betnacionalSelectionInFlight = entry;
      if (!pipeline || pipeline.key !== selectionKey) {
        state.betnacionalSelectionPipeline = entry;
      }

      try {
        return await operation;
      } finally {
        if (state.betnacionalSelectionInFlight === entry) {
          delete state.betnacionalSelectionInFlight;
        }
        if (state.betnacionalSelectionPipeline === entry) {
          setTimeout(() => {
            if (state.betnacionalSelectionPipeline === entry) {
              delete state.betnacionalSelectionPipeline;
            }
          }, BETNACIONAL_SELECTION_COOLDOWN_MS);
        }
      }
    }

    /**
     * Executa a seleção de uma odd específica na página com restrição ao contêiner exato do mercado e filtragem de botões folha.
     */
    async _selectOddsOnBetnacional(
      targetName,
      targetOddVal,
      marketTitle,
      colIndex = 0,
      rowIndex = 0,
      isHotkey = false,
      lineName = "",
      fastMode = false,
      targetElement = null,
      explicitStake = null,
    ) {
      try {
        const mainNode =
          document.querySelector("main, #ns-content-body") || document.body;

        const targetMarketEl = findBetnacionalMarketRoot(
          mainNode,
          marketTitle,
          targetElement,
        );
        if (!targetMarketEl) {
          console.warn(
            `[Betnacional Adapter] Mercado não localizado com segurança: ${marketTitle || "(sem mercado)"}.`,
          );
          return false;
        }
        const scopeNode = targetMarketEl;

        let targetBtn = null;
        const isSelectableOdd = (element) => {
          if (!element?.isConnected || !scopeNode.contains(element)) return false;
          const testId = element.getAttribute?.("data-testid") || "";
          const className = String(element.className || "");
          const text = element.textContent || "";
          return (
            /^odd-/i.test(testId) ||
            /^suspended-outcome-/i.test(testId) ||
            /OddsNumber/i.test(className) ||
            /\d+[.,]\d+/.test(text)
          );
        };

        // O scraper já encontrou a célula exata. Usá-la antes de qualquer
        // querySelectorAll amplo reduz drasticamente o custo do caminho quente.
        if (targetElement?.isConnected && scopeNode.contains(targetElement)) {
          const directCandidates = [
            targetElement.matches?.(BETNACIONAL_ODD_SELECTOR)
              ? targetElement
              : null,
            targetElement.closest?.(BETNACIONAL_ODD_SELECTOR),
            targetElement.closest?.('button, [role="button"]'),
          ].filter(Boolean);
          targetBtn = directCandidates.find(isSelectableOdd) || null;
        }

        // 1. Obter somente células de odd no escopo exato do mercado. A NSX
        // também usa botões para cabeçalhos, filtros e navegação; misturá-los
        // nesta lista é a origem dos cliques em controles sem relação com a
        // seleção. O fallback legado só entra quando o layout não expõe as
        // células pelo contrato de odd.
        let rawBtns = [];
        let allBtns = [];
        if (!targetBtn) {
          rawBtns = Array.from(scopeNode.querySelectorAll(BETNACIONAL_ODD_SELECTOR));
          if (rawBtns.length === 0) {
            rawBtns = Array.from(scopeNode.querySelectorAll(
              'button.MuiButton-root, button[role="button"], button[data-outcome], button[data-odd]',
            ));
          }
          rawBtns = rawBtns.filter((b) => {
            if (b.closest('header, nav, [class*="Header"], [class*="header"]')) return false;
            const txt = (b.textContent || "").toLowerCase();
            return !/voc[êe]\s+aposta|pode\s+ganhar/i.test(txt);
          });
          // 2. Filtro de elementos folha sem comparações O(n²).
          allBtns = keepBetnacionalLeafNodes(rawBtns, scopeNode);
        }

        // O fallback por índice só pode considerar células de odd reais.
        // Botões de perfil/conta também podem estar dentro do mesmo escopo e
        // nunca devem ser tratados como uma seleção apostável.
        const selectionBtns = allBtns.filter((btn) => {
          const text = (btn.innerText || btn.textContent || "").trim();
          const className = (btn.className || "").toString();
          const testId = btn.getAttribute("data-testid") || "";
          const ariaLabel = btn.getAttribute("aria-label") || "";
          const title = btn.getAttribute("title") || "";
          const inProfileContext = btn.closest(
            'header, nav, footer, [class*="Profile"], [class*="profile"], [class*="UserMenu"], [class*="user-menu"], [data-testid*="profile"], [data-testid*="Profile"], a[href*="/perfil"], a[href*="/profile"]',
          );
          if (inProfileContext) return false;
          if (
            /r\s*\$|saldo|dep[óo]sito|minha\s+conta|perfil|entrar|cadastrar/i.test(
              text,
            )
          ) {
            return false;
          }
          if (/perfil|profile|abrir\s+conta|minha\s+conta/i.test(`${ariaLabel} ${title}`)) {
            return false;
          }

          const hasOddMarker =
            /OddsNumber/i.test(className) ||
            /^odd-/i.test(testId) ||
            /^suspended-outcome-/i.test(testId) ||
            btn.hasAttribute("data-odd") ||
            btn.hasAttribute("data-outcome") ||
            btn.hasAttribute("data-outcome-id");
          const hasNumericOdd = /\d+[.,]\d+/.test(text);
          return hasOddMarker || hasNumericOdd;
        });

        const normTarget = normalizeBetnacionalText(targetName);
        const normOdd = normalizeBetnacionalOdd(targetOddVal);

        // O scraper já encontrou a célula exata. Usá-la primeiro elimina a
        // ambiguidade de nomes abreviados (por exemplo, "LDU"/"LDU Quito")
        // e evita clicar na primeira odd semelhante de outro mercado.
        if (!targetBtn && targetElement?.isConnected) {
          const exactCandidates = [
            targetElement,
            targetElement.closest(BETNACIONAL_ODD_SELECTOR),
            targetElement.closest('button, [role="button"]'),
          ].filter(Boolean);
          targetBtn = exactCandidates.find((candidate) =>
            selectionBtns.includes(candidate),
          );
          if (!targetBtn) {
            targetBtn = selectionBtns.find((candidate) =>
              candidate.contains(targetElement),
            );
          }
        }

        // NÍVEL 1: Match exato de Nome da Opção + Odd Value
        if (!targetBtn && normTarget && normOdd) {
          targetBtn = selectionBtns.find((b) => {
            const txt = normalizeBetnacionalText(
              (b.innerText || b.textContent || "").replace(",", "."),
            );
            const oddText = normalizeBetnacionalOdd(
              b.innerText || b.textContent || "",
            );
            return txt.includes(normTarget) && oddText.includes(normOdd);
          });
        }

        // NÍVEL 2: Match apenas por Nome da Opção (ex: "Betis")
        if (!targetBtn && normTarget) {
          targetBtn = selectionBtns.find((b) => {
            const txt = normalizeBetnacionalText(
              b.innerText || b.textContent || "",
            );
            return txt.includes(normTarget);
          });
        }

        // NÍVEL 3: Match apenas por Odd Value (ex: "5.50")
        if (!targetBtn && normOdd) {
          const oddMatches = selectionBtns.filter((b) => {
            const txt = normalizeBetnacionalOdd(
              b.innerText || b.textContent || "",
            );
            return txt.includes(normOdd);
          });
          // A mesma cotação pode aparecer em mais de uma opção. Um fallback
          // ambíguo deve falhar fechado, nunca clicar na primeira ocorrência.
          if (oddMatches.length === 1) targetBtn = oddMatches[0];
        }

        if (targetBtn) {
          const targetLabel = normalizeBetnacionalText(
            targetBtn.innerText || targetBtn.textContent || "",
          );
          const targetTestId = targetBtn.getAttribute("data-testid") || "";
          console.log(
            `[Betnacional Adapter] Odd localizada: ${targetName || "(sem nome)"} ` +
              `(${targetOddVal || "sem odd"}) -> ${targetLabel || targetTestId}.`,
          );
          let prefetchedStakeInputPromise = null;
          if (typeof simulateHumanClick === "function") {
            // O handler React pode começar a montar o cupom antes de a Promise
            // do clique DOM voltar ao adapter. Começar a observação no mesmo
            // ciclo elimina a janela ociosa entre a seleção visível e a
            // montagem nativa do bilhete.
            prefetchedStakeInputPromise = observeBetnacionalBetslipAfterSelection(
              targetOddVal,
              getBetnacionalBetslipWaitTimeout(
                fastMode ||
                  isHotkey ||
                  window.FastTriggerState?.backgroundDispatchInProgress === true,
              ),
            );
            const clickPromise = simulateHumanClick(
              targetBtn,
              isHotkey,
              fastMode ||
                isHotkey ||
                window.FastTriggerState?.backgroundDispatchInProgress === true,
            );
            const clicked = await clickPromise;
            if (clicked === false) return false;
          } else {
            targetBtn.click();
            prefetchedStakeInputPromise = observeBetnacionalBetslipAfterSelection(
              targetOddVal,
              getBetnacionalBetslipWaitTimeout(fastMode || isHotkey),
            );
          }

          // O triggerPlaceBet aguarda o input real do cupom; não introduzimos
          // um sleep fixo que só aumenta a latência e ainda pode ser curto
          // demais para um render assíncrono.
          const placeBetResult = await this.triggerPlaceBet(
            false,
            isHotkey,
            false,
            fastMode,
            prefetchedStakeInputPromise,
            explicitStake,
          );
          return placeBetResult !== false;
        }

        console.warn(
          `[Betnacional Adapter] Odd não localizada com segurança: ${targetName || "(sem nome)"} ` +
            `(${targetOddVal || "sem odd"}) no mercado ${marketTitle || "(sem mercado)"}.`,
        );
        return false;
      } catch (err) {
        console.error("[Betnacional Adapter] Erro ao selecionar odd:", err);
        return false;
      }
    }

    /**
     * Aguarda a abertura nativa do balão, preenche a stake e envia a aposta em One-Shot na Betnacional.
     * @param {boolean} [isManualTrigger=false]
     * @param {boolean} [isHotkey=false]
     * @returns {Promise<boolean>}
     */
    async triggerPlaceBet(
      isManualTrigger = false,
      isHotkey = false,
      stakeAlreadyPrepared = false,
      fastMode = false,
      prefetchedStakeInputPromise = null,
      explicitStake = null,
    ) {
      try {
        const flowStartedAt = performance.now();
        betnacionalFlowTrace("início", { manual: isManualTrigger, hotkey: isHotkey, stakePrepared: stakeAlreadyPrepared });
        const license = await ensureBetnacionalExecutionLicense();
        if (!license?.valid && !hasBetnacionalElectronAuthorization() && window.FastTriggerExternalElectronMode !== true) {
          betnacionalFlowTrace("bloqueado", "autorização Electron/licença ausente");
          if (typeof showFlashFeedback === "function")
            showFlashFeedback("🔒 Assinatura expirada ou não autorizada");
          return false;
        }
        if (explicitStake != null && explicitStake !== "") {
          window.FastTriggerExpectedExecutionStake = explicitStake;
        }
        const stakeVal =
          explicitStake ||
          window.FastTriggerExpectedExecutionStake ||
          (window.FastTriggerConfig && window.FastTriggerConfig.stakeValByHouse && window.FastTriggerConfig.stakeValByHouse.betnacional) ||
          (window.FastTriggerConfig ? window.FastTriggerConfig.stakeVal : null) ||
          "0.50";
        const parsedConfiguredStake = parseBetnacionalStake(stakeVal);
        const targetStakeNumeric = Number.isFinite(parsedConfiguredStake)
          ? parsedConfiguredStake
          : 0.5;
        const cleanStakeVal = targetStakeNumeric.toFixed(2).replace(".", ",");

        const fastDispatch =
          fastMode ||
          isHotkey ||
          window.FastTriggerState?.backgroundDispatchInProgress === true;
        // O commit da bind revalida a stake: o React pode remontar ou limpar
        // o input entre a preparação e o clique final.
        let stakePrepared = stakeAlreadyPrepared
          ? Boolean(
              await waitForStableBetnacionalStake(
                targetStakeNumeric,
                fastDispatch ? 700 : 1200,
                true,
              ),
            )
          : false;

        // A pipeline dinâmica prepara a stake em uma etapa e chama este método
        // novamente somente para o commit. Se o React remontar o input durante
        // essa passagem, nunca limpamos e reescrevemos o valor: aguardamos a
        // revalidação acima e falhamos fechado caso a evidência não reapareça.
        if (stakeAlreadyPrepared && !stakePrepared) {
          console.warn(
            "[Betnacional Adapter] Commit cancelado: a stake preparada não foi revalidada; nenhuma reescrita foi feita.",
          );
          return false;
        }

        if (!stakePrepared) {
          // A própria Betnacional abre o cupom. Esta etapa apenas aguarda o
          // input real; nunca clica em cabeçalhos, cards ou seleções auxiliares.
          let stakeInput = findBetnacionalStakeInput();
          if (!stakeInput) {
            stakeInput = prefetchedStakeInputPromise
              ? await prefetchedStakeInputPromise
              : await ensureBetnacionalBetslipExpanded(
                  fastDispatch ? 650 : 1100,
                );
          }

          // 2. Injeta a stake e aguarda a própria UI confirmar o valor.
          if (stakeInput) {
            let currentNumeric = parseBetnacionalStake(
              stakeInput.value || stakeInput.textContent,
            );

            // O input pode ficar visível um frame antes de a NSX hidratar o
            // valor que ela própria preservou. Uma janela curta e orientada a
            // sinais evita apagar uma stake correta sem inserir atraso quando
            // o valor já está disponível.
            if (!Number.isFinite(currentNumeric)) {
              const hydratedInput = await waitForStableBetnacionalStake(
                targetStakeNumeric,
                fastDispatch ? 48 : 80,
                false,
              );
              if (hydratedInput) {
                stakeInput = hydratedInput;
                currentNumeric = parseBetnacionalStake(
                  hydratedInput.value || hydratedInput.textContent,
                );
              }
            }

            if (
              Number.isFinite(targetStakeNumeric) &&
              Number.isFinite(currentNumeric) &&
              Math.abs(targetStakeNumeric - currentNumeric) < 0.01
            ) {
              stakePrepared = Boolean(
                await waitForStableBetnacionalStake(
                  targetStakeNumeric,
                  fastDispatch ? 700 : 1200,
                  true,
                ),
              );
              if (stakePrepared) {
                console.debug(
                  "[Betnacional Timing] Stake existente reutilizada sem escrita.",
                );
              }
            } else {
              // O setter com InputEvent reproduz o preenchimento que a máscara
              // aceita imediatamente. Só libera quando o botão também estiver
              // habilitado pela própria Betnacional.
              let directWriteSucceeded = false;
              if (typeof window.writeStakeValueDirect === "function") {
                directWriteSucceeded = window.writeStakeValueDirect(
                  stakeInput,
                  cleanStakeVal,
                );
              }

              stakePrepared = Boolean(
                directWriteSucceeded
                  ? await waitForStableBetnacionalStake(
                      targetStakeNumeric,
                      fastDispatch ? 900 : 1400,
                      true,
                    )
                  : null,
              );

              const liveInputAfterDirectWrite = findBetnacionalStakeInput();
              const liveNumericAfterDirectWrite = parseBetnacionalStake(
                liveInputAfterDirectWrite?.value ||
                  liveInputAfterDirectWrite?.textContent ||
                  "",
              );
              const directValueStillAccepted =
                Boolean(liveInputAfterDirectWrite?.isConnected) &&
                Number.isFinite(liveNumericAfterDirectWrite) &&
                Math.abs(targetStakeNumeric - liveNumericAfterDirectWrite) < 0.01;

              // O valor e o CTA são estados diferentes. A NSX pode aceitar e
              // exibir a stake imediatamente, mas levar mais tempo para
              // habilitar "Apostar". Nesse caso não apagamos nem digitamos de
              // novo: a digitação nativa só é permitida se o valor realmente
              // desapareceu ou voltou diferente após o setter direto.
              if (
                !stakePrepared &&
                !directValueStillAccepted &&
                typeof window.requestTrustedStakeText === "function"
              ) {
                const liveInput = findBetnacionalStakeInput();
                const nativeTyped = liveInput
                  ? await window.requestTrustedStakeText(
                      liveInput,
                      cleanStakeVal,
                    )
                  : false;
                stakePrepared = Boolean(
                  nativeTyped
                    ? await waitForStableBetnacionalStake(
                        targetStakeNumeric,
                        fastDispatch ? 1800 : 2400,
                        true,
                      )
                    : null,
                );
              }

              if (!stakePrepared && directValueStillAccepted) {
                console.warn(
                  "[Betnacional Adapter] Stake aceita, mas CTA ainda não ficou pronto; valor preservado sem redigitação.",
                );
              }

              // A máscara da casa pode consolidar o estado no blur.
              if (stakePrepared) {
                const acceptedInput = findBetnacionalStakeInput();
                try {
                  acceptedInput?.dispatchEvent(
                    new Event("change", { bubbles: true, composed: true }),
                  );
                  acceptedInput?.blur();
                } catch (error) {}
              }
            }
          }

          console.debug("[Betnacional Timing] Stake preparada", {
            success: stakePrepared,
            elapsedMs: Math.round(performance.now() - flowStartedAt),
            liveStake: findBetnacionalStakeInput()?.value || "",
          });
          betnacionalFlowTrace("stake", {
            pronta: stakePrepared,
            valor: findBetnacionalStakeInput()?.value || "vazio",
          });
          if (window.FastTriggerExecutionReport) {
            const activeActionId = window.FastTriggerState?.activeExecutionActionId;
            if (activeActionId) {
              window.FastTriggerExecutionReport.mark(
                activeActionId,
                "stake",
                {
                  reasonCode: stakePrepared ? "stake_ready" : "stake_not_ready",
                },
              );
            }
          }
        }

        // 3. A origem do comando (atalho ou bind) não autoriza confirmação.
        // Somente um disparo manual explícito ou a flag One-Shot ativa podem
        // clicar no botão final da Betnacional.
        // Comandos autorizados pelo Electron são sempre ações completas. Não
        // dependa do oneShot/storage local da extensão para decidir o commit.
        let isAutoSubmit =
          isManualTrigger ||
          hasBetnacionalElectronAuthorization() ||
          Boolean(window.FastTriggerState?.activeExecutionActionId);
        betnacionalFlowTrace("decisão", {
          autoSubmit: isAutoSubmit,
          electron: hasBetnacionalElectronAuthorization(),
          actionId: window.FastTriggerState?.activeExecutionActionId || "-",
        });

        if (!isAutoSubmit) {
          // Usa a mesma fonte de verdade do motor compartilhado. A opção
          // legada `fastTriggerAuto` também é reconhecida por
          // isOneShotActive(), mas ficava de fora desta lista e fazia o bind
          // preparar o cupom sem entregar o clique final.
          if (typeof isOneShotActive === "function") {
            try {
              isAutoSubmit = Boolean(await isOneShotActive());
            } catch (error) {}
          }

          const cfg = window.FastTriggerConfig || {};
          if (
            cfg.oneClick ||
            cfg.oneShot ||
            cfg.autoTriggerDirectBool ||
            cfg.autoTrigger ||
            cfg.autoTriggerDirect ||
            cfg.autoPlaceBet
          ) {
            isAutoSubmit = true;
          }
        }

        // O bind está apenas preparando seleção e stake. O clique final fica
        // para o motor compartilhado, que libera a próxima casa assim que
        // entrega o clique no botão Apostar.
        if (window.FastTriggerState?.deferDynamicBindSubmit === true) {
          betnacionalFlowTrace("preparado", "aguardando commit Electron");
          if (!stakePrepared) {
            console.warn(
              "[Betnacional Adapter] Preparação cancelada: stake não ficou pronta.",
              {
                configuredStake: stakeVal,
                liveStake: findBetnacionalStakeInput()?.value || "",
              },
            );
            return false;
          }
          return true;
        }

        if (isAutoSubmit && !stakePrepared) {
          betnacionalFlowTrace("bloqueado", "stake não validada");
          console.warn(
            "[Betnacional Adapter] Confirmação cancelada: stake não validada.",
          );
          return false;
        }

        if (
          !isAutoSubmit &&
          typeof chrome !== "undefined" &&
          chrome.storage &&
          chrome.storage.local
        ) {
          const res = window.gbrUserScopedStorage
            ? await window.gbrUserScopedStorage.get("local", [
                "autoTriggerDirectBool",
                "oneShot",
                "autoTrigger",
                "autoTriggerDirect",
                "oneClick",
                "autoPlaceBet",
              ])
            : {};
          isAutoSubmit = Boolean(
            res?.autoTriggerDirectBool ||
            res?.oneShot ||
            res?.autoTrigger ||
            res?.autoTriggerDirect ||
            res?.oneClick ||
            res?.autoPlaceBet,
          );
        }

        // 4. Se o modo One-Shot estiver ativado, aguarda o botão final habilitar
        // e dispara a aposta com o mesmo clique confiável usado pela Bet365.
        if (isAutoSubmit) {
          betnacionalFlowTrace("commit", "buscando CTA Apostar");
          if (typeof window.resolveOddsChangeBeforeCommit === "function") {
            const oddsChangeResult = await window.resolveOddsChangeBeforeCommit(fastDispatch);
            if (oddsChangeResult?.status === "blocked") return false;
          }

          let apostarBtn = null;

          const collectBetnacionalBetslipRoots = () => {
            const roots = [];
            const seenRoots = new Set();
            const rootSelectors = [
              '[data-testid="betslip-container"]',
              '[class*="Betslip"]',
              '[class*="betslip"]',
            ];
            for (const selector of rootSelectors) {
              for (const root of Array.from(document.querySelectorAll(selector))) {
                if (
                  root &&
                  root.offsetWidth > 0 &&
                  root.offsetHeight > 0 &&
                  !seenRoots.has(root)
                ) {
                  seenRoots.add(root);
                  roots.push(root);
                }
              }
            }
            return roots;
          };

          let betslipRoots = collectBetnacionalBetslipRoots();
          // Nunca usa a página inteira como escopo de confirmação: isso pode
          // confundir outro botão "Apostar" ou uma ação de perfil. Se o cupom
          // não tiver um container reconhecível, aborta com segurança.
          if (betslipRoots.length === 0) {
            const stakeInput = findBetnacionalStakeInput();
            const inferredRoot = stakeInput?.closest(
              '[data-testid="betslip-container"], [class*="Betslip"], [class*="betslip"], form, [class*="Drawer"], [class*="Panel"]',
            );
            if (inferredRoot && isBetnacionalBetslipElement(inferredRoot)) {
              betslipRoots.push(inferredRoot);
            } else {
              console.warn(
                "[Betnacional Adapter] Cupom não identificado; confirmação abortada por segurança.",
              );
              return false;
            }
          }

          const normalizeActionText = (value) =>
            (value || "")
              .toString()
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "")
              .toLowerCase()
              .replace(/\s+/g, " ")
              .trim();

          // Cache de curta duração: a Betnacional remonta o cupom ao validar
          // a stake, portanto a referência só é reutilizada enquanto o nó
          // permanecer conectado, visível e habilitado.
          let cachedApostarBtn = null;
          const isUsableApostarButton = (btn) =>
            Boolean(
              btn &&
                btn.isConnected &&
                btn.offsetWidth > 0 &&
                btn.offsetHeight > 0 &&
                !btn.disabled &&
                !btn.hasAttribute("disabled") &&
                btn.getAttribute("aria-disabled") !== "true" &&
                !btn.classList.contains("disabled") &&
                !btn.classList.contains("Mui-disabled"),
            );

          const findApostarButton = () => {
            // Caminho quente: o CTA oficial possui data-testid estável e evita
            // varrer todos os nós do cupom a cada iteração do waiter.
            if (isUsableApostarButton(cachedApostarBtn)) {
              return cachedApostarBtn;
            }
            const candidates = [];
            const seenCandidates = new Set();
            // A atualização da stake pode remontar todo o cupom. Recoleta os
            // roots a cada tentativa para nunca continuar preso a uma árvore
            // React que já foi substituída.
            const liveRoots = collectBetnacionalBetslipRoots();
            const roots = liveRoots.length
              ? liveRoots
              : betslipRoots.filter((root) => root?.isConnected);
            betslipRoots = roots;
            for (const root of roots) {
              const primary = root.querySelector('[data-testid="betslip-submit"]');
              if (isUsableApostarButton(primary)) {
                cachedApostarBtn = primary;
                return primary;
              }
              for (const btn of Array.from(
                root.querySelectorAll(
                  'button, [role="button"], input[type="submit"], a, div._cur-pointer',
                ),
              )) {
                if (seenCandidates.has(btn)) continue;
                seenCandidates.add(btn);
                if (
                  !isUsableApostarButton(btn)
                ) {
                  continue;
                }

                const label = normalizeActionText(
                  [
                    btn.innerText,
                    btn.textContent,
                    btn.getAttribute("aria-label"),
                    btn.getAttribute("title"),
                    btn.getAttribute("data-testid"),
                  ]
                    .filter(Boolean)
                    .join(" "),
                );
                const testId = btn.getAttribute("data-testid") || "";
                if (
                  !/\b(apostar|fazer aposta|finalizar aposta|colocar aposta|enviar aposta|confirmar aposta|confirmar|place bet)\b/.test(
                    label,
                  )
                ) {
                  continue;
                }

                let score = btn.tagName === "BUTTON" ? 20 : 0;
                if (testId === "betslip-submit") score += 60;
                if (label.includes("finalizar aposta")) score += 40;
                if (label.includes("apostar")) score += 30;
                if (label.includes("confirmar")) score += 25;
                if (label.includes("place bet")) score += 25;
                candidates.push({ btn, score });
              }
            }

            candidates.sort((left, right) => right.score - left.score);
            cachedApostarBtn = candidates[0]?.btn || null;
            return cachedApostarBtn;
          };

          const domWaiter = window.FastTriggerDom?.waitFor;
          if (typeof domWaiter === "function") {
            apostarBtn = await domWaiter(findApostarButton, {
              timeoutMs: fastDispatch ? 650 : 1200,
              intervalMs: 8,
            });
          } else {
            for (let retry = 0; retry < (fastDispatch ? 24 : 16); retry++) {
              apostarBtn = findApostarButton();
              if (apostarBtn) break;
              await new Promise((r) => setTimeout(r, fastDispatch ? 15 : 60));
            }
          }

          if (apostarBtn) {
            betnacionalFlowTrace("CTA", {
              texto: String(apostarBtn.innerText || apostarBtn.textContent || "").trim(),
              testId: apostarBtn.getAttribute("data-testid") || "-",
            });
            // A NSX pode pintar o CTA habilitado um frame antes de conectar o
            // handler React. Aguarde uma janela curta de estabilidade e
            // recapture o nó após o possível rerender, evitando que o clique
            // nativo chegue cedo demais ao botão ainda não interativo.
            const initialCommitButton = apostarBtn;
            await new Promise((resolve) => setTimeout(resolve, fastDispatch ? 110 : 160));
            const stabilizedCommitButton = findApostarButton();
            if (stabilizedCommitButton) apostarBtn = stabilizedCommitButton;
            else if (!initialCommitButton?.isConnected) {
              console.warn(
                "[Betnacional Adapter] CTA remountado durante a estabilização; confirmação abortada.",
              );
              return false;
            }

            // Barreira final: o CTA só pode receber o clique enquanto o input
            // atualmente conectado ainda contém a stake configurada.
            const finalStakeInput = await waitForStableBetnacionalStake(
              targetStakeNumeric,
              fastDispatch ? 700 : 1200,
              true,
            );
            if (!finalStakeInput) {
              betnacionalFlowTrace("bloqueado", "stake não consolidada para o CTA");
              console.warn(
                "[Betnacional Adapter] Clique final bloqueado: a stake ainda não foi consolidada.",
              );
              return false;
            }

            if (window.FastTriggerExecutionReport) {
              const activeActionId = window.FastTriggerState?.activeExecutionActionId;
              if (activeActionId) {
                window.FastTriggerExecutionReport.mark(activeActionId, "cta", {
                  reasonCode: "cta_ready",
                });
              }
            }

            // A validação/blur pode remontar o cupom. Reconsulta o botão para
            // nunca clicar numa referência anterior ao valor confirmado.
            apostarBtn = findApostarButton();
            if (!apostarBtn) {
              betnacionalFlowTrace("bloqueado", "CTA remountado/desabilitado");
              console.warn(
                "[Betnacional Adapter] Clique final bloqueado: o botão Apostar foi remontado ou desabilitado após a stake.",
              );
              return false;
            }

            console.log(
              "[Betnacional Adapter] 🚀 One-Shot ativo: entregando clique no botão final.",
              apostarBtn,
            );

            // Em uma janela sem foco, o Chrome pode confirmar o envio do clique
            // por coordenadas (CDP) sem que a Betnacional processe o botão. O
            // clique DOM é o caminho estável nesse fluxo e continua sendo feito
            // uma única vez, sem fallback posterior que possa duplicar aposta.
            if (!apostarBtn.isConnected) {
              return false;
            }

            const isBackgroundCommit =
              window.FastTriggerState?.backgroundDispatchInProgress === true;
            if (window.FastTriggerState) {
              window.FastTriggerState.lastDynamicBindFinalClickAttempted = true;
            }
            if (window.FastTriggerExecutionReport) {
              const activeActionId = window.FastTriggerState?.activeExecutionActionId;
              if (activeActionId) {
                window.FastTriggerExecutionReport.mark(activeActionId, "commit", {
                  reasonCode: "commit_sent",
                  clickAttempted: true,
                });
              }
            }

            if (isBackgroundCommit) {
              betnacionalFlowTrace("clique", "DOM direto no CTA validado");
              let clickDelivered = false;
              let clickReason = "";
              try {
                // A aba pode estar em segundo plano; use o transporte nativo
                // via CDP (mesmo caminho validado na Bet365), que entrega um
                // clique confiável ao renderer sem atingir o backdrop do cupom.
                // Betnacional usa coordenadas de viewport diferentes no modo
                // background; nunca envie o CTA financeiro por CDP aqui.
                if (false && typeof window.dispatchTrustedActionClick === "function") {
                  const nativeResult = await window.dispatchTrustedActionClick(
                    apostarBtn,
                    true,
                    ["apostar", "fazer aposta", "confirmar aposta"],
                    { financial: true, stage: "commit", fastResponse: true },
                  );
                  clickDelivered = nativeResult?.success === true;
                  clickReason = nativeResult?.reason || "";
                  console.debug("[Betnacional Commit TRACE] CDP result", {
                    success: clickDelivered,
                    trusted: nativeResult?.trusted === true,
                    reason: clickReason,
                    testId: apostarBtn?.getAttribute?.("data-testid") || "",
                    text: String(apostarBtn?.innerText || apostarBtn?.textContent || "").trim().slice(0, 80),
                    connected: apostarBtn?.isConnected === true,
                    disabled: apostarBtn?.disabled === true,
                    visibility: document.visibilityState,
                    frame: window !== window.top,
                  });
                  betnacionalFlowTrace("CDP", {
                    sucesso: clickDelivered,
                    trusted: nativeResult?.trusted === true,
                    motivo: clickReason || "-",
                  });
                  // O CDP confirma apenas a entrega do evento ao renderer;
                  // algumas versões do cupom Betnacional ignoram o evento de
                  // hardware quando o React acabou de remontar o CTA. Dê uma
                  // única oportunidade ao handler DOM sempre que o CTA ainda
                  // estiver conectado, visível e habilitado — inclusive quando
                  // o transporte nativo falhar sem retornar uma mensagem.
                  const clickedButton = apostarBtn;
                  await new Promise((resolve) => setTimeout(resolve, clickDelivered ? 140 : 0));
                  const stillReady =
                    clickedButton?.isConnected === true &&
                    !clickedButton.disabled &&
                    clickedButton.offsetWidth > 0 &&
                    clickedButton.offsetHeight > 0;
                  if (stillReady) {
                    const point = clickedButton.getBoundingClientRect();
                    const hit = document.elementFromPoint(
                      point.left + point.width / 2,
                      point.top + point.height / 2,
                    );
                    if (hit === clickedButton || clickedButton.contains(hit)) {
                      console.debug(
                        "[Betnacional Adapter] Fallback DOM único no CTA Apostar.",
                      );
                      clickedButton.click();
                      clickDelivered = true;
                      betnacionalFlowTrace("fallback DOM", "click() entregue ao CTA");
                    }
                  }
                } else {
                  apostarBtn.click();
                  clickDelivered = true;
                }
              } catch (clickError) {
                clickReason = clickError?.message || "background_dom_click_failed";
              }

              console.debug("[Betnacional Timing] Clique final", {
                success: clickDelivered,
                transport: "dom_element",
                elapsedMs: Math.round(performance.now() - flowStartedAt),
                reason: clickReason,
              });
              betnacionalFlowTrace("resultado clique", {
                entregue: clickDelivered,
                motivo: clickReason || "-",
              });
              if (!clickDelivered) {
                console.warn(
                  "[Betnacional Adapter] O clique DOM único no botão Apostar não foi entregue:",
                  clickReason || "erro desconhecido",
                );
              }
              return clickDelivered;
            }

            // Mesmo com foco, mantenha o mesmo caminho DOM da Betnacional;
            // CDP por coordenadas pode atingir a aba/viewport do cassino.
            let clickDelivered = false;
            let clickReason = "";
            try {
              apostarBtn.click();
              clickDelivered = true;
            } catch (clickError) {
              clickReason = clickError?.message || "dom_click_failed";
            }
            betnacionalFlowTrace("resultado clique", {
              entregue: clickDelivered,
              transport: "dom_element",
              motivo: clickReason || "-",
            });
            console.debug("[Betnacional Timing] Clique final", {
              success: clickDelivered,
              transport: "dom_element",
              elapsedMs: Math.round(performance.now() - flowStartedAt),
              reason: clickReason,
            });
            if (!clickDelivered) {
              console.warn(
                "[Betnacional Adapter] O clique nativo no botão Apostar não foi entregue:",
                clickReason || "erro desconhecido",
              );
            }
            return clickDelivered;
          }

          console.warn(
            "[Betnacional Adapter] One-Shot ativo, mas o botão final não ficou habilitado.",
          );
          betnacionalFlowTrace("bloqueado", "CTA Apostar não encontrado/habilitado");
          return false;
        }

        return true;
      } catch (err) {
        betnacionalFlowTrace("erro", err?.message || String(err));
        console.error("[Betnacional Adapter] Erro no disparo de aposta:", err);
        return false;
      }
    }
  }

  if (typeof window !== "undefined") {
    window.BetnacionalAdapter = BetnacionalAdapter;
    window.FastTriggerBetnacionalTesting = {
      ensureBetnacionalBetslipExpanded,
      findBetnacionalStakeInput,
      waitForStableBetnacionalStake,
      getBetnacionalBetslipWaitTimeout,
      getCertainlyCollapsedBetnacionalBetslipControl,
      observeBetnacionalBetslipAfterSelection,
    };
    window.selectOddsOnBetnacional = (
      targetName,
      targetOddVal,
      marketTitle,
      colIndex,
      rowIndex,
      isHotkey,
      lineName,
      fastMode,
      targetElement,
    ) => {
      const adapter = window.FastTriggerAdapter || new BetnacionalAdapter();
      return adapter.selectOddsOnBetnacional(
        targetName,
        targetOddVal,
        marketTitle,
        colIndex,
        rowIndex,
        isHotkey,
        lineName,
        fastMode,
        targetElement,
      );
    };
  }
})();
