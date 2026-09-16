// =========================================================================
// GATILHOBR - GERENCIADOR DE PRESETS COMPARTILHADOS (SUPABASE INTEGRATION)
// =========================================================================

/**
 * Gera um ID curto aleatório no padrão GBR- + 4 caracteres alfanuméricos em maiúsculas (ex: GBR-7X91).
 * @returns {string}
 */
function generatePresetCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let randomStr = "";
  for (let i = 0; i < 4; i++) {
    randomStr += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `GBR-${randomStr}`;
}

function sanitizePresetFavoriteMarkets(rawFavorites) {
  const result = { bet365: [], betfair: [] };

  ["bet365", "betfair"].forEach((house) => {
    const source =
      rawFavorites && Array.isArray(rawFavorites[house])
        ? rawFavorites[house]
        : [];
    const seen = new Set();

    source.slice(0, 100).forEach((entry) => {
      const title = typeof entry === "string" ? entry : entry && entry.title;
      const rawKey =
        (entry && typeof entry === "object" && entry.key) || title || "";
      const key = rawKey
        .toString()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");

      if (!key || seen.has(key)) return;
      seen.add(key);
      result[house].push({
        key,
        title: (title || key).toString().slice(0, 160),
      });
    });
  });

  return result;
}

function sanitizePresetPlayerPriorityRules(rawRules) {
  if (!Array.isArray(rawRules)) return [];
  const normalize = (value) =>
    (value || "")
      .toString()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .replace(/\s+/g, " ");
  const seen = new Set();
  const result = [];

  rawRules.slice(0, 200).forEach((entry, index) => {
    if (!entry || typeof entry !== "object") return;
    const house = entry.house === "betfair" ? "betfair" : "bet365";
    const team = (entry.team || "").toString().trim().slice(0, 80);
    const market = (entry.market || "").toString().trim().slice(0, 120);
    const player = (entry.player || "").toString().trim().slice(0, 100);
    if (!team || !market || !player) return;

    const signature = [house, team, market, player].map(normalize).join("|");
    if (seen.has(signature)) return;
    seen.add(signature);
    result.push({
      id: (entry.id || `player-rule-${index}`).toString().slice(0, 120),
      house,
      team,
      market,
      player,
    });
  });

  return result;
}

function sanitizePresetPanelTarget(entry) {
  const raw =
    entry && typeof entry.panelTarget === "object" && entry.panelTarget
      ? entry.panelTarget
      : {};
  const text = (value, limit) => (value || "").toString().trim().slice(0, limit);
  const target = {
    outcomeId: text(raw.outcomeId || entry?.outcomeId, 120),
    selectionId: text(raw.selectionId, 160),
    marketId: text(raw.marketId, 160),
    targetName: text(raw.targetName, 160),
    lineName: text(raw.lineName, 120),
    optionLabel: text(raw.optionLabel, 120),
    marketTitle: text(raw.marketTitle, 160),
  };
  return Object.values(target).some(Boolean) ? target : undefined;
}

function sanitizePresetDynamicPlayerBinds(rawBinds) {
  if (!rawBinds || typeof rawBinds !== "object" || Array.isArray(rawBinds))
    return {};
  const isAllowedKey = (code) =>
    /^Key[A-Z]$/.test(code) ||
    /^Digit[0-9]$/.test(code) ||
    /^Numpad[0-9]$/.test(code) ||
    /^F(?:[1-9]|1[0-2])$/.test(code);
  const result = {};

  Object.entries(rawBinds)
    .slice(0, 120)
    .forEach(([rawCode, rawEntry]) => {
      const entries = Array.isArray(rawEntry) ? rawEntry : [rawEntry];
      entries.forEach((entry, index) => {
        if (!entry || typeof entry !== "object") return;
        const fallbackCode = rawCode.includes(":")
          ? rawCode.split(":").pop()
          : rawCode;
        const keyCode = (entry.keyCode || fallbackCode || "").toString();
        if (!isAllowedKey(keyCode)) return;
        const house =
          entry.house === "betfair"
            ? "betfair"
            : entry.house === "betnacional"
              ? "betnacional"
              : entry.house === "betano"
                ? "betano"
              : "bet365";
        const targetType =
          entry.targetType === "market_selection"
            ? "market_selection"
            : "player_line";
        const team = (entry.team || "").toString().trim().slice(0, 80);
        const market = (entry.market || "").toString().trim().slice(0, 120);
        const player = (entry.player || "").toString().trim().slice(0, 100);
        if (!team || !market || (targetType !== "market_selection" && !player))
          return;
        const requestedLine = (entry.line || "").toString().trim().slice(0, 40);
        const hasExactLine =
          entry.lineMode === "exact" &&
          !!requestedLine &&
          requestedLine.length <= 40;
        const storageKey = `${house}:${keyCode}`;
        // O alvo do painel identifica o outcome da casa. Sem ele o preset
        // importado volta a mirar por texto e posição, que é o modo instável.
        const panelTarget = sanitizePresetPanelTarget(entry);
        const sanitized = {
          id: (entry.id || `${storageKey}:${index}`).toString().slice(0, 120),
          keyCode,
          house,
          targetType,
          team,
          market,
          player,
          selection: (entry.selection || "").toString().trim().slice(0, 160),
          rowLabel: (entry.rowLabel || "").toString().trim().slice(0, 120),
          rowIndex: Number.isInteger(entry.rowIndex)
            ? entry.rowIndex
            : undefined,
          colIndex: Number.isInteger(entry.colIndex)
            ? entry.colIndex
            : undefined,
          lineMode: hasExactLine ? "exact" : "first_available",
          line: hasExactLine ? requestedLine : "",
          outcomeId: panelTarget?.outcomeId || "",
          panelTarget,
          source: entry.source === "site_capture" ? "site_capture" : "guided",
          eventLabel: (entry.eventLabel || "").toString().trim().slice(0, 180),
          createdAt: Number(entry.createdAt) || Date.now(),
        };
        const previous = result[storageKey];
        result[storageKey] = previous
          ? [...(Array.isArray(previous) ? previous : [previous]), sanitized]
          : sanitized;
      });
    });

  return result;
}

