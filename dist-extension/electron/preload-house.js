// =========================================================================
// GATILHOBR DESKTOP - PRELOAD DAS CASAS DE APOSTA (BET365, BETFAIR, ETC.)
// =========================================================================

const { ipcRenderer } = require('electron');

let initialTabInfo = null;
try {
  initialTabInfo = ipcRenderer.sendSync('gbr:get-current-tab-info');
} catch (e) {}
// O User-Agent textual pode ser sobrescrito pelo processo principal, mas o
// site também consulta navigator.userAgentData antes de iniciar o feed ao vivo.
// No Electron os brands padrão podem denunciar o wrapper. Exponha hints
// compatíveis com o mesmo Chrome usado no cabeçalho, preservando os demais
// métodos/propriedades nativos.
if (initialTabInfo && initialTabInfo.houseKey === 'bet365') {
  try {
    const major = '140';
    const nativeUAData = navigator.userAgentData;
    if (nativeUAData) {
      const chromeBrands = [
        { brand: 'Not_A Brand', version: '24' },
        { brand: 'Google Chrome', version: major },
        { brand: 'Chromium', version: major },
      ];
      const maskedUAData = new Proxy(nativeUAData, {
        get(target, prop, receiver) {
          if (prop === 'brands') return chromeBrands;
          if (prop === 'mobile') return false;
          if (prop === 'platform') return 'Windows';
          return Reflect.get(target, prop, receiver);
        },
      });
      Object.defineProperty(navigator, 'userAgentData', {
        configurable: true,
        get: () => maskedUAData,
      });
    }
  } catch (e) {
    console.warn('[Preload House] Não foi possível ajustar User-Agent Client Hints:', e.message);
  }
}
// A página Bet365 permanece nativa; apenas a ponte de leitura de mercados é
// injetada mais abaixo para alimentar a dashboard.

