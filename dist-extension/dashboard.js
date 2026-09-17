document.addEventListener("DOMContentLoaded", () => {
  const betslipActiveText = document.getElementById("betslipActiveText");
  const dispHotkey = document.getElementById("dispHotkey");
  const dispStakeText = document.getElementById("dispStakeText");
  const marketsContainer = document.getElementById("markets-container");
  const btnFireNow = document.getElementById("btnFireNow");
  const stakeButtons = document.querySelectorAll(".stake-btn");
  const customStakeInput = document.getElementById("custom-stake-input");
  const btnMaxStake = document.getElementById("btn-max-stake");

  let currentStake = "0.50";
  let livePort = null;
  let selectedButtonEl = null;
  let isUpdatingProgrammatically = false;

  function createExplicitUserIntent(actionType) {
    const randomPart =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2);
    return {
      actionId: `${Date.now()}-${randomPart}`,
      issuedAt: Date.now(),
      intentSource: "dashboard_user",
      intentType: actionType,
    };
  }

  // LÓGICA DE ALTERNÂNCIA DE CASAS (BET365 & BETFAIR)
  let selectedHouseMarket = "bet365";
  const marketStatesByHouse = { bet365: null, betfair: null };
  let favoriteMarketsByHouse = { bet365: [], betfair: [] };
  let playerPriorityRules = [];
  let dynamicPlayerBinds = {};
  let isCapturingDynamicBindKey = false;
  let editingDynamicBindStorageKey = "";
  let editingDynamicBindIndex = -1;
  const activeEventContextByHouse = { bet365: null, betfair: null };

  const tabBet365 = document.getElementById("tab-market-bet365");
  const tabBetfair = document.getElementById("tab-market-betfair");
  const playerPriorityForm = document.getElementById("player-priority-form");
  const playerPriorityHouse = document.getElementById("player-priority-house");
  const playerPriorityTeam = document.getElementById("player-priority-team");
  const playerPriorityMarket = document.getElementById(
    "player-priority-market",
  );
  const playerPriorityPlayer = document.getElementById(
    "player-priority-player",
  );
  const playerPriorityList = document.getElementById("player-priority-list");
  const playerPriorityCount = document.getElementById("player-priority-count");
  const playerPriorityStatus = document.getElementById(
    "player-priority-status",
  );
  const playerPriorityTeams = document.getElementById("player-priority-teams");
  const playerPriorityMarkets = document.getElementById(
    "player-priority-markets",
  );
  const playerPriorityPlayers = document.getElementById(
    "player-priority-players",
  );
  const openDynamicBinds = document.getElementById("open-dynamic-binds");
  const closeDynamicBinds = document.getElementById("close-dynamic-binds");
  const dynamicBindsModal = document.getElementById("dynamic-binds-modal");
  const dynamicBindForm = document.getElementById("dynamic-bind-form");
  const dynamicBindKey = document.getElementById("dynamic-bind-key");
  const dynamicBindHouse = document.getElementById("dynamic-bind-house");
  const dynamicBindTeam = document.getElementById("dynamic-bind-team");
  const dynamicBindMarket = document.getElementById("dynamic-bind-market");
  const dynamicBindPlayer = document.getElementById("dynamic-bind-player");
  const dynamicBindLine = document.getElementById("dynamic-bind-line");
  const dynamicBindLiveState = document.getElementById(
    "dynamic-bind-live-state",
  );
  const dynamicBindPreview = document.getElementById("dynamic-bind-preview");
  const dynamicBindTest = document.getElementById("dynamic-bind-test");
  const dynamicBindCancelEdit = document.getElementById(
    "dynamic-bind-cancel-edit",
  );
  const dynamicBindSave = dynamicBindForm?.querySelector(".dynamic-bind-save");
  const dynamicBindCopyHouse = document.getElementById(
    "dynamic-bind-copy-house",
  );
  const dynamicBindStatus = document.getElementById("dynamic-bind-status");
  const dynamicBindList = document.getElementById("dynamic-bind-list");

  function escapeHtml(value) {
    return (value || "")
      .toString()
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function normalizePlayerRuleText(value) {
    return (value || "")
      .toString()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\(\s*\d+\s*\)$/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .replace(/\s+/g, " ");
  }

  function sanitizePlayerPriorityRules(rawRules) {
    if (!Array.isArray(rawRules)) return [];
    const seen = new Set();
    const result = [];

    rawRules.slice(0, 200).forEach((entry, index) => {
      if (!entry || typeof entry !== "object") return;
      const house =
        entry.house === "betfair"
          ? "betfair"
          : entry.house === "betnacional"
            ? "betnacional"
            : entry.house === "betano"
              ? "betano"
              : "bet365";
      const team = (entry.team || "").toString().trim().slice(0, 80);
      const market = (entry.market || "").toString().trim().slice(0, 120);
      const player = (entry.player || "").toString().trim().slice(0, 100);
      if (!team || !market || !player) return;

      const signature = [
        normalizePlayerRuleText(house),
        normalizePlayerRuleText(team),
        canonicalPlayerMarketTitle(market) || normalizePlayerRuleText(market),
        normalizePlayerRuleText(player),
      ].join("|");
      if (seen.has(signature)) return;
      seen.add(signature);
      result.push({
        id: (entry.id || `player-rule-${Date.now()}-${index}`)
          .toString()
          .slice(0, 120),
        house,
        team,
        market,
        player,
      });
    });

    return result;
  }

  function isAllowedDynamicBindKey(code) {
    return (
      /^Key[A-Z]$/.test(code) ||
      /^Digit[0-9]$/.test(code) ||
      /^Numpad[0-9]$/.test(code) ||
      /^F(?:[1-9]|1[0-2])$/.test(code)
    );
  }

  function formatDynamicBindKey(code) {
    if (/^Key[A-Z]$/.test(code)) return code.slice(3);
    if (/^Digit[0-9]$/.test(code)) return code.slice(5);
    if (/^Numpad[0-9]$/.test(code)) return `Num ${code.slice(6)}`;
    return code || "Escolher tecla";
  }

  function dynamicBindStorageKey(house, keyCode) {
    const normalizedHouse =
      house === "betfair"
        ? "betfair"
        : house === "betnacional"
          ? "betnacional"
          : house === "betano"
            ? "betano"
            : "bet365";
    return `${normalizedHouse}:${keyCode}`;
  }

  function sanitizeDynamicPlayerBinds(rawBinds) {
    if (!rawBinds || typeof rawBinds !== "object" || Array.isArray(rawBinds))
      return {};
    const result = {};

    Object.entries(rawBinds)
      .slice(0, 120)
      .forEach(([rawCode, rawValue]) => {
        const entries = Array.isArray(rawValue) ? rawValue : [rawValue];
        entries.forEach((entry, entryIndex) => {
          if (!entry || typeof entry !== "object") return;
          const rawCodeFallback = rawCode.includes(":")
            ? rawCode.split(":").pop()
            : rawCode;
          const keyCode = (entry.keyCode || rawCodeFallback || "").toString();
          if (!isAllowedDynamicBindKey(keyCode)) return;
          const house = entry.house === "betfair" ? "betfair" : "bet365";
          const team = (entry.team || "").toString().trim().slice(0, 80);
          const market = (entry.market || "").toString().trim().slice(0, 120);
          const player = (entry.player || "").toString().trim().slice(0, 100);
          if (!team || !market || !player) return;
          const requestedLine = (entry.line || "")
            .toString()
            .trim()
            .slice(0, 40);
          const hasExactLine =
            entry.lineMode === "exact" &&
            !!requestedLine &&
            requestedLine.length <= 40;
          const storageKey = dynamicBindStorageKey(house, keyCode);
          const normalized = {
            id: (entry.id || `${storageKey}:${entryIndex}`)
              .toString()
              .slice(0, 120),
            keyCode,
            house,
            team,
            market,
            player,
            lineMode: hasExactLine ? "exact" : "first_available",
            line: hasExactLine ? requestedLine : "",
            source: entry.source === "site_capture" ? "site_capture" : "guided",
            eventLabel: (entry.eventLabel || "")
              .toString()
              .trim()
              .slice(0, 180),
            createdAt: Number(entry.createdAt) || Date.now(),
          };
          const previous = result[storageKey];
          result[storageKey] = previous
            ? [...(Array.isArray(previous) ? previous : [previous]), normalized]
            : normalized;
        });
      });

    return result;
  }

  function showDynamicBindStatus(message, isError = false) {
    if (!dynamicBindStatus) return;
    dynamicBindStatus.textContent = message;
    dynamicBindStatus.classList.toggle("is-error", isError);
    dynamicBindStatus.style.display = message ? "block" : "none";
  }

  function showDashboardBindFeedback(message, isError = false) {
    let feedback = document.getElementById("dashboard-bind-feedback");
    if (!feedback) {
      feedback = document.createElement("div");
      feedback.id = "dashboard-bind-feedback";
      feedback.className = "dashboard-bind-feedback";
      document.body.appendChild(feedback);
    }
    feedback.textContent = message;
    feedback.classList.toggle("is-error", isError);
    feedback.classList.add("is-visible");
    clearTimeout(showDashboardBindFeedback.hideTimer);
    showDashboardBindFeedback.hideTimer = setTimeout(
      () => feedback.classList.remove("is-visible"),
      2600,
    );
  }

  function renderDynamicPlayerBinds() {
    if (!dynamicBindList) return;
    const binds = Object.entries(dynamicPlayerBinds).flatMap(
      ([storageKey, value]) =>
        (Array.isArray(value) ? value : [value]).map((bind, index) => ({
          bind,
          storageKey,
          index,
        })),
    );
    if (binds.length === 0) {
      dynamicBindList.innerHTML =
        '<div class="dynamic-bind-empty">Nenhum atalho contextual configurado.</div>';
      return;
    }

    dynamicBindList.innerHTML = binds
      .map(({ bind, storageKey, index }) => {
        return `
      <div class="dynamic-bind-row">
        <div class="dynamic-bind-keycap">${escapeHtml(formatDynamicBindKey(bind.keyCode))}</div>
        <div class="dynamic-bind-house-tag">${bind.house === "betfair" ? "Betfair" : "Bet365"}</div>
        <div class="dynamic-bind-value" title="${escapeHtml(bind.team)}">${escapeHtml(bind.team)}</div>
        <div class="dynamic-bind-value dynamic-bind-market-cell" title="${escapeHtml(bind.market)}">${escapeHtml(bind.market)}</div>
        <div class="dynamic-bind-value" title="${escapeHtml(bind.player)}"><strong>${escapeHtml(bind.player)}</strong></div>
        <div class="dynamic-bind-mode-tag">${bind.lineMode === "exact" ? `Linha ${escapeHtml(bind.line)}` : "Primeira linha aberta"}</div>
        <div class="dynamic-bind-row-actions">
          <button type="button" class="dynamic-bind-edit" data-bind-id="${escapeHtml(storageKey)}" data-bind-index="${index}" aria-label="Editar atalho ${escapeHtml(formatDynamicBindKey(bind.keyCode))}">Editar</button>
          <button type="button" class="dynamic-bind-remove" data-bind-id="${escapeHtml(storageKey)}" data-key-code="${escapeHtml(bind.keyCode)}" aria-label="Remover atalho ${escapeHtml(formatDynamicBindKey(bind.keyCode))}">×</button>
        </div>
      </div>
    `;
      })
      .join("");
  }

  function getDynamicBindEntry(storageKey, index = 0) {
    const value = dynamicPlayerBinds[storageKey];
    return Array.isArray(value) ? value[index] || null : value || null;
  }

  function leaveDynamicBindEditMode(clearDraft = false) {
    editingDynamicBindStorageKey = "";
    editingDynamicBindIndex = -1;
    if (dynamicBindSave) dynamicBindSave.textContent = "Salvar atalho";
    if (dynamicBindCancelEdit) dynamicBindCancelEdit.hidden = true;
    if (!clearDraft) return;

    if (dynamicBindKey) {
      dynamicBindKey.setAttribute("data-key-code", "");
      dynamicBindKey.textContent = "Escolher tecla";
      dynamicBindKey.classList.remove("has-key", "is-capturing");
    }
    if (dynamicBindCopyHouse) dynamicBindCopyHouse.checked = false;
    updateDynamicBindGuidedOptions();
    updateDynamicBindPreview();
  }

  function closeDynamicBindsModal() {
    if (!dynamicBindsModal) return;
    dynamicBindsModal.hidden = true;
    isCapturingDynamicBindKey = false;
    dynamicBindKey?.classList.remove("is-capturing");
    leaveDynamicBindEditMode(true);
    document.body.style.overflow = "";
  }

  function openDynamicBindsModal() {
    if (!dynamicBindsModal) return;
    if (dynamicBindHouse) dynamicBindHouse.value = selectedHouseMarket;
    updatePlayerPrioritySuggestions(
      marketStatesByHouse[selectedHouseMarket],
      selectedHouseMarket,
    );
    updateDynamicBindGuidedOptions({
      team: playerPriorityTeam?.value || "",
      market: playerPriorityMarket?.value || "",
      player: playerPriorityPlayer?.value || "",
    });
    dynamicBindsModal.hidden = false;
    document.body.style.overflow = "hidden";
    renderDynamicPlayerBinds();
    updateDynamicBindPreview();
  }

  function getEventTeams(house = selectedHouseMarket) {
    const context = activeEventContextByHouse[house] || {};
    const teams = Array.isArray(context.teams) ? context.teams : [];
    return teams
      .map((team) => (team || "").toString().trim())
      .filter(Boolean)
      .slice(0, 4);
  }

  function looselyMatches(left, right) {
    const a = normalizePlayerRuleText(left);
    const b = normalizePlayerRuleText(right);
    if (!a || !b) return false;
    return (
      a === b ||
      (a.length >= 5 && b.includes(a)) ||
      (b.length >= 5 && a.includes(b))
    );
  }

  function canonicalPlayerMarketTitle(value) {
    const text = normalizePlayerRuleText(value);
    const isPlayerMarket = /\b(jogador|jogadores|player|players)\b/.test(text);
    if (!isPlayerMarket) return "";

    const period = /\b(1 tempo|primeiro tempo|1st half)\b/.test(text)
      ? ":h1"
      : /\b(2 tempo|segundo tempo|2nd half)\b/.test(text)
        ? ":h2"
        : "";

    if (/\b(chute|chutes|finalizacao|finalizacoes|shot|shots)\b/.test(text)) {
      const onTarget =
        /\b(ao gol|a gol|no gol|no alvo|a baliza|on target|target)\b/.test(
          text,
        );
      return `${onTarget ? "player_shots_on_target" : "player_shots"}${period}`;
    }
    if (/\b(falta|faltas|foul|fouls)\b/.test(text)) {
      if (/\b(recebida|recebidas|sofrida|sofridas|received)\b/.test(text))
        return `player_fouls_received${period}`;
      if (/\b(cometida|cometidas|committed)\b/.test(text))
        return `player_fouls_committed${period}`;
      return `player_fouls${period}`;
    }
    if (/\b(cartao|cartoes|card|cards)\b/.test(text))
      return `player_cards${period}`;
    if (/\b(desarme|desarmes|tackle|tackles)\b/.test(text))
      return `player_tackles${period}`;
    if (/\b(passe|passes|pass|passing)\b/.test(text))
      return `player_passes${period}`;
    return "";
  }

  function playerMarketTitlesMatch(left, right) {
    const a = normalizePlayerRuleText(left);
    const b = normalizePlayerRuleText(right);
    const aIsPlayer = /\b(jogador|jogadores|player|players)\b/.test(a);
    const bIsPlayer = /\b(jogador|jogadores|player|players)\b/.test(b);
    if (aIsPlayer !== bIsPlayer) return false;

    const familyA = canonicalPlayerMarketTitle(a);
    const familyB = canonicalPlayerMarketTitle(b);
    if (familyA || familyB) return !!familyA && familyA === familyB;
    return looselyMatches(a, b);
  }

  function getLiveMarketsForHouse(house) {
    const state = marketStatesByHouse[house];
    return ((state && (state.groups || state.markets)) || []).filter(
      (market) =>
        market &&
        market.isTable &&
        Array.isArray(market.tableRows) &&
        market.tableRows.length > 0,
    );
  }

  function getGuidedMarket(house, title) {
    return (
      getLiveMarketsForHouse(house).find((market) => market.title === title) ||
      null
    );
  }

  function setSelectOptions(select, values, placeholder, preferredValue = "") {
    if (!select) return "";
    const unique = Array.from(
      new Set(
        values.map((value) => (value || "").toString().trim()).filter(Boolean),
      ),
    );
    const preferred = (preferredValue || "").toString().trim();
    const preferredIsUnavailable = !!preferred && !unique.includes(preferred);
    select.innerHTML =
      `<option value="">${escapeHtml(placeholder)}</option>` +
      (preferredIsUnavailable
        ? `<option value="${escapeHtml(preferred)}" data-saved-only="true">${escapeHtml(preferred)} — salvo, indisponível agora</option>`
        : "") +
      unique
        .map(
          (value) =>
            `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`,
        )
        .join("");
    const selected =
      preferred && (preferredIsUnavailable || unique.includes(preferred))
        ? preferred
        : "";
    select.value = selected;
    return selected;
  }

  function getMarketLine(market, item, colIndex) {
    const headerOffset = market && market.hasLabelsCol === false ? 0 : 1;
    return (
      (item && item.colHeader) ||
      (Array.isArray(market && market.headers)
        ? market.headers[colIndex + headerOffset]
        : "") ||
      `${colIndex + 1}+`
    );
  }

  function isLiveOpenOdd(item) {
    if (!item || item.status === "LOCKED" || item.isClosed === true)
      return false;
    const numeric = parseFloat(
      ((item.val || item.odds || "")
        .toString()
        .replace(",", ".")
        .match(/\d+(?:\.\d+)?/) || [])[0],
    );
    return Number.isFinite(numeric) && numeric > 1;
  }

  function updateDynamicBindPreview() {
    if (!dynamicBindPreview) return;
    const key = formatDynamicBindKey(
      dynamicBindKey?.getAttribute("data-key-code") || "",
    );
    const houseLabel =
      dynamicBindHouse?.value === "betfair" ? "Betfair" : "Bet365";
    const team = dynamicBindTeam?.value || "time";
    const market = dynamicBindMarket?.value || "mercado";
    const player = dynamicBindPlayer?.value || "jogador";
    const line =
      dynamicBindLine?.value === "first_available"
        ? "primeira linha aberta"
        : dynamicBindLine?.value || "linha";
    dynamicBindPreview.innerHTML = `
      <span class="dynamic-bind-preview-key">${escapeHtml(key)}</span>
      <span>${escapeHtml(houseLabel)} · ${escapeHtml(team)} · <strong>${escapeHtml(player)}</strong> · ${escapeHtml(market)} · ${escapeHtml(line)}</span>
    `;
  }

  function updateDynamicBindLines(preferredLine = "") {
    if (!dynamicBindLine) return;
    const house = dynamicBindHouse?.value === "betfair" ? "betfair" : "bet365";
    const market = getGuidedMarket(house, dynamicBindMarket?.value || "");
    const row = market?.tableRows?.find((item) =>
      looselyMatches(item.lineLabel, dynamicBindPlayer?.value),
    );
    const odds = row ? row.colOdds || row.odds || [] : [];
    const lineItems = odds
      .map((item, index) => ({
        line: getMarketLine(market, item, index),
        open: isLiveOpenOdd(item),
      }))
      .filter((item) => item.line);
    const uniqueLines = Array.from(
      new Map(lineItems.map((item) => [item.line, item])).values(),
    );
    const requestedLine = (preferredLine || "").toString().trim();
    const matchedPreferredLine =
      uniqueLines.find(
        (item) =>
          normalizePlayerRuleText(item.line) ===
          normalizePlayerRuleText(requestedLine),
      )?.line || "";
    const preserveUnavailableLine =
      !!requestedLine &&
      requestedLine !== "first_available" &&
      !matchedPreferredLine;
    dynamicBindLine.innerHTML =
      '<option value="first_available">Automática — primeira linha aberta</option>' +
      (preserveUnavailableLine
        ? `<option value="${escapeHtml(requestedLine)}" data-saved-only="true">${escapeHtml(requestedLine)} — salva, indisponível agora</option>`
        : "") +
      uniqueLines
        .map(
          (item) =>
            `<option value="${escapeHtml(item.line)}">${escapeHtml(item.line)}${item.open ? "" : " — fechada agora"}</option>`,
        )
        .join("");
    dynamicBindLine.value =
      requestedLine === "first_available"
        ? "first_available"
        : matchedPreferredLine ||
          (preserveUnavailableLine ? requestedLine : "first_available");

    const openCount = uniqueLines.filter((item) => item.open).length;
    if (dynamicBindLiveState) {
      const hasSavedOnlyValue = [
        dynamicBindTeam,
        dynamicBindMarket,
        dynamicBindPlayer,
        dynamicBindLine,
      ].some(
        (select) => select?.selectedOptions?.[0]?.dataset.savedOnly === "true",
      );
      dynamicBindLiveState.textContent = hasSavedOnlyValue
        ? "Dados salvos preservados — parte da regra não está disponível ao vivo agora"
        : row
          ? `${openCount} ${openCount === 1 ? "linha aberta encontrada" : "linhas abertas encontradas"}`
          : "Escolha um jogador disponível";
      dynamicBindLiveState.parentElement?.classList.toggle(
        "is-unavailable",
        hasSavedOnlyValue || !row || openCount === 0,
      );
    }
    updateDynamicBindPreview();
  }

  function updateDynamicBindPlayers(preferredPlayer = "", preferredLine = "") {
    const house = dynamicBindHouse?.value === "betfair" ? "betfair" : "bet365";
    const market = getGuidedMarket(house, dynamicBindMarket?.value || "");
    const players = (market?.tableRows || [])
      .map((row) => row.lineLabel)
      .filter(Boolean);
    const matchedPlayer = players.find((player) =>
      looselyMatches(player, preferredPlayer),
    );
    setSelectOptions(
      dynamicBindPlayer,
      players,
      players.length ? "Escolha um jogador…" : "Nenhum jogador encontrado",
      matchedPlayer || preferredPlayer,
    );
    updateDynamicBindLines(preferredLine);
  }

  function updateDynamicBindGuidedOptions(preferred = {}) {
    const house = dynamicBindHouse?.value === "betfair" ? "betfair" : "bet365";
    const teams = getEventTeams(house);
    const markets = getLiveMarketsForHouse(house);
    const requestedTeam = preferred.team || dynamicBindTeam?.value || "";
    const matchedTeam = teams.find((team) =>
      looselyMatches(team, requestedTeam),
    );
    setSelectOptions(
      dynamicBindTeam,
      teams,
      teams.length ? "Escolha o time…" : "Aguardando jogo ao vivo…",
      matchedTeam || requestedTeam,
    );
    const requestedMarket = preferred.market || dynamicBindMarket?.value || "";
    const matchedMarket = markets.find(
      (market) =>
        market.title === requestedMarket ||
        playerMarketTitlesMatch(market.title, requestedMarket),
    );
    const selectedMarket = setSelectOptions(
      dynamicBindMarket,
      markets.map((market) => market.title),
      markets.length
        ? "Escolha um mercado…"
        : "Nenhum mercado de jogador encontrado",
      matchedMarket?.title || requestedMarket,
    );
    if (selectedMarket) dynamicBindMarket.value = selectedMarket;
    updateDynamicBindPlayers(preferred.player || "", preferred.line || "");
    if (dynamicBindLiveState && (!teams.length || !markets.length)) {
      dynamicBindLiveState.textContent = !teams.length
        ? "Abra uma partida na casa selecionada"
        : "Nenhum mercado de jogador encontrado agora";
      dynamicBindLiveState.parentElement?.classList.add("is-unavailable");
    }
    updateDynamicBindPreview();
  }

  function resolveDynamicBindDraft(candidate) {
    if (!candidate)
      return { success: false, reason: "Complete os campos do atalho." };
    const eventTeams = getEventTeams(candidate.house);
    if (!eventTeams.some((team) => looselyMatches(team, candidate.team))) {
      return {
        success: false,
        reason: "O time escolhido não foi confirmado na partida aberta.",
      };
    }
    const market = getLiveMarketsForHouse(candidate.house).find((item) =>
      playerMarketTitlesMatch(item.title, candidate.market),
    );
    if (!market)
      return {
        success: false,
        reason: "Esse mercado não está disponível agora.",
      };
    const rowIndex = market.tableRows.findIndex((row) =>
      looselyMatches(row.lineLabel, candidate.player),
    );
    if (rowIndex < 0)
      return {
        success: false,
        reason: "Esse jogador não está disponível agora.",
      };
    const row = market.tableRows[rowIndex];
    const odds = row.colOdds || row.odds || [];
    let colIndex =
      candidate.lineMode === "exact"
        ? odds.findIndex(
            (item, index) =>
              normalizePlayerRuleText(getMarketLine(market, item, index)) ===
                normalizePlayerRuleText(candidate.line) && isLiveOpenOdd(item),
          )
        : odds.findIndex(isLiveOpenOdd);
    if (colIndex < 0) {
      return {
        success: false,
        reason:
          candidate.lineMode === "exact"
            ? `A linha ${candidate.line} está fechada ou indisponível.`
            : "Não há nenhuma linha aberta para esse jogador.",
      };
    }
    return {
      success: true,
      market,
      row,
      rowIndex,
      colIndex,
      line: getMarketLine(market, odds[colIndex], colIndex),
    };
  }

  function buildDynamicBindCandidate() {
    const keyCode = dynamicBindKey?.getAttribute("data-key-code") || "";
    const house = dynamicBindHouse?.value === "betfair" ? "betfair" : "bet365";
    const storageKey = dynamicBindStorageKey(house, keyCode);
    const candidate = sanitizeDynamicPlayerBinds({
      [storageKey]: {
        keyCode,
        house,
        team: dynamicBindTeam?.value,
        market: dynamicBindMarket?.value,
        player: dynamicBindPlayer?.value,
        lineMode:
          dynamicBindLine?.value === "first_available"
            ? "first_available"
            : "exact",
        line:
          dynamicBindLine?.value === "first_available"
            ? ""
            : dynamicBindLine?.value,
        eventLabel: activeEventContextByHouse[house]?.eventLabel || "",
        source: "guided",
        createdAt: Date.now(),
      },
    })[storageKey];
    return { candidate, storageKey, keyCode, house };
  }

  function buildEquivalentHouseBind(candidate) {
    const otherHouse = candidate.house === "betfair" ? "bet365" : "betfair";
    const otherTeams = getEventTeams(otherHouse);
    const matchingTeam = otherTeams.find((team) =>
      looselyMatches(team, candidate.team),
    );
    const market = getLiveMarketsForHouse(otherHouse).find((item) =>
      playerMarketTitlesMatch(item.title, candidate.market),
    );
    const row = market?.tableRows?.find((item) =>
      looselyMatches(item.lineLabel, candidate.player),
    );
    if (!matchingTeam || !market || !row) return null;
    return {
      ...candidate,
      house: otherHouse,
      team: matchingTeam,
      market: market.title,
      player: row.lineLabel,
      eventLabel: activeEventContextByHouse[otherHouse]?.eventLabel || "",
      createdAt: Date.now(),
    };
  }

  function dynamicBindTargetsMatch(left, right) {
    if (!left || !right || left.house !== right.house) return false;
    return (
      looselyMatches(left.team, right.team) &&
      playerMarketTitlesMatch(left.market, right.market) &&
      looselyMatches(left.player, right.player)
    );
  }

  function testDynamicBindWithoutBet() {
    const { candidate } = buildDynamicBindCandidate();
    const result = resolveDynamicBindDraft(candidate);
    if (!result.success) {
      showDynamicBindStatus(result.reason, true);
      return;
    }

    if (selectedHouseMarket !== candidate.house) {
      switchMarketHouseTab(candidate.house);
    }
    const buttons = Array.from(
      marketsContainer?.querySelectorAll(".seu-botao-odd, .odd-btn-table") ||
        [],
    );
    const target = buttons.find(
      (button) =>
        playerMarketTitlesMatch(
          button.getAttribute("data-markettitle") || "",
          result.market.title,
        ) &&
        looselyMatches(
          button.getAttribute("data-linename") || "",
          result.row.lineLabel,
        ) &&
        Number(button.getAttribute("data-colindex")) === result.colIndex,
    );
    document
      .querySelectorAll(".dynamic-bind-test-highlight")
      .forEach((element) =>
        element.classList.remove("dynamic-bind-test-highlight"),
      );
    if (target) {
      target.classList.add("dynamic-bind-test-highlight");
      target.scrollIntoView({
        behavior: "smooth",
        block: "center",
        inline: "center",
      });
      setTimeout(
        () => target.classList.remove("dynamic-bind-test-highlight"),
        3500,
      );
    }
    showDynamicBindStatus(
      `Teste seguro: ${result.row.lineLabel} · ${result.line}. Nenhuma aposta foi feita.`,
    );
  }

  function getMatchingPlayerRule(
    marketTitle,
    rowLabel,
    house = selectedHouseMarket,
  ) {
    const eventTeams = getEventTeams(house);
    for (let index = 0; index < playerPriorityRules.length; index++) {
      const rule = playerPriorityRules[index];
      if (
        rule.house !== house ||
        !playerMarketTitlesMatch(rule.market, marketTitle)
      )
        continue;
      if (!looselyMatches(rule.player, rowLabel)) continue;

      const teamConfirmed =
        eventTeams.some((team) => looselyMatches(rule.team, team)) ||
        looselyMatches(rule.team, rowLabel);
      if (!teamConfirmed) continue;
      return { rule, priority: index };
    }
    return null;
  }

  function prioritizePlayerRows(market) {
    const rows = Array.isArray(market && market.tableRows)
      ? market.tableRows
      : [];
    return rows
      .map((row, originalIndex) => {
        const match = getMatchingPlayerRule(
          market.title,
          row.lineLabel || "",
          selectedHouseMarket,
        );
        return {
          row,
          originalIndex,
          matchedRule: match ? match.rule : null,
          priority: match ? match.priority : Number.MAX_SAFE_INTEGER,
        };
      })
      .sort((a, b) =>
        a.priority === b.priority
          ? a.originalIndex - b.originalIndex
          : a.priority - b.priority,
      );
  }

  function showPlayerPriorityStatus(message, isError = false) {
    if (!playerPriorityStatus) return;
    playerPriorityStatus.textContent = message;
    playerPriorityStatus.classList.toggle("is-error", isError);
    playerPriorityStatus.style.display = message ? "block" : "none";
  }

  function renderPlayerPriorityRules() {
    if (playerPriorityCount) {
      playerPriorityCount.textContent = `${playerPriorityRules.length} ${playerPriorityRules.length === 1 ? "regra" : "regras"}`;
    }
    if (!playerPriorityList) return;

    if (playerPriorityRules.length === 0) {
      playerPriorityList.innerHTML =
        '<span class="player-priority-empty">Nenhuma prioridade configurada.</span>';
      return;
    }

    playerPriorityList.innerHTML = playerPriorityRules
      .map(
        (rule) => `
      <div class="player-priority-rule">
        <span><strong>${escapeHtml(rule.player)}</strong> · ${escapeHtml(rule.team)} · ${escapeHtml(rule.market)} · ${rule.house === "betfair" ? "Betfair" : "Bet365"}</span>
        <button type="button" class="player-priority-remove" data-rule-id="${escapeHtml(rule.id)}" aria-label="Remover prioridade de ${escapeHtml(rule.player)}" title="Remover regra">×</button>
      </div>
    `,
      )
      .join("");
  }

  function refreshPlayerPriorityUI() {
    currentStructuralKey = "";
    renderPlayerPriorityRules();
    const activeState = marketStatesByHouse[selectedHouseMarket];
    if (activeState) renderDashboardUI(activeState, true);
  }

  function persistPlayerPriorityRules() {
    chrome.storage.local.set({ playerPriorityRules });
  }

  function updatePlayerPrioritySuggestions(state, house = selectedHouseMarket) {
    const markets = (state && (state.groups || state.markets)) || [];
    const teams = getEventTeams(house);
    const marketTitles = markets.map((market) => market.title).filter(Boolean);
    const players = markets.flatMap((market) =>
      Array.isArray(market.tableRows)
        ? market.tableRows.map((row) => row.lineLabel).filter(Boolean)
        : [],
    );

    const fillDatalist = (element, values) => {
      if (!element) return;
      const unique = Array.from(
        new Set(values.map((value) => value.toString().trim()).filter(Boolean)),
      );
      element.innerHTML = unique
        .slice(0, 150)
        .map((value) => `<option value="${escapeHtml(value)}"></option>`)
        .join("");
    };

    fillDatalist(playerPriorityTeams, teams);
    fillDatalist(playerPriorityMarkets, marketTitles);
    fillDatalist(playerPriorityPlayers, players);
  }

  function normalizeFavoriteMarketTitle(title) {
    return (title || "")
      .toString()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .replace(/\s+/g, "-");
  }

  function sanitizeFavoriteMarkets(rawFavorites) {
    const sanitized = { bet365: [], betfair: [] };

    ["bet365", "betfair"].forEach((house) => {
      const rawList =
        rawFavorites && Array.isArray(rawFavorites[house])
          ? rawFavorites[house]
          : [];
      const seen = new Set();

      rawList.slice(0, 100).forEach((entry) => {
        const title = typeof entry === "string" ? entry : entry && entry.title;
        const key = normalizeFavoriteMarketTitle(
          (entry && typeof entry === "object" && entry.key) || title,
        );
        if (!key || seen.has(key)) return;
        seen.add(key);
        sanitized[house].push({
          key,
          title: (title || key).toString().slice(0, 160),
        });
      });
    });

    return sanitized;
  }

  function getFavoriteMarketIndex(title, house = selectedHouseMarket) {
    const key = normalizeFavoriteMarketTitle(title);
    return (favoriteMarketsByHouse[house] || []).findIndex(
      (item) => item.key === key,
    );
  }

  function isFavoriteMarket(title, house = selectedHouseMarket) {
    return getFavoriteMarketIndex(title, house) !== -1;
  }

  function sortMarketsByFavorites(markets, house = selectedHouseMarket) {
    const favorites = favoriteMarketsByHouse[house] || [];
    const priorityByKey = new Map(
      favorites.map((item, index) => [item.key, index]),
    );

    return markets
      .map((market, originalIndex) => {
        const key = normalizeFavoriteMarketTitle(market && market.title);
        return {
          market,
          originalIndex,
          favoritePriority: priorityByKey.has(key)
            ? priorityByKey.get(key)
            : Number.MAX_SAFE_INTEGER,
        };
      })
      .sort((a, b) => {
        if (a.favoritePriority !== b.favoritePriority) {
          return a.favoritePriority - b.favoritePriority;
        }
        return a.originalIndex - b.originalIndex;
      })
      .map((item) => item.market);
  }

  function refreshFavoriteMarketOrder() {
    currentStructuralKey = "";
    const activeState = marketStatesByHouse[selectedHouseMarket];
    if (activeState) renderDashboardUI(activeState, true);
  }

  function toggleFavoriteMarket(title, house = selectedHouseMarket) {
    if (!title || !favoriteMarketsByHouse[house]) return;

    const key = normalizeFavoriteMarketTitle(title);
    const currentIndex = getFavoriteMarketIndex(title, house);

    if (currentIndex === -1) {
      favoriteMarketsByHouse[house].push({
        key,
        title: title.toString().slice(0, 160),
      });
    } else {
      favoriteMarketsByHouse[house].splice(currentIndex, 1);
    }

    refreshFavoriteMarketOrder();
    chrome.storage.local.set({ favoriteMarketsByHouse });
  }

  chrome.storage.local.get(
    { favoriteMarketsByHouse: { bet365: [], betfair: [] } },
    (res) => {
      favoriteMarketsByHouse = sanitizeFavoriteMarkets(
        res.favoriteMarketsByHouse,
      );
      refreshFavoriteMarketOrder();
    },
  );

  if (chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local") return;

      if (changes.favoriteMarketsByHouse) {
        const nextFavorites = sanitizeFavoriteMarkets(
          changes.favoriteMarketsByHouse.newValue,
        );
        if (
          JSON.stringify(nextFavorites) !==
          JSON.stringify(favoriteMarketsByHouse)
        ) {
          favoriteMarketsByHouse = nextFavorites;
          refreshFavoriteMarketOrder();
        }
      }

      if (changes.playerPriorityRules) {
        const nextRules = sanitizePlayerPriorityRules(
          changes.playerPriorityRules.newValue,
        );
        if (JSON.stringify(nextRules) !== JSON.stringify(playerPriorityRules)) {
          playerPriorityRules = nextRules;
          refreshPlayerPriorityUI();
        }
      }

      if (changes.dynamicPlayerBinds) {
        const nextBinds = sanitizeDynamicPlayerBinds(
          changes.dynamicPlayerBinds.newValue,
        );
        if (JSON.stringify(nextBinds) !== JSON.stringify(dynamicPlayerBinds)) {
          dynamicPlayerBinds = nextBinds;
          renderDynamicPlayerBinds();
        }
      }
    });
  }

  chrome.storage.local.get({ playerPriorityRules: [] }, (res) => {
    playerPriorityRules = sanitizePlayerPriorityRules(res.playerPriorityRules);
    refreshPlayerPriorityUI();
  });

  chrome.storage.local.get({ dynamicPlayerBinds: {} }, (res) => {
    dynamicPlayerBinds = sanitizeDynamicPlayerBinds(res.dynamicPlayerBinds);
    renderDynamicPlayerBinds();
  });

  if (playerPriorityForm) {
    playerPriorityForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const candidate = sanitizePlayerPriorityRules([
        {
          id: `player-rule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          house: playerPriorityHouse
            ? playerPriorityHouse.value
            : selectedHouseMarket,
          team: playerPriorityTeam ? playerPriorityTeam.value : "",
          market: playerPriorityMarket ? playerPriorityMarket.value : "",
          player: playerPriorityPlayer ? playerPriorityPlayer.value : "",
        },
      ])[0];

      if (!candidate) {
        showPlayerPriorityStatus(
          "Preencha casa, time, mercado e jogador.",
          true,
        );
        return;
      }

      const signature = [
        normalizePlayerRuleText(candidate.house),
        normalizePlayerRuleText(candidate.team),
        canonicalPlayerMarketTitle(candidate.market) ||
          normalizePlayerRuleText(candidate.market),
        normalizePlayerRuleText(candidate.player),
      ].join("|");
      const alreadyExists = playerPriorityRules.some(
        (rule) =>
          [
            normalizePlayerRuleText(rule.house),
            normalizePlayerRuleText(rule.team),
            canonicalPlayerMarketTitle(rule.market) ||
              normalizePlayerRuleText(rule.market),
            normalizePlayerRuleText(rule.player),
          ].join("|") === signature,
      );
      if (alreadyExists) {
        showPlayerPriorityStatus("Essa prioridade já está configurada.", true);
        return;
      }

      playerPriorityRules.push(candidate);
      persistPlayerPriorityRules();
      refreshPlayerPriorityUI();
      showPlayerPriorityStatus(
        `${candidate.player} será priorizado em ${candidate.market} quando ${candidate.team} estiver no jogo.`,
      );
      if (playerPriorityPlayer) playerPriorityPlayer.value = "";
    });
  }

  if (playerPriorityHouse) {
    playerPriorityHouse.addEventListener("change", () => {
      const house =
        playerPriorityHouse.value === "betfair" ? "betfair" : "bet365";
      updatePlayerPrioritySuggestions(marketStatesByHouse[house], house);
    });
  }

  if (dynamicBindHouse) {
    dynamicBindHouse.addEventListener("change", () => {
      const house = dynamicBindHouse.value === "betfair" ? "betfair" : "bet365";
      updatePlayerPrioritySuggestions(marketStatesByHouse[house], house);
      updateDynamicBindGuidedOptions();
    });
  }

  dynamicBindTeam?.addEventListener("change", updateDynamicBindPreview);
  dynamicBindMarket?.addEventListener("change", () =>
    updateDynamicBindPlayers(),
  );
  dynamicBindPlayer?.addEventListener("change", () => updateDynamicBindLines());
  dynamicBindLine?.addEventListener("change", updateDynamicBindPreview);
  dynamicBindTest?.addEventListener("click", testDynamicBindWithoutBet);
  dynamicBindCancelEdit?.addEventListener("click", () => {
    leaveDynamicBindEditMode(true);
    showDynamicBindStatus("Edição cancelada.");
  });

  if (playerPriorityList) {
    playerPriorityList.addEventListener("click", (event) => {
      const removeButton = event.target.closest(".player-priority-remove");
      if (!removeButton) return;
      const ruleId = removeButton.getAttribute("data-rule-id");
      playerPriorityRules = playerPriorityRules.filter(
        (rule) => rule.id !== ruleId,
      );
      persistPlayerPriorityRules();
      refreshPlayerPriorityUI();
      showPlayerPriorityStatus("Prioridade removida.");
    });
  }

  if (openDynamicBinds)
    openDynamicBinds.addEventListener("click", openDynamicBindsModal);
  if (closeDynamicBinds)
    closeDynamicBinds.addEventListener("click", closeDynamicBindsModal);
  if (dynamicBindsModal) {
    dynamicBindsModal.addEventListener("click", (event) => {
      if (event.target === dynamicBindsModal) closeDynamicBindsModal();
    });
  }

  if (dynamicBindKey) {
    dynamicBindKey.addEventListener("click", () => {
      isCapturingDynamicBindKey = true;
      dynamicBindKey.classList.add("is-capturing");
      dynamicBindKey.textContent = "Pressione uma tecla…";
      showDynamicBindStatus("Use uma letra, número ou tecla F1–F12.");
    });
  }

  document.addEventListener(
    "keydown",
    (event) => {
      if (
        dynamicBindsModal &&
        !dynamicBindsModal.hidden &&
        event.code === "Escape"
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (isCapturingDynamicBindKey) {
          isCapturingDynamicBindKey = false;
          dynamicBindKey?.classList.remove("is-capturing");
          if (dynamicBindKey) {
            const currentCode =
              dynamicBindKey.getAttribute("data-key-code") || "";
            dynamicBindKey.textContent = formatDynamicBindKey(currentCode);
          }
        } else {
          closeDynamicBindsModal();
        }
        return;
      }

      if (!isCapturingDynamicBindKey) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!isAllowedDynamicBindKey(event.code)) {
        showDynamicBindStatus(
          "Essa tecla não pode ser usada. Escolha uma letra, número ou F1–F12.",
          true,
        );
        return;
      }

      isCapturingDynamicBindKey = false;
      dynamicBindKey.setAttribute("data-key-code", event.code);
      dynamicBindKey.textContent = formatDynamicBindKey(event.code);
      dynamicBindKey.classList.remove("is-capturing");
      dynamicBindKey.classList.add("has-key");
      showDynamicBindStatus(
        `Tecla ${formatDynamicBindKey(event.code)} selecionada.`,
      );
      updateDynamicBindPreview();
    },
    true,
  );

  document.addEventListener(
    "keydown",
    (event) => {
      if (
        !event.isTrusted ||
        event.repeat ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        isCapturingDynamicBindKey ||
        (dynamicBindsModal && !dynamicBindsModal.hidden)
      ) {
        return;
      }

      const activeElement = document.activeElement;
      if (
        activeElement &&
        (["INPUT", "TEXTAREA", "SELECT"].includes(activeElement.tagName) ||
          activeElement.isContentEditable)
      ) {
        return;
      }

      const targetHouses = ["bet365", "betfair", "betnacional", "betano"].filter(
        (house) => {
          const storageKey = dynamicBindStorageKey(house, event.code);
          return Boolean(
            dynamicPlayerBinds[storageKey] ||
            (dynamicPlayerBinds[event.code]?.house === house
              ? dynamicPlayerBinds[event.code]
              : null),
          );
        },
      );
      if (targetHouses.length === 0) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      if (!livePort) {
        showDashboardBindFeedback(
          "A conexão com as casas ainda não está pronta.",
          true,
        );
        return;
      }

      targetHouses.forEach((house) => {
        const intent = createExplicitUserIntent("dynamic_bind");
        livePort.postMessage({
          type: "DYNAMIC_BIND_ACTION",
          ...intent,
          house,
          keyCode: event.code,
          stakeVal: window.FastTriggerConfig?.stakeVal || null,
        });
      });
      showDashboardBindFeedback(
        `${formatDynamicBindKey(event.code)} enviado para ${selectedHouseMarket === "betfair" ? "Betfair" : "Bet365"}…`,
      );
    },
    true,
  );

  if (dynamicBindForm) {
    dynamicBindForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const { candidate, storageKey, keyCode } = buildDynamicBindCandidate();

      if (!candidate) {
        showDynamicBindStatus(
          "Escolha a tecla, o time, o mercado e o jogador nas listas ao vivo.",
          true,
        );
        return;
      }

      const liveValidation = resolveDynamicBindDraft(candidate);
      const editingExistingBind = editingDynamicBindStorageKey
        ? getDynamicBindEntry(
            editingDynamicBindStorageKey,
            editingDynamicBindIndex,
          )
        : null;
      const isPreservingSavedTarget = dynamicBindTargetsMatch(
        editingExistingBind,
        candidate,
      );
      if (
        !liveValidation.success &&
        candidate.lineMode !== "exact" &&
        !isPreservingSavedTarget
      ) {
        showDynamicBindStatus(liveValidation.reason, true);
        return;
      }

      const [localHotkeyData, syncHotkeyData] = await Promise.all([
        new Promise((resolve) =>
          chrome.storage.local.get({ fastTriggerHotkey: null }, resolve),
        ),
        new Promise((resolve) =>
          chrome.storage.sync.get({ triggerKeyStr: "Space" }, resolve),
        ),
      ]);
      const globalHotkeyCode =
        typeof localHotkeyData.fastTriggerHotkey === "string"
          ? localHotkeyData.fastTriggerHotkey
          : localHotkeyData.fastTriggerHotkey?.code;
      if (
        globalHotkeyCode === keyCode ||
        syncHotkeyData.triggerKeyStr === keyCode
      ) {
        showDynamicBindStatus(
          `A tecla ${formatDynamicBindKey(keyCode)} já é usada pelo disparo geral. Escolha outra tecla.`,
          true,
        );
        return;
      }

      const existingValue = dynamicPlayerBinds[storageKey];
      const existingEntries = existingValue
        ? Array.isArray(existingValue)
          ? existingValue
          : [existingValue]
        : [];
      const editingSameStorage = storageKey === editingDynamicBindStorageKey;
      const duplicateIndex = existingEntries.findIndex((entry, index) => {
        if (editingSameStorage && index === editingDynamicBindIndex)
          return false;
        return (
          dynamicBindTargetsMatch(entry, candidate) &&
          entry.lineMode === candidate.lineMode &&
          entry.line === candidate.line &&
          (!entry.eventLabel ||
            !candidate.eventLabel ||
            looselyMatches(entry.eventLabel, candidate.eventLabel))
        );
      });
      if (duplicateIndex >= 0) {
        showDynamicBindStatus(
          "Essa regra jÃ¡ estÃ¡ salva para este jogo e alvo.",
          true,
        );
        return;
      }

      if (false) {
        const sameRule =
          existing.team === candidate.team &&
          playerMarketTitlesMatch(existing.market, candidate.market) &&
          looselyMatches(existing.player, candidate.player) &&
          existing.lineMode === candidate.lineMode &&
          existing.line === candidate.line;
        showDynamicBindStatus(
          sameRule
            ? `Esse atalho já está salvo na ${candidate.house === "betfair" ? "Betfair" : "Bet365"}.`
            : `A tecla ${formatDynamicBindKey(keyCode)} já possui outra regra nessa casa. Remova-a antes de reutilizar a tecla.`,
          true,
        );
        return;
      }

      if (
        editingDynamicBindStorageKey &&
        editingDynamicBindStorageKey !== storageKey
      ) {
        const previousValue = dynamicPlayerBinds[editingDynamicBindStorageKey];
        const previousEntries = Array.isArray(previousValue)
          ? [...previousValue]
          : [previousValue];
        previousEntries.splice(editingDynamicBindIndex, 1);
        if (previousEntries.length === 0)
          delete dynamicPlayerBinds[editingDynamicBindStorageKey];
        else
          dynamicPlayerBinds[editingDynamicBindStorageKey] =
            previousEntries.length === 1 ? previousEntries[0] : previousEntries;
      }
      if (editingExistingBind?.createdAt) {
        candidate.createdAt = editingExistingBind.createdAt;
      }
      const nextEntries = [...existingEntries];
      if (
        editingSameStorage &&
        editingDynamicBindIndex >= 0 &&
        nextEntries[editingDynamicBindIndex]
      ) {
        nextEntries[editingDynamicBindIndex] = candidate;
      } else {
        nextEntries.push(candidate);
      }
      dynamicPlayerBinds[storageKey] =
        nextEntries.length === 1 ? nextEntries[0] : nextEntries;
      let copiedHouse = "";
      let copyWarning = "";
      if (dynamicBindCopyHouse?.checked) {
        const equivalent = buildEquivalentHouseBind(candidate);
        if (!equivalent) {
          copyWarning =
            " O equivalente não foi criado porque a outra casa não possui agora o mesmo jogo, mercado e jogador.";
        } else {
          const equivalentKey = dynamicBindStorageKey(
            equivalent.house,
            keyCode,
          );
          if (dynamicPlayerBinds[equivalentKey]) {
            copyWarning =
              " A outra casa já usa essa tecla; a regra existente foi preservada.";
          } else {
            dynamicPlayerBinds[equivalentKey] = equivalent;
            copiedHouse = equivalent.house === "betfair" ? "Betfair" : "Bet365";
          }
        }
      }
      chrome.storage.local.set({ dynamicPlayerBinds });
      leaveDynamicBindEditMode(false);
      renderDynamicPlayerBinds();
      showDynamicBindStatus(
        `Atalho ${formatDynamicBindKey(keyCode)} salvo para ${candidate.lineMode === "exact" ? candidate.line : "a primeira linha aberta"}.` +
          (copiedHouse
            ? ` Regra equivalente criada também na ${copiedHouse}.`
            : "") +
          copyWarning,
        !!copyWarning,
      );
    });
  }

  if (dynamicBindList) {
    dynamicBindList.addEventListener("click", (event) => {
      const editButton = event.target.closest(".dynamic-bind-edit");
      if (editButton) {
        const storageKey = editButton.getAttribute("data-bind-id") || "";
        const index = Number(editButton.getAttribute("data-bind-index") || 0);
        const bind = getDynamicBindEntry(storageKey, index);
        if (!bind) return;
        editingDynamicBindStorageKey = storageKey;
        editingDynamicBindIndex = index;
        if (dynamicBindSave) dynamicBindSave.textContent = "Atualizar atalho";
        if (dynamicBindCancelEdit) dynamicBindCancelEdit.hidden = false;
        if (dynamicBindHouse) dynamicBindHouse.value = bind.house;
        dynamicBindKey?.setAttribute("data-key-code", bind.keyCode);
        if (dynamicBindKey) {
          dynamicBindKey.textContent = formatDynamicBindKey(bind.keyCode);
          dynamicBindKey.classList.add("has-key");
        }
        if (dynamicBindCopyHouse) dynamicBindCopyHouse.checked = false;
        updateDynamicBindGuidedOptions({
          team: bind.team,
          market: bind.market,
          player: bind.player,
          line: bind.lineMode === "exact" ? bind.line : "first_available",
        });
        updateDynamicBindPreview();
        showDynamicBindStatus(
          `Editando o atalho ${formatDynamicBindKey(bind.keyCode)} da ${bind.house === "betfair" ? "Betfair" : "Bet365"}.`,
        );
        dynamicBindForm?.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }

      const removeButton = event.target.closest(".dynamic-bind-remove");
      if (!removeButton) return;
      const storageKey = removeButton.getAttribute("data-bind-id") || "";
      const keyCode = removeButton.getAttribute("data-key-code") || "";
      delete dynamicPlayerBinds[storageKey || keyCode];
      if (editingDynamicBindStorageKey === storageKey)
        leaveDynamicBindEditMode(true);
      chrome.storage.local.set({ dynamicPlayerBinds });
      renderDynamicPlayerBinds();
      showDynamicBindStatus(
        `Atalho ${formatDynamicBindKey(keyCode)} removido.`,
      );
    });
  }

  function switchMarketHouseTab(houseKey) {
    selectedHouseMarket = (houseKey || "bet365").toLowerCase();
    const isBet365 = selectedHouseMarket === "bet365";
    if (playerPriorityHouse) playerPriorityHouse.value = selectedHouseMarket;

    if (tabBet365) tabBet365.classList.toggle("active", isBet365);
    if (tabBetfair) tabBetfair.classList.toggle("active", !isBet365);

    if (marketsContainer) marketsContainer.innerHTML = "";
    currentStructuralKey = "";

    const cachedState = isBet365
      ? marketStatesByHouse.bet365
      : marketStatesByHouse.betfair;
    if (cachedState) {
      updatePlayerPrioritySuggestions(cachedState, selectedHouseMarket);
      renderDashboardUI(cachedState, true);
    } else {
      if (marketsContainer) {
        marketsContainer.innerHTML = `<div style="font-size: 12px; color: #ffcc00; padding: 10px; background: var(--card-bg); border-radius: 6px;">Aguardando dados da ${isBet365 ? "Bet365" : "Betfair"} ao vivo...</div>`;
      }
    }

    if (livePort) {
      livePort.postMessage({
        type: "REQUEST_MARKETS",
        house: selectedHouseMarket,
      });
    } else if (
      typeof chrome !== "undefined" &&
      chrome.runtime &&
      chrome.runtime.sendMessage
    ) {
      chrome.runtime
        .sendMessage({ action: "REQUEST_MARKETS", house: selectedHouseMarket })
        .catch(() => {});
    }
  }

  if (tabBet365)
    tabBet365.addEventListener("click", () => switchMarketHouseTab("bet365"));
  if (tabBetfair)
    tabBetfair.addEventListener("click", () => switchMarketHouseTab("betfair"));

  function isZeroVal(val) {
    if (!val) return true;
    const clean = val
      .toString()
      .replace(/[^\d,.]/g, "")
      .trim();
    return (
      !clean ||
      clean === "0" ||
      clean === "0,00" ||
      clean === "0.00" ||
      clean === "000"
    );
  }

  function highlightStakeBtn(stake) {
    const cleanCurrent = stake.toString().replace(".", ",");
    stakeButtons.forEach((btn) => {
      const btnStake = btn
        .getAttribute("data-stake")
        .toString()
        .replace(".", ",");
      if (
        btnStake === cleanCurrent ||
        btn.getAttribute("data-stake") === stake
      ) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
    });
  }

  function applyStakeValue(valStr, isUserAction = false) {
    if (!valStr) return;
    const cleanVal = valStr
      .toString()
      .replace(/[^\d,.]/g, "")
      .trim();
    if (!cleanVal) return;

    if (isZeroVal(cleanVal) && !isZeroVal(currentStake) && !isUserAction) {
      console.warn(
        "[FT Engine] 🛡️ Ignorado reset indesejado para 0,00. Stake mantida:",
        currentStake,
      );
      return;
    }

    currentStake = cleanVal;
    const formattedDisplay = cleanVal.replace(".", ",");

    dispStakeText.textContent = `R$ ${formattedDisplay}`;

    if (customStakeInput && customStakeInput.value !== formattedDisplay) {
      isUpdatingProgrammatically = true;
      customStakeInput.value = formattedDisplay;
      isUpdatingProgrammatically = false;
    }

    highlightStakeBtn(cleanVal);

    // Hidratar o painel com a stake salva nunca deve tocar no cupom da casa.
    // Somente uma alteração explícita do usuário persiste e propaga a configuração.
    if (isUserAction) {
      chrome.storage.local.set(
        { fastTriggerStakeVal: cleanVal, stakeVal: cleanVal },
        () => {
          chrome.storage.sync.set({ stakeVal: cleanVal }, () => {
            chrome.tabs.query({}, (tabs) => {
              tabs.forEach((tab) => {
                if (tab.id) {
                  chrome.tabs
                    .sendMessage(tab.id, {
                      action: "UPDATE_CONFIG",
                      config: { stakeVal: cleanVal },
                    })
                    .catch(() => {});
                }
              });
            });
          });
        },
      );
    }
  }

  chrome.storage.sync.get(
    {
      triggerKeyStr: "Space",
      stakeVal: "0.50",
    },
    (data) => {
      dispHotkey.textContent =
        data.triggerKeyStr === "Space" ? "Espaço" : data.triggerKeyStr;

      chrome.storage.local.get(
        ["fastTriggerStakeVal", "stakeVal"],
        (localRes) => {
          const val =
            localRes.fastTriggerStakeVal ||
            localRes.stakeVal ||
            data.stakeVal ||
            "0.50";
          if (!isZeroVal(val)) {
            applyStakeValue(val, false);
          }
        },
      );
    },
  );

  const chkAutoTrigger = document.getElementById("chk-auto-trigger");
  if (chkAutoTrigger) {
    chrome.storage.local.get(
      ["autoTriggerDirectBool", "oneShot", "autoTrigger", "autoTriggerDirect"],
      (res) => {
        const isChecked = !!(
          res.autoTriggerDirectBool ||
          res.oneShot ||
          res.autoTrigger ||
          res.autoTriggerDirect
        );
        chkAutoTrigger.checked = isChecked;
      },
    );

    chkAutoTrigger.addEventListener("change", (e) => {
      const val = !!e.target.checked;
      chrome.storage.local.set(
        {
          autoTriggerDirectBool: val,
          oneShot: val,
          autoTrigger: val,
          autoTriggerDirect: val,
        },
        () => {
          console.log(
            "[Dashboard] ⚡ Estado do Modo Disparo Direto (1-Click) alterado para:",
            val,
          );
        },
      );
    });
  }

  if (customStakeInput) {
    customStakeInput.addEventListener("input", (e) => {
      if (isUpdatingProgrammatically) return;
      applyStakeValue(e.target.value, true);
    });
    customStakeInput.addEventListener("change", (e) => {
      if (isUpdatingProgrammatically) return;
      applyStakeValue(e.target.value, true);
    });
  }

  stakeButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const stake = btn.getAttribute("data-stake");
      applyStakeValue(stake, true);
    });
  });

  if (btnMaxStake) {
    btnMaxStake.addEventListener("click", () => {
      console.log("[FT Engine] 🔍 Solicitando saldo total da conta...");

      const processBalance = (balanceStr) => {
        if (!balanceStr || isZeroVal(balanceStr)) {
          console.warn(
            "[FT Engine] ⚠️ Saldo retornado é zerado ou inválido:",
            balanceStr,
          );
          return;
        }
        const cleanBalance = balanceStr
          .toString()
          .replace(/[^\d,.]/g, "")
          .trim();
        console.log(
          "[FT Engine] 💰 Saldo total carregado como stake!:",
          cleanBalance,
        );
        applyStakeValue(cleanBalance, true);
      };

      chrome.tabs.query({ url: "*://*.bet365.com/*" }, (tabs) => {
        let responded = false;
        if (tabs && tabs.length > 0) {
          tabs.forEach((tab) => {
            chrome.tabs.sendMessage(
              tab.id,
              { action: "GET_ACCOUNT_BALANCE" },
              (response) => {
                if (
                  response &&
                  response.balance &&
                  !isZeroVal(response.balance) &&
                  !responded
                ) {
                  responded = true;
                  processBalance(response.balance);
                }
              },
            );
          });
        }

        setTimeout(() => {
          if (!responded && livePort) {
            livePort.postMessage({ type: "REQUEST_ACCOUNT_BALANCE" });
          }
        }, 350);
      });
    });
  }

  function updateConnectionBadges(connectionStatus) {
    const statusBet365 = document.getElementById("statusBet365");
    const statusBetfair = document.getElementById("statusBetfair");
    const cardStatusBet365 = document.getElementById("status-bet365");
    const cardStatusBetfair = document.getElementById("status-betfair");
    const cardStatusBetano = document.getElementById("status-betano");

    const isBet365Active = !!(
      connectionStatus && connectionStatus.bet365Active
    );
    const isBetfairActive = !!(
      connectionStatus && connectionStatus.betfairActive
    );
    const isBetanoActive = !!(
      connectionStatus && connectionStatus.betanoActive
    );

    // Header Badges
    if (statusBet365) {
      if (isBet365Active) {
        statusBet365.textContent = "[🟢 Bet365 Ativa]";
        statusBet365.style.background = "rgba(16, 185, 129, 0.15)";
        statusBet365.style.border = "1px solid rgba(16, 185, 129, 0.4)";
        statusBet365.style.color = "#10B981";
      } else {
        statusBet365.textContent = "[🔴 Bet365 Inativa]";
        statusBet365.style.background = "rgba(255, 71, 87, 0.1)";
        statusBet365.style.border = "1px solid rgba(255, 71, 87, 0.3)";
        statusBet365.style.color = "#ff6b81";
      }
    }

    if (statusBetfair) {
      if (isBetfairActive) {
        statusBetfair.textContent = "[🟢 Betfair Ativa]";
        statusBetfair.style.background = "rgba(16, 185, 129, 0.15)";
        statusBetfair.style.border = "1px solid rgba(16, 185, 129, 0.4)";
        statusBetfair.style.color = "#10B981";
      } else {
        statusBetfair.textContent = "[🔴 Betfair Inativa]";
        statusBetfair.style.background = "rgba(255, 71, 87, 0.1)";
        statusBetfair.style.border = "1px solid rgba(255, 71, 87, 0.3)";
        statusBetfair.style.color = "#ff6b81";
      }
    }

    // Workstation Card Badges
    if (cardStatusBet365) {
      if (isBet365Active) {
        cardStatusBet365.textContent = "🟢 Conectado";
        cardStatusBet365.className = "badge-status connected";
      } else {
        cardStatusBet365.textContent = "⚪ Desconectado";
        cardStatusBet365.className = "badge-status disconnected";
      }
    }

    if (cardStatusBetfair) {
      if (isBetfairActive) {
        cardStatusBetfair.textContent = "🟢 Conectado";
        cardStatusBetfair.className = "badge-status connected";
      } else {
        cardStatusBetfair.textContent = "⚪ Desconectado";
        cardStatusBetfair.className = "badge-status disconnected";
      }
    }

    if (cardStatusBetano) {
      if (isBetanoActive) {
        cardStatusBetano.textContent = "🟢 Conectado";
        cardStatusBetano.className = "badge-status connected";
      } else {
        cardStatusBetano.textContent = "⚪ Desconectado";
        cardStatusBetano.className = "badge-status disconnected";
      }
    }
  }

  // LÓGICA DE SALVAMENTO E ABERTURA - ESTAÇÃO DE TRABALHO
  const chkBet365 = document.getElementById("chk-house-bet365");
  const chkBetfair = document.getElementById("chk-house-betfair");
  const chkBetnacional = document.getElementById("chk-house-betnacional");
  const chkBetano = document.getElementById("chk-house-betano");
  const btnLaunchHouses = document.getElementById("btn-launch-houses");

  function getSelectedActiveHouses() {
    const selected = [];
    if (chkBet365 && chkBet365.checked) selected.push("bet365");
    if (chkBetfair && chkBetfair.checked) selected.push("betfair");
    if (chkBetnacional && chkBetnacional.checked) selected.push("betnacional");
    if (chkBetano && chkBetano.checked) selected.push("betano");
    return selected;
  }

  function saveActiveHousesPreference() {
    const houses = getSelectedActiveHouses();
    if (
      typeof chrome !== "undefined" &&
      chrome.storage &&
      chrome.storage.local
    ) {
      chrome.storage.local.set({ activeHouses: houses }, () => {
        console.log(
          "[Estação de Trabalho] 💾 Preferência de casas salva:",
          houses,
        );
      });
    }
  }

  function loadActiveHousesPreference() {
    if (
      typeof chrome !== "undefined" &&
      chrome.storage &&
      chrome.storage.local
    ) {
      chrome.storage.local.get(
        { activeHouses: ["bet365", "betfair", "betnacional", "betano"] },
        (res) => {
          const houses = res.activeHouses || ["bet365", "betfair", "betnacional", "betano"];
          if (chkBet365) chkBet365.checked = houses.includes("bet365");
          if (chkBetfair) chkBetfair.checked = houses.includes("betfair");
          if (chkBetnacional) chkBetnacional.checked = houses.includes("betnacional");
          if (chkBetano) chkBetano.checked = houses.includes("betano");
        },
      );
    }
  }

  if (chkBet365)
    chkBet365.addEventListener("change", saveActiveHousesPreference);
  if (chkBetfair)
    chkBetfair.addEventListener("change", saveActiveHousesPreference);
  if (chkBetnacional)
    chkBetnacional.addEventListener("change", saveActiveHousesPreference);
  if (chkBetano)
    chkBetano.addEventListener("change", saveActiveHousesPreference);

  if (btnLaunchHouses) {
    btnLaunchHouses.addEventListener("click", () => {
      const selectedHouses = getSelectedActiveHouses();
      console.log(
        "[Estação de Trabalho] 🚀 Lançando casas selecionadas:",
        selectedHouses,
      );

      if (
        typeof chrome !== "undefined" &&
        chrome.runtime &&
        chrome.runtime.sendMessage
      ) {
        chrome.runtime.sendMessage(
          {
            action: "LAUNCH_SELECTED_HOUSES",
            houses: selectedHouses,
          },
          (response) => {
            if (response && response.connectionStatus) {
              updateConnectionBadges(response.connectionStatus);
            }
          },
        );
      }
    });
  }

  loadActiveHousesPreference();

  function connectPort() {
    try {
      if (
        typeof chrome !== "undefined" &&
        chrome.runtime &&
        chrome.runtime.connect
      ) {
        livePort = chrome.runtime.connect({ name: "dashboard_live_stream" });
        livePort.onMessage.addListener((msg) => {
          if (!msg) return;
          if (msg.type === "SYNC_DASHBOARD") {
            if (msg.payload) renderDashboardUI(msg.payload);
            if (msg.connectionStatus)
              updateConnectionBadges(msg.connectionStatus);
          } else if (msg.type === "ACCOUNT_BALANCE_RESULT" && msg.balance) {
            if (!isZeroVal(msg.balance)) {
              console.log(
                "[FT Engine] 💰 Saldo total carregado como stake!:",
                msg.balance,
              );
              applyStakeValue(msg.balance, true);
            }
          } else if (msg.type === "DYNAMIC_BIND_DISPATCH_RESULT") {
            const houseLabel = msg.house === "betfair" ? "Betfair" : "Bet365";
            if (msg.success && msg.pending) {
              showDashboardBindFeedback(
                `Bind encaminhada para a ${houseLabel}…`,
              );
            } else if (msg.success) {
              showDashboardBindFeedback(`Bind executada na ${houseLabel}.`);
            } else {
              showDashboardBindFeedback(
                msg.reason ||
                  `Não foi possível executar a bind na ${houseLabel}.`,
                true,
              );
            }
          }
        });
        livePort.onDisconnect.addListener(() => {
          livePort = null;
          updateConnectionBadges({ bet365Active: false, betfairActive: false });
          setTimeout(connectPort, 1000);
        });

        if (chrome.runtime.sendMessage) {
          chrome.runtime.sendMessage({ type: "GET_INITIAL_STATE" }, (res) => {
            if (res && res.connectionStatus) {
              updateConnectionBadges(res.connectionStatus);
            }
          });
        }
      }
    } catch (e) {}
  }

  if (
    typeof chrome !== "undefined" &&
    chrome.runtime &&
    chrome.runtime.onMessage
  ) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.connectionStatus) {
        updateConnectionBadges(msg.connectionStatus);
      }
    });
  }

  connectPort();

  function markButtonSelected(btnElement) {
    if (selectedButtonEl) {
      selectedButtonEl.classList.remove("selected-odd");
    }
    if (btnElement) {
      selectedButtonEl = btnElement;
      selectedButtonEl.classList.add("selected-odd");
    }
  }

  function sanitizeId(str) {
    if (!str) return "opt";
    return str
      .toString()
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "_");
  }

  let currentStructuralKey = "";

  function updateOddElement(btn, newValue, isLocked) {
    if (!btn) return;

    const valSpan = btn.querySelector(".val, .odd");
    const currentVal = valSpan ? valSpan.innerText : btn.innerText;

    if (currentVal !== newValue) {
      if (valSpan) {
        valSpan.innerText = newValue;
      } else {
        btn.innerText = newValue;
      }
      btn.setAttribute("data-val", newValue);

      btn.classList.add("flash-update");
      setTimeout(() => btn.classList.remove("flash-update"), 500);
    }

    if (isLocked) {
      btn.classList.add("locked");
      btn.disabled = true;
      btn.style.opacity = "0.5";
      btn.style.pointerEvents = "none";
    } else {
      btn.classList.remove("locked");
      btn.disabled = false;
      btn.style.opacity = "1";
      btn.style.pointerEvents = "auto";
    }
  }

  function patchMarkets(markets) {
    markets.forEach((market) => {
      const marketKey = sanitizeId(market.title);

      if (market.isTable && market.tableRows) {
        prioritizePlayerRows(market).forEach(({ row }, displayRowIndex) => {
          const colOdds = row.colOdds || row.odds || [];
          colOdds.forEach((item, colIndex) => {
            const btnId = `odd-table-${marketKey}-${displayRowIndex}-${colIndex}`;
            const btn = document.getElementById(btnId);
            if (btn) {
              const isLocked =
                item.status === "LOCKED" ||
                item.isClosed === true ||
                item.val === "🔒" ||
                item.odds === "🔒 FECHADO";
              const displayOdds = isLocked ? "🔒" : item.val || item.odds;
              updateOddElement(btn, displayOdds, isLocked);
            }
          });
        });
      } else if (market.participants) {
        market.participants.forEach((p, index) => {
          const btnId = `odd-simple-${marketKey}-${index}`;
          const btn = document.getElementById(btnId);
          if (btn) {
            const isLocked =
              p.status === "LOCKED" ||
              p.isClosed === true ||
              p.val === "🔒" ||
              p.odds === "🔒 FECHADO";
            const displayOdds = isLocked ? "🔒" : p.val || p.odds;
            updateOddElement(btn, displayOdds, isLocked);
          }
        });
      }
    });
  }

  // DELEGAÇÃO DE EVENTOS ÚNICA PARA SELEÇÃO DE ODDS (Evita ouvintes duplicados em múltiplos renders)
  if (marketsContainer) {
    marketsContainer.onclick = (evt) => {
      const playerShortcut = evt.target.closest(".player-rule-shortcut");
      if (playerShortcut) {
        evt.preventDefault();
        evt.stopPropagation();
        const decodeAttribute = (name) => {
          const raw = playerShortcut.getAttribute(name) || "";
          try {
            return decodeURIComponent(raw);
          } catch (e) {
            return raw;
          }
        };
        const marketTitle = decodeAttribute("data-market-title");
        const playerLabel = decodeAttribute("data-player-label");
        const teamMatch = playerLabel.match(/\(([^()]+)\)\s*$/);
        const inferredTeam =
          teamMatch && !/^\d+$/.test(teamMatch[1].trim())
            ? teamMatch[1].trim()
            : "";

        if (playerPriorityHouse)
          playerPriorityHouse.value = selectedHouseMarket;
        if (playerPriorityMarket) playerPriorityMarket.value = marketTitle;
        if (playerPriorityPlayer) {
          playerPriorityPlayer.value = playerLabel
            .replace(/\(\s*\d+\s*\)\s*$/g, "")
            .replace(/\([^()]+\)\s*$/g, "")
            .trim();
        }
        if (playerPriorityTeam) {
          playerPriorityTeam.value = inferredTeam;
          playerPriorityTeam.focus();
        }
        document
          .querySelector(".player-priority-card")
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
        showPlayerPriorityStatus(
          inferredTeam
            ? "Confira os dados e adicione a prioridade."
            : "Informe o time desse jogador para concluir a prioridade.",
        );
        return;
      }

      const favoriteButton = evt.target.closest(".market-favorite-toggle");
      if (favoriteButton) {
        evt.preventDefault();
        evt.stopPropagation();
        let favoriteTitle =
          favoriteButton.getAttribute("data-market-title") || "";
        try {
          favoriteTitle = decodeURIComponent(favoriteTitle);
        } catch (e) {}
        toggleFavoriteMarket(
          favoriteTitle,
          favoriteButton.getAttribute("data-house") || selectedHouseMarket,
        );
        return;
      }

      const b = evt.target.closest(
        ".seu-botao-odd, .odd-btn-table, .odd-button",
      );
      if (!b || b.classList.contains("locked") || b.disabled) return;

      const marketTitle = b.getAttribute("data-markettitle") || "";
      const targetName =
        b.getAttribute("data-name") || b.getAttribute("data-rawname");
      const targetVal = b.getAttribute("data-val");
      const lineName = b.getAttribute("data-linename") || "";
      const optionLabel = b.getAttribute("data-optionlabel") || "";
      const colIndex = parseInt(b.getAttribute("data-colindex") || "0", 10);
      const rowIndex = parseInt(b.getAttribute("data-rowindex") || "0", 10);
      const outcomeId = b.getAttribute("data-outcomeid") || "";

      markButtonSelected(b);
      const intent = createExplicitUserIntent("select_odds");

      if (livePort) {
        livePort.postMessage({
          type: "SELECT_ODDS_ACTION",
          ...intent,
          fastMode: true,
          house: selectedHouseMarket,
          marketTitle: marketTitle,
          name: targetName,
          lineName: lineName,
          optionLabel: optionLabel,
          val: targetVal,
          colIndex: colIndex,
          rowIndex: rowIndex,
          outcomeId: outcomeId,
        });
      } else {
        chrome.runtime
          .sendMessage({
            type: "SELECT_ODDS_ACTION",
            ...intent,
            fastMode: true,
            payload: {
              fastMode: true,
              house: selectedHouseMarket,
              marketTitle: marketTitle,
              name: targetName,
              lineName: lineName,
              optionLabel: optionLabel,
              odds: targetVal,
              colIndex: colIndex,
              rowIndex: rowIndex,
              outcomeId: outcomeId,
            },
          })
          .catch(() => {});
      }
    };
  }

  function renderMarketCard(market) {
    const card = document.createElement("div");
    const marketIsFavorite = isFavoriteMarket(
      market.title,
      selectedHouseMarket,
    );
    card.className = [
      "market-card",
      market.isPlayerMarket ? "mercado-jogadores" : "",
      marketIsFavorite ? "market-card--favorite" : "",
    ]
      .filter(Boolean)
      .join(" ");
    const marketKey = sanitizeId(market.title);
    const encodedMarketTitle = encodeURIComponent(market.title || "");

    let html = `
      <div class="market-header-row">
        <div class="market-header">${market.title}</div>
        <button
          type="button"
          class="market-favorite-toggle ${marketIsFavorite ? "is-favorite" : ""}"
          data-market-title="${encodedMarketTitle}"
          data-house="${selectedHouseMarket}"
          aria-pressed="${marketIsFavorite ? "true" : "false"}"
          aria-label="${marketIsFavorite ? "Remover mercado dos favoritos" : "Adicionar mercado aos favoritos"}"
          title="${marketIsFavorite ? "Remover dos favoritos" : "Priorizar este mercado"}"
        >${marketIsFavorite ? "★" : "☆"}</button>
      </div>`;

    if (market.isTable && market.tableRows && market.tableRows.length > 0) {
      const hasLineCol = market.hasLabelsCol !== false;
      const rowOddCount = market.tableRows.reduce((max, row) => {
        const rowOdds = row.colOdds || row.odds || [];
        return Math.max(max, rowOdds.length);
      }, 0);
      const headerOddCount = Array.isArray(market.headers)
        ? Math.max(0, market.headers.length - (hasLineCol ? 1 : 0))
        : 0;
      const oddCount = Math.max(1, rowOddCount, headerOddCount);
      const useResponsivePlayerLayout = market.isPlayerMarket && oddCount > 5;

      if (useResponsivePlayerLayout) {
        let playerRowsHTML = `
          <div class="player-options-market" aria-label="${escapeHtml(market.title)}">
            <div class="player-options-guide" aria-hidden="true">
              <span>Jogador / contagem</span>
              <span>Linha e odd</span>
            </div>`;

        prioritizePlayerRows(market).forEach(
          ({ row, originalIndex, matchedRule }, displayRowIndex) => {
            const rowLabel = row.lineLabel || `Jogador ${originalIndex + 1}`;
            const encodedPlayerLabel = encodeURIComponent(rowLabel);
            const colOdds = row.colOdds || row.odds || [];

            playerRowsHTML += `
            <div class="player-options-row ${matchedRule ? "player-priority-row" : ""}">
              <div class="player-options-name" title="${escapeHtml(rowLabel)}">
                <span class="player-priority-label">
                  <span class="player-priority-label-text">${escapeHtml(rowLabel)}</span>
                  ${matchedRule ? '<span class="player-priority-badge">Prioridade</span>' : ""}
                  <button
                    type="button"
                    class="player-rule-shortcut ${matchedRule ? "is-configured" : ""}"
                    data-market-title="${encodedMarketTitle}"
                    data-player-label="${encodedPlayerLabel}"
                    aria-label="Configurar prioridade para ${escapeHtml(rowLabel)}"
                    title="Configurar jogador prioritário"
                  >${matchedRule ? "★" : "☆"}</button>
                </span>
              </div>
              <div class="player-options-grid" role="group" aria-label="Linhas de ${escapeHtml(rowLabel)}">`;

            colOdds.forEach((item, colIndex) => {
              const btnId = `odd-table-${marketKey}-${displayRowIndex}-${colIndex}`;
              const isLocked =
                item.status === "LOCKED" ||
                item.isClosed === true ||
                item.val === "🔒" ||
                item.odds === "🔒 FECHADO";
              const displayOdds = isLocked
                ? "🔒"
                : item.val || item.odds || "-";
              const optionLabel =
                item.colHeader ||
                (Array.isArray(market.headers)
                  ? market.headers[colIndex + (hasLineCol ? 1 : 0)]
                  : "") ||
                `${colIndex + 1}+`;
              const targetName =
                item.name || item.rawName || `${rowLabel} ${optionLabel}`;

              playerRowsHTML += `
              <button
                id="${btnId}"
                class="seu-botao-odd player-option-button ${isLocked ? "locked" : ""}"
                ${isLocked ? "disabled" : ""}
                data-markettitle="${escapeHtml(market.title)}"
                data-name="${escapeHtml(targetName)}"
                data-linename="${escapeHtml(rowLabel)}"
                data-optionlabel="${escapeHtml(optionLabel)}"
                data-val="${escapeHtml(displayOdds)}"
                data-rawname="${escapeHtml(targetName)}"
                data-colindex="${colIndex}"
                data-rowindex="${originalIndex}"
                data-outcomeid="${escapeHtml(item.outcomeId || "")}"
                aria-label="${escapeHtml(rowLabel)}, linha ${escapeHtml(optionLabel)}, odd ${escapeHtml(displayOdds)}"
              >
                <span class="player-option-label">${escapeHtml(optionLabel)}</span>
                <span class="val player-option-odd">${escapeHtml(displayOdds)}</span>
              </button>`;
            });

            playerRowsHTML += `
              </div>
            </div>`;
          },
        );

        playerRowsHTML += `</div>`;
        card.innerHTML = html + playerRowsHTML;
        return card;
      }

      const isWideTable = oddCount > 5;
      const tableMinWidth = hasLineCol
        ? 150 + oddCount * 72 + oddCount * 8 + 16
        : oddCount * 72 + (oddCount - 1) * 8 + 16;
      const tableClasses = [
        "bloco-mercado",
        isWideTable ? "bloco-mercado--wide" : "",
        hasLineCol ? "" : "bloco-mercado--no-labels",
      ]
        .filter(Boolean)
        .join(" ");

      let tableHTML = `<div class="${tableClasses}" style="--odd-count:${oddCount}; --table-min-width:${tableMinWidth}px;">`;
      tableHTML += `<div class="tabela-header">`;
      if (market.headers && Array.isArray(market.headers)) {
        market.headers.forEach((h, hIdx) => {
          const colClass = hIdx === 0 && hasLineCol ? "col-linha" : "col-odd";
          tableHTML += `<div class="${colClass}">${h}</div>`;
        });
      }
      tableHTML += `</div>`;

      prioritizePlayerRows(market).forEach(
        ({ row, originalIndex, matchedRule }, displayRowIndex) => {
          const encodedPlayerLabel = encodeURIComponent(row.lineLabel || "");
          tableHTML += `<div class="tabela-row ${matchedRule ? "player-priority-row" : ""}">`;
          if (market.hasLabelsCol !== false && row.lineLabel) {
            tableHTML += `
            <div class="col-linha" title="${escapeHtml(row.lineLabel)}">
              <span class="player-priority-label">
                <span class="player-priority-label-text">${escapeHtml(row.lineLabel)}</span>
                ${matchedRule ? '<span class="player-priority-badge">Prioridade</span>' : ""}
                <button
                  type="button"
                  class="player-rule-shortcut ${matchedRule ? "is-configured" : ""}"
                  data-market-title="${encodedMarketTitle}"
                  data-player-label="${encodedPlayerLabel}"
                  aria-label="Configurar prioridade para ${escapeHtml(row.lineLabel)}"
                  title="Configurar jogador prioritário"
                >${matchedRule ? "★" : "☆"}</button>
              </span>
            </div>`;
          }
          const colOdds = row.colOdds || row.odds || [];
          colOdds.forEach((item, colIndex) => {
            const btnId = `odd-table-${marketKey}-${displayRowIndex}-${colIndex}`;
            const isLocked =
              item.status === "LOCKED" ||
              item.isClosed === true ||
              item.val === "🔒" ||
              item.odds === "🔒 FECHADO";
            const displayOdds = isLocked ? "🔒" : item.val || item.odds;
            const displayName = item.rawName || item.name || "";
            const optionLabel =
              item.colHeader ||
              (Array.isArray(market.headers)
                ? market.headers[colIndex + (hasLineCol ? 1 : 0)]
                : "") ||
              `${colIndex + 1}+`;
            const targetName =
              item.name || `${row.lineLabel || ""} ${optionLabel}`.trim();

            tableHTML += `
            <button id="${btnId}" class="seu-botao-odd ${isLocked ? "locked" : ""}" ${isLocked ? "disabled" : ""} data-markettitle="${escapeHtml(market.title)}" data-name="${escapeHtml(targetName)}" data-linename="${escapeHtml(row.lineLabel || "")}" data-optionlabel="${escapeHtml(optionLabel)}" data-val="${escapeHtml(displayOdds)}" data-rawname="${escapeHtml(displayName)}" data-colindex="${colIndex}" data-rowindex="${originalIndex}" data-outcomeid="${escapeHtml(item.outcomeId || "")}">
              ${displayName && displayName !== displayOdds ? `<span class="name" style="font-size:10px; opacity:0.85; margin-right:4px;">${displayName}</span>` : ""}
              <span class="val">${displayOdds}</span>
            </button>`;
          });
          tableHTML += `</div>`;
        },
      );

      tableHTML += `</div>`;
      card.innerHTML = html + tableHTML;
    } else if (market.participants && market.participants.length > 0) {
      const selections = market.participants;
      const count = selections.length;
      const rowLength = count % 3 === 0 ? 3 : count % 2 === 0 ? 2 : 3;

      let gridHTML = `<div class="simple-grid-container">`;

      for (let i = 0; i < selections.length; i += rowLength) {
        gridHTML += `<div class="market-1x2-container" style="margin-bottom: 6px;">`;
        const chunk = selections.slice(i, i + rowLength);
        chunk.forEach((p, chunkIdx) => {
          const pIndex = i + chunkIdx;
          const btnId = `odd-simple-${marketKey}-${pIndex}`;
          const isLocked =
            p.status === "LOCKED" ||
            p.isClosed === true ||
            p.val === "🔒" ||
            p.odds === "🔒 FECHADO";
          const displayName = p.name || p.rawName || "Opção";
          const displayOdds = isLocked ? "🔒" : p.val || p.odds;

          gridHTML += `
            <button id="${btnId}" class="odd-button ${isLocked ? "locked" : ""}" ${isLocked ? "disabled" : ""} data-markettitle="${market.title}" data-name="${displayName}" data-val="${displayOdds}" data-outcomeid="${escapeHtml(p.outcomeId || "")}">
              <span class="name" title="${displayName}">${displayName}</span>
              <span class="odd">${displayOdds}</span>
            </button>`;
        });
        gridHTML += `</div>`;
      }
      gridHTML += `</div>`;
      card.innerHTML = html + gridHTML;
    }

    return card;
  }

  function getStructuralKey(markets) {
    if (!markets || !Array.isArray(markets)) return "";
    return markets
      .map((m) => {
        const rowsCount = m.tableRows
          ? m.tableRows.length
          : m.participants
            ? m.participants.length
            : 0;
        const columnsCount = m.tableRows
          ? m.tableRows.reduce(
              (max, row) =>
                Math.max(max, (row.colOdds || row.odds || []).length),
              0,
            )
          : 0;
        const headersKey = Array.isArray(m.headers) ? m.headers.join("|") : "";
        const rowLabelsKey = Array.isArray(m.tableRows)
          ? m.tableRows.map((row) => row.lineLabel || "").join("|")
          : "";
        const rowOptionHeadersKey = Array.isArray(m.tableRows)
          ? m.tableRows
              .map((row) =>
                (row.colOdds || row.odds || [])
                  .map((item) => item.colHeader || "")
                  .join(","),
              )
              .join(";")
          : "";
        const participantNamesKey = Array.isArray(m.participants)
          ? m.participants
              .map((item) => item.rawName || item.name || "")
              .join("|")
          : "";
        return `${m.title}_${m.isTable ? "tbl" : "grid"}_${rowsCount}_${columnsCount}_${headersKey}_${rowLabelsKey}_${rowOptionHeadersKey}_${participantNamesKey}`;
      })
      .join("|");
  }

  function renderMarkets(markets) {
    if (!marketsContainer) return;
    if (!markets || !Array.isArray(markets) || markets.length === 0) return;

    const prioritizedMarkets = sortMarketsByFavorites(
      markets,
      selectedHouseMarket,
    );
    const newKey = getStructuralKey(prioritizedMarkets);

    // PATCHING: Se a estrutura é idêntica, apenas atualiza valores em-lugar sem resetar o DOM/scroll
    if (
      newKey === currentStructuralKey &&
      marketsContainer.children.length > 0
    ) {
      patchMarkets(prioritizedMarkets);
      return;
    }

    currentStructuralKey = newKey;
    const scrollTop = marketsContainer.scrollTop;

    marketsContainer.innerHTML = "";

    prioritizedMarkets.forEach((market) => {
      const cardEl = renderMarketCard(market);
      if (cardEl) {
        marketsContainer.appendChild(cardEl);
      }
    });

    marketsContainer.scrollTop = scrollTop;
  }

  function renderDashboardUI(state, isForce = false) {
    if (!state) return;

    const siteName = (state.siteName || "Bet365").toLowerCase();
    const houseKey = siteName.includes("betfair") ? "betfair" : "bet365";
    const previousContextKey = JSON.stringify(
      activeEventContextByHouse[houseKey] || {},
    );
    activeEventContextByHouse[houseKey] = state.eventContext || null;
    const nextContextKey = JSON.stringify(
      activeEventContextByHouse[houseKey] || {},
    );
    if (previousContextKey !== nextContextKey) currentStructuralKey = "";
    marketStatesByHouse[houseKey] = state;

    if (!isForce && houseKey !== selectedHouseMarket) {
      return;
    }

    if (state.betslip) {
      betslipActiveText.textContent = state.betslip;
      betslipActiveText.style.color = "#00ff88";
    } else {
      betslipActiveText.textContent =
        "Clique em qualquer odd na casa para carregar no cupom";
      betslipActiveText.style.color = "#a0acba";
    }

    if (state.groups || state.markets) {
      updatePlayerPrioritySuggestions(state, houseKey);
      if (
        dynamicBindsModal &&
        !dynamicBindsModal.hidden &&
        dynamicBindHouse?.value === houseKey
      ) {
        updateDynamicBindGuidedOptions({
          team: dynamicBindTeam?.value || "",
          market: dynamicBindMarket?.value || "",
          player: dynamicBindPlayer?.value || "",
          line: dynamicBindLine?.value || "",
        });
      }
      renderMarkets(state.groups || state.markets);
    }
  }

  btnFireNow.addEventListener("click", () => {
    if (livePort) {
      livePort.postMessage({
        type: "TRIGGER_BET_ACTION",
        ...createExplicitUserIntent("trigger_bet"),
      });
    }
  });

  const autoTriggerChk = document.getElementById("chk-auto-trigger");
  if (autoTriggerChk) {
    chrome.storage.local.get(["autoTriggerDirectBool"], (res) => {
      autoTriggerChk.checked = !!res.autoTriggerDirectBool;
    });

    autoTriggerChk.addEventListener("change", (e) => {
      const isDirectEnabled = e.target.checked;
      chrome.storage.local.set(
        { autoTriggerDirectBool: isDirectEnabled },
        () => {
          console.log(
            `[Fast Trigger] 🎛️ Disparo Direto: ${isDirectEnabled ? "ATIVADO" : "DESATIVADO"}`,
          );
        },
      );
    });
  }

  // =========================================================================
  // GESTÃO DE AUTENTICAÇÃO, TRIAL 24H E LICENÇA NO PAINEL
  // =========================================================================
  const authModal = document.getElementById("authModal");
  const authStatusBanner = document.getElementById("authStatusBanner");
  const tabSignIn = document.getElementById("tabSignIn");
  const tabSignUp = document.getElementById("tabSignUp");
  const authForm = document.getElementById("authForm");
  const authEmail = document.getElementById("authEmail");
  const authPassword = document.getElementById("authPassword");
  const authRememberAccess = document.getElementById("authRememberAccess");
  const authRememberGroup = document.getElementById("authRememberGroup");
  const btnAuthSubmit = document.getElementById("btnAuthSubmit");
  const userLicenseBadge = document.getElementById("userLicenseBadge");
  const btnLogout = document.getElementById("btnLogout");

  const authTabsWrapper = document.getElementById("authTabsWrapper");
  const verifyEmailView = document.getElementById("verify-email-view");
  const userRegisteredEmailTag = document.getElementById(
    "user-registered-email",
  );
  const btnCheckEmailConfirmed = document.getElementById(
    "btnCheckEmailConfirmed",
  );
  const btnResendEmail = document.getElementById("btnResendEmail");

  const renewSubscriptionView = document.getElementById(
    "renew-subscription-view",
  );
  const btnGeneratePix = document.getElementById("btnGeneratePix");
  const pixDisplayContainer = document.getElementById("pixDisplayContainer");
  const pixLoadingSpinner = document.getElementById("pixLoadingSpinner");
  const pixContentWrapper = document.getElementById("pixContentWrapper");
  const pixQrCodeImg = document.getElementById("pixQrCodeImg");
  const pixCopiaEColaInput = document.getElementById("pixCopiaEColaInput");
  const btnCopyPixCode = document.getElementById("btnCopyPixCode");

  let confirmationPollingTimer = null;
  let pixPollingTimer = null;
  let activeRegistrationEmail = "";
  let activeRegistrationPassword = "";
  let activeRememberAccess = true;
  let currentAuthMode = "signin";

  chrome.storage.local.get({ gbr_remember_access: true }, (stored) => {
    activeRememberAccess = stored.gbr_remember_access !== false;
    if (authRememberAccess) authRememberAccess.checked = activeRememberAccess;
  });

  if (authRememberAccess) {
    authRememberAccess.addEventListener("change", () => {
      activeRememberAccess = !!authRememberAccess.checked;
      chrome.storage.local.set({ gbr_remember_access: activeRememberAccess });
    });
  }

  function stopConfirmationPolling() {
    if (confirmationPollingTimer) {
      clearInterval(confirmationPollingTimer);
      confirmationPollingTimer = null;
    }
  }

  function stopPixPolling() {
    if (pixPollingTimer) {
      clearInterval(pixPollingTimer);
      pixPollingTimer = null;
    }
  }

  function showEmailVerificationScreen(email, password) {
    activeRegistrationEmail = email;
    activeRegistrationPassword = password;

    stopPixPolling();
    if (renewSubscriptionView) renewSubscriptionView.style.display = "none";
    if (authTabsWrapper) authTabsWrapper.style.display = "none";
    if (authForm) authForm.style.display = "none";
    if (authStatusBanner) authStatusBanner.style.display = "none";

    if (userRegisteredEmailTag) userRegisteredEmailTag.textContent = email;
    if (verifyEmailView) verifyEmailView.style.display = "flex";

    startConfirmationPolling(email, password);
  }

  function showRenewSubscriptionScreen() {
    stopConfirmationPolling();
    if (verifyEmailView) verifyEmailView.style.display = "none";
    if (authTabsWrapper) authTabsWrapper.style.display = "none";
    if (authForm) authForm.style.display = "none";

    if (renewSubscriptionView) renewSubscriptionView.style.display = "flex";
  }

  function resetAuthModalView() {
    stopConfirmationPolling();
    stopPixPolling();
    if (verifyEmailView) verifyEmailView.style.display = "none";
    if (renewSubscriptionView) renewSubscriptionView.style.display = "none";
    if (authTabsWrapper) authTabsWrapper.style.display = "flex";
    if (authForm) authForm.style.display = "flex";
  }

  function startPixPaymentPolling() {
    stopPixPolling();

    pixPollingTimer = setInterval(async () => {
      try {
        if (typeof checkLicenseStatus === "function") {
          const res = await checkLicenseStatus();
          if (res && res.valid && res.profile?.status === "active") {
            stopPixPolling();
            showAuthStatusBanner(
              "info",
              "🎉 Pagamento Confirmado! Assinatura Ativa por 30 dias!",
            );
            setTimeout(verifyDashboardLicense, 1500);
          }
        }
      } catch (e) {}
    }, 3000);
  }

  if (btnGeneratePix) {
    btnGeneratePix.addEventListener("click", async () => {
      btnGeneratePix.disabled = true;
      btnGeneratePix.textContent = "Gerando Pix Seguro...";

      if (pixDisplayContainer) pixDisplayContainer.style.display = "flex";
      if (pixLoadingSpinner) pixLoadingSpinner.style.display = "flex";
      if (pixContentWrapper) pixContentWrapper.style.display = "none";

      try {
        const storageData = await new Promise((r) =>
          chrome.storage.local.get(["gbr_auth_token"], r),
        );
        const getSessionFn =
          typeof getValidGbrAuthSession === "function"
            ? getValidGbrAuthSession
            : typeof window !== "undefined"
              ? window.getValidGbrAuthSession
              : null;
        const validSession = getSessionFn ? await getSessionFn(false) : null;
        const token =
          validSession?.access_token ||
          (storageData ? storageData.gbr_auth_token : null);

        if (!token) {
          showAuthStatusBanner(
            "error",
            "Sessão expirada. Faça login novamente.",
          );
          resetAuthModalView();
          return;
        }

        const baseUrl =
          typeof SUPABASE_URL !== "undefined"
            ? SUPABASE_URL
            : window.SUPABASE_URL || "";
        const response = await fetch(
          `${baseUrl}/functions/v1/create-pix-charge`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
          },
        );

        const resData = await response.json();

        if (!response.ok || !resData.success) {
          showAuthStatusBanner(
            "error",
            `❌ ${resData.error || "Erro ao gerar cobrança Pix."}`,
          );
          if (pixDisplayContainer) pixDisplayContainer.style.display = "none";
        } else {
          if (pixQrCodeImg) pixQrCodeImg.src = resData.qrcode;
          if (pixCopiaEColaInput)
            pixCopiaEColaInput.value = resData.pixCopiaECola;

          if (pixLoadingSpinner) pixLoadingSpinner.style.display = "none";
          if (pixContentWrapper) pixContentWrapper.style.display = "flex";

          startPixPaymentPolling();
        }
      } catch (err) {
        console.error("[Dashboard Pix] Erro ao gerar Pix:", err);
        showAuthStatusBanner("error", "❌ Falha de conexão ao gerar Pix.");
        if (pixDisplayContainer) pixDisplayContainer.style.display = "none";
      } finally {
        btnGeneratePix.disabled = false;
        btnGeneratePix.textContent = "⚡ Gerar QR Code Pix (R$ 50,00)";
      }
    });
  }

  if (btnCopyPixCode) {
    btnCopyPixCode.addEventListener("click", () => {
      if (!pixCopiaEColaInput || !pixCopiaEColaInput.value) return;
      navigator.clipboard
        .writeText(pixCopiaEColaInput.value)
        .then(() => {
          const origText = btnCopyPixCode.textContent;
          btnCopyPixCode.textContent = "✓ Copiado!";
          btnCopyPixCode.style.color = "#00ff88";
          setTimeout(() => {
            btnCopyPixCode.textContent = origText;
            btnCopyPixCode.style.color = "#ffffff";
          }, 1500);
        })
        .catch(() => {
          pixCopiaEColaInput.select();
          document.execCommand("copy");
        });
    });
  }

  function startConfirmationPolling(email, password) {
    stopConfirmationPolling();

    confirmationPollingTimer = setInterval(async () => {
      try {
        const loginValFn =
          typeof loginAndValidate === "function"
            ? loginAndValidate
            : window.loginAndValidate;
        if (loginValFn) {
          const res = await loginValFn(email, password, activeRememberAccess);
          if (res && res.success) {
            stopConfirmationPolling();
            showAuthStatusBanner(
              "info",
              "✅ E-mail confirmado com sucesso! Liberando acesso...",
            );
            if (verifyEmailView) verifyEmailView.style.display = "none";
            setTimeout(verifyDashboardLicense, 1200);
          }
        }
      } catch (e) {}
    }, 4000);
  }

  if (btnCheckEmailConfirmed) {
    btnCheckEmailConfirmed.addEventListener("click", async () => {
      if (!activeRegistrationEmail || !activeRegistrationPassword) return;

      btnCheckEmailConfirmed.disabled = true;
      btnCheckEmailConfirmed.textContent = "Verificando...";

      try {
        const loginValFn =
          typeof loginAndValidate === "function"
            ? loginAndValidate
            : window.loginAndValidate;
        const res = await loginValFn(
          activeRegistrationEmail,
          activeRegistrationPassword,
          activeRememberAccess,
        );

        if (res && res.success) {
          stopConfirmationPolling();
          showAuthStatusBanner(
            "info",
            "✅ E-mail confirmado com sucesso! Liberando acesso...",
          );
          if (verifyEmailView) verifyEmailView.style.display = "none";
          setTimeout(verifyDashboardLicense, 1000);
        } else {
          showAuthStatusBanner(
            "warning",
            "⏱️ E-mail ainda não confirmado. Verifique sua caixa de entrada.",
          );
        }
      } catch (err) {
        showAuthStatusBanner("error", "❌ Erro ao checar confirmação.");
      } finally {
        btnCheckEmailConfirmed.disabled = false;
        btnCheckEmailConfirmed.textContent = "Já Confirmei o E-mail";
      }
    });
  }

  if (btnResendEmail) {
    btnResendEmail.addEventListener("click", async () => {
      if (!activeRegistrationEmail) return;

      btnResendEmail.disabled = true;
      btnResendEmail.textContent = "Reenviando...";

      try {
        const resendFn =
          typeof resendConfirmationEmail === "function"
            ? resendConfirmationEmail
            : window.resendConfirmationEmail;
        if (resendFn) {
          const res = await resendFn(activeRegistrationEmail);
          if (res && !res.error) {
            showAuthStatusBanner(
              "info",
              "📩 E-mail de confirmação reenviado! Verifique sua caixa de entrada.",
            );
          } else {
            showAuthStatusBanner(
              "error",
              `❌ ${res?.message || "Erro ao reenviar e-mail."}`,
            );
          }
        }
      } catch (err) {
        showAuthStatusBanner("error", "❌ Erro de conexão ao reenviar e-mail.");
      } finally {
        btnResendEmail.disabled = false;
        btnResendEmail.textContent =
          "Não recebeu? Reenviar e-mail de confirmação";
      }
    });
  }

  function showAuthStatusBanner(type, message) {
    if (!authStatusBanner) return;
    const translator =
      typeof translateAuthError === "function"
        ? translateAuthError
        : typeof window !== "undefined" && window.translateAuthError
          ? window.translateAuthError
          : (m) => m;

    const formattedMessage =
      type === "error" && message ? translator(message) : message;

    authStatusBanner.className = `auth-status-banner ${type}`;
    authStatusBanner.textContent = formattedMessage;
    authStatusBanner.style.display = "block";
  }

  function updateAuthTabs(mode) {
    currentAuthMode = mode;
    resetAuthModalView();

    const authSubtitle = document.getElementById("authSubtitle");
    const authPromoBanner = document.getElementById("authPromoBanner");
    const authNameGroup = document.getElementById("authNameGroup");
    const authConfirmPasswordGroup = document.getElementById(
      "authConfirmPasswordGroup",
    );

    if (mode === "signup") {
      tabSignUp.classList.add("active");
      tabSignIn.classList.remove("active");
      tabSignUp.style.background = "#10B981";
      tabSignUp.style.color = "#090D16";
      tabSignIn.style.background = "transparent";
      tabSignIn.style.color = "#94A3B8";

      if (authSubtitle)
        authSubtitle.textContent = "Crie sua conta para começar seu teste";
      if (authPromoBanner) authPromoBanner.style.display = "flex";
      if (authNameGroup) authNameGroup.style.display = "flex";
      if (authConfirmPasswordGroup)
        authConfirmPasswordGroup.style.display = "flex";
      if (authRememberGroup) authRememberGroup.style.display = "none";

      btnAuthSubmit.textContent = "⚡ Criar Minha Conta Grátis";
    } else {
      tabSignIn.classList.add("active");
      tabSignUp.classList.remove("active");
      tabSignIn.style.background = "#10B981";
      tabSignIn.style.color = "#090D16";
      tabSignUp.style.background = "transparent";
      tabSignUp.style.color = "#94A3B8";

      if (authSubtitle)
        authSubtitle.textContent = "Autenticação & Validação de Licença";
      if (authPromoBanner) authPromoBanner.style.display = "none";
      if (authNameGroup) authNameGroup.style.display = "none";
      if (authConfirmPasswordGroup)
        authConfirmPasswordGroup.style.display = "none";
      if (authRememberGroup) authRememberGroup.style.display = "flex";

      btnAuthSubmit.textContent = "⚡ Entrar no GatilhoBR";
    }
    if (authStatusBanner) authStatusBanner.style.display = "none";
  }

  if (tabSignIn)
    tabSignIn.addEventListener("click", () => updateAuthTabs("signin"));
  if (tabSignUp)
    tabSignUp.addEventListener("click", () => updateAuthTabs("signup"));

  // Vincular eventos do gerenciador de assinatura e checkout Pix
  const btnRenewLicense = document.getElementById("btn-renew-license");
  const btnClosePixModal = document.getElementById("btn-close-pix-modal");
  const btnCopyPixKey = document.getElementById("btn-copy-pix");
  const btnCopyPixIcon = document.getElementById("btn-copy-pix-icon");
  const filterMarketsSelect = document.getElementById("filter-markets");

  if (btnRenewLicense) {
    btnRenewLicense.addEventListener("click", () => {
      const gerarPixFn =
        typeof gerarCobrancaPix === "function"
          ? gerarCobrancaPix
          : window.gerarCobrancaPix;
      if (typeof gerarPixFn === "function") gerarPixFn();
    });
  }

  if (btnClosePixModal) {
    btnClosePixModal.addEventListener("click", () => {
      const fecharPixFn =
        typeof fecharModalPix === "function"
          ? fecharModalPix
          : window.fecharModalPix;
      if (typeof fecharPixFn === "function") fecharPixFn();
    });
  }

  const triggerCopyPix = () => {
    const copiarPixFn =
      typeof copiarChavePix === "function"
        ? copiarChavePix
        : window.copiarChavePix;
    if (typeof copiarPixFn === "function") copiarPixFn();
  };

  if (btnCopyPixKey) btnCopyPixKey.addEventListener("click", triggerCopyPix);
  if (btnCopyPixIcon) btnCopyPixIcon.addEventListener("click", triggerCopyPix);

  if (filterMarketsSelect) {
    filterMarketsSelect.addEventListener("change", (e) => {
      const val = e.target.value.toLowerCase();
      const cards = document.querySelectorAll(".market-card");
      cards.forEach((card) => {
        const title = (
          card.querySelector(".market-header")?.textContent || ""
        ).toLowerCase();
        if (val === "all") {
          card.style.display = "block";
        } else if (
          val === "gols" &&
          (title.includes("gol") ||
            title.includes("3º") ||
            title.includes("partida - gols"))
        ) {
          card.style.display = "block";
        } else if (
          val === "escanteios" &&
          (title.includes("escanteio") ||
            title.includes("cart") ||
            title.includes("corner"))
        ) {
          card.style.display = "block";
        } else if (
          val === "resultado" &&
          (title.includes("resultado") ||
            title.includes("1x2") ||
            title.includes("vencedor"))
        ) {
          card.style.display = "block";
        } else {
          card.style.display = "none";
        }
      });
    });
  }

  async function verifyDashboardLicense() {
    const authModal = document.getElementById("authModal");
    const userLicenseBadge = document.getElementById("userLicenseBadge");
    const btnLogout = document.getElementById("btnLogout");
    const subscriptionStatusText = document.getElementById(
      "subscription-status-text",
    );

    const checkLicenseFn =
      typeof checkUserLicenseSecure === "function"
        ? checkUserLicenseSecure
        : window.checkUserLicenseSecure ||
          (typeof checkLicenseStatus === "function"
            ? checkLicenseStatus
            : null);

    if (!checkLicenseFn) {
      console.warn(
        "[Dashboard] Nenhuma função de licenciamento segura disponível.",
      );
      return false;
    }

    const res = await checkLicenseFn();
    console.log(
      "[Dashboard Licensing] 🔒 Resultado do check de licença segura:",
      res,
    );

    if (res && res.isValid) {
      if (typeof stopConfirmationPolling === "function")
        stopConfirmationPolling();
      if (typeof stopPixPolling === "function") stopPixPolling();

      if (authModal) authModal.style.display = "none";
      if (btnLogout) btnLogout.style.display = "inline-block";

      // 1. CONTA DEV / ADMIN (ILIMITADA)
      if (res.isDev) {
        if (typeof pararTrialTimer === "function") pararTrialTimer();

        if (subscriptionStatusText) {
          subscriptionStatusText.textContent =
            "⚙️ CONTA DEV (Acesso Ilimitado)";
          subscriptionStatusText.style.color = "#38BDF8";
        }

        if (userLicenseBadge) {
          userLicenseBadge.textContent = "⚙️ CONTA DEV (ILIMITADA)";
          userLicenseBadge.style.display = "inline-flex";
          userLicenseBadge.style.background = "#8B5CF6";
          userLicenseBadge.style.color = "#FFFFFF";
        }
        return true;
      }

      // 2. ASSINATURA ATIVA
      if (res.isActive) {
        if (typeof pararTrialTimer === "function") pararTrialTimer();
        const formattedDate =
          typeof formatDateBR === "function"
            ? formatDateBR(res.expiresAt)
            : "Ativa";
        const msg = `⚡ Assinatura Ativa (Ativo até: ${formattedDate})`;

        if (subscriptionStatusText) {
          subscriptionStatusText.textContent = msg;
          subscriptionStatusText.style.color = "#10B981";
        }

        if (userLicenseBadge) {
          userLicenseBadge.textContent = "⚡ ASSINATURA ATIVA";
          userLicenseBadge.style.display = "inline-flex";
          userLicenseBadge.style.background = "rgba(16, 185, 129, 0.2)";
          userLicenseBadge.style.color = "#10B981";
        }
        return true;
      }

      // 3. PERÍODO DE TESTE (TRIAL 24H)
      if (res.isTrial) {
        if (typeof startTrialTimer === "function") {
          startTrialTimer(res.trialEndsAt);
        }
        return true;
      }

      return true;
    } else {
      if (authModal) authModal.style.display = "flex";
      if (userLicenseBadge) userLicenseBadge.style.display = "none";
      if (btnLogout) btnLogout.style.display = "none";

      const reason = res ? res.reason : "USER_NOT_AUTHENTICATED";

      const storageData = await new Promise((r) =>
        chrome.storage.local.get(["gbr_auth_token"], r),
      );
      const hasToken = !!(storageData && storageData.gbr_auth_token);

      if (
        (reason === "TRIAL_EXPIRED" ||
          reason === "SUBSCRIPTION_EXPIRED" ||
          reason === "INACTIVE_LICENSE" ||
          reason === "trial_expired" ||
          reason === "license_expired") &&
        hasToken
      ) {
        if (typeof showRenewSubscriptionScreen === "function")
          showRenewSubscriptionScreen();
        if (typeof showAuthStatusBanner === "function") {
          showAuthStatusBanner(
            "warning",
            "🔒 Assinatura Expirada: Renove para liberar o GatilhoBR.",
          );
        }
      } else {
        if (typeof resetAuthModalView === "function") resetAuthModalView();
        if (typeof showAuthStatusBanner === "function") {
          showAuthStatusBanner(
            "info",
            "🔑 Realize o login ou crie sua conta para utilizar o GatilhoBR.",
          );
        }
      }
      return false;
    }
  }

  if (authForm) {
    authForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = authEmail.value.trim();
      const password = authPassword.value.trim();
      activeRememberAccess = authRememberAccess
        ? !!authRememberAccess.checked
        : true;

      if (!email || !password) {
        showAuthStatusBanner("error", "Preencha todos os campos obrigatórios.");
        return;
      }

      btnAuthSubmit.disabled = true;
      btnAuthSubmit.textContent = "Aguarde...";

      try {
        if (currentAuthMode === "signup") {
          // Limpeza prévia de sessão e tokens antigos para evitar envio de sessão expirada
          const clearSessionFn =
            typeof clearGbrAuthSession === "function"
              ? clearGbrAuthSession
              : window.clearGbrAuthSession;
          if (clearSessionFn) {
            await clearSessionFn();
          } else {
            await new Promise((r) =>
              chrome.storage.local.remove(
                [
                  "gbr_auth_token",
                  "gbr_refresh_token",
                  "gbr_auth_expires_at",
                  "gbr_user_id",
                  "gbr_user_email",
                  "gbr_license_status",
                  "gbr_user_profile",
                ],
                r,
              ),
            );
          }
          if (typeof localStorage !== "undefined") {
            try {
              localStorage.clear();
            } catch (e) {}
          }

          const genFingerprintFn =
            typeof generateDeviceFingerprint === "function"
              ? generateDeviceFingerprint
              : window.generateDeviceFingerprint || (async () => "fp_default");

          const fingerprint = await genFingerprintFn();
          const signUpFn =
            typeof signUpUser === "function" ? signUpUser : window.signUpUser;

          const res = await signUpFn(email, password, fingerprint);

          if (res.error) {
            showAuthStatusBanner("error", `❌ ${res.message}`);
          } else {
            const token = res.access_token;
            const userId = res.user ? res.user.id : null;

            if (token && userId) {
              const persistSessionFn =
                typeof persistGbrAuthSession === "function"
                  ? persistGbrAuthSession
                  : window.persistGbrAuthSession;
              if (persistSessionFn) {
                await persistSessionFn(res, activeRememberAccess);
              } else {
                await new Promise((r) =>
                  chrome.storage.local.set(
                    {
                      gbr_auth_token: token,
                      gbr_user_id: userId,
                      gbr_remember_access: activeRememberAccess,
                    },
                    r,
                  ),
                );
              }
              showAuthStatusBanner(
                "info",
                "⏱️ Seu teste de 24 horas está ativo!",
              );
              setTimeout(verifyDashboardLicense, 800);
            } else {
              showEmailVerificationScreen(email, password);
            }
          }
        } else {
          const loginValFn =
            typeof loginAndValidate === "function"
              ? loginAndValidate
              : window.loginAndValidate;
          let res;
          if (loginValFn) {
            res = await loginValFn(email, password, activeRememberAccess);
            if (!res.success) {
              showAuthStatusBanner(
                "error",
                `❌ ${res.error || "Falha na autenticação."}`,
              );
            } else {
              const isValid = await verifyDashboardLicense();
              if (isValid) {
                showAuthStatusBanner("info", "✅ Autenticado com sucesso!");
              }
            }
          } else {
            const signInFn =
              typeof signInUser === "function" ? signInUser : window.signInUser;
            res = await signInFn(email, password);

            if (res.error) {
              showAuthStatusBanner("error", `❌ ${res.message}`);
            } else {
              const persistSessionFn =
                typeof persistGbrAuthSession === "function"
                  ? persistGbrAuthSession
                  : window.persistGbrAuthSession;
              if (persistSessionFn) {
                await persistSessionFn(res, activeRememberAccess);
              } else {
                await new Promise((r) =>
                  chrome.storage.local.set(
                    {
                      gbr_auth_token: res.access_token,
                      gbr_user_id: res.user.id,
                      gbr_remember_access: activeRememberAccess,
                    },
                    r,
                  ),
                );
              }
              const isValid = await verifyDashboardLicense();
              if (isValid) {
                showAuthStatusBanner("info", "✅ Autenticado com sucesso!");
              }
            }
          }
        }
      } catch (err) {
        showAuthStatusBanner(
          "error",
          `❌ ${err.message || "Ocorreu um erro inesperado ao conectar."}`,
        );
        console.error("[Dashboard Auth] Erro:", err);
      } finally {
        btnAuthSubmit.disabled = false;
        btnAuthSubmit.textContent =
          currentAuthMode === "signup"
            ? "🚀 Criar Conta & Ativar Teste (24h)"
            : "⚡ Entrar no GatilhoBR";
      }
    });
  }

  if (btnLogout) {
    btnLogout.addEventListener("click", async () => {
      const signOutFn =
        typeof signOutUser === "function" ? signOutUser : window.signOutUser;
      if (signOutFn) {
        await signOutFn();
      } else {
        await new Promise((r) =>
          chrome.storage.local.remove(
            [
              "gbr_auth_token",
              "gbr_refresh_token",
              "gbr_auth_expires_at",
              "gbr_user_id",
              "gbr_license_status",
              "gbr_user_profile",
            ],
            r,
          ),
        );
      }
      verifyDashboardLicense();
    });
  }

  // =========================================================================
  // EXPORTAÇÃO E IMPORTAÇÃO DE PRESETS COMPARTILHADOS (GBR-XXXX)
  // =========================================================================
  const presetNameInput = document.getElementById("presetNameInput");
  const btnExportPreset = document.getElementById("btnExportPreset");
  const exportResultWrapper = document.getElementById("exportResultWrapper");
  const presetGeneratedCode = document.getElementById("presetGeneratedCode");
  const btnCopyPresetCode = document.getElementById("btnCopyPresetCode");
  const exportStatusBanner = document.getElementById("exportStatusBanner");

  const presetCodeInput = document.getElementById("presetCodeInput");
  const btnImportPreset = document.getElementById("btnImportPreset");
  const importStatusBanner = document.getElementById("importStatusBanner");

  if (btnExportPreset) {
    btnExportPreset.addEventListener("click", async () => {
      const presetName = presetNameInput ? presetNameInput.value.trim() : "";

      btnExportPreset.disabled = true;
      btnExportPreset.textContent = "Gerando código...";

      if (exportStatusBanner) exportStatusBanner.style.display = "none";

      const exportFn =
        typeof exportPreset === "function" ? exportPreset : window.exportPreset;
      const res = await exportFn(presetName);

      if (res.success && res.code) {
        if (presetGeneratedCode) presetGeneratedCode.value = res.code;
        if (exportResultWrapper) exportResultWrapper.style.display = "flex";
        if (exportStatusBanner) {
          exportStatusBanner.style.color = "#00ff88";
          exportStatusBanner.textContent = `✅ Código ${res.code} gerado com sucesso!`;
          exportStatusBanner.style.display = "block";
        }
      } else {
        if (exportResultWrapper) exportResultWrapper.style.display = "none";
        if (exportStatusBanner) {
          exportStatusBanner.style.color = "#ff6b81";
          exportStatusBanner.textContent = `❌ ${res.message || "Erro ao exportar preset."}`;
          exportStatusBanner.style.display = "block";
        }
      }

      btnExportPreset.disabled = false;
      btnExportPreset.textContent = "🚀 Gerar Código de Compartilhamento";
    });
  }

  if (btnCopyPresetCode) {
    btnCopyPresetCode.addEventListener("click", () => {
      if (!presetGeneratedCode || !presetGeneratedCode.value) return;
      navigator.clipboard
        .writeText(presetGeneratedCode.value)
        .then(() => {
          const origText = btnCopyPresetCode.textContent;
          btnCopyPresetCode.textContent = "✓ Copiado!";
          btnCopyPresetCode.style.color = "#00ff88";
          setTimeout(() => {
            btnCopyPresetCode.textContent = origText;
            btnCopyPresetCode.style.color = "#fff";
          }, 1500);
        })
        .catch(() => {
          presetGeneratedCode.select();
          document.execCommand("copy");
        });
    });
  }

  if (btnImportPreset) {
    btnImportPreset.addEventListener("click", async () => {
      const code = presetCodeInput ? presetCodeInput.value.trim() : "";

      if (!code) {
        if (importStatusBanner) {
          importStatusBanner.style.color = "#ff6b81";
          importStatusBanner.textContent =
            "❌ Digite um código de preset (ex: GBR-8X91).";
          importStatusBanner.style.display = "block";
        }
        return;
      }

      btnImportPreset.disabled = true;
      btnImportPreset.textContent = "Importando...";

      if (importStatusBanner) importStatusBanner.style.display = "none";

      const importFn =
        typeof importPreset === "function" ? importPreset : window.importPreset;
      const res = await importFn(code);

      if (res.success) {
        if (importStatusBanner) {
          importStatusBanner.style.color = "#00ff88";
          importStatusBanner.textContent = `✅ Configuração '${res.name}' aplicada com sucesso!`;
          importStatusBanner.style.display = "block";
        }

        // Recarrega o valor da stake exibido no painel
        chrome.storage.local.get(
          ["fastTriggerStakeVal", "stakeVal"],
          (localRes) => {
            const val =
              localRes.fastTriggerStakeVal || localRes.stakeVal || "0.50";
            if (typeof applyStakeValue === "function")
              applyStakeValue(val, false);
          },
        );
      } else {
        if (importStatusBanner) {
          importStatusBanner.style.color = "#ff6b81";
          importStatusBanner.textContent = `❌ ${res.message || "Erro ao importar preset."}`;
          importStatusBanner.style.display = "block";
        }
      }

      btnImportPreset.disabled = false;
      btnImportPreset.textContent = "📥 Importar Configuração";
    });
  }

  // Executa validação de licença ao inicializar o dashboard
  verifyDashboardLicense();

  // -------------------------------------------------------------------------
  // INTEGRAÇÃO DESKTOP: AUTO-UPDATE & NOTIFICAÇÕES
  // -------------------------------------------------------------------------
  const btnCheckUpdate = document.getElementById("btn-check-update");
  const modalUpdate = document.getElementById("modal-desktop-update");
  const updateInfoEl = document.getElementById("desktop-update-info");
  const updateNotesEl = document.getElementById("desktop-update-notes");
  const btnCloseUpdate = document.getElementById("btn-close-update-modal");
  const btnDownloadUpdate = document.getElementById("btn-download-update");
  let currentDownloadUrl = "";

  function showUpdateModal(info) {
    if (!modalUpdate) return;
    currentDownloadUrl = info.downloadUrl || "https://github.com/gatilhobr/releases";
    if (updateInfoEl) {
      updateInfoEl.innerHTML = `Nova versão <b>v${info.latestVersion}</b> disponível (você está na v${info.currentVersion || "4.3.0"}).`;
    }
    if (updateNotesEl) {
      updateNotesEl.textContent = info.releaseNotes || "Melhorias de performance, estabilidade e atualização de casas.";
    }
    modalUpdate.style.display = "flex";
  }

  if (btnCloseUpdate) {
    btnCloseUpdate.addEventListener("click", () => {
      if (modalUpdate) modalUpdate.style.display = "none";
    });
  }

  if (btnDownloadUpdate) {
    btnDownloadUpdate.addEventListener("click", () => {
      if (currentDownloadUrl) {
        if (typeof window.__gbrElectronApi !== "undefined" && window.__gbrElectronApi.send) {
          window.__gbrElectronApi.send("gbr:open-external", { url: currentDownloadUrl });
        } else {
          window.open(currentDownloadUrl, "_blank");
        }
      }
      if (modalUpdate) modalUpdate.style.display = "none";
    });
  }

  if (typeof window.__gbrElectronApi !== "undefined" && window.__gbrElectronApi.on) {
    window.__gbrElectronApi.on("gbr:update-available", (info) => {
      console.log("[Desktop] Notificação de nova versão recebida:", info);
      showUpdateModal(info);
    });
  }

  if (btnCheckUpdate) {
    btnCheckUpdate.addEventListener("click", async () => {
      btnCheckUpdate.textContent = "⏳ Verificando...";
      btnCheckUpdate.disabled = true;

      if (typeof window.__gbrElectronApi !== "undefined" && window.__gbrElectronApi.invoke) {
        try {
          const res = await window.__gbrElectronApi.invoke("gbr:check-for-updates");
          if (res && res.hasUpdate) {
            showUpdateModal(res);
          } else {
            alert(res && res.latestVersion ? `✅ Seu GatilhoBR Desktop já está atualizado (v${res.latestVersion})!` : "✅ Você já está utilizando a versão mais recente!");
          }
        } catch (e) {
          alert("Não foi possível conectar ao servidor de atualizações no momento.");
        }
      } else {
        alert("GatilhoBR Desktop v4.3.0 ativo.");
      }

      btnCheckUpdate.textContent = "🔄 Atualizações";
      btnCheckUpdate.disabled = false;
    });
  }
});