/**
 * Coleta as configurações atuais e exporta um novo preset para o Supabase.
 * @param {string} presetName Nome descritivo da configuração (ex: "Estratégia Escanteios")
 * @returns {Promise<{success: boolean, code?: string, name?: string, message?: string}>}
 */
async function exportPreset(presetName) {
  try {
    if (
      typeof chrome === "undefined" ||
      !chrome.storage ||
      !chrome.storage.local
    ) {
      return { success: false, message: "chrome.storage indisponível" };
    }

    if (!window.gbrUserScopedStorage) {
      return { success: false, message: "Sessao da conta indisponivel" };
    }
    const storageData = await window.gbrUserScopedStorage.get("local", null);

    const getSessionFn =
      typeof getValidGbrAuthSession === "function"
        ? getValidGbrAuthSession
        : typeof window !== "undefined"
          ? window.getValidGbrAuthSession
          : null;
    const validSession = getSessionFn ? await getSessionFn(false) : null;
    const token = validSession?.access_token || storageData.gbr_auth_token;
    const userId = validSession?.user?.id || storageData.gbr_user_id;

    if (!token || !userId) {
      return {
        success: false,
        message: "Você precisa estar autenticado para compartilhar um preset.",
      };
    }

    const baseUrl =
      typeof SUPABASE_URL !== "undefined"
        ? SUPABASE_URL
        : typeof window !== "undefined"
          ? window.SUPABASE_URL
          : "";
    const anonKey =
      typeof SUPABASE_ANON_KEY !== "undefined"
        ? SUPABASE_ANON_KEY
        : typeof window !== "undefined"
          ? window.SUPABASE_ANON_KEY
          : "";

    if (!baseUrl) {
      return { success: false, message: "URL do Supabase não configurada" };
    }

    // Coleta as chaves de configuração sensíveis e operacionais
    const configObj = {
      fastTriggerStakeVal: storageData.fastTriggerStakeVal || "0.50",
      stakeVal: storageData.stakeVal || "0.50",
      autoTriggerDirectBool: !!storageData.autoTriggerDirectBool,
      quickBinds: storageData.quickBinds || {},
      presetConfigs: storageData.presetConfigs || [],
      triggerKeyStr: storageData.triggerKeyStr || "Space",
      favoriteMarketsByHouse: sanitizePresetFavoriteMarkets(
        storageData.favoriteMarketsByHouse,
      ),
      playerPriorityRules: sanitizePresetPlayerPriorityRules(
        storageData.playerPriorityRules,
      ),
      dynamicPlayerBinds: sanitizePresetDynamicPlayerBinds(
        storageData.dynamicPlayerBinds,
      ),
    };

    const presetId = generatePresetCode();
    const finalName =
      presetName && presetName.trim() ? presetName.trim() : "Setup GatilhoBR";

    const response = await fetch(`${baseUrl}/rest/v1/presets`, {
      method: "POST",
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        id: presetId,
        user_id: userId,
        name: finalName,
        config_json: configObj,
      }),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      return {
        success: false,
        message:
          errData.message ||
          errData.hint ||
          "Erro ao salvar preset no Supabase.",
      };
    }

    return {
      success: true,
      code: presetId,
      name: finalName,
    };
  } catch (err) {
    console.error("[PresetManager] Erro ao exportar preset:", err);
    return {
      success: false,
      message: err.message || "Falha de comunicação ao exportar preset.",
    };
  }
}

/**
 * Consulta e importa uma configuração compartilhada pelo código GBR-XXXX no Supabase.
 * @param {string} presetCode Código no formato GBR-XXXX
 * @returns {Promise<{success: boolean, code?: string, name?: string, config?: Object, message?: string}>}
 */
