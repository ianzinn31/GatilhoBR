// =========================================================================
// FAST TRIGGER PRO - PARSER E SCRAPER DE MERCADOS BET365 (VERSÃO ESTÁVEL)
// =========================================================================

function isSelectionLocked(element, isPodSuspended) {
  if (isPodSuspended) return true;
  if (!element) return false;

  if (
    element.classList.contains("gl-Participant_Suspended") ||
    element.classList.contains("gl-ParticipantOddsOnly_Suspended") ||
    element.classList.contains("gl-ParticipantBorderless_Suspended") ||
    element.classList.contains("gl-ParticipantCenteredStacked_Suspended") ||
    element.classList.contains("disabled")
  ) {
    return true;
  }

  if (
    element.closest(
      ".gl-Participant_Suspended, .gl-ParticipantOddsOnly_Suspended, .gl-ParticipantBorderless_Suspended, .gl-ParticipantCenteredStacked_Suspended",
    )
  ) {
    return true;
  }

  const lockIcon = element.querySelector(
    '.gl-Participant_Lock, [class*="Participant_Lock"], [class*="ParticipantOddsOnly_Lock"]',
  );
  if (lockIcon && lockIcon.offsetWidth > 0) {
    return true;
  }

  const oddsEl = element.querySelector(
    '.gl-Participant_Odds, .gl-ParticipantOddsOnly_Odds, .srb-ParticipantResponsiveText_Odds, [class*="Odds"]',
  );
  if (oddsEl) {
    const txt = oddsEl.innerText ? oddsEl.innerText.trim() : "";
    if (!txt || txt === "" || txt === "-") return true;
  } else {
    const fullTxt = element.innerText ? element.innerText.trim() : "";
    if (!fullTxt || !/\d/.test(fullTxt)) return true;
  }

  return false;
}

function getMarketGridRoot() {
  return (
    document.querySelector(
      '.ipe-EventViewDetail_MarketGrid, .ipe-EventViewDetail_ContentContainer, .ipe-EventViewDetail, [class*="MarketGrid"], [class*="EventViewDetail"], [class*="ContentContainer"]',
    ) || document.body
  );
}

const bet365MarketStructureCache = new Map();
const bet365SuspendedMarketTitles = new Set();
let bet365MarketCacheContext = "";

function getBet365MarketContextKey() {
  const href =
    typeof window !== "undefined" && window.location
      ? window.location.href
      : "";
  const eventMatch = href.match(/\bEV\d+\b/i);
  return eventMatch ? eventMatch[0].toUpperCase() : href;
}

function cloneBet365Market(market) {
  try {
    return JSON.parse(
      JSON.stringify(market, (key, value) =>
        key === "element" ? undefined : value,
      ),
    );
  } catch (e) {
    return null;
  }
}

function lockBet365MarketSnapshot(market) {
  const snapshot = cloneBet365Market(market);
  if (!snapshot) return null;

  const lockItem = (item) => ({
    ...item,
    odds: "🔒 FECHADO",
    val: "🔒",
    isClosed: true,
    status: "LOCKED",
  });

  if (Array.isArray(snapshot.tableRows)) {
    snapshot.tableRows = snapshot.tableRows.map((row) => {
      const lockedOdds = (row.colOdds || row.odds || []).map(lockItem);
      return { ...row, colOdds: lockedOdds, odds: lockedOdds };
    });
    snapshot.rows = snapshot.tableRows.map((row) => ({
      label: row.lineLabel || "",
      odds: row.colOdds,
    }));
  }
  if (Array.isArray(snapshot.participants)) {
    snapshot.participants = snapshot.participants.map(lockItem);
  }
  if (Array.isArray(snapshot.selections)) {
    snapshot.selections = snapshot.selections.map(lockItem);
  }

  snapshot.isSuspended = true;
  return snapshot;
}

// A Bet365 passou a entregar parte da página com uma árvore de componentes
// `rrb-*`/`rgl-*`, sem as classes semânticas `gl-*` usadas no layout anterior.
// Mantemos o parser antigo para as páginas legadas e tratamos esse layout novo
// por estrutura. A Bet365 troca os sufixos `rrb-*` com frequência (`rrb-5c`,
// `rrb-c9`, ...), então o card é o menor ancestral que reúne um cabeçalho
// anterior e a sua grade `rgl-Market`.
function isBet365ModernCard(element) {
  const cardHelper = window.FastTriggerBet365ModernCards;
  if (typeof cardHelper?.isCard === "function") {
    return cardHelper.isCard(element);
  }

  return (
    element &&
    typeof element.className === "string" &&
    /(?:^|\s)rrb-5c(?:\s|$)/.test(element.className)
  );
}

function isBet365ModernVisible(element) {
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
  } catch (e) {
    return true;
  }
}

function getBet365ModernText(element) {
  return (element?.innerText || element?.textContent || "")
    .replace(/\s+/g, " ")
    .trim();
}

function getBet365ModernTitle(card) {
  const titleHelper = window.FastTriggerBet365MarketTitle;
  if (titleHelper?.fromCard) {
    return titleHelper.fromCard(card);
  }

  const header = card?.querySelector('[role="button"]') || card?.firstElementChild;
  const titleNode = header?.querySelector("span");
  const title = getBet365ModernText(titleNode);
  if (title && !/^(ca|criar aposta|substituicao\+|substituição\+)$/i.test(title)) {
    return title;
  }

  return getBet365ModernText(header)
    .split(/\n+/)
    .map((line) => line.trim())
    .find(
      (line) =>
        line &&
        !/^(ca|criar aposta|substituicao\+|substituição\+|pagamento antecipado|acum\. aumentado)$/i.test(
          line,
        ),
    ) || "";
}