// -------------------------------------------------------------------------
// STEALTH ANTI-DETECÇÃO (AKAMAI BOT MANAGER / BETFAIR / NETHONE EVASION)
// -------------------------------------------------------------------------
if (!(initialTabInfo && initialTabInfo.houseKey === 'bet365')) try {
  // 1. Remove navigator.webdriver e mascara protótipo
  if (Object.getPrototypeOf(navigator).hasOwnProperty('webdriver')) {
    delete Object.getPrototypeOf(navigator).webdriver;
  }
  Object.defineProperty(navigator, 'webdriver', {
    get: () => undefined,
    configurable: true,
  });

  // 2. Simula propriedades e métodos padrão do window.chrome
  if (!window.chrome) window.chrome = {};
  if (!window.chrome.app) {
    window.chrome.app = {
      isInstalled: false,
      InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
      RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
      getDetails: () => null,
      getIsInstalled: () => false,
      runningState: () => 'cannot_run',
    };
  }
  if (!window.chrome.csi) {
    window.chrome.csi = function () {
      return {
        startE: Date.now(),
        onloadT: Date.now() + 150,
        pageT: 150,
        tran: 15,
      };
    };
  }
  if (!window.chrome.loadTimes) {
    window.chrome.loadTimes = function () {
      return {
        requestTime: Date.now() / 1000,
        startLoadTime: Date.now() / 1000,
        commitLoadTime: Date.now() / 1000 + 0.08,
        finishDocumentLoadTime: Date.now() / 1000 + 0.15,
        finishLoadTime: Date.now() / 1000 + 0.22,
        firstPaintTime: Date.now() / 1000 + 0.1,
        firstPaintAfterLoadTime: 0,
        navigationType: 'Other',
        wasFetchedViaSpdy: true,
        wasNpnNegotiated: true,
        npnNegotiatedProtocol: 'h2',
        wasAlternateProtocolAvailable: false,
        connectionInfo: 'h2',
      };
    };
  }

  // 3. Simula plugins do Chrome garantindo compatibilidade com namedItem/item
  if (!navigator.plugins || navigator.plugins.length === 0 || typeof navigator.plugins.namedItem !== 'function') {
    const mockPlugins = [
      { name: 'PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
      { name: 'Chrome PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
      { name: 'Chromium PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
      { name: 'Microsoft Edge PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
      { name: 'WebKit built-in PDF', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
    ];
    mockPlugins.item = (i) => mockPlugins[i] || null;
    mockPlugins.namedItem = (name) => mockPlugins.find((p) => p && p.name === name) || null;
    mockPlugins.refresh = () => {};
    try {
      Object.defineProperty(navigator, 'plugins', {
        get: () => mockPlugins,
        configurable: true,
      });
    } catch (e) {}
  }

  // 4. Idiomas padrão realistas
  Object.defineProperty(navigator, 'languages', {
    get: () => ['pt-BR', 'pt', 'en-US', 'en'],
    configurable: true,
  });

  // 5. Normaliza Permissions API para não revelar wrapper
  const originalPermissionsQuery = window.navigator.permissions && window.navigator.permissions.query;
  if (originalPermissionsQuery) {
    window.navigator.permissions.query = (parameters) =>
      parameters && parameters.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission || 'default' })
        : originalPermissionsQuery.call(window.navigator.permissions, parameters);
  }
} catch (stealthErr) {
  console.warn('[Preload House] Aviso no setup stealth:', stealthErr);
}
// Identifica a casa pela URL/hostname atual
function detectHouseFromUrl(url) {
  if (!url) return 'unknown';
  const str = url.toLowerCase();
  if (str.includes('bet365.')) return 'bet365';
  if (str.includes('betfair.')) return 'betfair';
  if (str.includes('betnacional.')) return 'betnacional';
  if (str.includes('betano.')) return 'betano';
  if (str.includes('betmgm.')) return 'betmgm';
  if (str.includes('superbet.')) return 'superbet';
  return 'unknown';
}

// Obtém informações da aba e da casa atribuídas pelo main process
let tabInfo = { tabId: 1, houseKey: 'unknown' };
try {
  tabInfo = ipcRenderer.sendSync('gbr:get-current-tab-info') || tabInfo;
} catch (e) {
  try {
    tabInfo.tabId = ipcRenderer.sendSync('gbr:get-current-tab-id') || 1;
  } catch (err) {}
}

const tabId = tabInfo.tabId || 1;
let currentHouse = tabInfo.houseKey && tabInfo.houseKey !== 'unknown'
  ? tabInfo.houseKey
  : detectHouseFromUrl(window.location.href);

console.log(`[GatilhoBR House Preload] Iniciando para casa: ${currentHouse} (tabId: ${tabId}, url: ${window.location.href})`);

// Expõe a ponte para o polyfill chrome.*
const electronApi = {
  isDesktop: true,
  tabId: tabId,
  house: currentHouse,
  send(channel, data) {
    ipcRenderer.send(channel, data);
  },
  invoke(channel, data) {
    return ipcRenderer.invoke(channel, data);
  },
  on(channel, callback) {
    ipcRenderer.on(channel, (event, ...args) => callback(...args));
  },
};

window.__gbrElectronApi = electronApi;
globalThis.__gbrElectronApi = electronApi;

// Injeta o polyfill chrome.* no ambiente
try {
  const polyfillCode = ipcRenderer.sendSync('gbr:read-file-sync', 'electron/chrome-polyfill.js');
  if (polyfillCode) {
    eval(polyfillCode);
    if (typeof window.chrome !== 'undefined') globalThis.chrome = window.chrome;
  }
} catch (err) {
  console.error('[Preload House] Erro ao avaliar polyfill:', err);
}

// Injeta scripts nos documentos usando leitura síncrona do main process
function injectScriptFile(relativeFilePath) {
  try {
    const code = ipcRenderer.sendSync('gbr:read-file-sync', relativeFilePath);
    if (!code) {
      console.warn(`[Preload House] Arquivo não encontrado: ${relativeFilePath}`);
      return;
    }
    // Executa diretamente no contexto do window
    try {
      window.eval(`${code}\n//# sourceURL=gatilhobr://${relativeFilePath}`);
    } catch (evalErr) {
      const target = document.head || document.documentElement;
      if (target) {
        const scriptEl = document.createElement('script');
        scriptEl.textContent = `${code}\n//# sourceURL=gatilhobr://${relativeFilePath}`;
        target.appendChild(scriptEl);
        scriptEl.remove();
      } else {
        console.error(`[Preload House] Falha ao injetar ${relativeFilePath}:`, evalErr);
      }
    }
  } catch (err) {
    console.error(`[Preload House] Erro ao injetar ${relativeFilePath}:`, err);
  }
}

// =========================================================================
// A ponte de captura é necessária para sincronizar mercados com a dashboard.
// =========================================================================
const BYPASS_BET365_SCRIPTS = false;

if (BYPASS_BET365_SCRIPTS && (currentHouse === 'bet365' || window.location.hostname.includes('bet365'))) {
  console.log('[GatilhoBR Diagnostics] ⚠️ MODO LIMPO ATIVO: Nenhum script de extensão injetado na Bet365.');
  return;
}

function injectBet365FeedScripts() {
  // Não substituímos WebSocket/fetch na navegação do evento: isso deixa o
  // spinner da Bet365 preso. A captura usa somente o DOM já renderizado.
}

// Injeção dos motores e adaptadores quando o DOM estiver pronto
function injectEnginesAndAdapters() {
  const host = (window.location.hostname || '').toLowerCase();
  const targetHouse = (currentHouse && currentHouse !== 'unknown')
    ? currentHouse
    : (detectHouseFromUrl(window.location.href) || detectHouseFromUrl(host));

  console.log(`[Preload House] Injetando motores e adaptadores para: ${targetHouse} (${window.location.href})...`);

  const commonScripts = [
    'src/securityGuard.js',
    'src/utils/executionReport.js',
    'src/utils/marketIndex.js',
    'src/core/selectionResolver.js',
    'src/userScopedStorage.js',
    'src/config.js',
    'src/core/directOrderPreferences.js',
    'src/ui.js',
    'src/supabaseClient.js',
    'src/services/licensingEngine.js',
    'src/authManager.js',
    'src/presetManager.js',
    'src/utils/domWaiter.js',
    'src/stakeEngine.js',
    'src/placeBetEngine.js',
    'src/presetEngine.js',
    'src/gridScraper.js',
    'src/quickBindEngine.js',
    'src/quickExecEngine.js',
    'src/hotkeyEngine.js',
    'src/hotkeyConfigurator.js',
    'src/utils/humanizer.js',
  ];
  const isBet365 = targetHouse === 'bet365' || host.includes('bet365');
  const isBetfair = targetHouse === 'betfair' || host.includes('betfair');
  const isBetnacional = targetHouse === 'betnacional' || host.includes('betnacional');
  const isBetano = targetHouse === 'betano' || host.includes('betano.bet.br');
  const isBetmgm = targetHouse === 'betmgm' || host.includes('betmgm');
  const isSuperbet = targetHouse === 'superbet' || host.includes('superbet');

  // Na Bet365, mantenha a interação nativa de odds. Os motores de execução
  // adicionam listeners de clique e podem impedir que o bilhete oficial abra;
  // a captura de mercados continua ativa via content/parser/feed bridge.
  const bet365InteractionScripts = new Set();
  const scriptsToInject = isBet365
    ? commonScripts.filter((file) => !bet365InteractionScripts.has(file))
    : commonScripts;
  scriptsToInject.forEach(injectScriptFile);

  if (isBet365) {
    injectScriptFile('src/utils/bet365MarketTitle.js');
    injectScriptFile('src/adapters/bet365Adapter.js');
  } else if (isBetfair) {
    injectScriptFile('src/adapters/betfairSportsbookAdapter.js');
  } else if (isBetnacional) {
    injectScriptFile('src/adapters/betnacionalAdapter.js');
  } else if (isBetmgm) {
    injectScriptFile('src/adapters/betmgmAdapter.js');
  } else if (isBetano) {
    injectScriptFile('src/adapters/betanoAdapter.js');
  } else if (isSuperbet) {
    injectScriptFile('src/adapters/superbetAdapter.js');
  }

  // Neste ponto a página já está no contexto do evento; os motores de
  // execução podem ser armados sem bloquear a navegação da listagem.
  injectScriptFile('src/triggerEngine.js');
  injectScriptFile('src/parser.js');
  injectScriptFile('content.js');

  console.log(`[Preload House] ✅ Todos os scripts e adaptadores injetados com sucesso em ${targetHouse}.`);
}

// Captura erros da página e exibe no console para diagnóstico rápido
window.addEventListener('error', (event) => {
  console.warn('[Bet365 Page Diagnostic Error]', event.message, 'at', event.filename, 'line:', event.lineno);
});

// Respeita o contrato "document_idle" original da extensão (aguarda carregamento completo do React)
function scheduleEnginesAndAdapters() {
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(() => setTimeout(injectEnginesAndAdapters, 400));
  } else {
    setTimeout(injectEnginesAndAdapters, 800);
  }
}

const isBet365Page = currentHouse === 'bet365' || window.location.hostname.includes('bet365');
if (isBet365Page) {
  // A listagem inicial deve permanecer 100% nativa para que o usuário possa
  // navegar e escolher o jogo. Só armamos os interceptadores após a primeira
  // seleção de odd; nessa altura a casa já abriu o contexto do evento.
  const armAfterSelection = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const looksLikeSelection = target.closest(
      '[class*="gl-Participant"], [class*="Participant"], [class*="Odds"], [data-selection-id], button'
    );
    if (!looksLikeSelection) return;
    document.removeEventListener('click', armAfterSelection, true);
    setTimeout(() => {
      injectBet365FeedScripts();
      scheduleEnginesAndAdapters();
    }, 5000);
  };
  document.addEventListener('click', armAfterSelection, true);
} else if (document.readyState === 'complete') {
  scheduleEnginesAndAdapters();
} else {
  window.addEventListener('load', scheduleEnginesAndAdapters, { once: true });
}
