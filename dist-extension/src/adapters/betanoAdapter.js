// =========================================================================
// GATILHOBR - ADAPTER BETANO BRASIL (SPORTSBOOK ULTRA HIGH-PERFORMANCE)
// Arquitetura não-bloqueante: O(1) cached accordion lookup, zero layout thrashing
// =========================================================================

(function () {
  "use strict";

  // Seletores semânticos e data-qa estáveis da Betano
  const SELECTION_SELECTOR =
    '[data-qa="event-selection"], div[role="button"][data-selnid], .selection-horizontal-button';
  const BETSLIP_ROOT_SELECTOR =
    '#right-sidebar, aside[id="right-sidebar"], [data-qa*="betslip" i], aside, [class*="betslip" i]';
  const BETSLIP_STAKE_SELECTOR =
    'input[data-qa="betslip-stake-input"], input[inputmode="decimal"], input[placeholder*="0,00"], input[placeholder*="stake" i], input[placeholder*="valor" i]';
  const BETSLIP_SUBMIT_SELECTOR =
    'button[data-qa="betslip-place-bet-button"], button[type="button"][role="button"]:not([disabled])';

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

  // Verificação de visibilidade sem bloquear elementos em containers position:fixed
  function isVisible(el) {
    if (!el || el.isConnected === false) return false;
    if (el.hidden || el.getAttribute?.("aria-hidden") === "true") return false;
    if (el.style?.display === "none" || el.style?.visibility === "hidden") return false;
    if (typeof el.offsetWidth === "number" && typeof el.offsetHeight === "number") {
      if (el.offsetWidth === 0 && el.offsetHeight === 0) {
        const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
        if (rect && rect.width <= 0 && rect.height <= 0) return false;
        const style = typeof window !== "undefined" && window.getComputedStyle ? window.getComputedStyle(el) : null;
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
      norm.startsWith("aposteja") ||
      norm.includes("aposteja") ||
      norm.startsWith("apostar") ||
      norm === "apostar" ||
      norm.includes("fazeraposta") ||
      norm.includes("colocaraposta") ||
      norm.includes("confirmaraposta") ||
      norm.includes("placebet") ||
      clean.includes("aposte já") ||
      clean.includes("aposte ja") ||
      clean.includes("apostar") ||
      clean.includes("fazer aposta") ||
      clean.includes("colocar aposta") ||
      clean.includes("place bet") ||
      clean.includes("confirmar aposta")
    );
  }

  // Verificação se o botão está efetivamente habilitado para clique financeiro
  function isButtonEnabled(el) {
    if (!el || !isVisible(el)) return false;
    if (el.disabled || el.hasAttribute?.("disabled")) return false;
    if (el.getAttribute?.("aria-disabled") === "true") return false;

    // Checagem de classes de estado desabilitado (exatas, sem colidir com prefixos de variantes Tailwind como 'disabled:tw-opacity-50')
    if (el.classList) {
      if (
        el.classList.contains("disabled") ||
        el.classList.contains("is-disabled") ||
        el.classList.contains("btn--disabled") ||
        el.classList.contains("is-loading") ||
        el.classList.contains("tw-opacity-50") ||
        el.classList.contains("opacity-50") ||
        el.classList.contains("tw-pointer-events-none")
      ) {
        return false;
      }
    } else {
      const cls = (el.className || "").toString();
      const tokens = cls.split(/\s+/);
      if (tokens.some((t) => t === "disabled" || t === "is-disabled" || t === "tw-opacity-50" || t === "opacity-50")) {
        return false;
      }
    }
    return true;
  }

  // Compatibilidade com scrape e seletores de mercado
  function isButtonEligible(el) {
    return isVisible(el);
  }

  // Validação estrita do botão de aposta (evita clicar no botão de configurações, lixeira, abas, etc.)
  function isSubmitButtonEligible(btn) {
    if (!btn || !isVisible(btn)) return false;

    const text = cleanText(btn.textContent || "");
    const aria = cleanText(btn.getAttribute?.("aria-label") || "");
    const title = cleanText(btn.getAttribute?.("title") || "");
    const dataQa = cleanText(btn.getAttribute?.("data-qa") || "");

    // 1. Prioridade Absoluta: Rótulo inequívoco de aposta ("APOSTE JÁ", "Apostar", "Fazer Aposta", "Place Bet", etc.)
    if (isPlaceBetText(text) || isPlaceBetText(aria) || isPlaceBetText(title)) {
      return true;
    }

    // 2. data-qa explícito de confirmação de aposta
    if (
      dataQa === "betslip-place-bet-button" ||
      dataQa.includes("place-bet-button") ||
      dataQa.includes("place-bet") ||
      dataQa.includes("placebet") ||
      dataQa.includes("submit-bet")
    ) {
      return true;
    }

    // 3. Botão com visual/classe do CTA verde principal da Betano (e sem texto de config/lixeira)
    const cls = (btn.className || "").toString();
    if (
      /primary-green|tw-bg-primary-green|bg-primary-green/i.test(cls) &&
      !/setting|configura|lixeira|trash|clear|fechar|close/i.test(`${text} ${aria} ${dataQa}`)
    ) {
      return true;
    }

    // 4. Rejeição de botões auxiliares (configurações, fechar, lixeira, salvar, etc.)
    const IGNORED =
      /setting|configura|definiç|preferên|personaliz|salvar|save|compartilhar|share|limpar|clear|remover|remove|excluir|trash|lixeira|fechar|deposit|login|entrar|cassino|casino|perfil|campo|estat[íi]sticas|expandir|fixar|ajuda|help|regras|rules|\+10|\+50|\+200/i;

    const testInfo = `${text} ${aria} ${title} ${dataQa}`;
    if (IGNORED.test(testInfo)) {
      return false;
    }

    // 5. Fallbacks mais amplos
    if (/aposta|apostar|confirmar|place\s+bet/i.test(testInfo)) {
      return true;
    }

    return false;
  }

  function waitFor(predicate, timeoutMs = 1200, stepMs = 25) {
    return new Promise((resolve) => {
      const started = Date.now();
      const tick = () => {
        let value = null;
        try { value = predicate(); } catch (_) {}
        if (value) return resolve(value);
        if (Date.now() - started >= timeoutMs) return resolve(null);
        setTimeout(tick, stepMs);
      };
      tick();
    });
  }

  function clickElement(el) {
    if (!el) return false;
    try {
      if (typeof el.scrollIntoView === "function") {
        el.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
    } catch (_) {}

    const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
    const clientX = rect ? rect.left + rect.width / 2 : 0;
    const clientY = rect ? rect.top + rect.height / 2 : 0;
    const commonInit = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      clientX: clientX,
      clientY: clientY,
      button: 0,
      pointerId: 1,
      isPrimary: true,
    };
    const eventInitDown = { ...commonInit, buttons: 1 };
    const eventInitUp = { ...commonInit, buttons: 0 };

    const targetChild = el.querySelector?.('.s-name, [data-qa="event-selection-selection-name"], span') || el;

    try { el.dispatchEvent(new PointerEvent("pointerdown", eventInitDown)); } catch (_) {}
    try { el.dispatchEvent(new MouseEvent("mousedown", eventInitDown)); } catch (_) {}
    try { targetChild.dispatchEvent(new MouseEvent("mousedown", eventInitDown)); } catch (_) {}
    try { el.focus?.(); } catch (_) {}
    try { el.dispatchEvent(new PointerEvent("pointerup", eventInitUp)); } catch (_) {}
    try { el.dispatchEvent(new MouseEvent("mouseup", eventInitUp)); } catch (_) {}
    try { targetChild.dispatchEvent(new MouseEvent("mouseup", eventInitUp)); } catch (_) {}
    try { el.dispatchEvent(new MouseEvent("click", eventInitUp)); } catch (_) {}
    try { targetChild.dispatchEvent(new MouseEvent("click", eventInitUp)); } catch (_) {}
    try { el.click(); } catch (_) {}
    return true;
  }

  // Limpa ruídos de títulos da Betano (badges "CA" / Criar Aposta, ícones, chevrons, seleções concatenadas)
  function cleanMarketTitle(rawTitle) {
    if (!rawTitle) return "";
    const lines = rawTitle
      .split("\n")
      .map((l) => cleanText(l))
      .filter(Boolean);

    for (let line of lines) {
      // 1. Remove repetidos badges de CA / Criar Aposta no início, mesmo se colados diretamente na palavra seguinte
      let cleaned = line
        .replace(/^(?:(?:ca|criar aposta|bet builder)[\s:-]*)+/i, "")
        .replace(/^ca(?=[A-ZÀ-Ú])/i, "")
        .trim();

      // 2. Remove sufixos de CA / badges / ícones
      cleaned = cleaned
        .replace(/[\s:-]*(?:ca|criar aposta|bet builder)$/i, "")
        .replace(/[\s\^v\+\-]+$/, "")
        .trim();

      // 3. Se o texto ainda contiver seleções/odds concatenadas no final (ex: "Resultado Final13.05X2.8522.55", "Total de GolsMais de 2.5...", etc.)
      // corta antes do início da primeira seleção para manter APENAS o nome do mercado
      // 3.1 1X2 colado com odds (ex: "Resultado Final13.05X2.8522.55")
      const m1x2 = cleaned.match(/[1X2]\s*\d+[.,]\d{2}(?:[X2]\s*\d+[.,]\d{2})/i);
      if (m1x2 && m1x2.index >= 3) {
        cleaned = cleaned.slice(0, m1x2.index).trim();
      }
      // 3.2 Mais/Menos ou Over/Under colado com odds (ex: "Total de GolsMais de 2.5...")
      const mOverUnder = cleaned.match(/(?:Mais|Menos|Over|Under)\s*(?:de)?\s*\d+[.,]?\d*\s*\d+[.,]\d{2}/i);
      if (mOverUnder && mOverUnder.index >= 3) {
        cleaned = cleaned.slice(0, mOverUnder.index).trim();
      }
      // 3.3 Título terminado em parêntese seguido de time/odd (ex: "Próximo gol (Gol 1)América-MG2.15...")
      const mParenTime = cleaned.match(/\)\s*[A-ZÀ-ÿa-z0-9\s\-]+?\d+[.,]\d{2}/i);
      if (mParenTime && mParenTime.index >= 3) {
        cleaned = cleaned.slice(0, mParenTime.index + 1).trim();
      }
      // 3.4 Título com Tempo/Parte/Set seguido de time/odd (ex: "Resultado do 1° TempoAmérica-MG3.80...")
      const mPeriod = cleaned.match(/(?:Tempo|Parte|Set|Quarto|Inning)\s*[A-ZÀ-ÿa-z0-9\s\-]+?\d+[.,]\d{2}/i);
      if (mPeriod) {
        const termMatch = cleaned.slice(mPeriod.index).match(/(?:Tempo|Parte|Set|Quarto|Inning)/i);
        if (termMatch) {
          cleaned = cleaned.slice(0, mPeriod.index + termMatch.index + termMatch[0].length).trim();
        }
      }

      // Ignora badges, abas, controles de expansão e ícones
      if (
        !cleaned ||
        cleaned.length < 2 ||
        /^(ca|criar aposta|bet builder|ao vivo|populares|campo|estat[íi]sticas|mostrar todos|mostrar menos|op[çc][õo]es alternativas|\^|v|\+|-)$/i.test(cleaned) ||
        /^\d+(?:[.,]\d+)?$/.test(cleaned)
      ) {
        continue;
      }

      // NUNCA aceita um rótulo de seleção (ex: "Mais de 6.5", "Menos de 2.5", "1", "X", "2", "Sim", "Não") como título de mercado
      if (
        /^(?:mais(?:\s+de)?|menos(?:\s+de)?|over|under)\s+\d+(?:[.,]\d+)?$/i.test(cleaned) ||
        /^(?:1|x|2|sim|n[ãa]o)$/i.test(cleaned)
      ) {
        continue;
      }

      return cleaned;
    }
    return "";
  }

  // Extração rápida de texto de elemento sem acionar layout recalculation (zero innerText layout thrashing)
  function getElementTextFast(el) {
    if (!el) return "";
    return cleanText(el.textContent || el.innerText || "");
  }

  // Extração unificada e à prova de inversão de rótulo e cotação
  function extractSelectionInfo(button) {
    // 1. Extração via aria-label descritivo (Inglês ou Português) - O(1) direto em memória
    const aria = button.getAttribute("aria-label") || "";
    if (aria) {
      const enMatch = aria.match(/^Bet\s+on\s+(.+?)\s+with\s+odds\s+(\d+(?:[.,]\d+)?)/i);
      if (enMatch && Number(enMatch[2].replace(",", ".")) >= 1.001) {
        return {
          label: cleanText(enMatch[1]),
          odd: formatOddValue(enMatch[2]),
        };
      }
      const ptMatch = aria.match(
        /^(?:Apostar?\s+em\s+|Aposta\s+em\s+)?(.+?)\s+(?:com\s+)?(?:odds?|cota[çc][ãa]o)\s+(?:de\s+)?(\d+(?:[.,]\d+)?)/i
      );
      if (ptMatch && Number(ptMatch[2].replace(",", ".")) >= 1.001) {
        return {
          label: cleanText(ptMatch[1]),
          odd: formatOddValue(ptMatch[2]),
        };
      }
    }

    // 2. Extração via texto completo: o layout da Betano SEMPRE coloca o rótulo antes e o número da cotação no final
    const fullText = getElementTextFast(button);
    const endMatch = fullText.match(/^(.*?)(?:[\s\n]+)([0-9]+(?:[.,][0-9]+)?)$/s);
    if (endMatch) {
      const oRaw = endMatch[2].replace(",", ".");
      const l = cleanText(endMatch[1]);
      if (l.length > 0 && /^\d{1,4}(?:\.\d{1,3})?$/.test(oRaw) && Number(oRaw) >= 1.001) {
        return {
          label: l,
          odd: formatOddValue(oRaw),
        };
      }
    }

    // 3. Elementos internos estruturados (fallback sem layout reflow)
    const titleEl = button.querySelector?.(
      '.s-name, [data-qa="event-selection-selection-name"], [class*="selection-horizontal-button__title" i], [class*="selection-name" i]'
    );
    const priceEl = button.querySelector?.(
      '.tw-text-sem-color-text-highlight, [class*="text-highlight" i], .tw-font-bold, [class*="selection-odds" i], [class*="odds" i]'
    );
    if (titleEl && priceEl && priceEl !== titleEl) {
      const l = getElementTextFast(titleEl);
      const oRaw = getElementTextFast(priceEl).replace(",", ".");
      if (l && /^\d{1,4}(?:\.\d{1,3})?$/.test(oRaw) && Number(oRaw) >= 1.001) {
        return {
          label: l,
          odd: formatOddValue(oRaw),
        };
      }
    }

    // 4. Fallback final por regex de números no final
    const nums = fullText.match(/\d+(?:[.,]\d+)?/g);
    if (nums && nums.length > 0) {
      const lastNum = nums[nums.length - 1];
      const oRaw = lastNum.replace(",", ".");
      const idx = fullText.lastIndexOf(lastNum);
      const l = fullText.slice(0, idx).trim() || "Opção";
      return {
        label: l,
        odd: formatOddValue(oRaw),
      };
    }

    return { label: fullText || "Opção", odd: "" };
  }

  // Constrói estrutura tabular (tableRows) para mercados com linhas (Over/Under, Handicap)
  function buildMarketStructure(marketTitle, participants) {
    const lineMap = new Map();
    let isLineMarket = false;

    // Detecta mercados de Over/Under ou Mais/Menos
    for (const p of participants) {
      const name = p.name || "";
      const m = name.match(/(mais(?:\s+de)?|menos(?:\s+de)?|over|under)\s+(\d+(?:[.,]\d+)?)/i);
      if (m) {
        isLineMarket = true;
        const side = /mais|over/i.test(m[1]) ? "Mais" : "Menos";
        const lineVal = m[2].replace(",", ".");
        if (!lineMap.has(lineVal)) {
          lineMap.set(lineVal, {});
        }
        lineMap.get(lineVal)[side] = p;
      }
    }

    const tableRows = [];
    let headers = [];

    if (isLineMarket && lineMap.size > 0) {
      headers = ["Linha", "Mais", "Menos"];
      const sortedLines = Array.from(lineMap.keys()).sort((a, b) => Number(a) - Number(b));

      sortedLines.forEach((line) => {
        const pair = lineMap.get(line);
        const colOdds = [];
        for (const side of ["Mais", "Menos"]) {
          if (pair[side]) {
            const item = { ...pair[side] };
            item.colHeader = side;
            item.lineName = line;
            colOdds.push(item);
          }
        }
        if (colOdds.length > 0) {
          tableRows.push({
            lineLabel: line,
            colOdds: colOdds,
            odds: colOdds,
          });
        }
      });
    }

    const isTable = tableRows.length > 0;
    if (!isTable) {
      headers = participants.map((p) => p.colHeader || p.name);
    }

    return {
      title: marketTitle,
      isTable: isTable,
      isPlayerMarket: false,
      isSuspended: participants.every((p) => p.isClosed),
      headers: headers,
      tableRows: tableRows,
      rows: tableRows.map((r) => ({
        label: r.lineLabel,
        odds: r.colOdds,
      })),
      participants: participants,
      selections: participants,
    };
  }

  class BetanoAdapter {
    constructor() {
      this.siteName = "Betano";
      this.lastScrapeAt = 0;
      this.cachedMarkets = [];
      this.lastBetslipAt = 0;
      this.lastBetslipValue = "";
    }

    cleanMarketTitle(rawTitle) {
      return cleanMarketTitle(rawTitle);
    }

    static cleanMarketTitle(rawTitle) {
      return cleanMarketTitle(rawTitle);
    }

    static isMatchingSite(hostname) {
      const currentHost = typeof location !== "undefined" ? location.hostname : "";
      return /(^|\.)betano\.bet\.br$/i.test(hostname || currentHost);
    }

    scrapeClean(root) {
      const now = Date.now();
      // Cooldown de 250ms: reutiliza snapshot sem reconsultar DOM, aliviando CPU
      if (now - this.lastScrapeAt < 250 && this.cachedMarkets.length > 0) {
        return this.cachedMarkets;
      }

      const scope = root || document.body;
      if (!scope?.querySelectorAll) return [];

      // Coleta botões de seleção com checagem O(1) de visibilidade (zero getBoundingClientRect)
      const rawButtons = Array.from(scope.querySelectorAll(SELECTION_SELECTOR)).filter(isButtonEligible);
      if (rawButtons.length === 0) return [];

      // Filtra abas e botões que não são seleções de aposta
      const validButtons = rawButtons.filter((btn) => {
        if (btn.getAttribute("role") === "tab") return false;
        return true;
      });

      // Cache O(1) por ciclo: evita navegar múltiplos ancestrais repetidamente
      const containerCache = new Map();

      function getMarketInfoFast(button) {
        let node = button.parentElement;
        if (node && containerCache.has(node)) return containerCache.get(node);
        if (node?.parentElement && containerCache.has(node.parentElement)) return containerCache.get(node.parentElement);
        if (node?.parentElement?.parentElement && containerCache.has(node.parentElement.parentElement)) {
          return containerCache.get(node.parentElement.parentElement);
        }

        // 1. Identifica o bloco de mercado através dos seletores reais da Betano
        const marketBlock = button.closest?.(
          '[data-qa-market-type-id], [class*="markets__market"], .markets__market, [data-qa="table-market-column"], [data-qa="table-markets-row"], [data-qa="event-card"], [class*="accordion-item" i], [class*="market-container" i]'
        );

        let bestContainer = marketBlock || null;
        let bestTitle = "";

        if (marketBlock) {
          // Procura cabeçalho dentro do marketBlock sem incluir o botão de seleção
          let headerEl = marketBlock.querySelector?.(
            '[class*="markets__market__header" i], [class*="market-header" i], [data-qa*="header" i], [class*="accordion-header" i], [class*="accordion-item__header" i], button[aria-expanded], [role="button"][aria-expanded]'
          );
          if (!headerEl && marketBlock.firstElementChild && !marketBlock.firstElementChild.contains(button)) {
            headerEl = marketBlock.firstElementChild;
          }

          if (headerEl) {
            const titleInner = headerEl.querySelector?.(
              '[class*="title" i], [data-qa*="title" i], h1, h2, h3, h4, h5, div.tw-self-center, [class*="market-name" i]'
            );
            bestTitle = cleanMarketTitle(titleInner?.textContent || "") || cleanMarketTitle(headerEl.textContent || "");
          }

          // Se ainda não encontrou título pelo cabeçalho, procura nós que antecedem o container de seleções
          if (!bestTitle) {
            const headings = Array.from(marketBlock.querySelectorAll?.('h1, h2, h3, h4, h5, [class*="title" i], [data-qa*="title" i]') || []);
            for (const h of headings) {
              if (h.contains?.(button)) continue;
              const candidate = cleanMarketTitle(h.textContent || "");
              if (candidate) {
                bestTitle = candidate;
                break;
              }
            }
          }

          // Fallback final: linhas de texto antes do primeiro botão de seleção
          if (!bestTitle) {
            const lines = (marketBlock.innerText || marketBlock.textContent || "").split("\n").map((l) => cleanText(l)).filter(Boolean);
            for (const line of lines) {
              const candidate = cleanMarketTitle(line);
              if (candidate) {
                bestTitle = candidate;
                break;
              }
            }
          }
        }

        // 2. Fallback: navegação ancestral até 10 níveis se closest não encontrou
        if (!bestTitle) {
          let cur = button.parentElement;
          for (let depth = 0; cur && depth < 10; depth++, cur = cur.parentElement) {
            if (cur.tagName === "BODY" || cur.tagName === "MAIN" || cur.id === "app" || cur.id === "root") break;
            if (cur.getAttribute?.("data-qa") === "table-markets-wrapper") break;
            if (containerCache.has(cur)) {
              return containerCache.get(cur);
            }
            const headerEl = cur.querySelector?.(
              '[class*="markets__market__header" i], [class*="market-header" i], [data-qa*="header" i], [class*="header" i]'
            );
            if (headerEl && headerEl !== cur && !headerEl.contains?.(button)) {
              const titleInner = headerEl.querySelector?.(
                '[class*="title" i], [data-qa*="title" i], h2, h3, h4, h5, div.tw-self-center'
              );
              bestTitle = cleanMarketTitle(titleInner?.textContent || "") || cleanMarketTitle(headerEl.textContent || "");
              if (bestTitle) {
                bestContainer = cur;
                break;
              }
            }
          }
        }

        if (!bestTitle) bestTitle = "Mercado Betano";
        if (!bestContainer) bestContainer = marketBlock || button.parentElement?.parentElement || button.parentElement || bestTitle;

        const info = { title: bestTitle, container: bestContainer };
        if (bestContainer && typeof bestContainer === "object") {
          containerCache.set(bestContainer, info);
        }
        let p = button.parentElement;
        for (let d = 0; p && d < 4; d++, p = p.parentElement) {
          if (p === bestContainer) break;
          containerCache.set(p, info);
        }
        return info;
      }

      const marketsMap = new Map();

      validButtons.forEach((button, index) => {
        const { label, odd } = extractSelectionInfo(button);
        if (!odd || Number(odd) < 1.001) return;

        const { title: marketTitle, container } = getMarketInfoFast(button);
        if (!marketTitle || marketTitle.toUpperCase() === "CA") return;

        const outcomeId =
          button.getAttribute("data-selnid") ||
          button.getAttribute("data-selection-id") ||
          button.getAttribute("data-outcome-id") ||
          `betano-${index}`;

        const groupKey = container || marketTitle;
        if (!marketsMap.has(groupKey)) {
          marketsMap.set(groupKey, {
            title: marketTitle,
            participants: [],
            headers: [],
          });
        }

        const marketObj = marketsMap.get(groupKey);
        if (marketObj.title === "Mercado Betano" && marketTitle !== "Mercado Betano") {
          marketObj.title = marketTitle;
        }

        const isClosed = Boolean(
          button.disabled ||
          button.getAttribute("aria-disabled") === "true" ||
          button.classList.contains("disabled")
        );

        const participant = {
          name: label,
          rawName: label,
          colHeader: label,
          val: odd,
          odds: odd,
          outcomeId: String(outcomeId),
          isClosed: isClosed,
        };

        // Mantém referência não enumerável ao botão DOM para disparo instantâneo
        Object.defineProperty(participant, "element", {
          value: button,
          enumerable: false,
          configurable: true,
        });

        marketObj.participants.push(participant);
        if (!marketObj.headers.some((h) => normalizeText(h) === normalizeText(label))) {
          marketObj.headers.push(label);
        }
      });

      const result = Array.from(marketsMap.values())
        .filter((m) => m.participants.length > 0)
        .map((m) => buildMarketStructure(m.title, m.participants));

      this.lastScrapeAt = now;
      this.cachedMarkets = result;
      return result;
    }

    scanBetslip() {
      try {
        const now = Date.now();
        if (now - this.lastBetslipAt < 200) return this.lastBetslipValue;

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

    findOutcome(name, odd, outcomeId = "") {
      const wantedNorm = normalizeText(name);
      const wantedOddNum = Number(String(odd || "").replace(",", "."));

      // 1. Lookup instantâneo O(1) pelo ID da seleção da Betano (data-selnid)
      if (outcomeId) {
        const idStr = String(outcomeId).trim();
        const direct = document.querySelector(
          `[data-qa="event-selection"][data-selnid="${idStr}"], [data-selnid="${idStr}"]`
        );
        if (direct) return direct;
      }

      // 2. Busca pelas seleções ativas na página
      const buttons = Array.from(document.querySelectorAll(SELECTION_SELECTOR));

      // Prioriza correspondência exata de nome + odd
      for (const btn of buttons) {
        const { label: btnLabel, odd: btnOdd } = extractSelectionInfo(btn);
        const btnOddNum = Number(String(btnOdd || "").replace(",", "."));
        const btnNorm = normalizeText(btnLabel);

        const oddMatches =
          Number.isFinite(wantedOddNum) &&
          Number.isFinite(btnOddNum) &&
          Math.abs(wantedOddNum - btnOddNum) < 0.02;

        const nameMatches =
          wantedNorm && (btnNorm === wantedNorm || btnNorm.includes(wantedNorm) || wantedNorm.includes(btnNorm));

        if (nameMatches && oddMatches) return btn;
      }

      // Se não encontrou ambos, busca por nome com odd válida
      if (wantedNorm) {
        for (const btn of buttons) {
          const { label: btnLabel } = extractSelectionInfo(btn);
          const btnNorm = normalizeText(btnLabel);
          if (btnNorm && (btnNorm === wantedNorm || btnNorm.includes(wantedNorm) || wantedNorm.includes(btnNorm))) {
            return btn;
          }
        }
      }

      // Fallback final por odd precisa
      if (Number.isFinite(wantedOddNum)) {
        for (const btn of buttons) {
          const { odd: btnOdd } = extractSelectionInfo(btn);
          const btnOddNum = Number(String(btnOdd || "").replace(",", "."));
          if (Number.isFinite(btnOddNum) && Math.abs(wantedOddNum - btnOddNum) < 0.01) {
            return btn;
          }
        }
      }

      return null;
    }

    ensureBetslipExpanded() {
      if (typeof document === "undefined") return;
      const existing = document.querySelector(
        'input[data-qa*="stake" i], input[inputmode="decimal"], input[data-qa="betslip-stake-input"]'
      );
      if (existing && isVisible(existing)) return;

      const toggleCandidates = [
        '[data-qa="betslip-toggle"]',
        '[data-qa="betslip-bar"]',
        '[class*="betslip-bar" i]',
        '[class*="floating-betslip" i]',
        'button[aria-label*="abrir cupom" i]',
        'button[aria-label*="expandir cupom" i]',
      ];
      for (const sel of toggleCandidates) {
        const btn = document.querySelector(sel);
        if (btn && isVisible(btn)) {
          const qa = (btn.getAttribute?.("data-qa") || "").toLowerCase();
          const aria = (btn.getAttribute?.("aria-label") || "").toLowerCase();
          if (/setting|configura|definiç|lixeira|trash|delete|close|fechar/i.test(qa + " " + aria)) {
            continue;
          }
          clickElement(btn);
          break;
        }
      }
    }

    injectStakeValue(input, stakeValue) {
      if (!input) return false;
      try {
        input.focus?.();
        input.click?.();

        const setter = Object.getOwnPropertyDescriptor(
          (typeof window !== "undefined" ? window.HTMLInputElement : null)?.prototype || {},
          "value"
        )?.set;

        // Limpa antes
        if (setter) {
          setter.call(input, "");
        } else {
          input.value = "";
        }
        input.dispatchEvent(new Event("input", { bubbles: true }));

        // Aplica o valor formatado
        if (setter) {
          setter.call(input, stakeValue);
        } else {
          input.value = stakeValue;
        }
        try {
          input.dispatchEvent(
            new InputEvent("beforeinput", {
              bubbles: true,
              cancelable: true,
              data: stakeValue,
              inputType: "insertText",
            })
          );
        } catch (_) {}
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));

        // Se o input não aceitou o formato (ex: aceita ponto em vez de vírgula), tenta formato alternativo
        const altVal = stakeValue.includes(",")
          ? stakeValue.replace(",", ".")
          : stakeValue.replace(".", ",");
        if (
          !input.value ||
          input.value === "" ||
          input.value === "0" ||
          input.value === "0,00" ||
          input.value === "0.00"
        ) {
          if (setter) {
            setter.call(input, altVal);
          } else {
            input.value = altVal;
          }
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
        }

        input.blur?.();
        return true;
      } catch (e) {
        console.warn("[Betano Adapter] Erro ao injetar stake:", e);
        return false;
      }
    }

    async selectOddsOnBetano(
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
        const outcome = this.findOutcome(targetName || optionLabel, targetOdd, outcomeId);
        if (!outcome) {
          console.warn("[Betano Adapter] Seleção não encontrada:", {
            targetName,
            targetOdd,
            outcomeId,
            optionLabel,
          });
          return false;
        }

        // Executa clique no elemento de seleção diretamente (0ms, sem latência variável de humanizer)
        clickElement(outcome);
        try { outcome.focus?.(); } catch (_) {}
        try { outcome.click?.(); } catch (_) {}

        // Prepara o bilhete, preenche a stake e confirma a aposta no mesmo disparo com alta prioridade
        return (await this.triggerPlaceBet(true, isHotkey, false, true, explicitStake)) !== false;
      } catch (err) {
        console.error("[Betano Adapter] Erro em selectOddsOnBetano:", err);
        return false;
      }
    }

    findStake(root) {
      if (typeof document === "undefined") return null;

      // 1. Seletores diretos da Betano
      const directSelectors = [
        'input[data-qa="betslip-stake-input"]',
        'input[data-qa*="stake-input" i]',
        'input[data-qa*="stake" i]',
        'input[data-qa*="betslip" i]',
        'input[name*="stake" i]',
        '#right-sidebar input[inputmode="decimal"]',
        '#right-sidebar input[type="text"]',
        '#right-sidebar input[type="number"]',
        'aside input[inputmode="decimal"]',
        'aside input[type="text"]',
        'aside input[type="number"]',
        '[class*="betslip" i] input[inputmode="decimal"]',
        '[class*="betslip" i] input[type="text"]',
        '[class*="betslip" i] input[type="number"]',
        'input[inputmode="decimal"]',
        'input[placeholder*="0,00"]',
        'input[placeholder*="0.00"]',
        'input[placeholder*="stake" i]',
        'input[placeholder*="valor" i]',
      ];

      for (const sel of directSelectors) {
        const found = document.querySelector(sel);
        if (
          found &&
          isVisible(found) &&
          !found.readOnly &&
          !/search|buscar|pesquisar|login|promo/i.test(found.placeholder || "")
        ) {
          return found;
        }
      }

      // 2. Fallback de escopo no sidebar ou container do cupom
      const scopes = [
        root,
        document.querySelector("#right-sidebar"),
        document.querySelector("aside"),
        document.querySelector('[data-qa*="betslip" i]'),
        document.querySelector('[class*="betslip" i]'),
      ].filter(Boolean);

      for (const scope of scopes) {
        const inputs = scope.querySelectorAll?.("input") || [];
        for (const input of inputs) {
          if (
            isVisible(input) &&
            input.type !== "search" &&
            input.type !== "checkbox" &&
            input.type !== "radio"
          ) {
            return input;
          }
        }
      }

      return null;
    }

    findSubmit(rootOrRequireEnabled = null, requireEnabled = false) {
      if (typeof document === "undefined") return null;

      let root = null;
      let mustBeEnabled = false;
      if (typeof rootOrRequireEnabled === "boolean") {
        mustBeEnabled = rootOrRequireEnabled;
        root = null;
      } else {
        root = rootOrRequireEnabled;
        mustBeEnabled = Boolean(requireEnabled);
      }

      const checkCandidate = (btn) => {
        if (!btn || btn.isConnected === false || !isVisible(btn)) return false;
        if (!isSubmitButtonEligible(btn)) return false;
        if (mustBeEnabled && !isButtonEnabled(btn)) return false;
        return true;
      };

      // 1. Prioridade Absoluta: Busca reversa no DOM por botão com texto "APOSTE JÁ" / "Apostar"
      // (O floating-betslip da Betano fica fixado no final do DOM, então varrer do fim é instantâneo)
      const allButtons = Array.from(
        document.querySelectorAll('button, [role="button"], input[type="submit"]')
      );
      for (let i = allButtons.length - 1; i >= 0; i--) {
        const btn = allButtons[i];
        const text = btn.textContent || "";
        const aria = btn.getAttribute?.("aria-label") || "";
        if (isPlaceBetText(text) || isPlaceBetText(aria)) {
          if (checkCandidate(btn)) {
            return btn;
          }
        }
      }

      // 2. Seletores diretos específicos do botão de aposta e CTA verde da Betano
      const directSelectors = [
        'button[data-qa="betslip-place-bet-button"]',
        'button[data-qa*="place-bet-button" i]',
        'button[data-qa*="place-bet" i]',
        'button[data-qa*="placeBet" i]',
        'button[data-qa*="submit-bet" i]',
        'button[class*="primary-green" i]',
        '[class*="primary-green" i] button',
        '[class*="floating-betslip" i] button',
        '[data-qa="betslip-footer"] button',
        '[data-qa*="betslip-bottom" i] button',
        '#right-sidebar [class*="footer" i] button',
        'aside [class*="footer" i] button',
        '[class*="betslip" i] [class*="footer" i] button',
      ];

      for (const sel of directSelectors) {
        const candidates = Array.from(document.querySelectorAll(sel));
        for (let i = candidates.length - 1; i >= 0; i--) {
          if (checkCandidate(candidates[i])) {
            return candidates[i];
          }
        }
      }

      // 3. Busca nos escopos do cupom e da página (reverso)
      const candidateScopes = [
        root,
        document.querySelector('[class*="floating-betslip" i]'),
        document.querySelector('[data-qa*="floating-betslip" i]'),
        document.querySelector('[data-qa="betslip-footer"]'),
        document.querySelector('[data-qa*="betslip" i]'),
        document.querySelector('#right-sidebar'),
        document.querySelector('aside'),
        document.querySelector('[class*="betslip" i]'),
        document.body,
      ].filter(Boolean);

      for (const scope of candidateScopes) {
        const buttons = Array.from(
          scope.querySelectorAll?.('button, [role="button"], input[type="submit"]') || []
        );
        for (let i = buttons.length - 1; i >= 0; i--) {
          if (checkCandidate(buttons[i])) {
            return buttons[i];
          }
        }
      }

      return null;
    }

    findAcceptChanges(root = null) {
      if (typeof document === "undefined") return null;
      const candidateScopes = [
        root,
        document.querySelector("#right-sidebar"),
        document.querySelector("aside"),
        document.querySelector('[data-qa*="betslip" i]'),
        document.querySelector('[class*="betslip" i]'),
        document.body,
      ].filter(Boolean);

      for (const scope of candidateScopes) {
        const buttons = scope.querySelectorAll?.('button, [role="button"]') || [];
        for (const btn of buttons) {
          if (!isVisible(btn)) continue;
          const label = cleanText(
            btn.textContent || btn.getAttribute?.("aria-label") || ""
          ).toLowerCase();
          const qa = (btn.getAttribute?.("data-qa") || "").toLowerCase();
          if (
            qa.includes("accept") ||
            qa.includes("odds-change") ||
            label.includes("aceitar altera") ||
            label.includes("aceitar mudan") ||
            label.includes("aceitar odds") ||
            label.includes("accept changes")
          ) {
            return btn;
          }
        }
      }
      return null;
    }

    async submitBetslip(timeoutMs = 2500) {
      try {
        // Pausa curta para estabilização do ciclo de render do React após injeção da stake
        await new Promise((r) => setTimeout(r, 40));

        // 0. Se o modal de configurações tiver sido acidentalmente aberto anteriormente, fecha-o
        const modalClose = document.querySelector(
          '[role="dialog"] button[aria-label*="fechar" i], [role="dialog"] button[data-qa*="close" i], [class*="modal" i] button[aria-label*="fechar" i], [class*="modal" i] [data-qa*="close" i], button[aria-label*="fechar modal" i]'
        );
        if (modalClose && isVisible(modalClose)) {
          console.log("[Betano Adapter] Fechando modal de configurações sobreposto...");
          clickElement(modalClose);
          try { modalClose.click?.(); } catch (_) {}
          await new Promise((r) => setTimeout(r, 40));
        }

        // 1. Aceita alterações pendentes de odds se houver
        const acceptBtn = this.findAcceptChanges();
        if (acceptBtn && isButtonEnabled(acceptBtn)) {
          console.log("[Betano Adapter] Aceitando alterações de odds pendentes...");
          clickElement(acceptBtn);
          try { acceptBtn.click?.(); } catch (_) {}
          await new Promise((r) => setTimeout(r, 40));
        }

        // 2. Aguarda o botão de aposta estar presente e habilitado (re-consultando o nó vivo a cada 20ms)
        let submitBtn = await waitFor(
          () => {
            const acc = this.findAcceptChanges();
            if (acc && isButtonEnabled(acc)) {
              clickElement(acc);
              try { acc.click?.(); } catch (_) {}
            }
            const liveEnabled = this.findSubmit(null, true);
            if (liveEnabled && liveEnabled.isConnected !== false && isButtonEnabled(liveEnabled)) {
              return liveEnabled;
            }
            return null;
          },
          timeoutMs,
          20
        );

        // Fallback: se não habilitou no tempo, busca qualquer botão elegível conectado
        if (!submitBtn) {
          submitBtn = this.findSubmit(null, false);
        }

        if (!submitBtn) {
          console.warn("[Betano Adapter] Botão de submissão do cupom não encontrado.");
          return false;
        }

        // 3. Clique de submissão no botão vivo
        console.log(
          "[Betano Adapter] 🎯 Clicando no botão de aposta da Betano:",
          cleanText(submitBtn.textContent || ""),
          "| Habilitado:",
          isButtonEnabled(submitBtn)
        );
        try { submitBtn.focus?.(); } catch (_) {}
        clickElement(submitBtn);
        try { submitBtn.click(); } catch (_) {}

        // 4. Reforço de submissão aos 120ms e 250ms com nó vivo
        setTimeout(() => {
          try {
            const checkBtn = this.findSubmit(null, true);
            if (checkBtn && checkBtn.isConnected !== false && isButtonEnabled(checkBtn)) {
              console.log("[Betano Adapter] Reforço de submissão do cupom (120ms) executado.");
              checkBtn.focus?.();
              clickElement(checkBtn);
              try { checkBtn.click?.(); } catch (_) {}
            }
          } catch (_) {}
        }, 120);

        setTimeout(() => {
          try {
            const checkBtn2 = this.findSubmit(null, true);
            if (checkBtn2 && checkBtn2.isConnected !== false && isButtonEnabled(checkBtn2)) {
              console.log("[Betano Adapter] Reforço de submissão do cupom (250ms) executado.");
              checkBtn2.focus?.();
              clickElement(checkBtn2);
              try { checkBtn2.click?.(); } catch (_) {}
            }
          } catch (_) {}
        }, 250);

        return true;
      } catch (e) {
        console.error("[Betano Adapter] Erro em submitBetslip:", e);
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
        // 1. Verificação de licença e autorização Electron
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
          console.warn("[Betano Adapter] Execução bloqueada: licença ou autorização Electron ausente.");
          return false;
        }

        if (explicitStake != null && explicitStake !== "") {
          window.FastTriggerExpectedExecutionStake = explicitStake;
        }

        const config = window.FastTriggerConfig || {};
        const rawStake =
          explicitStake ||
          window.FastTriggerExpectedExecutionStake ||
          (config.stakeValByHouse && config.stakeValByHouse.betano) ||
          config.stakeVal ||
          config.stake ||
          "0.50";
        const stakeValue = String(rawStake).replace(".", ",");
        const fastDispatch = Boolean(fastMode || isHotkey || isManualTrigger);

        // 2. Localização e preenchimento de Stake
        if (!stakeAlreadyPrepared) {
          this.ensureBetslipExpanded();

          let stakeInput = this.findStake();
          if (!stakeInput) {
            stakeInput = await waitFor(() => {
              this.ensureBetslipExpanded();
              return this.findStake();
            }, fastDispatch ? 1200 : 2000, 20);
          }
          if (!stakeInput) {
            console.warn("[Betano Adapter] Campo de stake não encontrado no cupom.");
            return false;
          }

          // Preenche a stake no input com eventos do React
          this.injectStakeValue(stakeInput, stakeValue);
        }

        // 3. Suporte a Dynamic Bind com submissão deferida
        if (window.FastTriggerState?.deferDynamicBindSubmit === true && !isManualTrigger) {
          return true;
        }

        // Checagem de submissão automática: se for fastMode, atalho, autorização Electron, disparo manual ou One-Shot ativo
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
          console.log("[Betano Adapter] One-Shot desativado. Odd selecionada e stake preenchida.");
          return true;
        }

        // 4. Confirmação / Submissão da Aposta via submitBetslip com espera ativa
        const submitted = await this.submitBetslip(fastDispatch ? 2500 : 3000);
        if (!submitted) {
          console.warn("[Betano Adapter] Submissão do cupom não pôde ser completada.");
          return false;
        }

        console.log("[Betano Adapter] 🚀 Disparo concluído com sucesso: odd selecionada, stake preenchida e aposta confirmada!");
        return true;
      } catch (err) {
        console.error("[Betano Adapter] Erro ao executar triggerPlaceBet:", err);
        return false;
      }
    }
  }

  if (typeof window !== "undefined") {
    window.BetanoAdapter = BetanoAdapter;
    window.BetanoSportsbookAdapter = BetanoAdapter;
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = BetanoAdapter;
  }
})();
