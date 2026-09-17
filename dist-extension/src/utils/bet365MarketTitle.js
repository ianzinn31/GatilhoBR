// =========================================================================
// GATILHOBR - TITULOS SEMANTICOS DOS MERCADOS BET365
// =========================================================================

(function () {
  "use strict";

  const decorationPatterns = [
    /\bPAGAMENTO\s+ANTECIPADO\b/giu,
    /\bACUM(?:ULADOR)?\.?\s+AUMENTADO\b/giu,
    /\bSUBSTITUI[CÇ][AÃ]O\s*\+/giu,
    /\bCRIAR\s+APOSTA\b/giu,
    /\bBET\s*BUILDER\b/giu,
  ];

  function normalizeDecoration(value) {
    return (value || "")
      .toString()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/gi, " ")
      .trim()
      .toLowerCase();
  }

  function isDecoration(value) {
    const normalized = normalizeDecoration(value);
    return (
      !normalized ||
      /^(?:ca|pagamento antecipado|acum(?:ulador)? aumentado|substituicao|criar aposta|bet builder|principais|todos)$/.test(
        normalized,
      )
    );
  }

  function clean(value) {
    let title = (value || "").toString().replace(/\s+/g, " ").trim();
    if (!title) return "";

    decorationPatterns.forEach((pattern) => {
      title = title.replace(pattern, " ");
    });

    title = title
      .replace(/(?:^|\s)CA(?=\s|$)/giu, " ")
      .replace(/\s+(?:PRINCIPAIS(?:\s+TODOS)?|TODOS)\s*$/iu, "")
      .replace(/[⭐★☆]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    return title;
  }

  function visible(element) {
    if (!element) return false;
    try {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        rect.width > 0 &&
        rect.height > 0
      );
    } catch (error) {
      return true;
    }
  }

  function textOf(element) {
    return (element?.innerText || element?.textContent || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function fromCard(card) {
    if (!card) return "";

    const header = card.querySelector('[role="button"]') || card.firstElementChild;
    if (!header) return "";

    const preferredNodes = Array.from(
      header.querySelectorAll(
        '.gl-MarketGroupButton_Text, .sip-MarketGroupButton_Text, [class*="MarketGroupButton_Text"], [class*="MarketGroupButton_Title"], [class*="MarketTitle"], .rrb-64b',
      ),
    );
    const leafNodes = Array.from(header.querySelectorAll("span, div")).filter(
      (node) => node.children.length === 0,
    );

    const candidates = [...preferredNodes, ...leafNodes]
      .filter(visible)
      .map(textOf)
      .filter(
        (text, index, list) =>
          text &&
          list.indexOf(text) === index &&
          !isDecoration(text) &&
          /[A-Za-zÀ-ÿ]/.test(text),
      );

    if (candidates.length > 0) return clean(candidates[0]);
    return clean(textOf(header));
  }

  function aliasesFromCard(card) {
    if (!card) return [];
    const header = card.querySelector('[role="button"]') || card.firstElementChild;
    const rawHeader = textOf(header);
    const semanticTitle = fromCard(card);
    return [...new Set([semanticTitle, clean(rawHeader), rawHeader].filter(Boolean))];
  }

  function hasModernMarketClass(element) {
    const className =
      typeof element?.className === "string" ? element.className : "";
    return /(?:^|\s)rgl-[^\s]*Market[^\s]*(?:\s|$)/.test(className);
  }

  function isBefore(left, right) {
    if (!left || !right || typeof left.compareDocumentPosition !== "function") {
      return true;
    }

    const following =
      left.ownerDocument?.defaultView?.Node?.DOCUMENT_POSITION_FOLLOWING || 4;
    return Boolean(left.compareDocumentPosition(right) & following);
  }

  function headerBeforeMarket(container, market) {
    if (!container || !market || typeof container.querySelectorAll !== "function") {
      return null;
    }

    return (
      Array.from(container.querySelectorAll('[role="button"]')).find((button) => {
        if (!button || button.contains?.(market)) return false;
        if (button.closest?.('[class*="rgl-Market"]')) return false;
        if (!isBefore(button, market)) return false;

        const headerText = textOf(button);
        return /[A-Za-zÀ-ÿ]/.test(headerText) && !isDecoration(headerText);
      }) || null
    );
  }

  function findCardForMarket(market, boundary) {
    if (!market) return null;

    const stop =
      boundary?.nodeType === 9 ? boundary.documentElement : boundary || null;
    let current = market.parentElement;
    while (current) {
      if (headerBeforeMarket(current, market)) return current;
      if (current === stop) break;
      current = current.parentElement;
    }
    return null;
  }

  function isModernCard(element) {
    if (!element) return false;
    const className =
      typeof element.className === "string" ? element.className : "";
    if (/(?:^|\s)rrb-5c(?:\s|$)/.test(className)) return true;

    const market = Array.from(
      element.querySelectorAll?.('[class*="rgl-Market"]') || [],
    ).find(hasModernMarketClass);
    return Boolean(market && findCardForMarket(market, element) === element);
  }

  function collectModernCards(root) {
    const targetRoot = root || document;
    if (!targetRoot?.querySelectorAll) return [];

    const cards = [];
    const seen = new Set();
    const remember = (card) => {
      if (!card || seen.has(card)) return;
      seen.add(card);
      cards.push(card);
    };

    // Compatibilidade com o layout anterior. A classe fica confinada aqui;
    // todos os consumidores usam a descoberta estrutural compartilhada.
    Array.from(targetRoot.querySelectorAll('[class~="rrb-5c"]'))
      .filter(
        (card) =>
          !card.parentElement?.closest?.('[class~="rrb-5c"]'),
      )
      .forEach(remember);

    Array.from(targetRoot.querySelectorAll('[class*="rgl-Market"]'))
      .filter(hasModernMarketClass)
      .forEach((market) => remember(findCardForMarket(market, targetRoot)));

    return cards;
  }

  function closestModernCard(element) {
    if (!element) return null;

    const legacyCard = element.closest?.('[class~="rrb-5c"]');
    if (legacyCard) return legacyCard;

    const market = element.closest?.('[class*="rgl-Market"]');
    if (!hasModernMarketClass(market)) return null;
    return findCardForMarket(market, element.ownerDocument || document);
  }

  window.FastTriggerBet365MarketTitle = Object.freeze({
    clean,
    fromCard,
    aliasesFromCard,
    isDecoration,
  });

  window.FastTriggerBet365ModernCards = Object.freeze({
    collect: collectModernCards,
    closest: closestModernCard,
    isCard: isModernCard,
  });
})();
