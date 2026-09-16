// =========================================================================
// GATILHOBR - ADAPTER SUPERBET BRASIL (SPORTSBOOK ULTRA HIGH-PERFORMANCE)
// Suporte nativo a superbet.bet.br e superbet.com
// Arquitetura não-bloqueante: O(1) outcome lookup, zero layout thrashing
// Agrupamento tabular inteligente e estruturado por mercado individual
// =========================================================================

(function () {
  "use strict";

  // Seletores SDS e e2e da Superbet
  const OUTCOME_SELECTOR =
    'button.odd-button, button[class*="odd-button"], [class*="e2e-market-layout-odd-button"], [class*="e2e-market-odd"], [class*="market-layout-card__odd"], [class*="e2e-market-layout-selection"], [class*="odd-container"], [data-testid*="odd" i], [data-testid*="outcome" i], [class*="odd__value" i], [class*="odd-value" i], button[class*="odd" i], div[role="button"][class*="odd" i], button.actionable';

  const MARKET_CONTAINER_SELECTOR =
    '.single-market-card, .market-layout-card, .event-grid__expanded-market, .e2e-expanded-market, .e2e-market, [class*="single-market-card"], [class*="market-layout-card"], [class*="market-card"], [class*="e2e-market"], [class*="three-column-over-market"], [data-testid*="market"]';

  const BETSLIP_ROOT_SELECTOR =
    '#betslip, aside.sds-betslip-desktop, .sds-betslip-body, [class*="sds-betslip" i], [class*="desktop-betslip" i], [class*="e2e-betslip" i], [data-testid*="betslip" i], [data-testid*="ticket" i], aside[class*="ticket" i], aside[class*="betslip" i], [class*="ticket" i], [class*="betslip" i], #betslip-container, #ticket-container, aside, section[class*="betslip" i]';

  const BETSLIP_STAKE_SELECTOR =
    'input#stake-0, input#stake-1, input[id^="stake-"], input[name="stake"], input.sds-base-input__input, input.e2e-sds-base-input__field, [data-testid="e2e-stake-input"], [class*="sds-base-input"] input, [class*="e2e-stake-input"] input, input[class*="e2e-stake-input"], [class*="stake-input"] input, input[class*="stake-input"], [class*="e2e-stake-picker"] input, input[data-testid*="stake" i], input[data-testid*="amount" i], input[data-testid*="ticket-stake" i], [class*="ticket" i] input[inputmode="decimal"], [class*="ticket" i] input[type="text"], [class*="ticket" i] input[inputmode="numeric"], [class*="betslip" i] input[type="text"], [class*="betslip" i] input[inputmode="decimal"], [class*="betslip" i] input[inputmode="numeric"], input[placeholder*="0,00"], input[placeholder*="0.00"], input[placeholder*="stake" i], input[placeholder*="valor" i], input[placeholder*="quantia" i]';

  const BETSLIP_SUBMIT_SELECTOR =
    'button.e2e-betslip-submit, button.sds-bet-slip-submit, button[class*="betslip-submit"], button[class*="bet-slip-submit"], [class*="e2e-betslip-submit"] button, button[data-testid*="place-bet" i], button[data-testid*="ticket-submit" i], button[data-testid*="bet-button" i], button[class*="ticket-submit" i], button[class*="place-bet" i], button[class*="btn-bet" i], button[class*="bet-btn" i], [class*="ticket"] button[type="submit"], [class*="betslip"] button[type="submit"]';

  function cleanText(value) {
    return (value || "")
      .toString()
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeText(value) {
    return cleanText(value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "")
      .trim();
  }

  function formatOddValue(oddStr) {
    const clean = String(oddStr || "").trim().replace(",", ".");
    const num = Number(clean);
    if (!Number.isFinite(num) || num < 1.001) return "";
    if (clean.includes(".")) {
      const parts = clean.split(".");
      if (parts[1].length === 1) return num.toFixed(2);
      return clean;
    }
    return num.toFixed(2);
  }

  function isVisible(el) {
    if (!el || el.isConnected === false) return false;
    if (el.hidden || el.getAttribute?.("aria-hidden") === "true") return false;
    if (el.style?.display === "none" || el.style?.visibility === "hidden") return false;
    if (typeof el.offsetWidth === "number" && typeof el.offsetHeight === "number") {
      if (el.offsetWidth === 0 && el.offsetHeight === 0) {
        const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
        if (rect && rect.width <= 0 && rect.height <= 0) return false;
        const style =
          typeof window !== "undefined" && window.getComputedStyle
            ? window.getComputedStyle(el)
            : null;
        if (style && (style.display === "none" || style.visibility === "hidden")) return false;
      }
    }
    return true;
  }

  function isPlaceBetText(text) {
    if (!text) return false;
    const clean = cleanText(text).toLowerCase();
    const norm = normalizeText(text);
    return (
      norm.startsWith("apostar") ||
      norm === "apostar" ||
      norm.includes("fazeraposta") ||
      norm.includes("colocaraposta") ||
      norm.includes("confirmaraposta") ||
      norm.includes("placebet") ||
      norm.includes("aposteja") ||
      clean.includes("apostar") ||
      clean.includes("fazer aposta") ||
      clean.includes("colocar aposta") ||
      clean.includes("confirmar aposta") ||
      clean.includes("place bet") ||
      clean.includes("aposte já") ||
      clean.includes("aposte ja")
    );
  }

  function isButtonEnabled(el) {
    if (!el || !isVisible(el)) return false;
    if (el.disabled || el.hasAttribute?.("disabled")) return false;
    if (el.getAttribute?.("aria-disabled") === "true") return false;

    if (el.classList) {
      if (
        el.classList.contains("disabled") ||
        el.classList.contains("is-disabled") ||
        el.classList.contains("btn--disabled") ||
        el.classList.contains("is-loading") ||
        el.classList.contains("opacity-50") ||
        el.classList.contains("pointer-events-none") ||
        el.classList.contains("empty-odd")
      ) {
        return false;
      }
    } else {
      const cls = (el.className || "").toString();
      const tokens = cls.split(/\s+/);
      if (
        tokens.some(
          (t) =>
            t === "disabled" ||
            t === "is-disabled" ||
            t === "opacity-50" ||
            t === "empty-odd"
        )
      ) {
        return false;
      }
    }
    return true;
  }

  function isSubmitButtonEligible(btn) {
    if (!btn || !isVisible(btn)) return false;

    const text = cleanText(btn.textContent || "");
    const aria = cleanText(btn.getAttribute?.("aria-label") || "");
    const title = cleanText(btn.getAttribute?.("title") || "");
    const dataTestid = cleanText(btn.getAttribute?.("data-testid") || "");
    const cls = (btn.className || "").toString();

    // 1. Rótulo direto de aposta
    if (isPlaceBetText(text) || isPlaceBetText(aria) || isPlaceBetText(title)) {
      return true;
    }

    // 2. data-testid ou classe explícita de confirmação de aposta da Superbet
    if (
      /place-bet|ticket-submit|bet-button|submit-bet|btn-bet|e2e-betslip-submit|sds-bet-slip-submit/i.test(
        `${dataTestid} ${cls}`
      ) &&
      !/setting|configura|lixeira|trash|clear|fechar|close/i.test(`${text} ${aria} ${dataTestid}`)
    ) {
      return true;
    }

    // 3. Rejeição de botões secundários
    const IGNORED =
      /setting|configura|definiç|preferên|salvar|save|compartilhar|share|limpar|clear|remover|remove|excluir|trash|lixeira|fechar|close|deposit|login|entrar|cassino|casino|perfil|campo|estat[íi]sticas|expandir|fixar|ajuda|help|regras|rules|\+10|\+50|\+100|\+200/i;

    const testInfo = `${text} ${aria} ${title} ${dataTestid} ${cls}`;
    if (IGNORED.test(testInfo)) {
      return false;
    }

    // 4. Fallback mais amplo
    if (/aposta|apostar|confirmar|place\s+bet/i.test(testInfo)) {
      return true;
    }

    return false;
  }

  function waitFor(predicate, timeoutMs = 1500, stepMs = 30) {
    return new Promise((resolve) => {
      const started = Date.now();
      const tick = () => {
        let value = null;
        try {
          value = predicate();
        } catch (_) {}
        if (value) return resolve(value);
        if (Date.now() - started >= timeoutMs) return resolve(null);
        setTimeout(tick, stepMs);
      };
      tick();
    });
  }

  function showSuperbetStatusToast(msg, isError = false) {
    if (typeof document === "undefined") return;
    try {
      let el = document.getElementById("gbr-superbet-toast");
      if (!el) {
        el = document.createElement("div");
        el.id = "gbr-superbet-toast";
        el.style.cssText =
          "position: fixed; top: 14px; left: 50%; transform: translateX(-50%); z-index: 2147483647; padding: 8px 18px; border-radius: 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 13px; font-weight: 600; color: #fff; background: rgba(15, 23, 42, 0.95); box-shadow: 0 4px 14px rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.15); pointer-events: none; transition: opacity 0.3s ease, transform 0.3s ease; text-align: center;";
        document.body.appendChild(el);
      }
      el.style.borderColor = isError ? "#ef4444" : "#22c55e";
      el.style.boxShadow = isError
        ? "0 4px 14px rgba(239,68,68,0.5)"
        : "0 4px 14px rgba(34,197,94,0.5)";
      el.textContent = `⚡ GatilhoBR: ${msg}`;
      el.style.opacity = "1";
      el.style.transform = "translateX(-50%) translateY(0)";
      clearTimeout(window.__gbrToastTimer);
      window.__gbrToastTimer = setTimeout(() => {
        if (el) {
          el.style.opacity = "0";
          el.style.transform = "translateX(-50%) translateY(-10px)";
        }
      }, 4500);
    } catch (_) {}
  }

  function clickElement(el) {
    if (!el) return false;
    const target =
      el.tagName === "BUTTON" || el.getAttribute?.("role") === "button"
        ? el
        : el.closest?.("button, [role='button']") || el.querySelector?.("button, [role='button']") || el;

    try { target.scrollIntoView?.({ block: "nearest", inline: "nearest" }); } catch (_) {}

    const rect = target.getBoundingClientRect
      ? target.getBoundingClientRect()
      : { left: 0, top: 0, width: 0, height: 0 };
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + rect.height / 2;

    const commonInit = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: typeof window !== "undefined" ? window : null,
      clientX: clientX,
      clientY: clientY,
      button: 0,
      pointerId: 1,
      isPrimary: true,
    };
    const eventInitDown = { ...commonInit, buttons: 1 };
    const eventInitUp = { ...commonInit, buttons: 0 };

    const child = target.querySelector?.('span, [class*="value" i], [class*="name" i], [class*="odd" i]') || target;

    try { target.dispatchEvent(new PointerEvent("pointerdown", eventInitDown)); } catch (_) {}
    try { target.dispatchEvent(new MouseEvent("mousedown", eventInitDown)); } catch (_) {}
    if (child !== target) {
      try { child.dispatchEvent(new PointerEvent("pointerdown", eventInitDown)); } catch (_) {}
      try { child.dispatchEvent(new MouseEvent("mousedown", eventInitDown)); } catch (_) {}
    }
    try { target.focus?.(); } catch (_) {}
    try { target.dispatchEvent(new PointerEvent("pointerup", eventInitUp)); } catch (_) {}
    try { target.dispatchEvent(new MouseEvent("mouseup", eventInitUp)); } catch (_) {}
    if (child !== target) {
      try { child.dispatchEvent(new PointerEvent("pointerup", eventInitUp)); } catch (_) {}
      try { child.dispatchEvent(new MouseEvent("mouseup", eventInitUp)); } catch (_) {}
    }
    try { target.dispatchEvent(new MouseEvent("click", eventInitUp)); } catch (_) {}
    if (child !== target) {
      try { child.dispatchEvent(new MouseEvent("click", eventInitUp)); } catch (_) {}
    }
    try { target.click?.(); } catch (_) {}
    if (child !== target) {
      try { child.click?.(); } catch (_) {}
    }
    return true;
  }

  function elementContains(parent, child) {
    if (!parent || !child) return false;
    if (typeof parent.contains === "function") {
      try { return parent.contains(child); } catch (_) {}
    }
    let cur = child.parentElement;
    while (cur) {
      if (cur === parent) return true;
      cur = cur.parentElement;
    }
    return false;
  }

  function cleanMarketTitle(rawTitle) {
    if (!rawTitle) return "";
    const lines = rawTitle
      .split("\n")
      .map((l) => cleanText(l))
      .filter(Boolean);

    for (let line of lines) {
      let cleaned = line
        .replace(/(?:super\s*substitui[çc][ãa]o|super\s*placar|super\s*odds|criar\s*aposta|bet\s*builder|dicas\s*de\s*aposta)[\s:-]*$/i, "")
        .replace(/^(?:super\s*substitui[çc][ãa]o|super\s*placar|super\s*odds|criar\s*aposta|bet\s*builder|dicas\s*de\s*aposta)[\s:-]*/i, "")
        .replace(/[\s:-]*(?:super placar|super odds|criar aposta|bet builder|ao vivo|popular|populares|apostas populares|aposta popular|ca)$/i, "")
        .replace(/[\s\^v\+\-]+$/, "")
        .trim();

      if (!cleaned || cleaned.length < 2) continue;
      if (/^(super odds|super placar|super substitui[çc][ãa]o|criar aposta|ao vivo|populares|popular|apostas populares|aposta popular|dicas de aposta|todos|ca|i|\^|v)$/i.test(cleaned)) continue;
      if (/^[0-9]+(?:[.,][0-9]+)?$/.test(cleaned)) continue;
      if (/^[1X2]\s*[0-9]+(?:[.,][0-9]+)?$/i.test(cleaned)) continue;

      const m1x2 = cleaned.match(/[1X2]\s*\d+[.,]\d{2}(?:[X2]\s*\d+[.,]\d{2})/i);
      if (m1x2 && m1x2.index >= 3) {
        cleaned = cleaned.slice(0, m1x2.index).trim();
      }
      const mOverUnder = cleaned.match(
        /(?:Mais|Menos|Over|Under)\s*(?:de)?\s*\d+[.,]?\d*\s*\d+[.,]\d{2}/i
      );
      if (mOverUnder && mOverUnder.index >= 3) {
        cleaned = cleaned.slice(0, mOverUnder.index).trim();
      }

      if (!cleaned || cleaned.length < 2) continue;
      return cleaned;
    }
    return "";
  }

  function getElementTextFast(el) {
    if (!el) return "";
    return cleanText(el.textContent || el.innerText || "");
  }

  function extractSelectionInfo(button) {
    // 1. Extração via aria-label descritivo da Superbet:
    // Ex: "Resultado Final, Vasco da Gama vence a partida, coeficiente 1.14, active"
    // Ex: "Total de Gols, Mais de 1.5 gols na partida, coeficiente 1.25, active"
    const aria = button.getAttribute?.("aria-label") || "";
    if (aria) {
      const ariaMatch = aria.match(
        /^(?:.*?,\s*)?(.*?),\s*(?:coeficiente|odd|odds|cota[çc][ãa]o)\s*(\d+(?:[.,]\d+)?)/i
      );
      if (ariaMatch && Number(ariaMatch[2].replace(",", ".")) >= 1.001) {
        const fullDesc = cleanText(ariaMatch[1]);
        const oddVal = formatOddValue(ariaMatch[2]);
        const nameEl = button.querySelector?.(
          '[class*="e2e-odd-name" i], [class*="odd-button__odd-name" i], [class*="odd-name" i], [class*="odd__label" i], [class*="label" i], [class*="outcome-name" i], [class*="selection-name" i]'
        );
        const shortName = nameEl ? getElementTextFast(nameEl) : "";
        return {
          label: shortName || fullDesc,
          shortLabel: shortName || fullDesc,
          fullDesc: fullDesc,
          odd: oddVal,
        };
      }
      // Padrão alternativo: "Apostar em X com odd 1.90"
      const altMatch = aria.match(
        /^(?:Apostar?\s+em\s+|Aposta\s+em\s+)?(.+?)\s+(?:com\s+)?(?:odds?|cota[çc][ãa]o)?\s*(\d+(?:[.,]\d+)?)/i
      );
      if (altMatch && Number(altMatch[2].replace(",", ".")) >= 1.001) {
        return {
          label: cleanText(altMatch[1]),
          shortLabel: cleanText(altMatch[1]),
          fullDesc: cleanText(altMatch[1]),
          odd: formatOddValue(altMatch[2]),
        };
      }
    }

    // 2. Elementos internos estruturados (e2e da Superbet e seletores SDS)
    const labelEl = button.querySelector?.(
      '[class*="e2e-odd-name" i], [class*="odd-button__odd-name" i], [class*="odd__label" i], [class*="label" i], [class*="outcome-name" i], [class*="selection-name" i], [class*="name" i], [data-testid*="name" i]'
    );
    const priceEl = button.querySelector?.(
      '[class*="e2e-odd-value" i], [class*="odd-button__odd-value" i], [class*="odd__value" i], [class*="odd-value" i], [class*="price" i], [class*="value" i], [data-testid*="value" i]'
    );
    if (priceEl) {
      const oRaw = getElementTextFast(priceEl).replace(",", ".");
      if (/^\d{1,4}(?:\.\d{1,3})?$/.test(oRaw) && Number(oRaw) >= 1.001) {
        const l = labelEl && labelEl !== priceEl ? getElementTextFast(labelEl) : "";
        return {
          label: l,
          shortLabel: l,
          fullDesc: l,
          odd: formatOddValue(oRaw),
        };
      }
    }

    // 3. Fallback: texto completo com rótulo no início e cotação no final
    const fullText = getElementTextFast(button);
    const endMatch = fullText.match(/^(.*?)(?:[\s\n]+)([0-9]+(?:[.,][0-9]+)?)$/s);
    if (endMatch) {
      const oRaw = endMatch[2].replace(",", ".");
      const l = cleanText(endMatch[1]);
      if (l.length > 0 && /^\d{1,4}(?:\.\d{1,3})?$/.test(oRaw) && Number(oRaw) >= 1.001) {
        return {
          label: l,
          shortLabel: l,
          fullDesc: l,
          odd: formatOddValue(oRaw),
        };
      }
    }

    // 4. Se o botão contém apenas a cotação
    const pureOdd = fullText.replace(",", ".");
    if (/^\d{1,4}(?:\.\d{1,3})?$/.test(pureOdd) && Number(pureOdd) >= 1.001) {
      return {
        label: "",
        shortLabel: "",
        fullDesc: "",
        odd: formatOddValue(pureOdd),
      };
    }

    return { label: "", shortLabel: "", fullDesc: "", odd: "" };
  }

  // =========================================================================
  // CLASSE PRINCIPAL DO ADAPTADOR SUPERBET
  // =========================================================================

  class SuperbetAdapter {
    constructor() {
      this.siteName = "Superbet";
      this.domRevision = 0;
      this.lastScrapeResult = [];
      this.lastScrapeAt = 0;
      this.lastBetslipAt = 0;
      this.lastBetslipValue = "";
      this.outcomeElementsMap = new Map();
      this.outcomeCounter = 0;
    }

    static isMatchingSite(hostname) {
      const host = (hostname || "").toLowerCase().replace(/^www\./, "");
      return (
        host === "superbet.bet.br" ||
        host.endsWith(".superbet.bet.br") ||
        host === "superbet.com" ||
        host.endsWith(".superbet.com") ||
        host.includes("superbet")
      );
    }

    scanBetslip() {
      try {
        const now = Date.now();
        if (now - this.lastBetslipAt < 200 && this.lastBetslipValue) {
          return this.lastBetslipValue;
        }

        const betslip = document.querySelector(BETSLIP_ROOT_SELECTOR);
        if (!betslip) {
          this.lastBetslipAt = now;
          this.lastBetslipValue = "";
          return "";
        }

        const text = cleanText(betslip.textContent || "").slice(0, 300);
        const stakeInput = this.findStake(betslip);
        const stakeVal = stakeInput ? stakeInput.value : "";

        this.lastBetslipAt = now;
        this.lastBetslipValue = text || (stakeVal ? `Stake: ${stakeVal}` : "");
        return this.lastBetslipValue;
      } catch (_) {
        return "";
      }
    }

    scrapeClean(root = document) {
      try {
        const now = Date.now();
        if ((!root || root === document) && now - this.lastScrapeAt < 100 && this.lastScrapeResult.length > 0) {
          return this.lastScrapeResult;
        }

        const baseRoot = root || document;
        const results = [];

        // 1. Coleta de Cards de Mercado da Superbet
        // Seleciona os containers principais de mercado na página (excluindo elementos folha internos)
        let candidateCards = Array.from(
          baseRoot.querySelectorAll?.(
            '.single-market-card, .market-layout-card, .event-grid__expanded-market, [class*="single-market-card"]:not([class*="__"]), [class*="market-layout-card"]:not([class*="__"]), [class*="market-card"]:not([class*="__"])'
          ) || []
        ).filter(isVisible);

        // Se o próprio baseRoot for um card de mercado (ex: ambiente de teste)
        if (candidateCards.length === 0 && baseRoot !== document) {
          if (
            baseRoot.matches?.('.single-market-card, .market-layout-card, [class*="market-card"], [class*="market"]') ||
            baseRoot.querySelector?.('button, [class*="odd"]')
          ) {
            candidateCards.push(baseRoot);
          }
        }

        // Se ainda não encontrou cards por seletores diretos, agrupa a partir dos botões de odds reais
        if (candidateCards.length === 0) {
          const allOddsBtns = Array.from(
            baseRoot.querySelectorAll?.(OUTCOME_SELECTOR) || []
          ).filter(isVisible);

          const foundCardSet = new Set();
          for (const btn of allOddsBtns) {
            const card =
              btn.closest?.(
                '.single-market-card, .market-layout-card, [class*="single-market-card"], [class*="market-layout-card"], [class*="market-card"], [class*="market"], [data-testid*="market"]'
              ) || btn.parentElement?.parentElement;
            if (card && !foundCardSet.has(card)) {
              foundCardSet.add(card);
              candidateCards.push(card);
            }
          }
        }

        // Mantém apenas os containers pai de nível superior (evita duplicar cards aninhados)
        const topLevelCards = candidateCards.filter(
          (c) => !candidateCards.some((other) => other !== c && elementContains(other, c))
        );

        const marketItems = [];
        const seenCards = new Set();

        for (const card of topLevelCards) {
          if (seenCards.has(card)) continue;
          seenCards.add(card);

          // 1.1 Busca por elemento de cabeçalho explícito no card
          let rawTitle = "";
          const headerEl = card.querySelector?.(
            '.market-header-base__name, .e2e-market-name, .market-title, [class*="market-header-base__name"], [class*="market-title"], [class*="market-header"], [class*="header-title"], [class*="header__title"], [data-id*="market-header"], [data-testid*="market-title"], [data-testid*="market-header"], h2, h3, h4, h5'
          );
          if (headerEl) {
            rawTitle = headerEl.textContent || "";
          }

          let title = cleanMarketTitle(rawTitle);

          // 1.2 Se o cabeçalho não foi encontrado ou ficou genérico, busca a partir do aria-label dos botões de odd
          if (!title || /^(ca|todos|popular|populares|apostas populares|aposta popular|criar aposta|dicas de aposta)$/i.test(title)) {
            const oddBtns = Array.from(card.querySelectorAll?.('button, [role="button"]') || []).filter(isVisible);
            for (const b of oddBtns) {
              const aria = b.getAttribute?.("aria-label") || "";
              if (aria && aria.includes(",")) {
                const parts = aria.split(",");
                const cand = cleanMarketTitle(parts[0]);
                if (cand && cand.length >= 2 && !/^(super odds|super placar|criar aposta|ao vivo|populares|popular|apostas populares|aposta popular|dicas de aposta)$/i.test(cand)) {
                  title = cand;
                  break;
                }
              }
            }
          }

          // 1.3 Fallback adicional para texto inicial do card se ainda sem título
          if (!title) {
            const firstLine = cleanText((card.textContent || "").split("\n")[0]);
            const cand = cleanMarketTitle(firstLine);
            if (cand && cand.length >= 2) {
              title = cand;
            }
          }

          // Rejeita cards promocionais ou sem título
          if (!title || /^(super odds|super placar|criar aposta|ao vivo|populares|popular|apostas populares|aposta popular|dicas de aposta|ca|i|\^|v)$/i.test(title)) {
            continue;
          }

          marketItems.push({ title, card });
        }

        // 2. Extração Mercado por Mercado
        for (const { title: marketTitle, card } of marketItems) {
          // ===================================================================
          // CASO A: Mercado de Jogador Multi-colunas (.three-column-over-market)
          // Ex: Marcador de Gol, Chutes ao Gol com barra lateral de jogadores (.market-sidebar)
          // e colunas de totais (.market-columns)
          // ===================================================================
          const sidebar = card.querySelector?.('.market-sidebar, [class*="market-sidebar"]');
          const columnsContainer = card.querySelector?.('.market-columns, [class*="market-columns"]');

          if (sidebar && columnsContainer) {
            const playerEls = Array.from(
              sidebar.querySelectorAll?.('.player, [class*="player"]') || []
            ).filter(isVisible);

            const colContainers = Array.from(
              columnsContainer.querySelectorAll?.(
                '.column, [class*="market-columns__column"]'
              ) || []
            ).filter(
              (el) =>
                isVisible(el) &&
                !el.matches?.(
                  '[class*="total"], [class*="header"], [class*="title"], [class*="specifier"], button, [role="button"]'
                )
            );

            if (playerEls.length > 0 && colContainers.length > 0) {
              // Extrai títulos das colunas (ex: "0.5+", "1.5+", "2.5+")
              const colHeaders = colContainers.map((c, idx) => {
                const totalEl = c.querySelector?.('.column-total, [class*="column-total"], [class*="header"]');
                return totalEl ? cleanText(totalEl.textContent) : `Linha ${idx + 1}`;
              });

              // Para cada coluna, coleta todos os botões de odd (ordenados de cima para baixo)
              const colButtonsPerColumn = colContainers.map((c) => {
                const btns = Array.from(
                  c.querySelectorAll?.(
                    'button.odd-button, button[class*="odd-button"], [class*="e2e-market-layout-odd-button"], [class*="e2e-market-odd"], [class*="market-layout-card__odd"] button, [class*="odd-container"] button, button, [role="button"]'
                  ) || []
                ).filter(
                  (b) =>
                    isVisible(b) &&
                    !b.matches?.('[class*="total"], [class*="header"], [class*="specifier"]')
                );
                const realButtons = btns.filter(
                  (b) => b.tagName === "BUTTON" || b.getAttribute?.("role") === "button"
                );
                return realButtons.length > 0 ? realButtons : btns;
              });

              const tableRows = [];
              const headers = ["Jogador", ...colHeaders];

              // Constrói uma linha de tabela por jogador
              for (let pIdx = 0; pIdx < playerEls.length; pIdx++) {
                const pEl = playerEls[pIdx];
                const playerName = cleanText(pEl.textContent || "");
                if (!playerName) continue;

                const colOdds = [];

                for (let cIdx = 0; cIdx < colContainers.length; cIdx++) {
                  const btn = colButtonsPerColumn[cIdx]?.[pIdx];
                  if (!btn) continue;

                  const info = extractSelectionInfo(btn);
                  if (!info.odd || Number(info.odd) < 1.001) continue;

                  let outcomeId =
                    btn.getAttribute("data-gbr-outcome-id") ||
                    btn.getAttribute("data-outcome-id") ||
                    btn.getAttribute("data-id") ||
                    btn.getAttribute("id");
                  if (!outcomeId) {
                    outcomeId = `sb-${now}-${++this.outcomeCounter}`;
                  }
                  try { btn.setAttribute("data-gbr-outcome-id", outcomeId); } catch (_) {}
                  this.outcomeElementsMap.set(outcomeId, btn);

                  const colHeader = colHeaders[cIdx] || `Opção ${cIdx + 1}`;
                  const displayName = `${playerName} - ${colHeader}`;
                  const isClosed = !isButtonEnabled(btn);

                  const item = {
                    name: displayName,
                    rawName: displayName,
                    colHeader: colHeader,
                    lineName: playerName,
                    odds: info.odd,
                    val: info.odd,
                    isClosed: isClosed,
                    outcomeId: outcomeId,
                  };

                  Object.defineProperty(item, "element", {
                    value: btn,
                    enumerable: false,
                    configurable: true,
                  });

                  colOdds.push(item);
                }

                if (colOdds.length > 0) {
                  tableRows.push({
                    lineLabel: playerName,
                    colOdds: colOdds,
                    odds: colOdds,
                  });
                }
              }

              if (tableRows.length > 0) {
                const allParticipants = tableRows.flatMap((r) => r.colOdds);
                results.push({
                  title: marketTitle,
                  marketAliases: [marketTitle],
                  isTable: true,
                  isPlayerMarket: true,
                  hasLabelsCol: true,
                  headers: headers,
                  tableRows: tableRows,
                  rows: tableRows.map((r) => ({ label: r.lineLabel, odds: r.colOdds })),
                  participants: allParticipants,
                  selections: allParticipants,
                  isSuspended: allParticipants.every((p) => p.isClosed),
                });
                continue;
              }
            }
          }

          // ===================================================================
          // CASO B: Mercado Tabular por Linhas (Total de Gols, Escanteios, Handicap)
          // ===================================================================
          const allRowCandidates = Array.from(
            card.querySelectorAll?.(
              '.market-layout-card__row, .e2e-market-layout-selection-row, [class*="selection-row"]'
            ) || []
          ).filter(
            (el) =>
              isVisible(el) &&
              !el.matches?.(
                '[class*="specifier"], [class*="header"], [class*="odd"], [class*="title"], button, [role="button"]'
              )
          );

          // Filtra estritamente as linhas folha (rows que não contêm outras rows como filhos)
          const rowEls = allRowCandidates.filter(
            (row) => !allRowCandidates.some((other) => other !== row && elementContains(row, other))
          );

          if (rowEls.length > 0) {
            // Tenta detectar cabeçalhos de coluna no card (ex: "Mais", "Menos")
            const headerItemEls = Array.from(
              card.querySelectorAll?.(
                '.market-layout-card__header-item, [class*="header-item"], [class*="column-header"], [class*="col-header"]'
              ) || []
            ).filter(isVisible);
            const cardColHeaders = headerItemEls.map((el) => cleanText(el.textContent)).filter(Boolean);

            const tableRows = [];

            for (const row of rowEls) {
              const lineEl = row.querySelector?.(
                '.market-layout-card__row-specifier, .e2e-market-layout-selection, [class*="row-specifier"], [class*="specifier"], [class*="line"]'
              );
              const lineLabel = lineEl ? cleanText(lineEl.textContent) : "";

              const btns = Array.from(
                row.querySelectorAll?.(
                  'button.odd-button, button[class*="odd-button"], [class*="e2e-market-layout-odd-button"], [class*="e2e-market-odd"], [class*="market-layout-card__odd"] button, [class*="odd-container"] button, button, [role="button"]'
                ) || []
              ).filter(
                (b) =>
                  isVisible(b) &&
                  b !== row &&
                  !b.matches?.('[class*="specifier"], [class*="header"], [class*="collapse"]')
              );

              const realButtons = btns.filter(
                (b) => b.tagName === "BUTTON" || b.getAttribute?.("role") === "button"
              );
              const effectiveBtns = realButtons.length > 0 ? realButtons : btns;

              const colOdds = [];
              effectiveBtns.forEach((btn, colIdx) => {
                const info = extractSelectionInfo(btn);
                if (!info.odd || Number(info.odd) < 1.001) return;

                let outcomeId =
                  btn.getAttribute("data-gbr-outcome-id") ||
                  btn.getAttribute("data-outcome-id") ||
                  btn.getAttribute("data-id") ||
                  btn.getAttribute("id");
                if (!outcomeId) {
                  outcomeId = `sb-${now}-${++this.outcomeCounter}`;
                }
                try { btn.setAttribute("data-gbr-outcome-id", outcomeId); } catch (_) {}
                this.outcomeElementsMap.set(outcomeId, btn);

                // Determina o cabeçalho da coluna com precisão:
                // 1) Se aria-label contém "Mais de" ou "Menos de"
                // 2) Cabeçalhos detectados no card (cardColHeaders)
                // 3) Rótulo curto do botão (info.shortLabel)
                // 4) Posição clássica (colIdx === 0 -> Mais, colIdx === 1 -> Menos)
                let colHeader = "";
                const aria = btn.getAttribute?.("aria-label") || "";
                if (/\bmais\b/i.test(aria) || /\bover\b/i.test(aria)) {
                  colHeader = "Mais";
                } else if (/\bmenos\b/i.test(aria) || /\bunder\b/i.test(aria)) {
                  colHeader = "Menos";
                } else if (cardColHeaders[colIdx]) {
                  colHeader = cardColHeaders[colIdx];
                } else if (info.shortLabel && !/^\d+(?:\.\d+)?$/.test(info.shortLabel)) {
                  colHeader = info.shortLabel;
                } else if (effectiveBtns.length === 2) {
                  colHeader = colIdx === 0 ? "Mais" : "Menos";
                } else {
                  colHeader = `Opção ${colIdx + 1}`;
                }

                const displayName = lineLabel ? `${lineLabel} - ${colHeader}` : colHeader;
                const isClosed = !isButtonEnabled(btn);

                const item = {
                  name: displayName,
                  rawName: displayName,
                  colHeader: colHeader,
                  lineName: lineLabel,
                  odds: info.odd,
                  val: info.odd,
                  isClosed: isClosed,
                  outcomeId: outcomeId,
                };

                Object.defineProperty(item, "element", {
                  value: btn,
                  enumerable: false,
                  configurable: true,
                });

                colOdds.push(item);
              });

              if (colOdds.length > 0) {
                tableRows.push({
                  lineLabel: lineLabel,
                  colOdds: colOdds,
                  odds: colOdds,
                });
              }
            }

            if (tableRows.length > 0) {
              const allParticipants = tableRows.flatMap((r) => r.colOdds);
              const detectedHeaders = cardColHeaders.length > 0
                ? ["Linha", ...cardColHeaders]
                : ["Linha", "Mais", "Menos"];

              results.push({
                title: marketTitle,
                marketAliases: [marketTitle],
                isTable: true,
                isPlayerMarket: /marcador|jogador|player|chute|assist|finaliza/i.test(marketTitle),
                hasLabelsCol: true,
                headers: detectedHeaders,
                tableRows: tableRows,
                rows: tableRows.map((r) => ({ label: r.lineLabel, odds: r.colOdds })),
                participants: allParticipants,
                selections: allParticipants,
                isSuspended: allParticipants.every((p) => p.isClosed),
              });
              continue;
            }
          }

          // ===================================================================
          // CASO C: Mercado Não-Tabular (1X2 Resultado Final, Ambas Marcam, etc.)
          // ===================================================================
          const btns = Array.from(
            card.querySelectorAll?.(
              'button.odd-button, button[class*="odd-button"], [class*="e2e-market-layout-odd-button"], [class*="e2e-market-odd"], [class*="market-layout-card__odd"] button, [class*="odd-container"] button, button.actionable, button, [role="button"]'
            ) || []
          ).filter((b) => {
            if (!isVisible(b)) return false;
            if (
              b.closest?.(
                '[class*="header"], [class*="collapse"], [class*="favorite"], [class*="info"], [class*="carousel"], [class*="promo"], [class*="banner"], [class*="slider"]'
              )
            ) {
              return false;
            }
            return true;
          });

          const realButtons = btns.filter(
            (b) => b.tagName === "BUTTON" || b.getAttribute?.("role") === "button"
          );
          const effectiveBtns = realButtons.length > 0 ? realButtons : btns;

          const participants = [];
          for (let colIdx = 0; colIdx < effectiveBtns.length; colIdx++) {
            const btn = effectiveBtns[colIdx];
            const info = extractSelectionInfo(btn);
            if (!info.odd || Number(info.odd) < 1.001) continue;

            let outcomeId =
              btn.getAttribute("data-gbr-outcome-id") ||
              btn.getAttribute("data-outcome-id") ||
              btn.getAttribute("data-id") ||
              btn.getAttribute("id");
            if (!outcomeId) {
              outcomeId = `sb-${now}-${++this.outcomeCounter}`;
            }
            try { btn.setAttribute("data-gbr-outcome-id", outcomeId); } catch (_) {}
            this.outcomeElementsMap.set(outcomeId, btn);

            let colHeader = info.shortLabel;
            if (!colHeader) {
              if (effectiveBtns.length === 3) {
                colHeader = colIdx === 0 ? "1" : colIdx === 1 ? "X" : "2";
              } else {
                colHeader = info.label || `Opção ${colIdx + 1}`;
              }
            }

            const displayName = info.label || colHeader;
            const isClosed = !isButtonEnabled(btn);

            const item = {
              name: displayName,
              rawName: displayName,
              colHeader: colHeader,
              odds: info.odd,
              val: info.odd,
              isClosed: isClosed,
              outcomeId: outcomeId,
            };

            Object.defineProperty(item, "element", {
              value: btn,
              enumerable: false,
              configurable: true,
            });

            participants.push(item);
          }

          if (participants.length > 0) {
            results.push({
              title: marketTitle,
              marketAliases: [marketTitle],
              isTable: false,
              isPlayerMarket: /marcador|jogador|player|chute|assist|finaliza/i.test(marketTitle),
              hasLabelsCol: false,
              headers: participants.map((p) => p.colHeader || p.name),
              tableRows: [],
              rows: [],
              participants: participants,
              selections: participants,
              isSuspended: participants.every((p) => p.isClosed),
            });
          }
        }

        this.lastScrapeAt = now;
        this.lastScrapeResult = results;
        return results;
      } catch (e) {
        console.warn("[Superbet Adapter] Erro em scrapeClean:", e);
        return [];
      }
    }

    findOutcome(targetName, targetOdd, outcomeId = null, marketTitle = null) {
      if (typeof document === "undefined") return null;

      const applyHighlight = (el) => {
        if (!el) return el;
        try {
          el.style.transition = "all 0.2s ease";
          el.style.outline = "3px solid #22c55e";
          el.style.boxShadow = "0 0 15px rgba(34, 197, 94, 0.8)";
          setTimeout(() => {
            try {
              el.style.outline = "";
              el.style.boxShadow = "";
            } catch (_) {}
          }, 3500);
        } catch (_) {}
        return el;
      };

      // 1. Busca direta por data-gbr-outcome-id ou Map em memória O(1)
      if (outcomeId) {
        const idStr = String(outcomeId).trim();
        const fromMap = this.outcomeElementsMap.get(idStr);
        if (fromMap && isVisible(fromMap) && fromMap.isConnected !== false) {
          return applyHighlight(fromMap);
        }

        const direct = document.querySelector(`[data-gbr-outcome-id="${idStr}"]`);
        if (direct && isVisible(direct) && direct.isConnected !== false) {
          return applyHighlight(direct);
        }
      }

      // 2. Busca com escopo do mercado se fornecido
      let searchRoot = document;
      if (marketTitle) {
        const normTitle = normalizeText(marketTitle);
        // Gera variações sem ordinal (ex: 2gol -> 2, gol)
        const baseTitle = normTitle.replace(/(\d+)[og]/, "$1");
        const headers = Array.from(
          document.querySelectorAll(
            '.market-header-base__name, .e2e-market-name, [class*="market-header"], [class*="header"], h2, h3, h4'
          )
        );
        for (const h of headers) {
          const hNorm = normalizeText(h.textContent);
          if (
            hNorm.includes(normTitle) ||
            normTitle.includes(hNorm) ||
            (baseTitle && hNorm.includes(baseTitle))
          ) {
            const c =
              h.closest(
                '.single-market-card, .market-layout-card, [class*="single-market-card"], [class*="market-layout-card"], [class*="market-card"], [class*="market-layout"]'
              ) || h.parentElement?.parentElement;
            if (c) {
              const testBtns = c.querySelectorAll('button, [role="button"], [class*="odd"]');
              if (testBtns.length > 0) {
                searchRoot = c;
                break;
              }
            }
          }
        }
      }

      // 3. Busca pelas seleções ativas no escopo (ou no documento se escopo vazio)
      let buttons = Array.from(
        searchRoot.querySelectorAll(
          'button.odd-button, button[class*="odd-button"], [class*="e2e-market-layout-odd-button"], [class*="e2e-market-odd"], [class*="market-layout-card__odd"], button.actionable, button[class*="odd" i], div[role="button"][class*="odd" i], button, [role="button"]'
        )
      ).filter((b) => isVisible(b) && b.isConnected !== false);

      if (buttons.length === 0 && searchRoot !== document) {
        buttons = Array.from(
          document.querySelectorAll(
            'button.odd-button, button[class*="odd-button"], [class*="e2e-market-layout-odd-button"], [class*="e2e-market-odd"], [class*="market-layout-card__odd"], button.actionable, button[class*="odd" i], div[role="button"][class*="odd" i], button, [role="button"]'
          )
        ).filter((b) => isVisible(b) && b.isConnected !== false);
      }

      const normTarget = normalizeText(targetName);
      const cleanOdd = formatOddValue(targetOdd);

      // Prioridade 3.1: Match exato de nome + odd
      for (const btn of buttons) {
        const info = extractSelectionInfo(btn);
        if (cleanOdd && info.odd && formatOddValue(info.odd) !== cleanOdd) continue;
        const normLabel = normalizeText(info.label);
        const normShort = normalizeText(info.shortLabel);
        const normFull = normalizeText(info.fullDesc);
        if (
          (normTarget && normLabel === normTarget) ||
          (normTarget && normShort === normTarget) ||
          (normTarget && normFull === normTarget)
        ) {
          return applyHighlight(btn);
        }
        // Equivalência 1X2
        if (
          (normTarget === "1" || normTarget === "casa") && (normShort === "1" || normLabel === "1") ||
          (normTarget === "x" || normTarget === "empate") && (normShort === "x" || normLabel === "x") ||
          (normTarget === "2" || normTarget === "fora") && (normShort === "2" || normLabel === "2")
        ) {
          return applyHighlight(btn);
        }
      }

      // Prioridade 3.2: Match por nome exato mesmo se a odd tiver variado ligeiramente ao vivo
      if (normTarget) {
        for (const btn of buttons) {
          const info = extractSelectionInfo(btn);
          const normLabel = normalizeText(info.label);
          const normShort = normalizeText(info.shortLabel);
          const normFull = normalizeText(info.fullDesc);
          if (
            (normTarget && normLabel === normTarget) ||
            (normTarget && normShort === normTarget) ||
            (normTarget && normFull === normTarget)
          ) {
            return applyHighlight(btn);
          }
          if (
            (normTarget === "1" || normTarget === "casa") && (normShort === "1" || normLabel === "1") ||
            (normTarget === "x" || normTarget === "empate") && (normShort === "x" || normLabel === "x") ||
            (normTarget === "2" || normTarget === "fora") && (normShort === "2" || normLabel === "2")
          ) {
            return applyHighlight(btn);
          }
        }
      }

      // Prioridade 3.3: Match parcial de nome + odd
      if (normTarget) {
        for (const btn of buttons) {
          const info = extractSelectionInfo(btn);
          if (cleanOdd && info.odd && formatOddValue(info.odd) !== cleanOdd) continue;
          const normLabel = normalizeText(info.label);
          const normFull = normalizeText(info.fullDesc);
          if (
            (normLabel && (normLabel.includes(normTarget) || normTarget.includes(normLabel))) ||
            (normFull && (normFull.includes(normTarget) || normTarget.includes(normFull)))
          ) {
            return applyHighlight(btn);
          }
        }
      }

      // Prioridade 3.4: Match parcial de nome geral
      if (normTarget) {
        for (const btn of buttons) {
          const info = extractSelectionInfo(btn);
          const normLabel = normalizeText(info.label);
          const normFull = normalizeText(info.fullDesc);
          if (
            (normLabel && (normLabel.includes(normTarget) || normTarget.includes(normLabel))) ||
            (normFull && (normFull.includes(normTarget) || normTarget.includes(normFull)))
          ) {
            return applyHighlight(btn);
          }
        }
      }

      // Prioridade 3.5: Match apenas por odd se nome não encontrou
      if (cleanOdd) {
        for (const btn of buttons) {
          const info = extractSelectionInfo(btn);
          if (formatOddValue(info.odd) === cleanOdd) {
            return applyHighlight(btn);
          }
        }
      }

      return null;
    }

    findStake(root = null) {
      if (typeof document === "undefined") return null;

      const directSelectors = [
        "input#stake-1",
        "input.sds-base-input__input",
        "input.e2e-sds-base-input__field",
        '[class*="sds-base-input"] input',
        '[class*="e2e-stake-input"] input',
        'input[class*="e2e-stake-input"]',
        '[class*="stake-input"] input',
        'input[class*="stake-input"]',
        '[class*="e2e-stake-picker"] input',
        'input[data-testid*="stake" i]',
        'input[data-testid*="ticket-stake" i]',
        'input[data-testid*="amount" i]',
        'input[data-testid*="input" i]',
        'aside input[inputmode="decimal"]',
        'aside input[type="text"]',
        'aside input[type="number"]',
        '[class*="sds-betslip"] input[inputmode="decimal"]',
        '[class*="sds-betslip"] input[type="text"]',
        '[class*="desktop-betslip"] input[inputmode="decimal"]',
        '[class*="desktop-betslip"] input[type="text"]',
        '[class*="ticket" i] input[inputmode="decimal"]',
        '[class*="ticket" i] input[type="text"]',
        '[class*="ticket" i] input[type="number"]',
        '[class*="betslip" i] input[inputmode="decimal"]',
        '[class*="betslip" i] input[type="text"]',
        '[class*="betslip" i] input[type="number"]',
        'input[placeholder*="0,00"]',
        'input[placeholder*="0.00"]',
        'input[placeholder*="stake" i]',
        'input[placeholder*="valor" i]',
        'input[placeholder*="quantia" i]',
      ];

      const base = root || document;
      for (const sel of directSelectors) {
        try {
          const single = base.querySelector?.(sel);
          if (single && isVisible(single)) return single;

          const inputs = Array.from(base.querySelectorAll?.(sel) || []).filter((i) => isVisible(i));
          if (inputs.length > 0) {
            const prioritized = inputs.find((i) => !i.readOnly && !i.disabled) || inputs[0];
            return prioritized;
          }
        } catch (_) {}
      }

      // Procura dentro do betslip container
      const betslip = document.querySelector(BETSLIP_ROOT_SELECTOR);
      if (betslip && betslip !== base) {
        for (const sel of directSelectors) {
          try {
            const single = betslip.querySelector?.(sel);
            if (single && isVisible(single)) return single;
          } catch (_) {}
        }
      }

      return null;
    }

    injectStakeValue(input, val) {
      if (!input) return false;
      const cleanVal = String(val || "").trim().replace(".", ",");
      try {
        input.focus();
        input.dispatchEvent(new FocusEvent("focus", { bubbles: true, cancelable: true }));
      } catch (_) {}

      try {
        const nativeSetter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement?.prototype || {},
          "value"
        )?.set;
        if (nativeSetter) {
          nativeSetter.call(input, cleanVal);
        } else {
          input.value = cleanVal;
        }
      } catch (_) {
        input.value = cleanVal;
      }

      try {
        input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
        input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
        input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, composed: true, key: "Enter" }));
        input.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, composed: true, key: "Enter" }));
      } catch (_) {}

      try {
        input.blur();
        input.dispatchEvent(new FocusEvent("blur", { bubbles: true, cancelable: true }));
      } catch (_) {}

      return true;
    }

    findSubmit(root = null) {
      if (typeof document === "undefined") return null;

      const directSelectors = [
        "button.e2e-betslip-submit",
        "button.sds-bet-slip-submit",
        'button[class*="betslip-submit"]',
        'button[class*="bet-slip-submit"]',
        '[class*="e2e-betslip-submit"] button',
        'button[data-testid*="place-bet" i]',
        'button[data-testid*="ticket-submit" i]',
        'button[data-testid*="bet-button" i]',
        'button[class*="ticket-submit" i]',
        'button[class*="place-bet" i]',
        'button[class*="btn-bet" i]',
        'button[class*="bet-btn" i]',
        '[class*="ticket"] button[type="submit"]',
        '[class*="betslip"] button[type="submit"]',
      ];

      const base = root || document;
      for (const sel of directSelectors) {
        try {
          const btn = base.querySelector?.(sel);
          if (btn && isSubmitButtonEligible(btn)) {
            return btn;
          }
        } catch (_) {}
      }

      // Procura dentro do betslip container
      const betslip = document.querySelector(BETSLIP_ROOT_SELECTOR);
      if (betslip && betslip !== base) {
        const buttons = Array.from(betslip.querySelectorAll("button, [role='button']"));
        for (const btn of buttons) {
          if (isSubmitButtonEligible(btn)) {
            return btn;
          }
        }
      }

      // Fallback global por botões com texto de confirmação de aposta
      const allButtons = Array.from(document.querySelectorAll("button, [role='button']"));
      for (const btn of allButtons) {
        if (isSubmitButtonEligible(btn)) {
          return btn;
        }
      }

      return null;
    }

    ensureBetslipExpanded() {
      if (typeof document === "undefined") return;
      const toggleSelectors = [
        '[class*="betslip-toggle" i]',
        '[class*="ticket-toggle" i]',
        '[data-testid*="open-betslip" i]',
        '[class*="sds-betslip__header" i]',
        '[class*="bottom-nav"] [class*="ticket" i]',
        '[class*="bottom-navigation"] [class*="ticket" i]',
        '[class*="betslip-bar" i]',
        '[class*="ticket-bar" i]',
        '[class*="floating-betslip" i]',
        '[class*="ticket-bubble" i]',
        '[class*="selection-counter" i]',
        'button[aria-label*="bilhete" i]',
        'button[aria-label*="cupom" i]',
        '[class*="bottom-bar"] button'
      ];
      for (const sel of toggleSelectors) {
        try {
          const toggle = document.querySelector(sel);
          if (toggle && isVisible(toggle)) {
            const betslip = document.querySelector(BETSLIP_ROOT_SELECTOR);
            if (!betslip || !isVisible(betslip)) {
              clickElement(toggle);
              break;
            }
          }
        } catch (_) {}
      }
    }

    async submitBetslip(timeoutMs = 2500) {
      // Aguarda botão de aposta estar habilitado
      const submitBtn = await waitFor(() => {
        const btn = this.findSubmit();
        if (btn && isButtonEnabled(btn)) return btn;
        return null;
      }, timeoutMs, 30);

      if (!submitBtn) {
        const fallbackBtn = this.findSubmit();
        if (fallbackBtn) {
          console.log(`[Superbet Adapter] 🎯 Clicando no botão de aposta (fallback): ${cleanText(fallbackBtn.textContent || "")}`);
          clickElement(fallbackBtn);
          return true;
        }
        return false;
      }

      console.log(`[Superbet Adapter] 🎯 Clicando no botão de aposta da Superbet: ${cleanText(submitBtn.textContent || "")} | Habilitado: true`);
      clickElement(submitBtn);

      // Reforço após 120ms para garantir despacho
      setTimeout(() => {
        try {
          const btnReforco = this.findSubmit();
          if (btnReforco && isButtonEnabled(btnReforco)) {
            clickElement(btnReforco);
            console.log("[Superbet Adapter] Reforço de submissão do cupom (120ms) executado.");
          }
        } catch (_) {}
      }, 120);

      return true;
    }

    async selectOddsOnSuperbet(
      targetName,
      targetOdd,
      marketTitle,
      colIndex,
      rowIndex,
      isHotkey,
      lineName,
      fastMode,
      optionLabel,
      outcomeId,
      explicitStake
    ) {
      try {
        console.log(`[Superbet Adapter] ⚡ selectOddsOnSuperbet acionado:`, {
          targetName,
          targetOdd,
          marketTitle,
          outcomeId,
          explicitStake,
        });

        const displayDesc = `${marketTitle ? marketTitle + " • " : ""}${targetName || optionLabel || ""} @ ${targetOdd || ""}`;
        showSuperbetStatusToast(`🎯 Selecionando ${displayDesc}`);

        let outcome = this.findOutcome(targetName || optionLabel, targetOdd, outcomeId, marketTitle);
        if (!outcome) {
          // Segunda tentativa rápida após 90ms
          await new Promise((r) => setTimeout(r, 90));
          outcome = this.findOutcome(targetName || optionLabel, targetOdd, outcomeId, marketTitle);
        }

        if (!outcome) {
          console.warn("[Superbet Adapter] Seleção não encontrada:", {
            targetName,
            targetOdd,
            outcomeId,
            optionLabel,
          });
          showSuperbetStatusToast(`❌ Seleção não encontrada: ${targetName || optionLabel || ""}`, true);
          return false;
        }

        const isAlreadyActive =
          outcome.classList?.contains("active") ||
          outcome.classList?.contains("selected") ||
          outcome.getAttribute?.("aria-pressed") === "true" ||
          outcome.getAttribute?.("data-selected") === "true";

        if (!isAlreadyActive) {
          console.log(`[Superbet Adapter] 🎯 Clicando na seleção: ${cleanText(outcome.textContent || "")}`);
          clickElement(outcome);
          await new Promise((r) => setTimeout(r, 220));
        } else {
          console.log(`[Superbet Adapter] 🎯 Seleção já ativa no cupom da Superbet.`);
        }

        this.ensureBetslipExpanded();

        return (await this.triggerPlaceBet(true, isHotkey, false, true, explicitStake)) !== false;
      } catch (err) {
        console.error("[Superbet Adapter] Erro em selectOddsOnSuperbet:", err);
        showSuperbetStatusToast(`❌ Erro no disparo: ${err?.message || "falha"}`, true);
        return false;
      }
    }

    async triggerPlaceBet(
      isManualTrigger = false,
      isHotkey = false,
      stakeAlreadyPrepared = false,
      fastMode = false,
      explicitStake = null
    ) {
      try {
        const ensureLicense =
          typeof ensureGatilhoBRLicense === "function"
            ? ensureGatilhoBRLicense
            : window.ensureGatilhoBRLicense;
        const hotLicense =
          typeof window.getHotLicenseSnapshot === "function"
            ? window.getHotLicenseSnapshot()
            : null;
        const license = hotLicense || (ensureLicense ? await ensureLicense() : null);
        const electronAuthorized =
          window.FastTriggerExternalElectronMode === true ||
          Number(window.FastTriggerState?.electronAuthorizedUntil || 0) > Date.now() ||
          window.FastTriggerState?.selectionPermit?.actionId != null ||
          isManualTrigger === true;

        if (!license?.valid && !electronAuthorized) {
          console.warn("[Superbet Adapter] Execução bloqueada: licença ou autorização Electron ausente.");
          showSuperbetStatusToast("⚠️ Execução bloqueada: autorização ausente.", true);
          return false;
        }

        if (explicitStake != null && explicitStake !== "") {
          window.FastTriggerExpectedExecutionStake = explicitStake;
        }

        const config = window.FastTriggerConfig || {};
        const rawStake =
          explicitStake ||
          window.FastTriggerExpectedExecutionStake ||
          (config.stakeValByHouse && config.stakeValByHouse.superbet) ||
          config.stakeVal ||
          config.stake ||
          "0.50";
        const stakeValue = String(rawStake).replace(".", ",");
        const fastDispatch = Boolean(fastMode || isHotkey || isManualTrigger);

        if (!stakeAlreadyPrepared) {
          this.ensureBetslipExpanded();

          let stakeInput = this.findStake();
          if (!stakeInput) {
            stakeInput = await waitFor(() => {
              this.ensureBetslipExpanded();
              return this.findStake();
            }, fastDispatch ? 1500 : 2500, 30);
          }
          if (!stakeInput) {
            console.warn("[Superbet Adapter] Campo de stake não encontrado no cupom.");
            showSuperbetStatusToast("⚠️ Odd clicada. Cupom aberto para confirmação manual.", true);
            return false;
          }

          this.injectStakeValue(stakeInput, stakeValue);
          showSuperbetStatusToast(`Odd selecionada | Stake R$ ${stakeValue}`);
        }

        if (window.FastTriggerState?.deferDynamicBindSubmit === true && !isManualTrigger) {
          return true;
        }

        let isAutoSubmit = Boolean(fastMode || isHotkey || electronAuthorized || isManualTrigger);
        if (!isAutoSubmit && typeof isOneShotActive === "function") {
          try {
            isAutoSubmit = Boolean(await isOneShotActive());
          } catch (_) {}
        }
        if (
          config.oneClick ||
          config.oneShot ||
          config.autoTriggerDirectBool ||
          config.autoTrigger ||
          config.autoTriggerDirect ||
          config.autoPlaceBet
        ) {
          isAutoSubmit = true;
        }

        if (!isAutoSubmit && !isManualTrigger) {
          console.log("[Superbet Adapter] One-Shot desativado. Odd selecionada e stake preenchida.");
          showSuperbetStatusToast(`Odd e Stake R$ ${stakeValue} prontas!`);
          return true;
        }

        const submitted = await this.submitBetslip(fastDispatch ? 2500 : 3500);
        if (!submitted) {
          console.warn("[Superbet Adapter] Submissão do cupom não pôde ser completada.");
          showSuperbetStatusToast("⚠️ Stake pronta. Clique em Apostar para confirmar.", true);
          return false;
        }

        console.log("[Superbet Adapter] 🚀 Disparo concluído com sucesso: odd selecionada, stake preenchida e aposta confirmada!");
        showSuperbetStatusToast("🚀 Aposta confirmada na Superbet com sucesso!");
        return true;
      } catch (err) {
        console.error("[Superbet Adapter] Erro ao executar triggerPlaceBet:", err);
        showSuperbetStatusToast(`❌ Erro na aposta: ${err?.message || "falha"}`, true);
        return false;
      }
    }
  }

  // Exportação para o ambiente de extensão e Node.js
  if (typeof window !== "undefined") {
    window.SuperbetAdapter = SuperbetAdapter;
    window.SuperbetSportsbookAdapter = SuperbetAdapter;
    window.selectOddsOnSuperbet = (
      targetName,
      targetOdd,
      marketTitle,
      colIndex,
      rowIndex,
      isHotkey,
      lineName,
      fastMode,
      optionLabel,
      outcomeId,
      explicitStake
    ) => {
      const adapter = window.FastTriggerAdapter || new SuperbetAdapter();
      return adapter.selectOddsOnSuperbet(
        targetName,
        targetOdd,
        marketTitle,
        colIndex,
        rowIndex,
        isHotkey,
        lineName,
        fastMode,
        optionLabel,
        outcomeId,
        explicitStake
      );
    };

    if (SuperbetAdapter.isMatchingSite(window.location?.hostname)) {
      window.FastTriggerGetEventIdentity = () => {
        try {
          const context = window.FastTriggerEventContext;
          if (context && context.eventLabel) {
            const clean = context.eventLabel
              .toLowerCase()
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "")
              .replace(/[^a-z0-9]+/g, "-")
              .replace(/^-+|-+$/g, "");
            return `superbet:${clean}`;
          }
          const m = window.location.pathname.match(/\/([^\/]+)-(\d+)(?:\/|$)/);
          if (m) {
            const slug = m[1]
              .toLowerCase()
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "")
              .replace(/[^a-z0-9]+/g, "-");
            return `superbet:${slug}`;
          }
          return "superbet:current-event";
        } catch (_) {
          return "superbet:current-event";
        }
      };
    }

    if (
      !window.FastTriggerAdapter &&
      SuperbetAdapter.isMatchingSite(window.location?.hostname)
    ) {
      window.FastTriggerAdapter = new SuperbetAdapter();
    }
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = SuperbetAdapter;
  }
})();
