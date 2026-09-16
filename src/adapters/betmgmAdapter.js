// =========================================================================
// FAST TRIGGER PRO - ADAPTER BETMGM SPORTSBOOK (TIGER SPORTSBOOK)
// =========================================================================

(function () {
  "use strict";

  const SPORTSBOOK_ROOT_SELECTOR =
    '#sportsbook-client-wrapper, [data-testid="sportsbook-client-wrapper"], main';
  const OUTCOME_SELECTOR = '[data-testid^="outcomeButton"]';
  const PLAYER_SELECTOR = '[data-testid="playerName"]';
  const BETSLIP_ROOT_SELECTOR =
    '[data-testid="betslipContainer"], [data-testid="desktopBetslip"], [data-testid="betslip-viewport"], #betslip-viewport, ' +
    '[data-testid*="betslip" i], [id*="betslip" i], [class*="betslip" i], [aria-label*="betslip" i], aside, [role="dialog"]';

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

  function normalizeOdd(value) {
    const raw = cleanText(value).replace(/\s/g, "").replace(/,/g, ".");
    const match = raw.match(/\d+(?:\.\d+)?/);
    return match ? Number(match[0]).toFixed(3).replace(/0+$/, "").replace(/\.$/, "") : "";
  }

  function isVisible(element) {
    if (!element || !element.isConnected) return false;
    if (element.hidden || element.getAttribute("aria-hidden") === "true") return false;
    if (element.style?.display === "none" || element.style?.visibility === "hidden") {
      return false;
    }
    if (element.offsetWidth === 0 && element.offsetHeight === 0) {
      const rect = element.getBoundingClientRect?.();
      if (!rect || rect.width <= 0 || rect.height <= 0) return false;
      const style = window.getComputedStyle?.(element);
      if (style && (style.display === "none" || style.visibility === "hidden")) {
        return false;
      }
    }
    return true;
  }

  function isDisabled(element) {
    if (!element) return true;
    const testId = element.getAttribute("data-testid") || "";
    const className = (element.className || "").toString();
    return Boolean(
      element.disabled ||
        element.hasAttribute("disabled") ||
        element.getAttribute("aria-disabled") === "true" ||
        /locked|suspended|disabled/i.test(`${testId} ${className}`),
    );
  }

  function getSportsbookRoot(root) {
    if (root) return root;
    return (
      document.querySelector(SPORTSBOOK_ROOT_SELECTOR) ||
      document.querySelector("main") ||
      document.body
    );
  }

  function getOutcomeButtons(root) {
    const targetRoot = getSportsbookRoot(root);
    if (!targetRoot) return [];
    return Array.from(targetRoot.querySelectorAll(OUTCOME_SELECTOR))
      .filter((button) => isVisible(button) && button.tagName === "BUTTON")
      .map((button, domIndex) => ({ button, domIndex }))
      .sort((left, right) => {
        const stateOrder = Number(isDisabled(left.button)) - Number(isDisabled(right.button));
        return stateOrder || left.domIndex - right.domIndex;
      })
      .map(({ button }) => button);
  }

  function readOutcomeOdd(button) {
    const valueNode = button.querySelector('[data-testid="outcomeValue"]');
    const value = cleanText(valueNode?.innerText || valueNode?.textContent);
    if (value) return value;

    const text = cleanText(button.innerText || button.textContent);
    return text.match(/\d+(?:[.,]\d{1,3})?/)?.[0] || "";
  }

  function readOutcomeLabel(button) {
    const labelNode = button.querySelector('[data-testid^="outcome-text-"]');
    const label = cleanText(labelNode?.innerText || labelNode?.textContent);
    if (label) return label;

    const text = cleanText(button.innerText || button.textContent);
    const odd = readOutcomeOdd(button);
    return odd ? cleanText(text.replace(odd, "")) : text;
  }

  function readHeaderText(node) {
    if (!node) return "";
    const headerSelectors = [
      '[data-testid^="marketCategoryHeader-"]',
      '[data-testid*="marketCategoryHeader" i]',
      '[data-testid*="market-header" i]',
      '[data-testid*="market" i][role="heading"]',
      '[class*="marketCategoryHeader" i]',
      '[class*="MarketCategoryHeader" i]',
      '[class*="market-category" i]',
      '[class*="marketHeader" i]',
      '[class*="MarketHeader" i]',
      '[role="heading"]',
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
    ];

    for (const selector of headerSelectors) {
      const header = node.querySelector(selector);
      if (!header || header.matches(OUTCOME_SELECTOR)) continue;
      const text = cleanText(header.innerText || header.textContent).split("\n")[0];
      if (!text || text.length > 120) continue;
      if (/^(apostar|betslip|cupom|boletim|selecoes?|selections?)$/i.test(text)) continue;
      return text;
    }
    return "";
  }

  function hasMarketMarker(node) {
    const value = `${node?.getAttribute?.("data-testid") || ""} ${(node?.className || "").toString()}`;
    return /market|category/i.test(value);
  }

  function createMarketResolver(root) {
    const targetRoot = getSportsbookRoot(root);
    const scopeCache = new WeakMap();
    const headerCache = new WeakMap();

    const readCachedHeader = (node) => {
      if (!node) return "";
      if (headerCache.has(node)) return headerCache.get(node);
      const title = readHeaderText(node);
      headerCache.set(node, title);
      return title;
    };

    const resolve = (button) => {
      if (button && scopeCache.has(button)) return scopeCache.get(button);

      let node = button?.parentElement || null;
      let depth = 0;
      let fallback = null;

      while (node && node !== targetRoot && depth < 14) {
        const marker = hasMarketMarker(node);
        const title = marker || depth >= 1 ? readCachedHeader(node) : "";
        if (title && marker) {
          const result = { node, title };
          if (button) scopeCache.set(button, result);
          return result;
        }
        if (!fallback && title) fallback = { node, title };
        node = node.parentElement;
        depth += 1;
      }

      const result = fallback || { node: targetRoot, title: "Mercado BetMGM" };
      if (button) scopeCache.set(button, result);
      return result;
    };

    return { targetRoot, resolve };
  }

  function findPlayerName(button, scope) {
    let node = button?.parentElement || null;
    let depth = 0;
    while (node && depth < 10) {
      const players = Array.from(node.querySelectorAll(PLAYER_SELECTOR));
      const player = players.length === 1 ? players[0] : null;
      const text = cleanText(player?.innerText || player?.textContent);
      if (text) return text;
      if (node === scope) break;
      node = node.parentElement;
      depth += 1;
    }
    return "";
  }

  function waitFor(predicate, timeoutMs = 900) {
    const domWaiter = window.FastTriggerDom?.waitFor;
    if (typeof domWaiter === "function") {
      return domWaiter(predicate, { timeoutMs, intervalMs: 8 });
    }

    return new Promise((resolve) => {
      const startedAt = Date.now();
      const tick = () => {
        let result = null;
        try {
          result = predicate();
        } catch (error) {}
        if (result) {
          resolve(result);
          return;
        }
        if (Date.now() - startedAt >= timeoutMs) {
          resolve(null);
          return;
        }
        setTimeout(tick, 8);
      };
      tick();
    });
  }

  function isBetslipElement(element) {
    if (!element || !isVisible(element)) return false;
    if (
      element.closest(
        'header, nav, footer, [class*="profile" i], [class*="user-menu" i], [data-testid*="profile" i], [data-testid*="user" i]',
      )
    ) {
      return false;
    }
    return true;
  }

  function betslipSemanticText(element) {
    return cleanText(
      [
        element.getAttribute("data-testid"),
        element.id,
        element.getAttribute("class"),
        element.getAttribute("aria-label"),
        element.innerText,
      ]
        .filter(Boolean)
        .join(" "),
    ).toLowerCase();
  }

  function findBetslipRoots() {
    const roots = [];
    const seen = new Set();
    for (const element of Array.from(document.querySelectorAll(BETSLIP_ROOT_SELECTOR))) {
      if (!isBetslipElement(element) || seen.has(element)) continue;
      const semantic = betslipSemanticText(element);
      const hasInput = Boolean(element.querySelector("input"));
      const hasBetslipMarker = /betslip|bet slip|cupom|boletim|suas apostas|your bets|stake|valor da aposta/i.test(
        semantic,
      );
      const hasSelectionMarker = /selecoes|selections/i.test(semantic);
      if (
        !hasBetslipMarker &&
        !(hasSelectionMarker && hasInput) &&
        !(hasInput && /aposta|wager|amount/i.test(semantic))
      ) {
        continue;
      }
      seen.add(element);
      roots.push(element);
    }

    roots.sort((left, right) => {
      const score = (element) => {
        const text = betslipSemanticText(element);
        let value = 0;
        if (/betslip|bet slip/.test(text)) value += 60;
        if (/cupom|boletim|suas apostas|your bets/.test(text)) value += 40;
        if (element.querySelector("input")) value += 30;
        if (element.tagName === "ASIDE" || element.getAttribute("role") === "dialog") value += 10;
        return value;
      };
      return score(right) - score(left);
    });
    return roots;
  }

  function findBetslipRoot() {
    return findBetslipRoots()[0] || null;
  }

  function findBetslipToggle() {
    const roots = findBetslipRoots();
    const candidates = [];
    roots.forEach((root) => {
      if (root.matches("button, [role=\"button\"]")) candidates.push(root);
      candidates.push(
        ...Array.from(root.querySelectorAll("button, [role=\"button\"]")),
      );
    });

    return candidates
      .filter((element) => isBetslipElement(element) && !isDisabled(element))
      .map((element) => {
        const text = betslipSemanticText(element);
        let score = 0;
        if (/betslip|bet slip/.test(text)) score += 50;
        if (/cupom|boletim|suas apostas|your bets/.test(text)) score += 40;
        if (/\d+/.test(text)) score += 10;
        if (element.tagName === "BUTTON" || element.getAttribute("role") === "button") score += 15;
        return { element, score };
      })
      .sort((left, right) => right.score - left.score)[0]?.element || null;
  }

  function stakeInputScore(input) {
    const testId = input.getAttribute("data-testid") || "";
    const name = input.getAttribute("name") || "";
    const text = [
      testId,
      name,
      input.id,
      input.getAttribute("placeholder"),
      input.getAttribute("aria-label"),
      input.getAttribute("class"),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    let score = 0;
    if (testId.toLowerCase() === "betslipwagerinput") score += 220;
    if (name.toLowerCase() === "stake") score += 180;
    if (/stake|wager|bet-amount|betamount/.test(text)) score += 60;
    if (/valor|amount|aposta/.test(text)) score += 40;
    if (input.type === "number") score += 15;
    if (input.type === "text") score += 5;
    return score;
  }

  function findStakeInput(root = null, allowLocked = false) {
    const targetRoot = root || findBetslipRoot();
    if (!targetRoot) return null;
    const inputs = Array.from(targetRoot.querySelectorAll("input"))
      .filter(
        (input) =>
          isVisible(input) &&
          (allowLocked || (!input.disabled && !input.readOnly)) &&
          input.type !== "search" &&
          !/buscar|search/i.test(input.getAttribute("placeholder") || ""),
      )
      .map((input) => ({ input, score: stakeInputScore(input) }))
      .filter(({ score }) => score > 0)
      .sort((left, right) => right.score - left.score);
    return inputs[0]?.input || null;
  }

  function readStakeInputValue(input) {
    if (!input) return "";
    return cleanText(input.value || input.getAttribute("value") || "");
  }

  function parseStake(value) {
    const raw = cleanText(value).replace(/R\$/gi, "").replace(/\s/g, "");
    if (!raw) return NaN;
    const clean = raw.replace(/[^\d,.-]/g, "");
    if (!clean) return NaN;
    return Number.parseFloat(
      clean.includes(",") ? clean.replace(/\./g, "").replace(",", ".") : clean,
    );
  }

  function setStakeValue(input, value) {
    if (!input) return false;
    const rawValue = cleanText(value).replace(/\s/g, "");
    const cleanValue = rawValue.includes(",") ? rawValue : rawValue.replace(".", ",");
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    try {
      input.select?.();
    } catch (error) {}
    if (setter) setter.call(input, cleanValue);
    else input.value = cleanValue;

    try {
      input.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          composed: true,
          inputType: "insertText",
          data: cleanValue,
        }),
      );
    } catch (error) {
      input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    }
    input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    input.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "" }));
    return true;
  }

  function findPlaceBetButton(root) {
    if (!root) return null;
    const selectors = [
      'button[data-testid="betslipSubmitButton"]',
      'button[data-testid="betslipPlaceBet"]',
      'button[data-testid*="place" i]',
      'button[data-testid*="submit" i]',
      'button[data-testid*="confirm" i]',
      '[role="button"][data-testid*="place" i]',
      '[role="button"][data-testid*="submit" i]',
      '[role="button"][data-testid*="confirm" i]',
      'button, [role="button"], input[type="submit"], input[type="button"]',
    ];
    const rawCandidates = [];
    const seen = new Set();
    const addCandidates = (elements) => {
      elements.forEach((element) => {
        if (element && !seen.has(element)) {
          seen.add(element);
          rawCandidates.push(element);
        }
      });
    };
    if (root.matches?.('button, [role="button"], input[type="submit"], input[type="button"]')) {
      addCandidates([root]);
    }
    selectors.forEach((selector) => {
      try {
        addCandidates(Array.from(root.querySelectorAll(selector)));
      } catch (error) {}
    });

    const candidates = rawCandidates
      .filter((button) => isVisible(button) && !isDisabled(button))
      .filter((button) => !window.isFastTriggerOddsChangeButton?.(button))
      .map((button) => {
        const testId = button.getAttribute("data-testid") || "";
        const ariaLabel = button.getAttribute("aria-label") || "";
        const text = [
          button.innerText,
          button.textContent,
          ariaLabel,
          button.getAttribute("title"),
          testId,
          button.getAttribute("class"),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        const isExcluded = /deposit|login|entrar|perfil|account|close|fechar|remove|delete|settings|config|bin|expand|request|cookie|cashout/i.test(
          text,
        );
        const hasActionTestId = /(?:place|submit|confirm)(?:[-_]?bet|[-_]?wager)?/i.test(testId);
        const hasActionText = /apostar|fazer aposta|finalizar aposta|colocar aposta|enviar aposta|confirmar(?: aposta)?|place\s*bet|submit\s*bet|confirm\s*bet/i.test(
          text,
        );
        if (isExcluded || (!hasActionTestId && !hasActionText)) {
          return null;
        }
        let score = button.tagName === "BUTTON" ? 20 : 0;
        if (/betslipSubmitButton|betslipPlaceBet/i.test(testId)) score += 240;
        if (hasActionTestId) score += 120;
        if (/apostar|fazer aposta|finalizar aposta|colocar aposta|enviar aposta/i.test(text)) {
          score += 90;
        }
        if (/place\s*bet|submit\s*bet|confirm\s*bet/i.test(text)) score += 80;
        if (/confirmar|confirm|finalizar/.test(text)) score += 25;
        return { button, score };
      })
      .filter(Boolean)
      .sort((left, right) => right.score - left.score);
    if (candidates[0]?.button) return candidates[0].button;

    const sharedButton =
      typeof window.findReadyPlaceBetButton === "function"
        ? window.findReadyPlaceBetButton()
        : null;
    return sharedButton && (sharedButton === root || root.contains(sharedButton))
      ? sharedButton
      : null;
  }

  async function clickPlaceBetButton(button, fastMode = false) {
    if (!button || !isVisible(button) || isDisabled(button)) return false;

    const trustedReady = window.isActionBtnReady;
    const trustedDispatch = window.dispatchTrustedActionClick;
    if (typeof trustedReady === "function" && typeof trustedDispatch === "function") {
      if (trustedReady(button)) {
        const result = await trustedDispatch(button, fastMode);
        return result?.success === true;
      }
    }

    // A MGM pode trocar o wrapper visual do CTA sem expor o mesmo contrato
    // semântico do motor compartilhado. Nesse caso, ainda usamos o handler
    // React do botão real encontrado dentro do betslip.
    button.click();
    return true;
  }

  function marketMatches(candidateTitle, requestedTitle) {
    const requested = normalizeText(requestedTitle);
    if (!requested) return true;
    const candidate = normalizeText(candidateTitle);
    if (!candidate) return false;
    return candidate === requested || candidate.includes(requested) || requested.includes(candidate);
  }

  function makeCandidate(button, root, marketResolver) {
    const market = marketResolver.resolve(button);
    const player = findPlayerName(button, market.node);
    return {
      button,
      marketTitle: market.title,
      player,
      label: readOutcomeLabel(button),
      odd: readOutcomeOdd(button),
      outcomeId: button.getAttribute("data-outcome-id") || "",
    };
  }

  function selectCandidate(candidates, targetName, targetOddVal, marketTitle, lineName, optionLabel, colIndex) {
    const scoped = candidates.filter((candidate) => marketMatches(candidate.marketTitle, marketTitle));
    if (scoped.length === 0) return null;

    const playerNeedle = normalizeText(lineName);
    const labelNeedle = normalizeText(optionLabel || targetName);
    const nameNeedle = normalizeText(targetName);
    const oddNeedle = normalizeOdd(targetOddVal);
    const rowMatches = (candidate) =>
      !playerNeedle || normalizeText(candidate.player).includes(playerNeedle);
    const labelMatches = (candidate) =>
      !labelNeedle ||
      normalizeText(candidate.label) === labelNeedle ||
      normalizeText(candidate.label).includes(labelNeedle) ||
      labelNeedle.includes(normalizeText(candidate.label));
    const oddMatches = (candidate) => !oddNeedle || normalizeOdd(candidate.odd) === oddNeedle;

    let match = scoped.find(
      (candidate) => rowMatches(candidate) && labelMatches(candidate) && oddMatches(candidate),
    );
    if (!match && nameNeedle) {
      match = scoped.find(
        (candidate) =>
          rowMatches(candidate) &&
          oddMatches(candidate) &&
          normalizeText(`${candidate.player} ${candidate.label}`).includes(nameNeedle),
      );
    }
    if (!match && playerNeedle) {
      match = scoped.find((candidate) => rowMatches(candidate) && labelMatches(candidate));
    }
    if (!match && !playerNeedle && Number.isInteger(colIndex) && colIndex >= 0) {
      match = scoped[colIndex] || null;
    }
    return match || null;
  }

  class BetMgmAdapter {
    constructor() {
      this.siteName = "BetMGM";
      this.domRevision = 0;
      this.observedRoot = null;
      this.marketObserver = null;
      this.lastScrapeRoot = null;
      this.lastScrapeRevision = -1;
      this.lastScrapeResult = [];
      this.lastBetslipAt = 0;
      this.lastBetslipValue = "";
    }

    ensureDomObserver(root) {
      const targetRoot = getSportsbookRoot(root);
      if (!targetRoot) return null;
      if (this.observedRoot === targetRoot) return targetRoot;

      this.marketObserver?.disconnect?.();
      this.observedRoot = targetRoot;
      this.domRevision += 1;
      this.lastScrapeRevision = -1;

      if (typeof MutationObserver !== "function") return targetRoot;
      this.marketObserver = new MutationObserver(() => {
        this.domRevision += 1;
      });
      try {
        this.marketObserver.observe(targetRoot, {
          childList: true,
          subtree: true,
          characterData: true,
          attributes: true,
          attributeFilter: [
            "data-testid",
            "data-outcome-id",
            "aria-disabled",
            "disabled",
            "class",
            "aria-label",
            "data-state",
            "data-status",
            "style",
          ],
        });
      } catch (error) {
        this.marketObserver = null;
      }
      return targetRoot;
    }

    static isMatchingSite(hostname) {
      const host = (hostname || "").toLowerCase().replace(/^www\./, "");
      return host === "betmgm.bet.br" || host.endsWith(".betmgm.bet.br");
    }

    scrapeClean(root) {
      const targetRoot = this.ensureDomObserver(root);
      if (!targetRoot) return [];
      if (
        this.marketObserver &&
        this.lastScrapeRoot === targetRoot &&
        this.lastScrapeRevision === this.domRevision
      ) {
        return this.lastScrapeResult;
      }

      const markets = new Map();
      const seenOutcomeIds = new Set();
      const marketResolver = createMarketResolver(targetRoot);
      getOutcomeButtons(targetRoot).forEach((button, buttonIndex) => {
        const outcomeId = button.getAttribute("data-outcome-id") || `dom-${buttonIndex}`;
        if (seenOutcomeIds.has(outcomeId)) return;
        seenOutcomeIds.add(outcomeId);

        const market = marketResolver.resolve(button);
        const title = cleanText(market.title || "Mercado BetMGM");
        const player = findPlayerName(button, market.node);
        const label = cleanText(readOutcomeLabel(button) || `Opção ${buttonIndex + 1}`);
        const odd = readOutcomeOdd(button);
        const closed = isDisabled(button) || /locked|suspended/i.test(button.getAttribute("data-testid") || "");
        const rawSelection = {
          name: label,
          rawName: player ? `${player} ${label}` : label,
          colHeader: label,
          val: odd,
          odds: odd,
          isClosed: closed,
          outcomeId,
        };
        // Mantém a referência apenas em memória. Não é enumerável para que o
        // snapshot continue serializável ao ser enviado ao dashboard, mas
        // permite ao índice invalidar a entrada quando o botão é suspenso ou
        // reativado no mesmo nó do DOM.
        Object.defineProperty(rawSelection, "element", {
          value: button,
          enumerable: false,
          configurable: true,
        });

        const marketKey = market.node || title;
        if (!markets.has(marketKey)) {
          markets.set(marketKey, {
            title,
            isTable: Boolean(player),
            isPlayerMarket: Boolean(player),
            headers: [],
            rows: new Map(),
            participants: [],
          });
        }

        const current = markets.get(marketKey);
        current.isPlayerMarket = current.isPlayerMarket || Boolean(player);
        current.isTable = current.isPlayerMarket;
        if (!current.headers.some((header) => normalizeText(header) === normalizeText(label))) {
          current.headers.push(label);
        }

        if (current.isPlayerMarket) {
          const rowKey = normalizeText(player || `row-${buttonIndex}`) || `row-${buttonIndex}`;
          if (!current.rows.has(rowKey)) {
            current.rows.set(rowKey, { lineLabel: player || label, colOdds: [] });
          }
          const row = current.rows.get(rowKey);
          const colIndex = current.headers.findIndex(
            (header) => normalizeText(header) === normalizeText(label),
          );
          row.colOdds[colIndex] = rawSelection;
        } else {
          current.participants.push(rawSelection);
        }
      });

      const result = Array.from(markets.values())
        .map((market) => {
          const rows = Array.from(market.rows.values()).map((row) => ({
            lineLabel: row.lineLabel,
            colOdds: row.colOdds,
          }));
          const selections = market.isPlayerMarket
            ? []
            : market.participants.filter((selection) => selection && selection.val);
          const allSelections = market.isPlayerMarket
            ? rows.flatMap((row) => row.colOdds || []).filter(Boolean)
            : selections;
          return {
            title: market.title,
            isTable: market.isPlayerMarket,
            isPlayerMarket: market.isPlayerMarket,
            isSuspended: allSelections.length > 0 && allSelections.every((selection) => selection.isClosed),
            headers: market.headers,
            tableRows: rows,
            participants: selections,
            selections,
          };
        })
        .filter((market) =>
          (market.tableRows || []).length > 0 || (market.participants || []).length > 0,
        );
      this.lastScrapeRoot = targetRoot;
      this.lastScrapeRevision = this.domRevision;
      this.lastScrapeResult = result;
      return result;
    }

    invalidateMarketCache() {
      // A TigerSportsbook pode reativar o mesmo botão sem substituir o nó.
      // O chamador usa este método antes de uma nova tentativa para não
      // reaproveitar um snapshot que ainda esteja marcado como bloqueado.
      this.lastScrapeRevision = -1;
      this.lastScrapeResult = [];
    }

    scanBetslip() {
      try {
        const now = Date.now();
        if (now - this.lastBetslipAt < 120) return this.lastBetslipValue;
        const root = findBetslipRoot();
        if (!root) {
          this.lastBetslipAt = now;
          this.lastBetslipValue = "";
          return "";
        }
        const input = findStakeInput(root, true);
        const text = cleanText(root.innerText || root.textContent).slice(0, 240);
        const stake = readStakeInputValue(input);
        this.lastBetslipAt = now;
        this.lastBetslipValue = text || (stake ? `Stake ${stake}` : "");
        return this.lastBetslipValue;
      } catch (error) {
        return "";
      }
    }

    async selectOddsOnBetmgm(
      targetName,
      targetOddVal,
      marketTitle,
      colIndex = 0,
      rowIndex = 0,
      isHotkey = false,
      lineName = "",
      fastMode = false,
      optionLabel = "",
      outcomeId = "",
      explicitStake = null,
    ) {
      try {
        if (explicitStake != null && explicitStake !== "") {
          window.FastTriggerExpectedExecutionStake = explicitStake;
        }
        const targetRoot = getSportsbookRoot();
        let target = null;
        if (outcomeId) {
          const expectedId = String(outcomeId);
          const escapedId = window.CSS?.escape
            ? window.CSS.escape(expectedId)
            : expectedId.replace(/["\\]/g, "\\$&");
          const button = Array.from(
            targetRoot.querySelectorAll(
              `${OUTCOME_SELECTOR}[data-outcome-id="${escapedId}"]`,
            ),
          ).find(
            (candidate) =>
              candidate.tagName === "BUTTON" &&
              isVisible(candidate) &&
              !isDisabled(candidate),
          );
          if (button) {
            target = { button, outcomeId: expectedId };
          }
        }
        if (!target) {
          const buttons = getOutcomeButtons(targetRoot).filter(
            (button) => !isDisabled(button),
          );
          const marketResolver = createMarketResolver(targetRoot);
          const candidates = buttons.map((button) =>
            makeCandidate(button, targetRoot, marketResolver),
          );
          target = selectCandidate(
            candidates,
            targetName,
            targetOddVal,
            marketTitle,
            lineName,
            optionLabel,
            colIndex,
          );
        }
        if (!target || isDisabled(target.button) || !isVisible(target.button)) return false;

        // O botão outcomeButton é o componente React oficial da TigerSportsbook.
        // Um único HTMLElement.click() aciona o handler da casa sem navegar pelo
        // cabeçalho, perfil ou por um endpoint privado.
        target.button.click();

        const fastDispatch =
          fastMode ||
          isHotkey ||
          window.FastTriggerState?.backgroundDispatchInProgress === true;
        const result = await this.triggerPlaceBet(false, isHotkey, false, fastDispatch, explicitStake);
        return result !== false;
      } catch (error) {
        console.error("[BetMGM Adapter] Erro ao selecionar odd:", error);
        return false;
      }
    }

    async triggerPlaceBet(
      isManualTrigger = false,
      isHotkey = false,
      stakeAlreadyPrepared = false,
      fastMode = false,
      explicitStake = null,
    ) {
      try {
        const ensureLicense =
          typeof ensureGatilhoBRLicense === "function"
            ? ensureGatilhoBRLicense
            : window.ensureGatilhoBRLicense;
        const hotLicense = typeof window.getHotLicenseSnapshot === "function"
          ? window.getHotLicenseSnapshot()
          : null;
        const license = hotLicense || (ensureLicense ? await ensureLicense() : null);
        if (!license?.valid && window.FastTriggerExternalElectronMode !== true) return false;

        if (explicitStake != null && explicitStake !== "") {
          window.FastTriggerExpectedExecutionStake = explicitStake;
        }
        const config = window.FastTriggerConfig || {};
        const stakeValue =
          explicitStake ||
          window.FastTriggerExpectedExecutionStake ||
          (config.stakeValByHouse && config.stakeValByHouse.betmgm) ||
          config.stakeVal ||
          "0.50";
        const fastDispatch =
          fastMode ||
          isHotkey ||
          window.FastTriggerState?.backgroundDispatchInProgress === true;
        let stakePrepared = stakeAlreadyPrepared;

        if (!stakeAlreadyPrepared) {
          let root = findBetslipRoot();
          if (!root) {
            root = await waitFor(
              () => findBetslipRoot(),
              fastDispatch ? 650 : 1100,
            );
          }

          let input = findStakeInput(root);
          let presetInput = findStakeInput(root, true);
          const rootIsToggle = Boolean(
            root?.matches?.('button, [role="button"]') && !root.querySelector("input"),
          );

          if (!root || rootIsToggle) {
            const toggle = findBetslipToggle();
            if (toggle && typeof toggle.click === "function") {
              toggle.click();
              root = await waitFor(() => findBetslipRoot(), fastDispatch ? 700 : 1200);
              input = findStakeInput(root);
              presetInput = findStakeInput(root, true);
            }
          }

          if (input) {
            const targetNumeric = parseStake(stakeValue);
            const currentNumeric = parseStake(readStakeInputValue(input));
            if (
              Number.isFinite(targetNumeric) &&
              Number.isFinite(currentNumeric) &&
              Math.abs(targetNumeric - currentNumeric) < 0.01
            ) {
              stakePrepared = true;
            } else {
              input.focus?.();
              input.click?.();
              setStakeValue(input, stakeValue);
              const accepted = await waitFor(() => {
                const liveInput = findStakeInput(findBetslipRoot(), true);
                const liveValue = parseStake(readStakeInputValue(liveInput));
                return liveInput &&
                  Number.isFinite(targetNumeric) &&
                  Number.isFinite(liveValue) &&
                  Math.abs(targetNumeric - liveValue) < 0.01
                  ? liveInput
                  : null;
              }, fastDispatch ? 500 : 1100);
              stakePrepared = Boolean(accepted);
            }
          } else if (presetInput) {
            // A MGM pode render o valor predefinido como input readonly/disabled.
            // Não tentamos sobrescrevê-lo; basta deixar o CTA da casa validar.
            const presetNumeric = parseStake(readStakeInputValue(presetInput));
            stakePrepared = Number.isFinite(presetNumeric) && presetNumeric > 0;
          }
        }

        if (window.FastTriggerState?.deferDynamicBindSubmit === true) {
          if (stakePrepared) return true;
          const liveRoot = findBetslipRoot();
          const hasEditableStake = Boolean(findStakeInput(liveRoot));
          // Com stake predefinida, o CTA pode só aparecer depois da validação
          // assíncrona do pick. Deixamos a segunda etapa esperar pelo botão;
          // não abortamos a bind apenas porque ele ainda não foi renderizado.
          return !hasEditableStake && Boolean(liveRoot);
        }

        let autoSubmit = Boolean(isManualTrigger);
        if (
          config.oneClick ||
          config.oneShot ||
          config.autoTriggerDirectBool ||
          config.autoTrigger ||
          config.autoTriggerDirect ||
          config.autoPlaceBet ||
          config.fastTriggerAuto ||
          config.autoBet ||
          config.autoSubmit
        ) {
          autoSubmit = true;
        }
        if (!autoSubmit && typeof window.isOneShotActive === "function") {
          try {
            autoSubmit = Boolean(await window.isOneShotActive());
          } catch (error) {}
        }
        if (!autoSubmit) return Boolean(stakePrepared);

        if (typeof window.resolveOddsChangeBeforeCommit === "function") {
          const oddsChangeResult = await window.resolveOddsChangeBeforeCommit(fastDispatch);
          if (oddsChangeResult?.status === "blocked") return false;
        }

        const root =
          findBetslipRoot() ||
          (await waitFor(
            () => findBetslipRoot(),
            fastDispatch ? 700 : 1300,
          ));
        if (!root) return false;
        const placeButton = await waitFor(
          () => {
            const liveRoot = findBetslipRoot() || root;
            return findPlaceBetButton(liveRoot);
          },
          fastDispatch ? 700 : 1300,
        );
        if (!placeButton) return false;

        // O submit também usa o botão do betslip reconhecido, nunca um botão
        // genérico da página inteira.
        const clicked = await clickPlaceBetButton(placeButton, fastDispatch);
        if (window.FastTriggerState) {
          window.FastTriggerState.lastDynamicBindFinalClickAttempted = clicked;
        }
        return clicked;
      } catch (error) {
        console.error("[BetMGM Adapter] Erro no disparo de aposta:", error);
        return false;
      }
    }
  }

  if (typeof window !== "undefined") {
    window.BetMgmAdapter = BetMgmAdapter;
    window.BetMGMAdapter = BetMgmAdapter;
    window.selectOddsOnBetmgm = (
      targetName,
      targetOddVal,
      marketTitle,
      colIndex,
      rowIndex,
      isHotkey,
      lineName,
      fastMode,
      optionLabel,
      outcomeId,
    ) => {
      const adapter = window.FastTriggerAdapter || new BetMgmAdapter();
      return adapter.selectOddsOnBetmgm(
        targetName,
        targetOddVal,
        marketTitle,
        colIndex,
        rowIndex,
        isHotkey,
        lineName,
        fastMode,
        optionLabel,
        outcomeId,
      );
    };
  }
})();