function getBet365ModernOdds(element) {
  if (!element) return "";
  const oddsNode = element.querySelector(
    '[class*="rgl-4a5de5"], [class*="ParticipantOdds"], [class*="Odds"], [class*="Value"]',
  );
  const raw = getBet365ModernText(oddsNode);
  const match = raw.match(/\d+(?:[\.,]\d+)?/);
  return match ? match[0].replace(",", ".") : "";
}

function getBet365ModernLabel(element) {
  if (!element) return "";

  const labelNode = element.querySelector(
    '[class*="rgl-c1e976"], [class*="rgl-9de85c"], [class*="rrd-41f"], [class*="rrd-fd9"], [class*="rrd-2b"], [class*="rrd-1"], [class*="rrd-11"], [class*="rrb-f4"], [class*="rrb-7f"]',
  );
  const label = getBet365ModernText(labelNode);
  if (label) return label;

  const leaf = Array.from(element.querySelectorAll("span, div"))
    .filter((node) => node.children.length === 0)
    .map((node) => getBet365ModernText(node))
    .find(
      (text) =>
        text &&
        !/^\d+(?:[\.,]\d+)?$/.test(text) &&
        !/^(ca|criar aposta|substituicao\+|substituição\+)$/i.test(text),
    );
  return leaf || "";
}

function makeBet365ModernSelection(name, odds, element, colHeader, rawName) {
  const className = typeof element?.className === "string" ? element.className : "";
  const locked =
    !odds ||
    /suspended|disabled|d3e321/i.test(className) ||
    element?.getAttribute?.("aria-disabled") === "true";
  const displayVal = locked ? "🔒" : odds;

  return {
    colHeader: colHeader || "",
    name: name || colHeader || rawName || "Seleção",
    rawName: rawName || name || colHeader || "Seleção",
    odds: locked ? "🔒 FECHADO" : displayVal,
    val: displayVal,
    isClosed: locked,
    status: locked ? "LOCKED" : "OPEN",
    element: element || null,
  };
}

function getBet365ModernMarketLayouts(card) {
  const marketElements = Array.from(
    card.querySelectorAll('[class*="rgl-Market"]'),
  ).filter(isBet365ModernVisible);
  const layouts = [];
  const grouped = new Set();

  // No layout atual, a Bet365 pode manter a coluna de rótulos/jogadores fora
  // do scroller que contém as colunas de odds. Agrupar apenas irmãos diretos
  // separa jogador e linhas (1+, 2+, 3+) em mercados distintos. Partimos da
  // coluna sem odds e subimos até o menor ancestral que reúne a tabela inteira.
  const labelColumns = marketElements.filter((market) => {
    const className = typeof market.className === "string" ? market.className : "";
    if (!/(?:^|\s)rgl-[^\s]*b0d626(?:\s|$)/.test(className)) return false;
    return !Array.from(market.children).some((child) =>
      Boolean(getBet365ModernOdds(child)),
    );
  });

  labelColumns.forEach((labelColumn) => {
    if (grouped.has(labelColumn)) return;

    let container = labelColumn.parentElement;
    let layout = [labelColumn];
    while (container && container !== card.parentElement) {
      const descendants = marketElements.filter((market) =>
        container.contains(market),
      );
      if (descendants.length > 1) {
        const currentLabelIndex = descendants.indexOf(labelColumn);
        const nextLabelIndex = descendants.findIndex(
          (market, index) =>
            index > currentLabelIndex && labelColumns.includes(market),
        );
        layout = descendants.slice(
          Math.max(0, currentLabelIndex),
          nextLabelIndex >= 0 ? nextLabelIndex : descendants.length,
        );
        break;
      }
      if (container === card) break;
      container = container.parentElement;
    }

    layout.forEach((item) => grouped.add(item));
    layouts.push(layout);
  });

  marketElements.forEach((market) => {
    if (grouped.has(market)) return;
    const siblings = market.parentElement
      ? Array.from(market.parentElement.children).filter(
          (child) =>
            typeof child.className === "string" &&
            /(?:^|\s)rgl-[^\s]*Market[^\s]*(?:\s|$)/.test(child.className) &&
            isBet365ModernVisible(child),
        )
      : [];
    const layout = siblings.length > 1 ? siblings : [market];
    layout.forEach((item) => grouped.add(item));
    layouts.push(layout);
  });

  return layouts;
}

function parseBet365ModernFlatGrid(grid) {
  const items = [];
  Array.from(grid.children).forEach((row, rowIndex) => {
    const odds = getBet365ModernOdds(row);
    if (!odds) return;

    const label = getBet365ModernLabel(row) || `Seleção ${rowIndex + 1}`;
    items.push(makeBet365ModernSelection(label, odds, row, label, label));
  });
  return items;
}