async function importPreset(presetCode) {
  try {
    if (!presetCode || typeof presetCode !== "string") {
      return { success: false, message: "Digite um código válido de preset." };
    }

    const cleanCode = presetCode.trim().toUpperCase();

    if (!cleanCode.startsWith("GBR-") || cleanCode.length < 7) {
      return {
        success: false,
        message: "Formato de código inválido. Exemplo esperado: GBR-8X91",
      };
    }

    if (
      typeof chrome === "undefined" ||
      !chrome.storage ||
      !chrome.storage.local
    ) {
      return { success: false, message: "chrome.storage indisponível" };
    }

    const storageData = await new Promise((resolve) => {
      chrome.storage.local.get(["gbr_auth_token"], resolve);
    });

    const getSessionFn =
      typeof getValidGbrAuthSession === "function"
        ? getValidGbrAuthSession
        : typeof window !== "undefined"
          ? window.getValidGbrAuthSession
          : null;
    const validSession = getSessionFn ? await getSessionFn(false) : null;
    const token = validSession?.access_token || storageData.gbr_auth_token;
    const baseUrl =
      typeof SUPABASE_URL !== "undefined"
        ? SUPABASE_URL
        : typeof window !== "undefined"
          ? window.SUPABASE_URL
          : "";
    const anonKey =
      typeof SUPABASE_ANON_KEY !== "undefined"
        ? SUPABASE_ANON_KEY
        : typeof window !== "undefined"
          ? window.SUPABASE_ANON_KEY
          : "";

    if (!baseUrl) {
      return { success: false, message: "URL do Supabase não configurada" };
    }

    const headers = {
      apikey: anonKey,
      "Content-Type": "application/json",
    };

    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const response = await fetch(
      `${baseUrl}/rest/v1/presets?id=eq.${cleanCode}`,
      {
        method: "GET",
        headers: headers,
      },
    );

    if (!response.ok) {
      return {
        success: false,
        message: "Erro ao consultar preset no servidor.",
      };
    }

    const data = await response.json();

    if (!Array.isArray(data) || data.length === 0) {
      return {
        success: false,
        message: `Código de preset "${cleanCode}" não foi encontrado.`,
      };
    }

    const presetRecord = data[0];
    const configObj =
      typeof presetRecord.config_json === "string"
        ? JSON.parse(presetRecord.config_json)
        : presetRecord.config_json;

    if (!configObj || typeof configObj !== "object") {
      return {
        success: false,
        message: "Dados de configuração corrompidos no preset.",
      };
    }

    if (
      Object.prototype.hasOwnProperty.call(configObj, "favoriteMarketsByHouse")
    ) {
      configObj.favoriteMarketsByHouse = sanitizePresetFavoriteMarkets(
        configObj.favoriteMarketsByHouse,
      );
    }
    if (
      Object.prototype.hasOwnProperty.call(configObj, "playerPriorityRules")
    ) {
      configObj.playerPriorityRules = sanitizePresetPlayerPriorityRules(
        configObj.playerPriorityRules,
      );
    }
    if (Object.prototype.hasOwnProperty.call(configObj, "dynamicPlayerBinds")) {
      configObj.dynamicPlayerBinds = sanitizePresetDynamicPlayerBinds(
        configObj.dynamicPlayerBinds,
      );
    }

    // Grava as novas configurações no chrome.storage.local
    if (!window.gbrUserScopedStorage) {
      return { success: false, message: "Sessao da conta indisponivel" };
    }
    await window.gbrUserScopedStorage.set("local", configObj);

    if (configObj.stakeVal) {
      window.gbrUserScopedStorage
        .set("sync", { stakeVal: configObj.stakeVal })
        .catch(() => {});
    }

    // Notifica todas as abas abertas da extensão para aplicar a nova configuração
    if (typeof chrome !== "undefined" && chrome.tabs && chrome.tabs.query) {
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach((tab) => {
          if (tab.id) {
            chrome.tabs
              .sendMessage(tab.id, {
                action: "UPDATE_CONFIG",
                config: configObj,
              })
              .catch(() => {});
          }
        });
      });
    }

    return {
      success: true,
      code: presetRecord.id,
      name: presetRecord.name || "Setup Compartilhado",
      config: configObj,
    };
  } catch (err) {
    console.error("[PresetManager] Erro ao importar preset:", err);
    return {
      success: false,
      message: err.message || "Falha de comunicação ao importar preset.",
    };
  }
}

if (typeof window !== "undefined") {
  window.exportPreset = exportPreset;
  window.importPreset = importPreset;
  window.generatePresetCode = generatePresetCode;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    exportPreset,
    importPreset,
    generatePresetCode,
    sanitizePresetFavoriteMarkets,
    sanitizePresetPlayerPriorityRules,
    sanitizePresetDynamicPlayerBinds,
  };
}
