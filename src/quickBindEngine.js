// =========================================================================
// FAST TRIGGER PRO - CAPTURADOR DE CONTEXTO HÍBRIDO (JOGADOR E GERAL)
// =========================================================================

var activeBindTarget = null;
var activeBindCaptureCleanup = null;

// 1. Escuta o clique com o botão direito nos elementos de aposta
document.addEventListener(
  "contextmenu",
  (e) => {
    const oddButton = e.target.closest(
      '.sip-SingleMarketScrollerParticipant, [class*="SingleMarketScrollerParticipant"][class*="Participant_General"], .gl-Participant, [class*="ParticipantButton"], [class*="Participant"], [class*="Odds"], button',
    );

    if (!oddButton) return;

    activeBindTarget = extractSelectionContext(oddButton);
    if (
      !activeBindTarget ||
      !activeBindTarget.player ||
      !activeBindTarget.market
    )
      return;

    e.preventDefault();
    e.stopPropagation();

    showQuickBindMenu(e.clientX, e.clientY);
  },
  true,
);

function extractExactMarketHeader(btnEl) {
  if (!btnEl) return "Mercado Geral";

  const titleHelper = window.FastTriggerBet365MarketTitle;
  const closestModernCard =
    window.FastTriggerBet365ModernCards?.closest?.(btnEl) ||
    btnEl.closest('[class~="rrb-5c"]');
  if (closestModernCard && titleHelper?.fromCard) {
    const modernTitle = titleHelper.fromCard(closestModernCard);
    if (modernTitle) return modernTitle;
  }

  // 1. Busca os pods de mercado individuais (excluindo wrappers globais de abas)
  const pods = Array.from(
    document.querySelectorAll(
      '.gl-MarketGroupPod, [class*="MarketGroupPod"], .gl-MarketGroup, [class*="MarketGroup"]',
    ),
  );
  (window.FastTriggerBet365ModernCards?.collect?.(document) || []).forEach(
    (card) => {
      if (!pods.includes(card)) pods.push(card);
    },
  );
  const marketPods = pods.filter(
    (p) =>
      !p.classList.contains("gl-MarketGroup_Wrapper") &&
      !p.className.includes("Wrapper"),
  );

  const directPod = marketPods.find((p) => p.contains(btnEl));
  if (directPod) {
    const titleEl = directPod.querySelector(
      '.gl-MarketGroupButton_Text, .sip-MarketGroupButton_Text, [class*="MarketGroupButton_Text"], ' +
        '[class*="MarketGroupButton_Title"], [class*="HeaderLabel"], [class*="MarketTitle"]',
    );
    if (titleEl && titleEl.innerText) {
      const rawTitle = titleEl.innerText.trim().split("\n")[0];
      return titleHelper?.clean?.(rawTitle) || rawTitle;
    }

    const structuralTitle = titleHelper?.fromCard?.(directPod);
    if (structuralTitle) return structuralTitle;
  }

  // 2. Fallback: Procura o último cabeçalho de mercado posicionado ANTES do botão no DOM
  const allHeaders = Array.from(
    document.querySelectorAll(
      '.gl-MarketGroupButton_Text, .sip-MarketGroupButton_Text, [class*="MarketGroupButton_Text"], [class*="MarketTitle"]',
    ),
  );

  const precedingHeader = allHeaders
    .reverse()
    .find(
      (h) =>
        h.compareDocumentPosition(btnEl) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
  if (precedingHeader && precedingHeader.innerText) {
    const rawTitle = precedingHeader.innerText.trim().split("\n")[0];
    return titleHelper?.clean?.(rawTitle) || rawTitle;
  }

  return "Mercado Geral";
}

function extractSelectionContext(btnEl) {
  const adapter = window.FastTriggerAdapter;
  if (adapter && typeof adapter.scrapeClean === "function") {
    try {
      const markets = adapter.scrapeClean() || [];
      for (const market of markets) {
        if (!market || !market.isTable || !Array.isArray(market.tableRows))
          continue;
        for (let rowIndex = 0; rowIndex < market.tableRows.length; rowIndex++) {
          const row = market.tableRows[rowIndex];
          const odds = row.colOdds || row.odds || [];
          for (let colIndex = 0; colIndex < odds.length; colIndex++) {
            const item = odds[colIndex];
            const element = item && item.element;
            if (
              !element ||
              !(
                element === btnEl ||
                element.contains(btnEl) ||
                btnEl.contains(element)
              )
            )
              continue;
            const headerOffset = market.hasLabelsCol === false ? 0 : 1;
            const line =
              item.colHeader ||
              (Array.isArray(market.headers)
                ? market.headers[colIndex + headerOffset]
                : "") ||
              `${colIndex + 1}+`;
            return {
              type: "player",
              player: (row.lineLabel || "").trim(),
              line: line.toString().trim(),
              selection: `${row.lineLabel || ""} - ${line}`.trim(),
              market: (market.title || "").trim(),
              rowIndex,
              colIndex,
            };
          }
        }
      }
    } catch (error) {
      console.warn(
        "[Fast Trigger Binds] Falha ao capturar a seleção normalizada:",
        error,
      );
    }
  }

  const marketName = extractExactMarketHeader(btnEl);
  const parentPod = btnEl.closest(
    '[class*="MarketGroupPod"], [class*="MarketGroup"]',
  );

  // CASO A0: Grid horizontal Gen5 (jogador nas linhas, 1+/2+/3+ nas colunas)
  const hScrollCell = btnEl.closest(".gl-ParticipantOddsOnly");
  const hScrollColumn = hScrollCell?.closest(".srb-HScrollPlaceColumnMarket");
  const hScrollPlayerColumn = parentPod?.querySelector(
    ".srb-HScrollParticipantMarket",
  );

  if (hScrollCell && hScrollColumn && hScrollPlayerColumn && parentPod) {
    const columns = Array.from(
      parentPod.querySelectorAll(".srb-HScrollPlaceColumnMarket"),
    );
    const cells = Array.from(
      hScrollColumn.querySelectorAll(".gl-ParticipantOddsOnly"),
    );
    const players = Array.from(
      hScrollPlayerColumn.querySelectorAll(".srb-ParticipantLabelWithTeam"),
    ).filter((node) => node.offsetWidth > 0 || node.offsetHeight > 0);

    const rowIndex = cells.indexOf(hScrollCell);
    const colIndex = columns.indexOf(hScrollColumn);
    const playerNode = players[rowIndex];
    const playerName = playerNode
      ? (
          playerNode.querySelector(".srb-ParticipantLabelWithTeam_Name")
            ?.innerText ||
          playerNode.innerText ||
          ""
        ).trim()
      : "";
    const lineName = (
      hScrollColumn.querySelector(".srb-HScrollPlaceHeader")?.innerText ||
      `${colIndex + 1}+`
    ).trim();

    return {
      type: "player",
      player: playerName,
      line: lineName,
      selection: `${playerName ? playerName + " - " : ""}${lineName}`,
      market: marketName,
      rowIndex: rowIndex >= 0 ? rowIndex : 0,
      colIndex: colIndex >= 0 ? colIndex : 0,
    };
  }

  // CASO A: Lista Horizontal de Jogadores (sip-)
  const sipOption = btnEl.closest(
    '.sip-SingleMarketScrollerParticipant, [class*="SingleMarketScrollerParticipant"][class*="Participant_General"]',
  );
  if (sipOption) {
    const parentRow = sipOption.closest(
      '.sip-MarketLabelForSingleRow, [class*="MarketLabelForSingleRow"]',
    );
    const headerNode = parentRow?.querySelector(
      '.sip-MarketColumnHeaderWithCount, [class*="MarketColumnHeaderWithCount"]',
    );
    const rawHeader = headerNode ? headerNode.innerText.trim() : "";
    const playerName = rawHeader.replace(/\s+\d+$/, "").trim();
    const lineName =
      sipOption
        .querySelector('[class*="ScrollerParticipant_Name"]')
        ?.innerText.trim() || sipOption.innerText.trim();

    const parentSipRows = parentPod
      ? Array.from(
          parentPod.querySelectorAll(
            '.sip-MarketLabelForSingleRow, [class*="MarketLabelForSingleRow"]',
          ),
        )
      : [];
    const rIdx = parentSipRows.indexOf(parentRow);
    const scrollerOpts = parentRow
      ? Array.from(
          parentRow.querySelectorAll(
            '.sip-SingleMarketScrollerParticipant, [class*="SingleMarketScrollerParticipant"][class*="Participant_General"]',
          ),
        )
      : [];
    const cIdx = scrollerOpts.indexOf(sipOption);

    return {
      type: "player",
      player: playerName,
      line: lineName,
      selection: `${playerName ? playerName + " - " : ""}${lineName}`,
      market: marketName,
      rowIndex: rIdx >= 0 ? rIdx : 0,
      colIndex: cIdx >= 0 ? cIdx : 0,
    };
  }

  // CASO B: Tabela de Colunas da Bet365 (gl-Market_General-haslabels, como Multi Marcadores, Escanteios, etc.)
  const labelCol = parentPod?.querySelector(
    '.gl-Market_General-haslabels, [class*="haslabels"]',
  );
  if (labelCol && parentPod) {
    const colunas = Array.from(
      parentPod.querySelectorAll('.gl-Market, [class*="Market_General"]'),
    );
    const oddCols = Array.from(
      parentPod.querySelectorAll(
        '.gl-Market_General-columnheader, [class*="columnheader"]',
      ),
    ).filter((col) => col !== labelCol);
    const finalOddCols =
      oddCols.length > 0 ? oddCols : colunas.filter((col) => col !== labelCol);

    const targetColIdx = finalOddCols.findIndex((col) => col.contains(btnEl));
    const targetCol = targetColIdx >= 0 ? finalOddCols[targetColIdx] : null;

    if (targetCol) {
      const targetBtn =
        btnEl.closest('.gl-Participant, [class*="Participant"]') || btnEl;
      const botoesOdd = Array.from(targetCol.children).filter((item) => {
        const text = item.innerText ? item.innerText.trim() : "";
        const isHeader =
          item.classList.contains("gl-MarketColumnHeader") ||
          item.classList.contains("sip-StartingPlayersMarketHeader") ||
          item.classList.contains("sip-MarketHeaderLabel");
        return text !== "" && !isHeader;
      });

      const itemIdx = botoesOdd.indexOf(targetBtn);

      const itensLinha = Array.from(labelCol.children).filter((item) => {
        const text = item.innerText ? item.innerText.trim() : "";
        const isHeader =
          item.classList.contains("gl-MarketColumnHeader") ||
          item.classList.contains("sip-StartingPlayersMarketHeader") ||
          item.classList.contains("sip-MarketHeaderLabel");
        return text !== "" && !isHeader;
      });

      const playerItem =
        itemIdx >= 0 && itemIdx < itensLinha.length
          ? itensLinha[itemIdx]
          : null;
      const playerName = playerItem
        ? playerItem.innerText.trim().replace(/\s+\d+$/, "")
        : "";
      const selectionText = (btnEl.innerText || btnEl.textContent || "").trim();

      return {
        type: "player",
        player: playerName,
        line: selectionText,
        selection: `${playerName ? playerName + " - " : ""}${selectionText}`,
        market: marketName,
        rowIndex: itemIdx >= 0 ? itemIdx : 0,
        colIndex: targetColIdx >= 0 ? targetColIdx : 0,
      };
    }
  }

  // CASO C: Tabela Vertical Padrão com Nome na Linha (ParticipantRow)
  const parentRow = btnEl.closest(
    '[class*="ParticipantRow"], [class*="gl-ParticipantRow"], tr',
  );
  const playerEl = parentRow?.querySelector(
    '.gl-ParticipantSelectButton_Name, .gl-ParticipantBorderless_Name, .gl-Participant_Name, [class*="ParticipantSelectButton_Name"], [class*="Participant_Name"], [class*="ParticipantBorderless_Name"], [class*="Name"]',
  );
  const rawPlayerName = playerEl
    ? playerEl.innerText
        .trim()
        .replace(/\s+\d+$/, "")
        .trim()
    : "";

  if (rawPlayerName && parentRow) {
    const selectionText = (btnEl.innerText || btnEl.textContent || "").trim();
    return {
      type: "player",
      player: rawPlayerName,
      line: selectionText,
      selection: `${rawPlayerName} (${selectionText})`,
      market: marketName,
    };
  }

  // CASO D: Mercado Geral Genérico (Tentar separar Nome e Linha/Odd se presentes no botão)
  const nameNode =
    btnEl.querySelector('[class*="Name"], [class*="Label"]') ||
    btnEl
      .closest('[class*="Participant"]')
      ?.querySelector('[class*="Name"], [class*="Label"]');
  const oddsNode =
    btnEl.querySelector(
      '[class*="Odds"], [class*="Value"], [class*="Price"]',
    ) ||
    btnEl
      .closest('[class*="Participant"]')
      ?.querySelector('[class*="Odds"], [class*="Value"], [class*="Price"]');

  const extractedName = nameNode ? nameNode.innerText.trim() : "";
  const extractedOdd = oddsNode ? oddsNode.innerText.trim() : "";

  const rawSelectionText = (btnEl.innerText || btnEl.textContent || "")
    .replace(/\n/g, " ")
    .trim();

  return {
    type: extractedName ? "player" : "generic",
    player: extractedName,
    line: extractedOdd || rawSelectionText,
    selection: extractedName
      ? `${extractedName} (${extractedOdd || rawSelectionText})`
      : rawSelectionText,
    market: marketName,
  };
}

// 2. Exibe o Tooltip Flutuante na Posição do Mouse
function showQuickBindMenu(x, y) {
  const oldMenu = document.getElementById("ft-quick-bind-pop");
  if (oldMenu) oldMenu.remove();
  if (activeBindCaptureCleanup) activeBindCaptureCleanup();

  const pop = document.createElement("div");
  pop.id = "ft-quick-bind-pop";
  pop.style.cssText = `
    position: fixed;
    top: ${y + 5}px;
    left: ${x + 5}px;
    z-index: 999999;
    background: #0d1117;
    border: 1px solid #00e676;
    border-radius: 8px;
    padding: 10px 14px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.8);
    color: #fff;
    font-family: sans-serif;
    font-size: 12px;
  `;

  const eventTeams = Array.isArray(window.FastTriggerEventContext?.teams)
    ? window.FastTriggerEventContext.teams.filter(Boolean).slice(0, 4)
    : [];
  const canSaveSafely = !!(
    activeBindTarget &&
    activeBindTarget.player &&
    activeBindTarget.market &&
    eventTeams.length
  );

  pop.innerHTML = `
    <div style="font-weight: bold; color: #00e676; margin-bottom: 4px;">⚡ GATILHO BR - VINCULAR ATALHO</div>
    <div style="color: #8b949e; margin-bottom: 8px;">
      ${activeBindTarget.market ? "[" + activeBindTarget.market + "] " : ""}${activeBindTarget.player ? activeBindTarget.player + " - " : ""}${activeBindTarget.selection}
    </div>
    <label style="display:block; margin-bottom:7px; color:#8b949e;">
      Time da regra
      <select id="ft-bind-team" style="display:block; width:100%; margin-top:3px; padding:6px; color:#fff; background:#161b22; border:1px solid #30363d; border-radius:5px;">
        ${eventTeams.map((team) => `<option value="${team.replace(/"/g, "&quot;")}">${team}</option>`).join("")}
      </select>
    </label>
    <label style="display:block; margin-bottom:8px; color:#8b949e;">
      Linha
      <select id="ft-bind-line-mode" style="display:block; width:100%; margin-top:3px; padding:6px; color:#fff; background:#161b22; border:1px solid #30363d; border-radius:5px;">
        <option value="first_available">Automática — primeira aberta</option>
        <option value="exact">Exata — ${activeBindTarget.line || "linha selecionada"}</option>
      </select>
    </label>
    <div id="ft-bind-status" style="background: #161b22; padding: 6px; border-radius: 4px; text-align: center; color: #f0f6fc;">
      ${canSaveSafely ? "Pressione uma letra, número ou F1–F12" : "Não foi possível confirmar jogo, mercado e jogador."}
    </div>
  `;

  document.body.appendChild(pop);
  if (window.FastTriggerState)
    window.FastTriggerState.bindingCaptureInProgress = true;

  const finishBindingCapture = () => {
    if (window.FastTriggerState)
      window.FastTriggerState.bindingCaptureInProgress = false;
    window.removeEventListener("keydown", handleKeyBind, true);
    if (activeBindCaptureCleanup === finishBindingCapture)
      activeBindCaptureCleanup = null;
  };
  activeBindCaptureCleanup = finishBindingCapture;

  const handleKeyBind = async (e) => {
    if (
      window.FastTriggerState &&
      window.FastTriggerState.nativeTextEntryInProgress
    ) {
      return;
    }

    if (!canSaveSafely) return;
    const allowed =
      /^Key[A-Z]$/.test(e.code) ||
      /^Digit[0-9]$/.test(e.code) ||
      /^Numpad[0-9]$/.test(e.code) ||
      /^F(?:[1-9]|1[0-2])$/.test(e.code);
    if (!allowed) return;

    e.preventDefault();
    e.stopImmediatePropagation();

    const boundCode = e.code;
    const label = e.code.replace("Key", "").replace("Digit", "Nº ");
    const selectedTeam = pop.querySelector("#ft-bind-team")?.value || "";
    const lineMode =
      pop.querySelector("#ft-bind-line-mode")?.value === "exact"
        ? "exact"
        : "first_available";

    let saveResult;
    try {
      saveResult = await saveQuickPreset(boundCode, {
        ...activeBindTarget,
        team: selectedTeam,
        lineMode,
      });
    } catch (error) {
      console.error(
        "[Fast Trigger Binds] Falha ao salvar atalho contextual:",
        error,
      );
      saveResult = {
        success: false,
        reason: "não foi possível salvar o atalho",
      };
    }

    const statusEl = document.getElementById("ft-bind-status");
    if (statusEl) {
      statusEl.innerText = saveResult.success
        ? `✅ Salvo na Tecla: ${label}`
        : `⚠️ ${saveResult.reason}`;
      statusEl.style.color = saveResult.success ? "#00e676" : "#fca5a5";
    }

    setTimeout(() => pop.remove(), saveResult.success ? 1000 : 2400);
    finishBindingCapture();
  };

  window.addEventListener("keydown", handleKeyBind, true);

  setTimeout(() => {
    window.addEventListener("click", function closePop(e) {
      if (!pop.contains(e.target)) {
        pop.remove();
        finishBindingCapture();
        window.removeEventListener("click", closePop);
      }
    });
  }, 100);
}

// 3. Salva a Seleção Vinculada no Chrome Storage
async function saveQuickPreset(keyCode, context) {
  if (typeof chrome === "undefined" || !chrome.storage?.local) {
    return { success: false, reason: "armazenamento indisponível" };
  }

  const scoped = window.gbrUserScopedStorage;
  if (!scoped)
    return { success: false, reason: "sessao da conta indisponivel" };
  const [localData, syncData] = await Promise.all([
    scoped.get("local", ["dynamicPlayerBinds", "fastTriggerHotkey"]),
    scoped.get("sync", { triggerKeyStr: "Space" }),
  ]);
  const globalHotkeyCode =
    typeof localData.fastTriggerHotkey === "string"
      ? localData.fastTriggerHotkey
      : localData.fastTriggerHotkey?.code;
  if (globalHotkeyCode === keyCode || syncData.triggerKeyStr === keyCode) {
    return { success: false, reason: "tecla usada pelo disparo geral" };
  }

  const binds = localData.dynamicPlayerBinds || {};
  const host = window.location.hostname.toLowerCase();
  const house = host.includes("betfair")
    ? "betfair"
    : host.includes("betnacional")
      ? "betnacional"
      : host.includes("betano")
        ? "betano"
      : "bet365";
  const storageKey = `${house}:${keyCode}`;
  const legacyKeyEntry =
    !binds[storageKey] && binds[keyCode]?.house === house
      ? binds[keyCode]
      : null;
  const existingValue = binds[storageKey] || legacyKeyEntry;
  const existingEntries = Array.isArray(existingValue)
    ? existingValue.filter(Boolean)
    : existingValue
      ? [existingValue]
      : [];
  const nextEntry = {
    keyCode,
    house,
    targetType: "player_line",
    team: (context.team || "").toString().trim(),
    market: (context.market || "").toString().trim(),
    player: (context.player || "").toString().trim(),
    lineMode: context.lineMode === "exact" ? "exact" : "first_available",
    line:
      context.lineMode === "exact"
        ? (context.line || "").toString().trim()
        : "",
    source: "site_capture",
    eventLabel: (window.FastTriggerEventContext?.eventLabel || "")
      .toString()
      .trim(),
    createdAt: Date.now(),
  };
  const normalize = (value) => (value || "").toString().trim().toLowerCase();
  const sameRule = (entry) =>
    entry &&
    normalize(entry.house) === house &&
    normalize(entry.team) === normalize(nextEntry.team) &&
    normalize(entry.market) === normalize(nextEntry.market) &&
    normalize(entry.player) === normalize(nextEntry.player) &&
    normalize(entry.lineMode) === normalize(nextEntry.lineMode) &&
    normalize(entry.line) === normalize(nextEntry.line);
  const replacementIndex = existingEntries.findIndex(sameRule);
  if (replacementIndex >= 0) {
    nextEntry.id =
      existingEntries[replacementIndex].id ||
      `${storageKey}:${replacementIndex}`;
    existingEntries[replacementIndex] = nextEntry;
  } else {
    existingEntries.push(nextEntry);
  }

  binds[storageKey] =
    existingEntries.length === 1 ? existingEntries[0] : existingEntries;
  if (legacyKeyEntry) delete binds[keyCode];
  await scoped.set("local", { dynamicPlayerBinds: binds });
  console.log(
    `[Fast Trigger] 🎯 Atalho contextual [${house}:${keyCode}] salvo:`,
    binds[storageKey],
  );
  return { success: true, replaced: replacementIndex >= 0 };
}