function parseBet365ModernColumnLayout(columns) {
  const oddsColumns = columns.filter(
    (column) =>
      Array.from(column.children).some((child) => Boolean(getBet365ModernOdds(child))) ||
      Boolean(getBet365ModernOdds(column)),
  );
  if (oddsColumns.length === 0) return { items: [], tableRows: [], headers: [] };

  const firstColumn = columns.find((column) => !oddsColumns.includes(column)) || columns[0];
  const firstColumnChildren = Array.from(firstColumn.children);
  const labelCells = firstColumnChildren.slice(
    firstColumnChildren.length > 1 && !getBet365ModernOdds(firstColumnChildren[0])
      ? 1
      : 0,
  );
  const rowLabels = labelCells.map((cell) => getBet365ModernLabel(cell));

  const parsedColumns = oddsColumns.map((column) => {
    const children = Array.from(column.children);
    const startIndex = children.length > 0 && !getBet365ModernOdds(children[0]) ? 1 : 0;
    return {
      header: getBet365ModernLabel(children[0]) || getBet365ModernLabel(column),
      cells: children.slice(startIndex),
    };
  });

  const rowCount = Math.max(
    rowLabels.length,
    ...parsedColumns.map((column) => column.cells.length),
  );
  const tableRows = [];
  const selections = [];

  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const lineLabel = rowLabels[rowIndex] || "";
    const colOdds = [];

    parsedColumns.forEach((column) => {
      const cell = column.cells[rowIndex] || null;
      if (!cell) return;
      const odds = getBet365ModernOdds(cell);
      const colHeader = column.header || `Coluna ${colOdds.length + 1}`;
      const name = [lineLabel, colHeader].filter(Boolean).join(" ");
      const item = makeBet365ModernSelection(
        name,
        odds,
        cell,
        colHeader,
        lineLabel || colHeader,
      );
      colOdds.push(item);
      selections.push(item);
    });

    if (colOdds.length > 0) {
      tableRows.push({
        lineLabel,
        colOdds,
        odds: colOdds,
      });
    }
  }

  return {
    items: selections,
    tableRows,
    headers: [
      getBet365ModernLabel(firstColumnChildren[0]) || "Linha",
      ...parsedColumns.map((column) => column.header || "Seleção"),
    ],
  };
}

function parseBet365ModernCard(card) {
  const title = getBet365ModernTitle(card);
  if (!title) return null;

  const layouts = getBet365ModernMarketLayouts(card);
  const participants = [];
  const tableRows = [];
  const headers = [];
  const seenElements = new Set();

  layouts.forEach((layout) => {
    let parsed;
    const isColumnLayout =
      layout.length > 1 &&
      layout.some((column) =>
        /(?:^|\s)rgl-[^\s]*b0d626(?:\s|$)/.test(
          typeof column.className === "string" ? column.className : "",
        ),
      );

    if (isColumnLayout) {
      parsed = parseBet365ModernColumnLayout(layout);
    } else {
      parsed = {
        items: layout.flatMap((grid) => parseBet365ModernFlatGrid(grid)),
        tableRows: [],
        headers: [],
      };
    }

    (parsed.items || []).forEach((item) => {
      if (item.element && seenElements.has(item.element)) return;
      if (item.element) seenElements.add(item.element);
      participants.push(item);
    });
    if (parsed.tableRows?.length) tableRows.push(...parsed.tableRows);
    if (parsed.headers?.length) headers.push(...parsed.headers);
  });

  if (participants.length === 0) return null;

  const isTable = tableRows.length > 0;
  return {
    title,
    marketAliases:
      window.FastTriggerBet365MarketTitle?.aliasesFromCard?.(card) || [title],
    isTable,
    isPlayerMarket: /marcador|jogador|player|chute|assist|gol/i.test(title),
    hasLabelsCol: isTable,
    headers: headers.length
      ? headers
      : participants.map((item) => item.colHeader).filter(Boolean),
    tableRows,
    rows: tableRows.map((row) => ({ label: row.lineLabel, odds: row.colOdds })),
    participants,
    selections: participants,
    isSuspended: participants.every((item) => item.isClosed),
  };
}

