// =========================================================================
// GATILHOBR DESKTOP - PRELOAD DO DASHBOARD
// =========================================================================

const { ipcRenderer } = require('electron');

// 1. Expõe a ponte segura de comunicação IPC
const electronApi = {
  isDesktop: true,
  platform: process.platform,
  version: '4.3.0',
  tabId: 9999, // ID reservado para a janela do Dashboard
  isOnboardingRequested: process.argv.some(arg => arg && String(arg).includes('onboarding')),

  readFileSync(relPath) {
    return ipcRenderer.sendSync('gbr:read-file-sync', relPath);
  },
  send(channel, data) {
    ipcRenderer.send(channel, data);
  },
  invoke(channel, data) {
    return ipcRenderer.invoke(channel, data);
  },
  on(channel, callback) {
    ipcRenderer.on(channel, (event, ...args) => callback(...args));
  },
  getInstallationStatus() {
    return ipcRenderer.invoke('gbr:get-installation-status');
  },
  openOnboarding() {
    return ipcRenderer.invoke('gbr:open-onboarding');
  },
  repairBrowserIntegration() {
    return ipcRenderer.invoke('gbr:repair-browser-integration');
  },
  openExtensionPage(browser) {
    return ipcRenderer.invoke('gbr:open-extension-page', { browser });
  },
  retryNativeConnection() {
    return ipcRenderer.invoke('gbr:retry-native-connection');
  },
};

window.__gbrElectronApi = electronApi;
window.gbrElectron = electronApi;
window.isGatilhoDesktop = true;
globalThis.__gbrElectronApi = electronApi;
globalThis.gbrElectron = electronApi;
globalThis.isGatilhoDesktop = true;

// 2. Carrega e executa o polyfill chrome.* SINCRONAMENTE antes de qualquer script da página
try {
  const polyfillCode = ipcRenderer.sendSync('gbr:read-file-sync', 'electron/chrome-polyfill.js');
  if (polyfillCode) {
    eval(polyfillCode);
    console.log('[Preload Dashboard] ✅ Polyfill chrome.* carregado e executado com sucesso.');
  } else {
    console.error('[Preload Dashboard] ❌ Código do polyfill não foi retornado pelo processo principal.');
  }
} catch (err) {
  console.error('[Preload Dashboard] ❌ Erro ao inicializar polyfill:', err);
}

// 3. Garante que window.chrome e globalThis.chrome estejam acessíveis por qualquer módulo
if (typeof window.chrome !== 'undefined') {
  globalThis.chrome = window.chrome;
}

// 4. Atalhos de teclado no Dashboard para abertura rápida das casas
window.addEventListener('keydown', (e) => {
  if (e.target && ['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;

  if (e.ctrlKey || e.metaKey) {
    if (e.key === '1') {
      e.preventDefault();
      ipcRenderer.send('gbr:open-house', { house: 'bet365' });
    } else if (e.key === '2') {
      e.preventDefault();
      ipcRenderer.send('gbr:open-house', { house: 'betfair' });
    } else if (e.key === '3') {
      e.preventDefault();
      ipcRenderer.send('gbr:open-house', { house: 'betnacional' });
    } else if (e.key === '4') {
      e.preventDefault();
      ipcRenderer.send('gbr:open-house', { house: 'betmgm' });
    } else if (e.key === '5') {
      e.preventDefault();
      ipcRenderer.send('gbr:open-house', { house: 'betano' });
    } else if (e.key === '6') {
      e.preventDefault();
      ipcRenderer.send('gbr:open-house', { house: 'superbet' });
    }
  } else if (e.key === 'F9') {
    e.preventDefault();
    ipcRenderer.send('gbr:open-house', { house: 'all' });
  }
});

let lastPreloadClickAt = 0;
let lastPreloadClickHouse = '';

// 5. Interceptador de cliques para abertura de casas APENAS na seção 'Casas de Aposta' da Dashboard principal
document.addEventListener('click', (e) => {
  const target = e.target;
  if (!target) return;

  // IMPORTANTE: Na aba de Mercados ao Vivo, NUNCA abre janela de casa!
  // Os botões servem exclusivamente para alternar a visualização do mercado no app.
  if (target.closest('.gbr-markets-house-bar, .markets-page, [title*="Alternar para"]')) {
    return;
  }

  // Abertura de casas permitida EXCLUSIVAMENTE na seção 'Casas de Aposta' da Dashboard principal
  const houseCardOrBtn = target.closest('.gbr-dashboard-houses-section [data-house]');
  if (houseCardOrBtn) {
    const house = houseCardOrBtn.getAttribute('data-house');
    if (house) {
      const now = Date.now();
      if (now - lastPreloadClickAt < 1200 && lastPreloadClickHouse === house) {
        return;
      }
      lastPreloadClickAt = now;
      lastPreloadClickHouse = house;
      console.log('[Dashboard Preload] Abrindo casa da Dashboard:', house);
      ipcRenderer.send('gbr:open-house', { house });
    }
  }
}, true);
