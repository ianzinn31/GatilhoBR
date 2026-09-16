// =========================================================================
// GATILHOBR - PREFERÊNCIAS PERSISTENTES DO CAMINHO DIRETO
// =========================================================================
//
// Uma única chave em `chrome.storage.local` (`gbr_direct_order_prefs`) guarda o
// que antes precisava ser digitado no console a cada sessão:
//
//   executionMode            'DIRECT_NETWORK' | 'DOM_UI'
//   directOrderAutoSelection auto-resolução do `selectionId` pelo feed
//   maxStake                 teto de aposta da ordem direta, em reais
//   chosenByUser             o modo veio de uma escolha explícita no painel
//
// No modo direto, o modulo arma a ponte e configura as travas automaticamente.
// O modelo de requisicao continua sendo aprendido pela extensao durante a
// primeira aposta DOM explicitamente acionada pelo usuario; nunca vem da pagina
// por mensagem e nunca exige console.
//
// O padrao de fabrica e `DOM_UI`: o caminho direto arma o observador de rede da
// pagina (`inject.js` troca `window.WebSocket` por um Proxy) e isso nao pode
// acontecer sem opt-in. O schema 1 nascia em `DIRECT_NETWORK` e gravava esse
// valor na primeira aba, ligando `gbr_direct_order_experiment` para todo mundo;
// `migrate()` desfaz exatamente esse registro semeado e preserva quem escolheu.
// =========================================================================