function scrapeBet365Clean(root) {
  const targetRoot = root || getMarketGridRoot() || document.body;
  if (!targetRoot) return [];

  const contextKey = getBet365MarketContextKey();
  if (contextKey !== bet365MarketCacheContext) {
    bet365MarketCacheContext = contextKey;
    bet365MarketStructureCache.clear();
    bet365SuspendedMarketTitles.clear();
  }

  const modernCards =
    window.FastTriggerBet365ModernCards?.collect?.(targetRoot) ||
    Array.from(targetRoot.querySelectorAll('[class~="rrb-5c"]')).filter(
      (card) =>
        isBet365ModernCard(card) &&
        !card.parentElement?.closest('[class~="rrb-5c"]'),
    );
  const pods = Array.from(
    targetRoot.querySelectorAll(
      '.gl-MarketGroupPod, [class*="MarketGroupPod"]',
    ),
  );
  const marketPods =
    modernCards.length > 0
      ? modernCards
      : pods.length > 0
      ? pods
      : Array.from(
          targetRoot.querySelectorAll(
            '.gl-MarketGroup, .cm-CouponMarketGroup, [class*="MarketGroup"]:not([class*="MarketGroupButton"])',
          ),
        );

  const seenTitles = new Set();
  const results = [];
  const currentlySuspendedTitles = new Set();

  marketPods.forEach((pod) => {
    try {
      if (!pod) return;

      const modernCard = isBet365ModernCard(pod);
      const titleEl =
        pod.querySelector(
          '.gl-MarketGroupButton_Text, .sip-MarketGroupButton_Text, [class*="MarketGroupButton_Text"], [class*="MarketTitle"], ' +
            ".sc-MarketGroupButtonWithStats, .cm-MarketGroupWithIconsButton, .srb-ButtonWithBetBuilderIcon",
        ) || pod.firstElementChild;
      if (!titleEl) return;

      const rawTitle = modernCard
        ? getBet365ModernTitle(pod)
        : titleEl.innerText || titleEl.textContent || "";
      const title = modernCard
        ? rawTitle
        : window.FastTriggerBet365MarketTitle?.clean?.(
            rawTitle.trim().split("\n")[0],
          ) || rawTitle.trim().split("\n")[0];
      if (!title || seenTitles.has(title)) return;

      const podText = (pod.innerText || pod.textContent || "").toLowerCase();
      const explicitPodSuspension =
        pod.classList.contains("gl-MarketGroupPod_Suspended") ||
        pod.classList.contains("gl-MarketGroup_Suspended") ||
        pod.querySelector(".gl-MarketGroupButton_Suspended") !== null ||
        pod.querySelector(
          '[class*="MarketGroup"][class*="Suspended"], [class*="MarketGroupButton"][class*="Suspended"]',
        ) !== null ||
        podText.includes("mercado suspenso") ||
        podText.includes("market suspended");
      const podParticipants = Array.from(
        pod.querySelectorAll(
          ".sip-SingleMarketScrollerParticipant, .gl-ParticipantOddsOnly, .gl-Participant_General",
        ),
      );
      const allVisibleSelectionsLocked =
        podParticipants.length > 0 &&
        podParticipants.every((participant) =>
          isSelectionLocked(participant, false),
        );
      const isPodSuspended =
        explicitPodSuspension || allVisibleSelectionsLocked;

      if (isPodSuspended) {
        currentlySuspendedTitles.add(title);
        bet365SuspendedMarketTitles.add(title);
      }

      // Mercados recolhidos continuam ignorados. Mercados suspensos, mesmo com
      // o corpo temporariamente oculto pela Bet365, são reconciliados pelo cache.
      if (pod.offsetWidth === 0 && pod.offsetHeight === 0 && !isPodSuspended)
        return;

      if (modernCard) {
        const modernMarket = parseBet365ModernCard(pod);
        if (modernMarket) {
          seenTitles.add(title);
          if (modernMarket.isSuspended) {
            currentlySuspendedTitles.add(title);
            bet365SuspendedMarketTitles.add(title);
          }
          results.push(modernMarket);
        }
        return;
      }

      // 0.5. NOVO GRID HORIZONTAL DE JOGADORES (Bet365 Gen5)
      // Uma coluna contém os jogadores e cada srb-HScrollPlaceColumnMarket
      // representa 1+, 2+, 3+ etc., com as células alinhadas pelo índice.
      const hScrollPlayerCol = pod.querySelector(
        ".srb-HScrollParticipantMarket",
      );
      const hScrollOddsCols = Array.from(
        pod.querySelectorAll(".srb-HScrollPlaceColumnMarket"),
      );

      if (hScrollPlayerCol && hScrollOddsCols.length > 0) {
        const playerNodes = Array.from(
          hScrollPlayerCol.querySelectorAll(".srb-ParticipantLabelWithTeam"),
        ).filter((node) => node.offsetWidth > 0 || node.offsetHeight > 0);

        const playerNames = playerNodes
          .map((node) => {
            const nameEl = node.querySelector(
              ".srb-ParticipantLabelWithTeam_Name",
            );
            return nameEl ? nameEl.innerText.trim() : "";
          })
          .filter(Boolean);

        const headers = hScrollOddsCols.map((col, index) => {
          const headerEl = col.querySelector(".srb-HScrollPlaceHeader");
          return headerEl ? headerEl.innerText.trim() : `${index + 1}+`;
        });

        const columnCells = hScrollOddsCols.map((col) =>
          Array.from(col.querySelectorAll(".gl-ParticipantOddsOnly")),
        );

        const tableRows = [];
        const selections = [];

        playerNames.forEach((playerName, rowIndex) => {
          const colOdds = [];

          columnCells.forEach((cells, colIndex) => {
            const cell = cells[rowIndex] || null;
            const colHeader = headers[colIndex] || `${colIndex + 1}+`;
            const locked =
              !cell ||
              isPodSuspended ||
              isSelectionLocked(cell, isPodSuspended);
            const oddsEl = cell?.querySelector(
              '.gl-ParticipantOddsOnly_Odds, [class*="ParticipantOddsOnly_Odds"]',
            );
            const rawOdds = oddsEl ? oddsEl.innerText.trim() : "";
            const oddsMatch = rawOdds.match(/(\d+[\.,]\d+|\d+)/);
            const odds = oddsMatch ? oddsMatch[0].replace(",", ".") : "";
            const displayVal = locked ? "🔒" : odds || "-";

            const item = {
              colHeader: colHeader,
              name: `${playerName} ${colHeader}`,
              rawName: colHeader,
              odds: locked ? "🔒 FECHADO" : displayVal,
              val: displayVal,
              isClosed: locked,
              status: locked ? "LOCKED" : "OPEN",
              element: cell,
            };

            colOdds.push(item);
            selections.push(item);
          });

          if (colOdds.length > 0) {
            tableRows.push({
              lineLabel: playerName,
              colOdds: colOdds,
              odds: colOdds,
            });
          }
        });

        if (tableRows.length > 0) {
          seenTitles.add(title);
          results.push({
            title: title,
            isTable: true,
            isPlayerMarket: true,
            hasLabelsCol: true,
            headers: ["Jogador", ...headers],
            tableRows: tableRows,
            rows: tableRows.map((row) => ({
              label: row.lineLabel,
              odds: row.colOdds,
            })),
            participants: selections,
            selections: selections,
          });
          return;
        }
      }

      // 1. MERCADOS HORIZONTAIS SIP DE JOGADORES (.sip-MarketLabelForSingleRow)
      const sipRows = Array.from(
        pod.querySelectorAll(
          '.sip-MarketLabelForSingleRow, [class*="MarketLabelForSingleRow"]',
        ),
      );

      if (sipRows.length > 0) {
        const tableRows = [];
        const selections = [];
        const headerLabelsSet = new Set();

        sipRows.forEach((row) => {
          const headerNode = row.querySelector(
            '.sip-MarketColumnHeaderWithCount, [class*="MarketColumnHeaderWithCount"]',
          );
          const playerNameNode = headerNode?.querySelector(
            '.sip-MarketColumnHeaderWithCount_Name, [class*="MarketColumnHeaderWithCount_Name"]',
          );
          const fullHeaderText = headerNode
            ? headerNode.innerText.trim().replace(/\s+/g, " ")
            : "";
          const playerMatch = fullHeaderText.match(/^(.*?)(?:\s+(\d+))?$/);
          const playerName =
            playerNameNode?.innerText?.trim() ||
            (playerMatch ? playerMatch[1].trim() : fullHeaderText);
          const currentCount =
            playerMatch && playerMatch[2] ? playerMatch[2] : "";

          const displayPlayerLabel =
            currentCount !== ""
              ? `${playerName} (${currentCount})`
              : playerName;
          // Somente o cartão principal representa uma seleção. O seletor antigo
          // também capturava os filhos *_Name e *_Odds, criando odds fantasmas.
          const options = Array.from(
            row.querySelectorAll(
              '.sip-SingleMarketScrollerParticipant, [class*="SingleMarketScrollerParticipant"][class*="Participant_General"]',
            ),
          );
          const colOdds = [];
          const seenLines = new Set();

          options.forEach((opt, optionIndex) => {
            const lineNode = opt.querySelector(
              '.sip-SingleMarketScrollerParticipant_Name, [class*="ScrollerParticipant_Name"]',
            );
            const rawOdds =
              opt
                .querySelector(
                  '.sip-SingleMarketScrollerParticipant_Odds, [class*="ScrollerParticipant_Odds"]',
                )
                ?.innerText.trim() || "";
            const isLocked = isSelectionLocked(opt, isPodSuspended);
            const oddsMatch = rawOdds.match(/\d+(?:[\.,]\d+)?/);
            const oddsVal = oddsMatch ? oddsMatch[0].replace(",", ".") : "";

            // A Bet365 pode remover temporariamente o rótulo da linha quando a
            // célula está suspensa ou acabou de ser montada pela virtualização.
            // Preserve a célula: ela ainda é um alvo válido para first_available
            // e pode voltar a receber o rótulo depois do scroll/foco.
            const optionText = (opt.innerText || opt.textContent || "")
              .split("\n")
              .map((value) => value.trim())
              .filter(Boolean);
            const lineName =
              lineNode?.innerText?.trim() ||
              optionText.find(
                (value) =>
                  value !== rawOdds && !/^\d+(?:[\.,]\d+)?$/.test(value),
              ) ||
              opt.getAttribute("aria-label")?.trim() ||
              opt.getAttribute("title")?.trim() ||
              "";

            if (
              (lineName && seenLines.has(lineName)) ||
              (!oddsVal && !isLocked)
            )
              return;
            if (lineName) {
              seenLines.add(lineName);
              headerLabelsSet.add(lineName);
            }

            const displayVal = isLocked ? "🔒" : oddsVal;

            const item = {
              colHeader: lineName,
              name: lineName
                ? `${playerName} ${lineName}`.trim()
                : playerName,
              rawName: displayPlayerLabel,
              odds: isLocked ? "🔒 FECHADO" : displayVal,
              val: displayVal,
              isClosed: isLocked,
              status: isLocked ? "LOCKED" : "OPEN",
              element: opt,
              columnIndex: optionIndex,
              lineLabelAvailable: Boolean(lineName),
            };

            colOdds.push(item);
            selections.push(item);
          });

          if (colOdds.length > 0) {
            tableRows.push({
              lineLabel: displayPlayerLabel,
              colOdds: colOdds,
              odds: colOdds,
            });
          }
        });

        if (tableRows.length > 0) {
          seenTitles.add(title);
          const headersArr = [
            "Jogador/Contagem",
            ...Array.from(headerLabelsSet),
          ];
          results.push({
            title: title,
            isTable: true,
            isPlayerMarket: true,
            hasLabelsCol: true,
            headers: headersArr,
            tableRows: tableRows,
            rows: tableRows.map((r) => ({
              label: r.lineLabel,
              odds: r.colOdds,
            })),
            participants: selections,
            selections: selections,
          });
          return;
        }
      }

      // 1.5. MERCADOS DE ESTATÍSTICAS / CHUTES DE JOGADORES VIA FLEXBOX POR COLUNAS (.gl-MarketGroupContainer + .gl-Market_General)
      const playerStatsContainer = pod.querySelector(
        '.gl-MarketGroupContainer, [class*="MarketGroupContainer"]',
      );
      if (
        playerStatsContainer ||
        pod.querySelector(
          '.sip-PlayerParticipant_Name, [class*="PlayerParticipant_Name"]',
        )
      ) {
        const container = playerStatsContainer || pod;
        // As classes auxiliares `gl-Market_General-cn1` aparecem também nos
        // jogadores e nas células. Apenas os filhos diretos com a classe exata
        // `gl-Market_General` representam colunas reais do mercado.
        const directCols = Array.from(container.children).filter((el) =>
          el.classList.contains("gl-Market_General"),
        );
        const cols =
          directCols.length > 0
            ? directCols
            : Array.from(container.querySelectorAll(".gl-Market_General"));

        if (cols.length > 1) {
          const playerCol = cols[0];
          const playerCells = Array.from(playerCol.children).filter((el) =>
            el.classList.contains("sip-PlayerParticipant"),
          );

          const playerNames = playerCells
            .map((el) => {
              const nameNode =
                el.querySelector(".sip-PlayerParticipant_Name") || el;
              return nameNode.innerText.trim();
            })
            .filter(Boolean);

          if (playerNames.length > 0) {
            const oddsCols = cols.slice(1);
            const colHeaders = oddsCols.map((col, idx) => {
              const headerEl = col.querySelector(
                '.gl-MarketColumnHeader, .sip-MarketHeaderLabel, [class*="MarketColumnHeader"], [class*="ColumnHeader"]',
              );
              return headerEl ? headerEl.innerText.trim() : `${idx + 1}+`;
            });

            const tableRows = [];
            const selections = [];

            playerNames.forEach((playerName, pIdx) => {
              const colOdds = [];

              oddsCols.forEach((col, cIdx) => {
                const colHeader = colHeaders[cIdx] || `${cIdx + 1}+`;
                const participantCells = Array.from(col.children).filter(
                  (cell) =>
                    cell.classList.contains("gl-ParticipantOddsOnly") ||
                    cell.classList.contains("gl-Participant_General"),
                );

                const targetCell = participantCells[pIdx];
                let oddsVal = "";
                let isLocked = isPodSuspended;

                if (targetCell) {
                  const oddsEl =
                    targetCell.querySelector(
                      '.sip-PlayerParticipant_Odds, .gl-ParticipantOddsOnly_Odds, .gl-Participant_Odds, [class*="Participant_Odds"], [class*="Odds"]',
                    ) || targetCell;
                  oddsVal = oddsEl ? oddsEl.innerText.trim() : "";
                  if (oddsVal) {
                    const match = oddsVal.match(/(\d+\.\d+|\d+,\d+|\d+)/);
                    if (match) oddsVal = match[0].replace(",", ".");
                  }
                  isLocked = isLocked || isSelectionLocked(targetCell);
                }

                const displayVal = isLocked ? "🔒" : oddsVal || "-";
                const item = {
                  colHeader: colHeader,
                  name: `${playerName} ${colHeader}`.trim(),
                  rawName: playerName,
                  odds: isLocked ? "🔒 FECHADO" : displayVal,
                  val: displayVal,
                  isClosed: isLocked,
                  status: isLocked ? "LOCKED" : "OPEN",
                  element: targetCell || null,
                };

                colOdds.push(item);
                selections.push(item);
              });

              if (colOdds.length > 0) {
                tableRows.push({
                  lineLabel: playerName,
                  colOdds: colOdds,
                  odds: colOdds,
                });
              }
            });

            if (tableRows.length > 0) {
              seenTitles.add(title);
              const headersArr = ["Jogador", ...colHeaders];
              results.push({
                title: title,
                isTable: true,
                isPlayerMarket: true,
                hasLabelsCol: true,
                headers: headersArr,
                tableRows: tableRows,
                rows: tableRows.map((r) => ({
                  label: r.lineLabel,
                  odds: r.colOdds,
                })),
                participants: selections,
                selections: selections,
              });
              return;
            }
          }
        }
      }

      // 2. DETECTA SE É UM MERCADO COM COLUNAS EXPLICITAS (Handicaps, 1X2, Over/Under, Resultado Final)
      const columnHeaders = Array.from(
        pod.querySelectorAll(
          '.gl-MarketColumnHeader, .sip-MarketHeaderLabel, [class*="MarketColumnHeader"], [class*="ColumnHeader"]',
        ),
      )
        .map((h) => h.innerText.trim())
        .filter((txt) => txt !== "");

      const marketColumnsContainer =
        pod.querySelector(".gl-MarketGroupContainer") || pod;
      const directMarketColumns = Array.from(
        marketColumnsContainer.children,
      ).filter(
        (el) =>
          el.classList.contains("gl-Market") ||
          el.classList.contains("gl-Market_General"),
      );
      const marketColumns =
        directMarketColumns.length > 0
          ? directMarketColumns
          : Array.from(pod.querySelectorAll(".gl-Market, .gl-Market_General"));

      // 2. DETECTA SE É UM MERCADO COM COLUNAS DE RÓTULOS (Marcadores de Gol, Jogadores, Handicaps)
      const labelCol = pod.querySelector(
        '.gl-Market_General-haslabels, [class*="haslabels"]',
      );

      if (labelCol) {
        // Restringe às colunas filhas diretas do contêiner para não raspar sub-mercados aninhados (evita a 'sopa de letrinhas' de 28 colunas)
        const container = labelCol.parentElement || pod;
        const directCols = Array.from(container.children).filter((el) =>
          el.classList.contains("gl-Market_General"),
        );
        const allCols =
          directCols.length > 0
            ? directCols
            : Array.from(pod.querySelectorAll(".gl-Market_General"));
        const oddCols = allCols.filter(
          (col) =>
            col !== labelCol &&
            !col.classList.contains("gl-Market_General-haslabels"),
        );

        // Extrai o cabeçalho exato de cada coluna de odds (ex: "1º", "A Qualquer Momento")
        const headers = oddCols.map((col, idx) => {
          const head = col.querySelector(
            '.gl-MarketColumnHeader, [class*="ColumnHeader"]',
          );
          return head
            ? head.innerText.trim()
            : columnHeaders[idx] || (idx === 0 ? "1º" : "A Qualquer Momento");
        });

        const rawLabels = Array.from(labelCol.children);
        const tableRows = [];
        const selections = [];

        rawLabels.forEach((labelNode, rowIndex) => {
          const rawText = labelNode.innerText ? labelNode.innerText.trim() : "";

          const isSectionHeader =
            labelNode.classList.contains("sip-StartingPlayersMarketHeader") ||
            labelNode.classList.contains("gl-MarketHeaderLabel") ||
            labelNode.classList.contains("gl-MarketColumnHeader") ||
            rawText === "";

          if (isSectionHeader || !rawText) return;

          // LIMPEZA EXATA DO NOME: Isola o nome real descartando número da camisa e minutos (ex: "9\nAlan Kardec\n60'" -> "Alan Kardec")
          const nameParts = rawText
            .split("\n")
            .map((p) => p.trim())
            .filter((p) => p !== "");
          const cleanName =
            nameParts.find(
              (p) =>
                !/^\d+$/.test(p) &&
                !p.includes("'") &&
                !p.includes("↑") &&
                !p.includes("↓"),
            ) ||
            nameParts[0] ||
            rawText;

          const rowOdds = [];

          oddCols.forEach((col, colIdx) => {
            const cell = col.children[rowIndex];
            if (cell) {
              const oddsEl =
                cell.querySelector(
                  '.gl-ParticipantOddsOnly_Odds, .gl-Participant_Odds, [class*="Odds"]',
                ) || cell;
              let odds = oddsEl ? oddsEl.innerText.trim() : "";

              if (odds) {
                const match = odds.match(/(\d+[\.,]\d+|\d+)/);
                if (match) odds = match[0].replace(",", ".");
              }

              const locked =
                isPodSuspended ||
                cell.classList.contains("gl-ParticipantOddsOnly_Suspended") ||
                cell.querySelector(".gl-Participant_Suspended") !== null ||
                isSelectionLocked(cell) ||
                (odds === "" && !isSectionHeader);

              const headerText =
                headers[colIdx] || (colIdx === 0 ? "1º" : "A Qualquer Momento");
              const displayVal = locked ? "🔒" : odds || "-";

              const item = {
                colHeader: headerText,
                name: `${headerText} ${cleanName}`.trim(),
                rawName: cleanName,
                odds: locked ? "🔒 FECHADO" : displayVal,
                val: displayVal,
                isClosed: locked,
                status: locked ? "LOCKED" : "OPEN",
                element: cell,
              };

              rowOdds.push(item);
              selections.push(item);
            }
          });

          if (rowOdds.length > 0) {
            tableRows.push({
              lineLabel: cleanName,
              colOdds: rowOdds,
              odds: rowOdds,
            });
          }
        });

        if (tableRows.length > 0) {
          seenTitles.add(title);
          const isPlayerMarket = /marcador|jogador|player|marcar/i.test(title);
          const finalHeaders = ["Jogador", ...headers];

          results.push({
            title: title,
            isTable: true,
            isPlayerMarket: isPlayerMarket,
            hasLabelsCol: true,
            headers: finalHeaders,
            tableRows: tableRows,
            rows: tableRows.map((r) => ({
              label: r.lineLabel,
              odds: r.colOdds,
            })),
            participants: selections,
            selections: selections,
          });
          return;
        }
      }

      // 3. ESTRUTURA DE COLUNAS DE HANDICAP E LINHAS DE 3 OPÇÕES (sem rótulo lateral)
      if (columnHeaders.length > 0 && marketColumns.length > 0) {
        const headers = columnHeaders;
        const matrix = marketColumns.map((col, colIdx) => {
          const cells = Array.from(
            col.querySelectorAll(
              '.gl-Participant_General, .gl-ParticipantOddsOnly, .gl-ParticipantBorderless, .gl-ParticipantCenteredStacked, .srb-ParticipantResponsiveText, [class*="Participant"]',
            ),
          ).filter((el) => {
            const isHeader = el.closest(
              '.gl-MarketGroupButton, .sip-MarketGroupButton, [class*="Header"], [class*="MarketTitle"]',
            );
            const hasSubParticipant = el.querySelector(
              ".gl-Participant_General, .gl-ParticipantOddsOnly, .gl-ParticipantBorderless, .gl-ParticipantCenteredStacked, .srb-ParticipantResponsiveText",
            );
            return !isHeader && !hasSubParticipant;
          });

          return cells.map((cell) => {
            const nameEl = cell.querySelector(
              '.srb-ParticipantResponsiveText_Name, .gl-Participant_Name, [class*="Participant_Name"], [class*="Name"]',
            );
            const oddsEl = cell.querySelector(
              '.srb-ParticipantResponsiveText_Odds, .gl-Participant_Odds, .gl-ParticipantOddsOnly_Odds, [class*="ParticipantResponsiveText_Odds"], [class*="Participant_Odds"], [class*="Odds"], [class*="Value"]',
            );

            let name = nameEl ? nameEl.innerText.trim() : "";
            let odds = oddsEl ? oddsEl.innerText.trim() : cell.innerText.trim();
            const locked = isPodSuspended || isSelectionLocked(cell);

            if (name && odds && name.includes(odds)) {
              name = name.replace(odds, "").trim();
            }

            return { name: name, odds: locked ? "🔒" : odds, isLocked: locked };
          });
        });

        const maxRows = Math.max(...matrix.map((col) => col.length));
        const tableRows = [];
        const selections = [];

        for (let r = 0; r < maxRows; r++) {
          const colOdds = [];
          for (let c = 0; c < matrix.length; c++) {
            const cell = matrix[c][r] || {
              name: "-",
              odds: "-",
              isLocked: true,
            };
            const colHeader = headers[c] || `Coluna ${c + 1}`;
            const isClosed = cell.isLocked;
            const displayVal = isClosed ? "🔒" : cell.odds || "-";

            const item = {
              colHeader: colHeader,
              name: cell.name ? `${colHeader} ${cell.name}` : colHeader,
              rawName: cell.name || colHeader,
              odds: isClosed ? "🔒 FECHADO" : displayVal,
              val: displayVal,
              isClosed: isClosed,
              status: isClosed ? "LOCKED" : "OPEN",
            };

            colOdds.push(item);
            selections.push(item);
          }

          if (colOdds.length > 0) {
            tableRows.push({
              lineLabel: "",
              colOdds: colOdds,
              odds: colOdds,
            });
          }
        }

        if (tableRows.length > 0) {
          seenTitles.add(title);
          results.push({
            title: title,
            isTable: true,
            hasLabelsCol: false,
            headers: headers,
            tableRows: tableRows,
            rows: tableRows.map((r) => ({ label: "", odds: r.colOdds })),
            participants: selections,
            selections: selections,
          });
          return;
        }
      }

      // 4. GRID DE OPÇÕES SIMPLES (1x2 Resultado Final, Chance Dupla, Próximo Gol)
      const participantEls = Array.from(
        pod.querySelectorAll(
          ".gl-Participant_General, .gl-ParticipantOddsOnly, .gl-ParticipantBorderless, .gl-ParticipantCenteredStacked, .srb-ParticipantResponsiveText",
        ),
      ).filter((el) => {
        const isHeader = el.closest(
          '.gl-MarketGroupButton, .sip-MarketGroupButton, [class*="Header"], [class*="MarketTitle"]',
        );
        const hasSubParticipant = el.querySelector(
          ".gl-Participant_General, .gl-ParticipantOddsOnly, .gl-ParticipantBorderless, .gl-ParticipantCenteredStacked, .srb-ParticipantResponsiveText",
        );
        return !isHeader && !hasSubParticipant;
      });

      const flatParticipants = [];
      const seenNamesInMarket = new Set();

      participantEls.forEach((cell) => {
        const nameEl = cell.querySelector(
          '.srb-ParticipantResponsiveText_Name, .gl-Participant_Name, .sip-PlayerParticipant_Name, [class*="ParticipantResponsiveText_Name"], [class*="Participant_Name"]',
        );
        const oddsEl = cell.querySelector(
          '.srb-ParticipantResponsiveText_Odds, .gl-Participant_Odds, .gl-ParticipantOddsOnly_Odds, [class*="ParticipantResponsiveText_Odds"], [class*="Participant_Odds"], [class*="Value"]',
        );

        let name = nameEl ? nameEl.innerText.trim() : "";
        let odds = oddsEl ? oddsEl.innerText.trim() : "";

        if (!name || !odds) {
          const fullText = cell.innerText ? cell.innerText.trim() : "";
          if (fullText) {
            const oddsMatch = fullText.match(/(\d+\.\d+|\d+,\d+)/);
            if (oddsMatch) {
              odds = odds || oddsMatch[0].replace(",", ".");
              if (!name) {
                const extractedName = fullText.replace(oddsMatch[0], "").trim();
                name = extractedName !== "" ? extractedName : fullText;
              }
            } else if (!name) {
              name = fullText;
            }
          }
        }

        if (name) {
          if (seenNamesInMarket.has(name)) return;
          seenNamesInMarket.add(name);

          const locked = isPodSuspended || isSelectionLocked(cell);
          const displayVal = locked ? "🔒" : odds;

          flatParticipants.push({
            name: name,
            rawName: name,
            odds: locked ? "🔒 FECHADO" : displayVal,
            val: displayVal,
            isClosed: locked,
            status: locked ? "LOCKED" : "OPEN",
            element: cell,
          });
        }
      });

      if (flatParticipants.length > 0) {
        seenTitles.add(title);
        results.push({
          title: title,
          isTable: false,
          participants: flatParticipants,
          selections: flatParticipants,
        });
      }
    } catch (e) {
      console.error("[Parser] Erro ao raspar mercado individual:", e);
    }
  });

  const reconciledResults = results.map((market) => {
    if (currentlySuspendedTitles.has(market.title)) {
      const cached = bet365MarketStructureCache.get(market.title);
      return lockBet365MarketSnapshot(cached || market) || market;
    }

    const snapshot = cloneBet365Market(market);
    if (snapshot) bet365MarketStructureCache.set(market.title, snapshot);
    bet365SuspendedMarketTitles.delete(market.title);
    return market;
  });

  const renderedTitles = new Set(
    reconciledResults.map((market) => market.title),
  );
  bet365SuspendedMarketTitles.forEach((title) => {
    if (renderedTitles.has(title)) return;
    const cached = bet365MarketStructureCache.get(title);
    const lockedSnapshot = cached ? lockBet365MarketSnapshot(cached) : null;
    if (lockedSnapshot) reconciledResults.push(lockedSnapshot);
  });

  return reconciledResults;
}

if (typeof window !== "undefined") {
  window.isSelectionLocked = isSelectionLocked;
  window.scrapeBet365Clean = scrapeBet365Clean;
}
