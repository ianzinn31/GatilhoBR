// =========================================================================
// GATILHOBR - ÍNDICE LOCAL INCREMENTAL DE ALVOS DE MERCADO
// =========================================================================

(function () {
  "use strict";

  if (typeof window === "undefined") return;

  const entries = new Map();
  const snapshotEntries = new Map();
  const MAX_ENTRIES = 600;
  const MAX_SNAPSHOT_MARKETS = 600;
  const MAX_SNAPSHOT_ELEMENTS_PER_MARKET = 80;
  let hitCount = 0;
  let missCount = 0;
  let invalidationCount = 0;
  let snapshotUpdatedAt = 0;
  let snapshotRevision = 0;
  // Contador de ondas que só mexeram em preço. Serve de telemetria e deixa
  // explícito para o consumidor que o valor guardado pode estar um tique atrás
  // do DOM — a odd é relida da célula na hora de resolver a bind.
  let priceRevision = 0;

  function isElement(value) {
    return Boolean(
      value &&
        typeof value === "object" &&
        Number(value.nodeType) === 1 &&
        typeof value.isConnected === "boolean",
    );
  }

  function collectElements(value, depth = 0, result = [], visited = new Set()) {
    if (
      result.length >= MAX_SNAPSHOT_ELEMENTS_PER_MARKET ||
      depth > 6 ||
      value === null ||
      value === undefined
    ) {
      return result;
    }

    if (isElement(value)) {
      if (!result.includes(value)) result.push(value);
      return result;
    }

    if (typeof value !== "object" || visited.has(value)) return result;
    visited.add(value);

    if (Array.isArray(value)) {
      value.slice(0, 120).forEach((item) =>
        collectElements(item, depth + 1, result, visited),
      );
      return result;
    }

    // Os grupos normalizados usam estes campos para chegar às células. Não
    // percorremos propriedades arbitrárias para não guardar objetos grandes
    // nem referências de runtime que não fazem parte do mercado.
    [
      "element",
      "targetElement",
      "marketRoot",
      "root",
      "marketEl",
      "elements",
      "participants",
      "selections",
      "odds",
      "colOdds",
      "tableRows",
      "rows",
    ].forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        collectElements(value[key], depth + 1, result, visited);
      }
    });

    return result;
  }

  function normalizeSnapshotKey(value) {
    return (value || "")
      .toString()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 160);
  }

  function getSnapshotKey(market, index) {
    const base = normalizeSnapshotKey(
      market?.marketKey ||
        market?.canonicalKey ||
        market?.title ||
        market?.marketId ||
        `market-${index}`,
    );
    return `${base || `market-${index}`}::${index}`;
  }

  function rebuild(markets) {
    snapshotEntries.clear();
    if (!Array.isArray(markets)) {
      snapshotUpdatedAt = Date.now();
      snapshotRevision += 1;
      return;
    }

    markets.slice(0, MAX_SNAPSHOT_MARKETS).forEach((market, index) => {
      if (!market || typeof market !== "object") return;
      const key = getSnapshotKey(market, index);
      snapshotEntries.set(key, {
        market,
        elements: collectElements(market),
        updatedAt: Date.now(),
      });
    });
    snapshotUpdatedAt = Date.now();
    snapshotRevision += 1;
  }

  function getMarkets() {
    const markets = [];
    for (const [key, entry] of snapshotEntries) {
      const connectedElements = (entry.elements || []).filter(
        (element) => element?.isConnected,
      );
      if (entry.elements?.length > 0 && connectedElements.length === 0) {
        snapshotEntries.delete(key);
        invalidationCount += 1;
        continue;
      }
      markets.push(entry.market);
    }
    return markets;
  }

  function noteMiss() {
    missCount += 1;
  }

  function remember(key, resolved) {
    if (!key || !resolved?.success || !resolved.targetElement?.isConnected) {
      return;
    }

    entries.set(String(key), {
      resolved,
      element: resolved.targetElement,
      marketTitle: resolved.marketTitle || "",
      selectionKey: [resolved.targetName || "", resolved.line || ""].join("|")
        .toLowerCase(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    while (entries.size > MAX_ENTRIES) {
      entries.delete(entries.keys().next().value);
    }
  }

  function get(key, validator) {
    const entry = entries.get(String(key));
    if (!entry) {
      missCount += 1;
      return null;
    }

    if (!entry.element?.isConnected) {
      entries.delete(String(key));
      missCount += 1;
      return null;
    }

    if (typeof validator === "function" && !validator(entry.resolved, entry)) {
      entries.delete(String(key));
      missCount += 1;
      return null;
    }

    entry.updatedAt = Date.now();
    hitCount += 1;
    return entry.resolved;
  }

  const MUTATION_ANCESTOR_WALK_LIMIT = 80;

  // Um tique de preço troca texto dentro da célula; não move, não remove e não
  // recria o elemento. Tratar isso como invalidação limparia o índice a cada
  // atualização de odd — e numa aba com dezenas de mercados abertos isso é
  // constante, o que obriga a bind a pagar uma raspagem completa só para achar
  // o mercado. Só mutação estrutural derruba entrada.
  function isPriceOnlyMutation(mutation) {
    if (!mutation) return false;
    if (mutation.type === "characterData") return true;
    if (mutation.type !== "childList") return false;
    const added = mutation.addedNodes || [];
    const removed = mutation.removedNodes || [];
    if (added.length === 0 && removed.length === 0) return true;
    for (let i = 0; i < added.length; i += 1) {
      if (Number(added[i]?.nodeType) === 1) return false;
    }
    for (let i = 0; i < removed.length; i += 1) {
      if (Number(removed[i]?.nodeType) === 1) return false;
    }
    return true;
  }

  // O teste antigo era `target.contains(element) || element.contains(target)`
  // para cada par (entrada, mutação): com 600 entradas e uma onda de centenas
  // de mutações isso vira milhões de caminhadas de árvore por onda. Aqui a
  // vizinhança é montada uma única vez e cada entrada faz uma subida própria.
  function buildMutationScope(mutations) {
    const targets = new Set();
    const containers = new Set();
    const removed = new Set();
    let rootMutated = false;

    for (const mutation of mutations) {
      const target = mutation?.target;
      if (target) {
        if (
          target === document ||
          target === document.documentElement ||
          target === document.body
        ) {
          rootMutated = true;
        } else {
          targets.add(target);
        }
        let node = target;
        let depth = 0;
        while (node && depth < MUTATION_ANCESTOR_WALK_LIMIT) {
          if (containers.has(node)) break;
          containers.add(node);
          node = node.parentNode;
          depth += 1;
        }
      }
      const removedNodes = mutation?.removedNodes;
      if (removedNodes?.length) {
        for (let i = 0; i < removedNodes.length; i += 1) {
          if (removedNodes[i]) removed.add(removedNodes[i]);
        }
      }
    }

    return { targets, containers, removed, rootMutated };
  }

  function isElementTouched(element, scope) {
    if (!element) return false;
    // Mutação no próprio elemento ou dentro dele: o elemento é ancestral de
    // algum alvo, então está na vizinhança montada acima.
    if (scope.containers.has(element)) return true;
    // Mutação em um ancestral, inclusive remoção da subárvore inteira.
    let node = element;
    let depth = 0;
    while (node && depth < MUTATION_ANCESTOR_WALK_LIMIT) {
      if (scope.targets.has(node) || scope.removed.has(node)) return true;
      node = node.parentNode;
      depth += 1;
    }
    return false;
  }

  function invalidateMutations(mutations) {
    if (!Array.isArray(mutations) || mutations.length === 0) {
      return;
    }
    if (entries.size === 0 && snapshotEntries.size === 0) {
      return;
    }

    const structural = mutations.filter(
      (mutation) => !isPriceOnlyMutation(mutation),
    );
    if (structural.length < mutations.length) {
      priceRevision += 1;
    }
    if (structural.length === 0) {
      return;
    }

    const scope = buildMutationScope(structural);

    for (const [key, entry] of entries) {
      const element = entry.element;
      if (!element?.isConnected) {
        entries.delete(key);
        invalidationCount += 1;
        continue;
      }
      if (isElementTouched(element, scope)) {
        entries.delete(key);
        invalidationCount += 1;
      }
    }

    for (const [key, entry] of snapshotEntries) {
      const elements = entry.elements || [];
      if (elements.length > 0 && elements.every((element) => !element?.isConnected)) {
        snapshotEntries.delete(key);
        invalidationCount += 1;
        continue;
      }
      if (
        scope.rootMutated ||
        elements.some((element) => isElementTouched(element, scope))
      ) {
        snapshotEntries.delete(key);
        invalidationCount += 1;
      }
    }
  }

  function invalidateAll() {
    invalidationCount += entries.size + snapshotEntries.size;
    entries.clear();
    snapshotEntries.clear();
  }

  function stats() {
    return {
      size: entries.size,
      hitCount,
      missCount,
      invalidationCount,
      snapshotSize: snapshotEntries.size,
      snapshotUpdatedAt,
      snapshotRevision,
      priceRevision,
    };
  }

  window.FastTriggerMarketIndex = {
    rebuild,
    getMarkets,
    noteMiss,
    remember,
    get,
    invalidateMutations,
    invalidateAll,
    stats,
  };
})();