(function () {
  "use strict";

  if (typeof window === "undefined") return;

  const PREFS_KEY = "gbr_direct_order_prefs";
  const SETTINGS_KEY = "gbr_direct_order_settings";
  const EXPERIMENT_KEY = "gbr_direct_order_experiment";
  const EXECUTION_MODES = ["DOM_UI", "DIRECT_NETWORK"];
  // Teto do teto: preferência guardada não pode virar um limite absurdo por
  // erro de digitação em outra tela.
  const MAX_STAKE_CEILING = 100_000;
  const SCHEMA_VERSION = 2;

  const DEFAULTS = {
    schemaVersion: SCHEMA_VERSION,
    executionMode: "DOM_UI",
    directOrderAutoSelection: true,
    maxStake: 500,
    chosenByUser: false,
  };

  let current = { ...DEFAULTS };

  function storageArea() {
    try {
      const area = typeof chrome !== "undefined" && chrome.storage ? chrome.storage.local : null;
      return area && typeof area.get === "function" && typeof area.set === "function"
        ? area
        : null;
    } catch (error) {
      return null;
    }
  }

  // `storage.get` devolve promessa no MV3 e callback em ambiente antigo. As duas
  // formas convivem aqui para o módulo não depender de qual está disponível.
  function read(keys) {
    const area = storageArea();
    if (area === null) return Promise.resolve(null);
    return new Promise((resolve) => {
      try {
        const request = area.get(keys, (stored) => resolve(stored || null));
        if (request && typeof request.then === "function") {
          request.then((stored) => resolve(stored || null)).catch(() => resolve(null));
        }
      } catch (error) {
        resolve(null);
      }
    });
  }

  function write(values) {
    const area = storageArea();
    if (area === null) return Promise.resolve(false);
    return new Promise((resolve) => {
      try {
        const request = area.set(values, () => resolve(true));
        if (request && typeof request.then === "function") {
          request.then(() => resolve(true)).catch(() => resolve(false));
        }
      } catch (error) {
        resolve(false);
      }
    });
  }

  function normalizeMode(value) {
    const mode = typeof value === "string" ? value.trim().toUpperCase() : "";
    return EXECUTION_MODES.indexOf(mode) === -1 ? null : mode;
  }

  function normalizeMaxStake(value) {
    const stake = Number(value);
    if (!Number.isFinite(stake) || stake <= 0) return null;
    return stake > MAX_STAKE_CEILING ? MAX_STAKE_CEILING : stake;
  }

  // Valor guardado é dado de entrada como qualquer outro: campo inválido volta
  // para o padrão em vez de desligar a trava.
  function sanitize(raw) {
    const next = { ...DEFAULTS };
    if (raw === null || typeof raw !== "object") return next;
    const mode = normalizeMode(raw.executionMode);
    if (mode !== null) next.executionMode = mode;
    if (typeof raw.directOrderAutoSelection === "boolean") {
      next.directOrderAutoSelection = raw.directOrderAutoSelection;
    }
    const maxStake = normalizeMaxStake(raw.maxStake);
    if (maxStake !== null) next.maxStake = maxStake;
    if (raw.chosenByUser === true) next.chosenByUser = true;
    return next;
  }

  /**
   * Sobe um registro antigo para o schema atual.
   *
   * O schema 1 tinha `DIRECT_NETWORK` como padrão de fábrica e o `load()`
   * gravava esse padrão na primeira aba de qualquer usuário. O efeito colateral
   * era ligar `gbr_direct_order_experiment` sem ninguém pedir, e com ele o
   * observador de rede na página da Bet365. Aqui esse registro específico —
   * versão antiga, modo direto, sem marca de escolha — volta para `DOM_UI`.
   * Quem escolheu o modo direto no painel tem `chosenByUser: true` e não é
   * tocado; um `DOM_UI` antigo também passa intacto, só ganha a versão nova.
   *
   * @param {object} raw registro lido do storage
   * @returns {object} o mesmo objeto (já atual) ou uma cópia migrada
   */
  function migrate(raw) {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return raw;
    const version = Number(raw.schemaVersion);
    if (Number.isFinite(version) && version >= SCHEMA_VERSION) return raw;
    const next = { ...raw, schemaVersion: SCHEMA_VERSION };
    if (raw.chosenByUser === true) return next;
    if (normalizeMode(raw.executionMode) !== "DIRECT_NETWORK") return next;
    next.executionMode = "DOM_UI";
    next.chosenByUser = false;
    return next;
  }

  function snapshot() {
    return { ...current };
  }

  // =======================================================================
  // APLICAÇÃO
  // =======================================================================

  /**
   * Escreve as preferências em `window.FastTriggerConfig`. É chamada no boot e
   * de novo depois do merge da nuvem (`loadConfig`), que carrega o padrão de
   * fábrica `DOM_UI` e apagaria a escolha do usuário.
   * @returns {object} preferências aplicadas
   */
  function apply() {
    if (!window.FastTriggerConfig || typeof window.FastTriggerConfig !== "object") {
      window.FastTriggerConfig = {};
    }
    window.FastTriggerConfig.executionMode = current.executionMode;
    window.FastTriggerConfig.directOrderAutoSelection = current.directOrderAutoSelection;
    return snapshot();
  }

  // O modo escolhido na dashboard e o modo efetivo da ponte sao uma unica
  // configuracao de produto. DIRECT_NETWORK arma a ponte e libera envio real;
  // ainda assim nenhuma ordem existe sem intencao recente + selectionId unico +
  // perfil aprendido. DOM_UI desarma imediatamente.
  async function syncRuntime() {
    const stored = await read([SETTINGS_KEY, EXPERIMENT_KEY]);
    if (stored === null) return false;
    const settings = stored[SETTINGS_KEY];
    const base = settings !== null && typeof settings === "object" && !Array.isArray(settings)
      ? settings
      : {};
    const enabled = current.executionMode === "DIRECT_NETWORK";
    const nextSettings = {
      ...base,
      maxStake: current.maxStake,
      publishResults: true,
      ...(enabled ? { dryRun: false } : {}),
    };
    const unchanged =
      stored[EXPERIMENT_KEY] === enabled &&
      Number(base.maxStake) === current.maxStake &&
      base.publishResults === true &&
      (!enabled || base.dryRun === false);
    if (unchanged) return false;
    return write({
      [EXPERIMENT_KEY]: enabled,
      [SETTINGS_KEY]: nextSettings,
    });
  }

  /**
   * Grava um recorte das preferências e reaplica. Usado pelo painel: escolha
   * explícita do usuário passa a valer no próximo boot sem console.
   *
   * Toda chamada marca `chosenByUser`, porque só o painel chega aqui — é essa
   * marca que impede uma migração futura de desfazer a escolha.
   * @param {{executionMode?: string, directOrderAutoSelection?: boolean, maxStake?: number}} patch
   */
  async function save(patch) {
    const next = sanitize({ ...current, ...(patch || {}), chosenByUser: true });
    const changed =
      next.executionMode !== current.executionMode ||
      next.directOrderAutoSelection !== current.directOrderAutoSelection ||
      next.maxStake !== current.maxStake ||
      next.chosenByUser !== current.chosenByUser;
    current = next;
    apply();
    if (!changed) return snapshot();
    await write({ [PREFS_KEY]: { ...current } });
    await syncRuntime();
    return snapshot();
  }

  /**
   * Boot: lê a chave, migra o que for antigo, semeia os padrões na primeira
   * execução e aplica tudo.
   * @returns {Promise<object>} preferências em vigor
   */
  async function load() {
    const stored = await read([PREFS_KEY]);
    const raw = stored === null ? null : stored[PREFS_KEY];
    const usable = raw !== null && raw !== undefined && typeof raw === "object";
    const migrated = usable ? migrate(raw) : null;
    current = sanitize(migrated);
    apply();
    // Primeira execução: o padrão precisa ficar gravado, senão "sem console"
    // duraria só até a próxima aba. `migrated !== raw` cobre o registro antigo:
    // sem regravar, cada boot repetiria a migração em cima do mesmo valor.
    if (!usable || migrated !== raw) await write({ [PREFS_KEY]: { ...current } });
    await syncRuntime();
    return snapshot();
  }

  // =======================================================================
  // SINCRONIA COM O RESTO DA EXTENSÃO
  // =======================================================================

  try {
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "local" || !changes || changes[PREFS_KEY] === undefined) return;
        current = sanitize(migrate(changes[PREFS_KEY].newValue));
        apply();
      });
    }
  } catch (error) {}

  // O painel manda `UPDATE_CONFIG` e o `config.js` aplica na memória. Este
  // listener só persiste a escolha: sem ele, fechar a aba desfaria o ajuste.
  try {
    if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener((message) => {
        if (!message || message.action !== "UPDATE_CONFIG" || !message.config) return undefined;
        const patch = {};
        const mode = normalizeMode(message.config.executionMode);
        if (mode !== null) patch.executionMode = mode;
        if (typeof message.config.directOrderAutoSelection === "boolean") {
          patch.directOrderAutoSelection = message.config.directOrderAutoSelection;
        }
        const maxStake = normalizeMaxStake(message.config.directOrderMaxStake);
        if (maxStake !== null) patch.maxStake = maxStake;
        if (Object.keys(patch).length > 0) void save(patch);
        return undefined;
      });
    }
  } catch (error) {}

  function describe() {
    return [
      `modo: ${current.executionMode}${current.chosenByUser ? "" : " (padrão)"}`,
      `auto-seleção: ${current.directOrderAutoSelection ? "ligada" : "desligada"}`,
      `teto: R$ ${current.maxStake}`,
    ].join(" | ");
  }

  window.FastTriggerDirectOrderPrefs = {
    key: PREFS_KEY,
    settingsKey: SETTINGS_KEY,
    schemaVersion: SCHEMA_VERSION,
    defaults: { ...DEFAULTS },
    modes: [...EXECUTION_MODES],
    load,
    apply,
    save,
    snapshot,
    describe,
  };

  void load();
})();
