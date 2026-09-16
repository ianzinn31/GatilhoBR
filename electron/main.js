// =========================================================================
// GATILHOBR DESKTOP - PROCESSO PRINCIPAL (ELECTRON MAIN)
// =========================================================================

const { app, BrowserWindow, ipcMain, globalShortcut, session, screen, shell, Menu } = require('electron');
const { spawn } = require('child_process');
const net = require('net');
const path = require('path');
const fs = require('fs');
const updater = require('./updater');
const cookieManager = require('./cookie-manager');

// -------------------------------------------------------------------------
// 1. CONFIGURAÇÕES CRÍTICAS DE ALTA PERFORMANCE (ANTI-THROTTLING & GPU)
// -------------------------------------------------------------------------
// Impede que o Chromium reduza a prioridade de abas em segundo plano ou
// congele timers (o Chrome padrão desacelera timers para 1000ms quando a aba não está visível).
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// O formulário da Bet365 autentica em um domínio separado do sportsbook.
// Sem isso, o Chromium embutido particiona/bloqueia o cookie de sessão e a
// casa retorna "dados não reconhecidos" mesmo para credenciais válidas.
app.commandLine.appendSwitch('disable-features', 'ThirdPartyStoragePartitioning');
// Alguns provedores GeoIP da Bet365 não classificam o IPv6 residencial,
// retornando countryID=0 no login. O Chrome normal tende a cair para IPv4;
// manter o mesmo comportamento no Electron evita essa divergência.
app.commandLine.appendSwitch('disable-ipv6');

// Remove traços de automação que revelam o Chromium como bot (anti-detecção Akamai/Bet365)
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');

// Desativa avisos de segurança no console que não afetam a execução
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';

// Instância única do aplicativo
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
  process.exit(0);
} else {
  app.on('second-instance', (_event, commandLine) => {
    console.log('[Main] Segunda instância detectada com argumentos:', commandLine);
    if (dashboardWindow && !dashboardWindow.isDestroyed()) {
      if (dashboardWindow.isMinimized()) dashboardWindow.restore();
      dashboardWindow.focus();
      const hasOnboarding = commandLine.some(arg => arg && String(arg).includes('onboarding'));
      if (hasOnboarding) {
        dashboardWindow.webContents.send('gbr:start-onboarding');
        dashboardWindow.webContents.executeJavaScript('if (window.__gbrOpenOnboarding) window.__gbrOpenOnboarding();').catch(() => {});
      }
    }
  });
}

let dashboardWindow = null;
let backgroundWindow = null;
const houseWindows = new Map(); // tabId -> BrowserWindow
let nextTabId = 100;

// -------------------------------------------------------------------------
// Ponte Native Messaging (Chrome/Edge real -> processo principal)
// -------------------------------------------------------------------------
// A instalação do manifest/registro do Native Messaging é intencionalmente
// responsabilidade do instalador assistido. Este processo apenas conversa com
// um host que ele próprio iniciou no modo de desenvolvimento/teste; ele nunca
// escreve no registro do Windows nem instala extensões.
const NATIVE_BRIDGE_MAX_BYTES = 1024 * 1024;
const NATIVE_BRIDGE_ALLOWED_EVENTS = new Set([
  'REGISTER_TAB',
  'HOUSE_CONNECTED',
  'MARKET_DATA_UPDATE',
  'SYNC_DASHBOARD',
  'EXECUTION_REPORT',
  'NETWORK_FEED_OBSERVATION',
  'DIRECT_ORDER_RESULT',
  'NATIVE_BRIDGE_STATUS',
  'OPEN_DASHBOARD',
  'NATIVE_HELLO',
  'GBR_INSTALLATION_PING',
  'GBR_INSTALLATION_PONG',
  'PING',
  'PONG',
  'HANDSHAKE',
]);
const nativeBridge = {
  child: null,
  input: Buffer.alloc(0),
  portsByHouse: new Map(),
  connectedHouses: new Set(),
  extensionConnected: false,
  restarting: false,
  pipeServer: null,
  pipeSocket: null,
};
const NATIVE_BRIDGE_PIPE = '\\\\.\\pipe\\gatilhobr-native-bridge';

function nativeBridgeHostPath() {
  // Prefer the standalone host shipped as an extraResource. Keep source and
  // dist-native fallbacks for local development before packaging.
  const candidates = [
    process.resourcesPath && path.join(process.resourcesPath, 'native-host', 'gatilhobr-host.exe'),
    path.join(__dirname, '..', 'dist-native', 'gatilhobr-host.exe'),
    path.join(__dirname, '..', 'native-host', 'gatilhobr-host.js'),
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[candidates.length - 1];
}

function nativeBridgePortId(houseKey) {
  const ids = { bet365: 50365, betnacional: 50123, betfair: 50451, betmgm: 50555, betano: 50666, superbet: 50777 };
  return ids[houseKey] || 50999;
}

function nativeBridgeHouseFromMessage(message) {
  const raw = String(
    message?.houseKey ||
    message?.house ||
    message?.siteName ||
    message?.payload?.houseKey ||
    message?.payload?.house ||
    message?.payload?.siteName ||
    ''
  ).toLowerCase();
  if (raw.includes('nacional')) return 'betnacional';
  if (raw.includes('fair')) return 'betfair';
  if (raw.includes('mgm')) return 'betmgm';
  if (raw.includes('betano')) return 'betano';
  if (raw.includes('superbet')) return 'superbet';
  return 'bet365';
}

function nativeBridgeWrite(value) {
  const child = nativeBridge.child;
  const transport = nativeBridge.pipeSocket && !nativeBridge.pipeSocket.destroyed
    ? nativeBridge.pipeSocket : (child && child.stdin && !child.killed ? child.stdin : null);
  if (!transport) return false;
  let payload;
  try { payload = Buffer.from(JSON.stringify(value), 'utf8'); } catch (_) { return false; }
  if (payload.length > NATIVE_BRIDGE_MAX_BYTES) return false;
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32LE(payload.length, 0);
  try {
    transport.write(Buffer.concat([header, payload]));
    return true;
  } catch (_) {
    return false;
  }
}

function startNativeBridgePipe() {
  if (nativeBridge.pipeServer) return;
  const server = net.createServer((socket) => {
    nativeBridge.pipeSocket = socket;
    nativeBridge.input = Buffer.alloc(0);
    socket.on('data', consumeNativeBridgeData);
    socket.on('close', () => { if (nativeBridge.pipeSocket === socket) nativeBridge.pipeSocket = null; });
    socket.on('error', () => { if (nativeBridge.pipeSocket === socket) nativeBridge.pipeSocket = null; });
  });
  server.on('error', (error) => console.warn('[Native Bridge pipe]', error.message));
  server.listen(NATIVE_BRIDGE_PIPE, () => console.log('[Native Bridge] Pipe ouvindo', NATIVE_BRIDGE_PIPE));
  nativeBridge.pipeServer = server;
}

function stopNativeBridgePipe() {
  nativeBridge.pipeSocket?.destroy();
  nativeBridge.pipeSocket = null;
  nativeBridge.pipeServer?.close();
  nativeBridge.pipeServer = null;
}

// Configuração de stake e 1-click autoritativa do Electron
let latestElectronConfig = null;

function ensureNativeBridgePort(houseKey, url) {
  const known = nativeBridge.portsByHouse.get(houseKey);
  if (known) return known;
  const portId = nativeBridgePortId(houseKey);
  const sender = {
    id: 'com.gatilhobr.browser-extension',
    url: url || HOUSE_CONFIGS[houseKey]?.url || '',
    tab: { id: portId, url: url || HOUSE_CONFIGS[houseKey]?.url || '', windowId: portId },
    frameId: 0,
    external: true,
  };
  nativeBridge.portsByHouse.set(houseKey, { portId, sender });
  if (backgroundWindow && !backgroundWindow.isDestroyed()) {
    backgroundWindow.webContents.send('gbr:broadcast-runtime-connect', {
      portId,
      name: `native-browser:${houseKey}`,
      sender,
    });
  }
  // Envia imediatamente a stake autoritativa do Electron para a aba que acabou de conectar
  if (latestElectronConfig && latestElectronConfig.stakeVal) {
    setTimeout(() => {
      nativeBridgeWrite({
        direction: 'to-extension',
        houseKey,
        message: {
          action: 'UPDATE_CONFIG',
          config: latestElectronConfig,
          __gbrElectronAuthorized: true,
        },
        sentAt: Date.now(),
      });
    }, 150);
  }
  return nativeBridge.portsByHouse.get(houseKey);
}

function forwardNativeBridgeEvent(message) {
  if (!message || typeof message !== 'object' || !NATIVE_BRIDGE_ALLOWED_EVENTS.has(message.type)) return;
  if (message.type === 'NATIVE_HELLO' || message.type === 'GBR_INSTALLATION_PING' || message.type === 'PING' || message.type === 'HANDSHAKE') {
    lastSeenExtensionVersion = message.payload?.version || message.version || '4.3.0';
    nativeBridge.extensionConnected = true;
    console.log(`[Native Bridge] 👋 Handshake/Ping da extensão recebido (v${lastSeenExtensionVersion})`);
    if (message.type === 'GBR_INSTALLATION_PING' || message.type === 'PING') {
      nativeBridgeWrite({
        direction: 'to-extension',
        message: {
          type: 'GBR_INSTALLATION_PONG',
          timestamp: Date.now(),
          appVersion: app ? app.getVersion() : '4.3.0',
          __gbrElectronAuthorized: true,
        },
        sentAt: Date.now(),
      });
    }
    broadcastHouseStatus();
    return;
  }
  if (message.type !== 'MARKET_DATA_UPDATE') {
    console.log(`[Native Bridge] Evento recebido: ${message.type} (${message.siteName || message.houseKey || ''})` +
      (message.type === 'EXECUTION_REPORT'
        ? ` report=${JSON.stringify(message.report || {}).slice(0, 1200)}`
        : ''));
  }
  // O Native Messaging envelope usado pela extensão carrega o snapshot em
  // `payload`. As portas do background/dashboard, porém, esperam o mesmo
  // formato de uma mensagem de content script (groups/betslip no nível raiz).
  // Normalize aqui para que o agregador não veja `groups: 0` ao receber do
  // Chrome real.
  if ((message.type === 'MARKET_DATA_UPDATE' || message.type === 'SYNC_DASHBOARD') && message.payload && typeof message.payload === 'object') {
    // Native Messaging pode encapsular o snapshot em payload.snapshot (ou
    // usar o legado payload.markets). Achate todos os formatos antes de
    // encaminhar para o agregador, que espera groups na raiz.
    const rawPayload = message.payload;
    const snapshot = rawPayload.snapshot && typeof rawPayload.snapshot === 'object'
      ? { ...rawPayload, ...rawPayload.snapshot }
      : rawPayload;
    if (!Array.isArray(snapshot.groups) && Array.isArray(snapshot.markets)) {
      snapshot.groups = snapshot.markets;
    }
    message = {
      ...snapshot,
      ...message,
      type: 'MARKET_DATA_UPDATE',
      siteName: message.siteName || snapshot.siteName,
    };
    delete message.payload;
  }
  const houseKey = nativeBridgeHouseFromMessage(message);
  if (message.type === 'OPEN_DASHBOARD') {
    if (dashboardWindow && !dashboardWindow.isDestroyed()) dashboardWindow.focus();
    return;
  }
  const url = typeof message.url === 'string' ? message.url.slice(0, 2048) : undefined;
  const port = ensureNativeBridgePort(houseKey, url);
  nativeBridge.connectedHouses.add(houseKey);

  // Relatórios de execução já foram processados pelo background antes de
  // chegar ao host nativo. Reentregá-los ao background criava um eco
  // Electron -> extensão -> Electron. Apenas snapshots/comandos de leitura
  // precisam passar pela porta sintética; o relatório segue para a dashboard.
  if (message.type !== 'EXECUTION_REPORT' && backgroundWindow && !backgroundWindow.isDestroyed()) {
    backgroundWindow.webContents.send('gbr:port-message', { portId: port.portId, message });
  }
  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    dashboardWindow.webContents.send('gbr:native-bridge-event', { houseKey, message });
    // A dashboard React já consome eventos pelo canal de portas do polyfill.
    // Espelhe aqui para que casas abertas no Chrome real tenham exatamente o
    // mesmo caminho de renderização das casas Electron.
    dashboardWindow.webContents.send('gbr:port-message', {
      portId: port.portId,
      message,
    });
  }
  broadcastHouseStatus();
}

function consumeNativeBridgeData(chunk) {
  nativeBridge.input = Buffer.concat([nativeBridge.input, Buffer.from(chunk)]);
  while (nativeBridge.input.length >= 4) {
    const length = nativeBridge.input.readUInt32LE(0);
    if (length > NATIVE_BRIDGE_MAX_BYTES) {
      console.warn('[Native Bridge] Mensagem descartada: tamanho inválido');
      nativeBridge.child?.kill();
      return;
    }
    if (nativeBridge.input.length < length + 4) return;
    const body = nativeBridge.input.subarray(4, length + 4);
    nativeBridge.input = nativeBridge.input.subarray(length + 4);
    try {
      const envelope = JSON.parse(body.toString('utf8'));
      // O host de diagnóstico ecoa mensagens. Só eventos explicitamente
      // marcados como vindos da extensão entram no dashboard/background;
      // isso impede que comandos locais retornem como se fossem eventos.
      const event = envelope?.direction === 'from-extension'
        ? envelope.message
        : envelope?.payload?.direction === 'from-extension'
          ? envelope.payload.message
          // Hosts de produção podem emitir o evento diretamente (sem
          // envelope); o processo é nosso filho, portanto a allowlist acima
          // continua sendo a barreira de tipos aceitos.
          : (NATIVE_BRIDGE_ALLOWED_EVENTS.has(envelope?.type) ? envelope : null);
      forwardNativeBridgeEvent(event);
    } catch (_) {
      console.warn('[Native Bridge] JSON inválido descartado');
    }
  }
}

function startNativeBridge() {
  startNativeBridgePipe();
  // O processo Native Messaging é iniciado pelo Chrome. Criar uma cópia no
  // Electron ocupa a mesma pipe sem ter stdin do Chrome e pode desviar os
  // eventos para um host fantasma. Aqui mantemos apenas o servidor pronto.
  return { success: true };
}

function stopNativeBridge() {
  const child = nativeBridge.child;
  nativeBridge.child = null;
  nativeBridge.input = Buffer.alloc(0);
  nativeBridge.portsByHouse.clear();
  nativeBridge.connectedHouses.clear();
  if (child && !child.killed) child.kill();
  stopNativeBridgePipe();
  broadcastHouseStatus();
}

// -------------------------------------------------------------------------
// 2. SISTEMA DE STORAGE LOCAL PERSISTENTE (COMPATÍVEL COM CHROME.STORAGE)
// -------------------------------------------------------------------------
const storageFilePath = path.join(app.getPath('userData'), 'gbr_storage_local.json');
let localStorageData = {};
let sessionStorageData = {};
let storageSaveTimer = null;

function loadStorageFromDisk() {
  try {
    if (fs.existsSync(storageFilePath)) {
      const raw = fs.readFileSync(storageFilePath, 'utf8');
      localStorageData = JSON.parse(raw);
    }
  } catch (err) {
    console.error('[Storage] Erro ao carregar gbr_storage_local.json:', err);
    localStorageData = {};
  }
}

function scheduleSaveStorageToDisk() {
  if (storageSaveTimer) return;
  storageSaveTimer = setTimeout(() => {
    storageSaveTimer = null;
    try {
      fs.writeFileSync(storageFilePath, JSON.stringify(localStorageData, null, 2), 'utf8');
    } catch (err) {
      console.error('[Storage] Erro ao salvar gbr_storage_local.json:', err);
    }
  }, 100);
}

loadStorageFromDisk();

// Handlers de Storage
ipcMain.handle('gbr:storage-get', async (event, { area, keys }) => {
  const store = area === 'session' ? sessionStorageData : localStorageData;
  if (!keys) return { ...store };

  if (typeof keys === 'string') {
    return { [keys]: store[keys] };
  }

  if (Array.isArray(keys)) {
    const result = {};
    for (const k of keys) {
      if (k in store) result[k] = store[k];
    }
    return result;
  }

  if (typeof keys === 'object') {
    const result = { ...keys };
    for (const k of Object.keys(keys)) {
      if (k in store) result[k] = store[k];
    }
    return result;
  }

  return {};
});

ipcMain.handle('gbr:storage-set', async (event, { area, items }) => {
  if (!items || typeof items !== 'object') return;
  const store = area === 'session' ? sessionStorageData : localStorageData;
  const changes = {};

  for (const [k, v] of Object.entries(items)) {
    const oldValue = store[k];
    store[k] = v;
    changes[k] = { oldValue, newValue: v };
  }

  if (area !== 'session') {
    scheduleSaveStorageToDisk();
  }

  // Notifica todas as janelas sobre a alteração
  broadcastToAllWindows('gbr:storage-changed', { changes, areaName: area || 'local' });
});

ipcMain.handle('gbr:storage-remove', async (event, { area, keys }) => {
  const store = area === 'session' ? sessionStorageData : localStorageData;
  const keyList = Array.isArray(keys) ? keys : [keys];
  const changes = {};

  for (const k of keyList) {
    if (k in store) {
      const oldValue = store[k];
      delete store[k];
      changes[k] = { oldValue, newValue: undefined };
    }
  }

  if (area !== 'session') {
    scheduleSaveStorageToDisk();
  }

  broadcastToAllWindows('gbr:storage-changed', { changes, areaName: area || 'local' });
});

ipcMain.handle('gbr:storage-clear', async (event, { area }) => {
  if (area === 'session') {
    sessionStorageData = {};
  } else {
    localStorageData = {};
    scheduleSaveStorageToDisk();
  }
  broadcastToAllWindows('gbr:storage-changed', { changes: {}, areaName: area || 'local' });
});

// -------------------------------------------------------------------------
// 3. GERENCIADOR DE JANELAS E ESTAÇÃO DE TRABALHO
// -------------------------------------------------------------------------
function createDashboardWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;

  dashboardWindow = new BrowserWindow({
    width: Math.min(680, width),
    height: Math.min(890, height),
    minWidth: 480,
    minHeight: 600,
    title: 'GatilhoBR Desktop - Painel de Controle ao Vivo',
    backgroundColor: '#0B0F19',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '../assets/icons/gatilho-512.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload-dashboard.js'),
      nodeIntegration: false,
      contextIsolation: false,
      backgroundThrottling: false,
      webSecurity: false,
      allowRunningInsecureContent: true,
    },
  });

  dashboardWindow.removeMenu();
  dashboardWindow.setMenuBarVisibility(false);

  const localAppData = process.env.LOCALAPPDATA || '';
  const appData = process.env.APPDATA || '';
  const flagCandidates = [
    path.join(localAppData, 'GatilhoBR', 'pending_onboarding.flag'),
    path.join(appData, 'gatilhobr-desktop', 'pending_onboarding.flag'),
    path.join(app ? app.getPath('userData') : '', 'pending_onboarding.flag')
  ];
  let hasPendingOnboardingFlag = false;
  for (const flagPath of flagCandidates) {
    if (flagPath && fs.existsSync(flagPath)) {
      hasPendingOnboardingFlag = true;
      try { fs.unlinkSync(flagPath); } catch (_) {}
      console.log(`[Main] 🚩 Marcador ${flagPath} detectado! Forçando exibição do onboarding pós-instalação.`);
    }
  }

  const isOnboardingRequested = hasPendingOnboardingFlag || process.argv.some(arg => arg && String(arg).includes('onboarding'));
  const queryParams = {};
  if (isOnboardingRequested) queryParams.onboarding = 'install';
  const loadOptions = Object.keys(queryParams).length > 0 ? { query: queryParams } : {};
  dashboardWindow.loadFile(path.join(__dirname, '../dashboard-app/dist/index.html'), loadOptions);
  attachWebContentsLogging(dashboardWindow.webContents, 'Dashboard');

  dashboardWindow.webContents.on('did-finish-load', () => {
    if (isOnboardingRequested) {
      dashboardWindow.webContents.send('gbr:start-onboarding');
      dashboardWindow.webContents.executeJavaScript('if (window.__gbrOpenOnboarding) window.__gbrOpenOnboarding();').catch(() => {});
    }
  });

  dashboardWindow.on('closed', () => {
    dashboardWindow = null;
    // Fecha janelas auxiliares ao fechar o painel principal
    for (const win of houseWindows.values()) {
      if (!win.isDestroyed()) win.close();
    }
    if (backgroundWindow && !backgroundWindow.isDestroyed()) {
      backgroundWindow.close();
    }
    app.quit();
  });
}

function createBackgroundWindow() {
  backgroundWindow = new BrowserWindow({
    show: false,
    width: 300,
    height: 300,
    title: 'GatilhoBR Background Engine',
    webPreferences: {
      preload: path.join(__dirname, 'preload-dashboard.js'),
      nodeIntegration: false,
      contextIsolation: false,
      backgroundThrottling: false,
      webSecurity: false,
      allowRunningInsecureContent: true,
    },
  });

  backgroundWindow.loadFile(path.join(__dirname, 'background-runner.html'));
  attachWebContentsLogging(backgroundWindow.webContents, 'Background');

  backgroundWindow.webContents.on('did-fail-load', (e, code, desc) => {
    console.error('[Background Window] Falha ao carregar:', desc);
  });
}

const HOUSE_CONFIGS = {
  bet365: {
    name: 'Bet365',
    url: 'https://www.bet365.bet.br',
    partition: 'persist:gbr_bet365',
    matches: ['bet365.com', 'bet365.bet.br', 'bet365.es'],
    // Casas marcadas como "external" serão migradas gradualmente para
    // Chrome/Edge real. O fluxo Electron existente permanece inalterado
    // até que a ponte da extensão esteja disponível.
    browserMode: 'external',
  },
  betfair: {
    name: 'Betfair',
    url: 'https://www.betfair.com/sport',
    partition: 'persist:gbr_betfair',
    matches: ['betfair.com', 'betfair.bet.br', 'betfair.es'],
  },
  betnacional: {
    name: 'Betnacional',
    url: 'https://betnacional.bet.br',
    partition: 'persist:gbr_betnacional',
    matches: ['betnacional.com', 'betnacional.bet.br', 'betnacional.br'],
    browserMode: 'external',
  },
  betmgm: {
    name: 'BetMGM',
    url: 'https://www.betmgm.bet.br/aposta-esportiva#/home',
    partition: 'persist:gbr_betmgm',
    matches: ['betmgm.bet.br'],
  },
  betano: {
    name: 'Betano',
    // Always open the Betano home page; keep host matching independent below.
    url: 'https://betano.bet.br/',
    partition: 'persist:gbr_betano',
    matches: ['betano.bet.br'],
    browserMode: 'external',
  },
  superbet: {
    name: 'Superbet',
    url: 'https://superbet.bet.br/',
    partition: 'persist:gbr_superbet',
    matches: ['superbet.bet.br', 'superbet.com'],
    browserMode: 'external',
  },
};

// -------------------------------------------------------------------------
// Navegador real (scaffold de migração)
// -------------------------------------------------------------------------
// Retorna o executável Chrome/Edge instalado sem presumir caminhos fixos.
// A função é deliberadamente somente leitura; não altera o perfil do usuário
// nem registra políticas. A instalação/ponte da extensão será adicionada em
// uma etapa posterior.
function detectRealBrowser() {
  const candidates = [];
  const pf = process.env.PROGRAMFILES;
  const pf86 = process.env['PROGRAMFILES(X86)'];
  const local = process.env.LOCALAPPDATA;
  if (pf) {
    candidates.push(path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    candidates.push(path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
  }
  if (pf86) {
    candidates.push(path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    candidates.push(path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
  }
  if (local) {
    candidates.push(path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    candidates.push(path.join(local, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
  }
  const executablePath = candidates.find((candidate) => {
    try { return fs.existsSync(candidate); } catch (_) { return false; }
  });
  if (!executablePath) return null;
  const name = /msedge(?:\.exe)?$/i.test(executablePath) ? 'edge' : 'chrome';
  return { name, executablePath };
}

const lastExternalHouseOpenAt = new Map();

/**
 * Abre uma casa no navegador real instalado.
 * Esta API é um scaffold: a extensão local/Native Messaging ainda será
 * conectada posteriormente. Em caso de ausência de Chrome/Edge, retorna
 * erro sem interferir na janela Electron atual.
 */
function openExternalHouse(houseKey, options = {}) {
  const config = HOUSE_CONFIGS[houseKey];
  if (!config) return { success: false, error: `Casa não reconhecida: ${houseKey}` };

  const now = Date.now();
  const lastTime = lastExternalHouseOpenAt.get(houseKey) || 0;
  if (now - lastTime < 1500) {
    console.log(`[External Browser] Ignorando abertura duplicada de ${config.name} (debounce: ${now - lastTime}ms)`);
    return { success: true, debounced: true };
  }
  lastExternalHouseOpenAt.set(houseKey, now);

  const browser = detectRealBrowser();
  if (!browser) return { success: false, error: 'Chrome ou Edge não encontrado' };

  const args = ['--app=' + (options.url || config.url)];
  if (options.userDataDir) args.push('--user-data-dir=' + options.userDataDir);
  try {
    const child = spawn(browser.executablePath, args, { detached: true, stdio: 'ignore' });
    child.unref();
    console.log(`[External Browser] ${config.name} aberta no ${browser.name}`);
    return { success: true, browser: browser.name, executablePath: browser.executablePath };
  } catch (error) {
    console.warn(`[External Browser] Falha ao abrir ${config.name}:`, error.message);
    return { success: false, error: error.message };
  }
}

function openHouseWindow(houseKey) {
  const config = HOUSE_CONFIGS[houseKey];
  if (!config) return null;

  // Verifica se a janela da casa já existe
  for (const [tId, win] of houseWindows.entries()) {
    if (!win.isDestroyed() && win.__houseKey === houseKey) {
      win.focus();
      return win;
    }
  }

  const tabId = nextTabId++;
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;

  const win = new BrowserWindow({
    width: Math.min(1200, width - 100),
    height: Math.min(800, height - 80),
    title: `${config.name} - GatilhoBR Workstation`,
    backgroundColor: '#121212',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '../assets/icons/gatilho-128.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload-house.js'),
      partition: config.partition,
      nodeIntegration: false,
      contextIsolation: false,
      backgroundThrottling: false,
      webSecurity: houseKey !== 'bet365',
      allowRunningInsecureContent: houseKey !== 'bet365',
    },
  });

  win.removeMenu();
  win.setMenuBarVisibility(false);

  win.__houseKey = houseKey;
  win.__tabId = tabId;
  houseWindows.set(tabId, win);

  // Define User-Agent idêntico ao Google Chrome real correspondente à versão exata do Chromium no Electron
  const chromeVer = '140.0.0.0';
  win.webContents.userAgent = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVer} Safari/537.36`;

  attachWebContentsLogging(win.webContents, config.name);

  // Preserve cookies imported from the user's normal browser, including
  // Cloudflare clearance/session tokens required for authentication.
  win.loadURL(config.url);

  win.on('focus', () => {
    broadcastToAllWindows('gbr:tabs-activated', { tabId });
  });

  win.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12' && input.type === 'keyDown') {
      win.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  win.webContents.on('did-finish-load', () => {
    broadcastToAllWindows('gbr:tabs-updated', {
      tabId,
      changeInfo: { status: 'complete' },
      tab: { id: tabId, url: win.webContents.getURL() },
    });
  });

  win.on('closed', () => {
    houseWindows.delete(tabId);
    console.log(`[Workstation] Janela da casa ${houseKey} fechada (tabId: ${tabId})`);
    broadcastHouseStatus();
    broadcastToAllWindows('gbr:tabs-removed', { tabId });
  });

  broadcastHouseStatus();
  console.log(`[Workstation] Janela aberta para ${config.name} (tabId: ${tabId})`);
  return win;
}

function getActiveHousesStatus() {
  const status = {};
  for (const key of Object.keys(HOUSE_CONFIGS)) {
    status[key] = nativeBridge.connectedHouses.has(key) ||
      [...houseWindows.values()].some(w => !w.isDestroyed() && w.__houseKey === key);
  }
  return status;
}

function broadcastHouseStatus() {
  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    dashboardWindow.webContents.send('gbr:house-status-updated', getActiveHousesStatus());
  }
}

function configureHouseSessions() {
  // A Bet365 entrega o shell da aplicação mesmo quando o ambiente é
  // identificado como Electron, mas bloqueia as chamadas de esportes/live.
  // Definir apenas webContents.userAgent não altera os Client Hints enviados
  // pelo Chromium. Mantemos os hints coerentes com o UA Chrome usado pela
  // janela para que a sessão não seja classificada como Electron.
  // O Electron 33 embarca Chromium 130, que a Bet365 passou a considerar
  // legado para o feed de esportes. Anunciamos uma versão Chrome estável
  // atual nos headers (o site faz feature-gating por essa versão).
  const chromeVersion = '140';
  const chromeUserAgent = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion}.0.0.0 Safari/537.36`;
  const maskBet365ClientHints = (details, callback) => {
    const requestHeaders = { ...(details.requestHeaders || {}) };
    const keys = Object.keys(requestHeaders);
    const findKey = (name) => keys.find((key) => key.toLowerCase() === name.toLowerCase());
    const setHeader = (name, value) => {
      const existing = findKey(name);
      requestHeaders[existing || name] = value;
    };

    // A identidade precisa ser igual no sportsbook e no host de autenticação;
    // versões divergentes fazem o backend devolver countryID=0.
    setHeader('User-Agent', chromeUserAgent);
    setHeader('sec-ch-ua', `"Google Chrome";v="${chromeVersion}", "Chromium";v="${chromeVersion}", "Not_A Brand";v="24"`);
    setHeader('sec-ch-ua-mobile', '?0');
    setHeader('sec-ch-ua-platform', '"Windows"');
    callback({ cancel: false, requestHeaders });
  };

  const stripCsp = (details, callback) => {
    const responseHeaders = { ...details.responseHeaders };
    for (const key of Object.keys(responseHeaders)) {
      const lower = key.toLowerCase();
      if (
        lower === 'content-security-policy' ||
        lower === 'content-security-policy-report-only' ||
        lower === 'x-frame-options' ||
        lower === 'frame-options'
      ) {
        delete responseHeaders[key];
      }
    }
    callback({ cancel: false, responseHeaders });
  };

  for (const [key, config] of Object.entries(HOUSE_CONFIGS)) {
    try {
      const ses = session.fromPartition(config.partition);
      if (key === 'bet365') {
        ses.webRequest.onBeforeSendHeaders(maskBet365ClientHints);
        // A Bet365 valida a localização antes de solicitar os mercados. O
        // Chromium de desktop nega geolocation por padrão quando não há um
        // handler configurado, deixando o shell visível e o conteúdo vazio.
        ses.setPermissionRequestHandler((_webContents, permission, callback) => {
          callback(permission === 'geolocation');
        });
        ses.setPermissionCheckHandler((_webContents, permission) => permission === 'geolocation');
        continue; // CSP da Bet365 permanece intacta
      }
      ses.webRequest.onHeadersReceived(stripCsp);
    } catch (e) {
      console.warn('[Main] Erro ao configurar sessão:', e);
    }
  }
  try {
    session.defaultSession.webRequest.onHeadersReceived(stripCsp);
  } catch (e) {}
}

function attachWebContentsLogging(wc, label) {
  if (!wc) return;
  wc.on('console-message', (event, level, message, line, sourceId) => {
    let msg = '';
    let src = '';
    let ln = 0;

    if (typeof event === 'object' && event !== null && event.message !== undefined) {
      msg = String(event.message || '');
      src = String(event.sourceId || '');
      ln = event.lineNumber || 0;
    } else if (typeof message === 'string') {
      msg = message;
      src = String(sourceId || '');
      ln = line || 0;
    } else {
      msg = String(event || '');
    }

    // Evita poluir com ruídos conhecidos do Google Analytics / tags de telemetria
    if (msg.includes('GoogleAnalytics') || msg.includes('gtag') || msg.includes('clarity')) return;

    const loc = src ? ` [${src.split('/').pop().split('?')[0]}:${ln}]` : '';
    console.log(`[${label}] ${msg}${loc}`);
  });
}

// -------------------------------------------------------------------------
// 4. ROTEADOR DE MENSAGENS IPC & COMPATIBILIDADE CHROME
// -------------------------------------------------------------------------
function broadcastToAllWindows(channel, data) {
  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    dashboardWindow.webContents.send(channel, data);
  }
  if (backgroundWindow && !backgroundWindow.isDestroyed()) {
    backgroundWindow.webContents.send(channel, data);
  }
  for (const win of houseWindows.values()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, data);
    }
  }
}

// Retorna tabId síncrono para preloads
ipcMain.on('gbr:get-current-tab-id', (event) => {
  for (const [tabId, win] of houseWindows.entries()) {
    if (win.webContents === event.sender) {
      event.returnValue = tabId;
      return;
    }
  }
  event.returnValue = 1;
});

// Retorna informações completas da aba/casa para preloads
ipcMain.on('gbr:get-current-tab-info', (event) => {
  for (const [tabId, win] of houseWindows.entries()) {
    if (win.webContents === event.sender) {
      event.returnValue = {
        tabId,
        houseKey: win.__houseKey || 'unknown',
        url: win.webContents.getURL(),
      };
      return;
    }
  }
  event.returnValue = { tabId: 1, houseKey: 'unknown', url: '' };
});

// Manipulador do chrome.commands.getAll
ipcMain.handle('gbr:commands-get-all', () => {
  return [
    { name: 'dynamic-bind-slot-1', shortcut: 'Ctrl+Shift+1', description: 'Disparar bind global 1' },
    { name: 'dynamic-bind-slot-2', shortcut: 'Ctrl+Shift+2', description: 'Disparar bind global 2' },
    { name: 'dynamic-bind-slot-3', shortcut: 'Ctrl+Shift+3', description: 'Disparar bind global 3' },
    { name: 'dynamic-bind-slot-4', shortcut: 'Ctrl+Shift+4', description: 'Disparar bind global 4' },
    { name: 'trigger_place_bet_global', shortcut: '', description: 'Disparar Aposta (Global / Sem Foco)' },
    { name: 'trigger-focused', shortcut: '', description: 'Disparar Aposta (Aba em Foco)' },
    { name: 'trigger-bet365', shortcut: '', description: 'Disparar Aposta Bet365 (Background)' },
  ];
});

// Leitura síncrona de arquivos para preloads sem acesso ao módulo fs
ipcMain.on('gbr:read-file-sync', (event, relPath) => {
  try {
    const fullPath = path.join(__dirname, '..', relPath);
    if (fs.existsSync(fullPath)) {
      event.returnValue = fs.readFileSync(fullPath, 'utf8');
      return;
    }
  } catch (err) {}
  event.returnValue = null;
});

// Mensagens diretas entre páginas (chrome.runtime.sendMessage)
ipcMain.handle('gbr:runtime-send-message', async (event, { message }) => {
  if (!message) return null;

  // Se a mensagem for de controle de janela nativa
  if (message.action === 'LAUNCH_SELECTED_HOUSES') {
    const houses = message.houses || [];
    for (const h of houses) {
      if (HOUSE_CONFIGS[h]?.browserMode === 'external') openExternalHouse(h);
      else openHouseWindow(h);
    }
    return {
      connectionStatus: {
        bet365Active: [...houseWindows.values()].some(w => w.__houseKey === 'bet365'),
        betfairActive: [...houseWindows.values()].some(w => w.__houseKey === 'betfair'),
        betnacionalActive: [...houseWindows.values()].some(w => w.__houseKey === 'betnacional'),
        betmgmActive: [...houseWindows.values()].some(w => w.__houseKey === 'betmgm'),
        betanoActive: [...houseWindows.values()].some(w => w.__houseKey === 'betano'),
        superbetActive: [...houseWindows.values()].some(w => w.__houseKey === 'superbet') || nativeBridge.connectedHouses.has('superbet'),
      }
    };
  }

  // Encaminha a mensagem para o Background Window e aguarda resposta
  if (backgroundWindow && !backgroundWindow.isDestroyed() && event.sender !== backgroundWindow.webContents) {
    return new Promise((resolve) => {
      const replyChannel = `gbr:reply_${Date.now()}_${Math.random()}`;
      const timeout = setTimeout(() => {
        ipcMain.removeAllListeners(replyChannel);
        resolve(null);
      }, 5000);

      ipcMain.once(replyChannel, (e, response) => {
        clearTimeout(timeout);
        resolve(response);
      });

      backgroundWindow.webContents.send('gbr:broadcast-runtime-message', {
        message,
        sender: { id: 'gatilhobr-desktop', tab: { id: event.sender.__tabId || 1 } },
        replyChannel,
      });
    });
  }

  return null;
});

const lastOpenHouseIpcAt = new Map();

// Abertura direta de casas via IPC da barra de estação de trabalho
ipcMain.on('gbr:open-house', (event, { house }) => {
  if (!house) return;
  const now = Date.now();
  const lastTime = lastOpenHouseIpcAt.get(house) || 0;
  if (now - lastTime < 1500) {
    console.log(`[Main] gbr:open-house ignorado por debounce (${house}, delta: ${now - lastTime}ms)`);
    return;
  }
  lastOpenHouseIpcAt.set(house, now);

  if (house === 'all') {
    ['bet365', 'betfair', 'betnacional', 'betmgm', 'betano', 'superbet'].forEach((key) =>
      HOUSE_CONFIGS[key]?.browserMode === 'external' ? openExternalHouse(key) : openHouseWindow(key)
    );
  } else {
    if (HOUSE_CONFIGS[house]?.browserMode === 'external') {
      const result = openExternalHouse(house);
      if (!result.success) console.warn(`[External Browser] ${result.error}`);
    } else {
      openHouseWindow(house);
    }
  }
});

ipcMain.handle('gbr:get-house-status', () => {
  return getActiveHousesStatus();
});

// APIs de migração para navegador real (não alteram openHouseWindow).
ipcMain.handle('gbr:get-browser-capability', () => {
  const browser = detectRealBrowser();
  return {
    available: !!browser,
    browser: browser?.name || null,
    executablePath: browser?.executablePath || null,
    externalHouses: Object.entries(HOUSE_CONFIGS)
      .filter(([, cfg]) => cfg.browserMode === 'external')
      .map(([key]) => key),
  };
});

// Controle explícito da ponte (usado pelo assistente de instalação/testes).
ipcMain.handle('gbr:native-bridge-start', () => startNativeBridge());
ipcMain.handle('gbr:native-bridge-stop', () => { stopNativeBridge(); return { success: true }; });
ipcMain.handle('gbr:native-bridge-status', () => ({
  running: (!!nativeBridge.child && !nativeBridge.child.killed) || !!nativeBridge.pipeSocket,
  connectedHouses: [...nativeBridge.connectedHouses],
  hostPath: nativeBridgeHostPath(),
}));
ipcMain.handle('gbr:native-bridge-send', (_event, { house, message } = {}) => {
  if (!message || typeof message !== 'object') return { success: false, error: 'Mensagem inválida' };
  const houseKey = nativeBridgeHouseFromMessage({ ...message, house });
  const ok = nativeBridgeWrite({
    direction: 'to-extension',
    houseKey,
    message,
    sentAt: Date.now(),
  });
  return { success: ok, houseKey, running: !!nativeBridge.child && !nativeBridge.child.killed };
});

ipcMain.handle('gbr:open-external-house', (_event, { house, url, userDataDir } = {}) => {
  return openExternalHouse(house, { url, userDataDir });
});

// Gerenciamento de conexões de longa duração (chrome.runtime.connect)
const activePortConnections = new Map();

ipcMain.on('gbr:port-connect', (event, { portId, name }) => {
  const isDashboard = event.sender === dashboardWindow?.webContents;
  let senderTabId = 1;
  let senderUrl = event.sender.getURL();

  if (isDashboard) {
    senderTabId = 9999;
  } else {
    for (const [tabId, win] of houseWindows.entries()) {
      if (win.webContents === event.sender) {
        senderTabId = tabId;
        if (!senderUrl || senderUrl === 'about:blank') {
          const cfg = HOUSE_CONFIGS[win.__houseKey];
          if (cfg) senderUrl = cfg.url;
        }
        break;
      }
    }
  }

  const sender = {
    id: 'gatilhobr-desktop',
    url: senderUrl,
    tab: {
      id: senderTabId,
      url: senderUrl,
      windowId: 1,
    },
    frameId: 0,
  };

  activePortConnections.set(portId, {
    senderWebContents: event.sender,
    name,
    sender,
  });

  console.log(`[Main IPC] 🔌 port-connect (${portId}, name: "${name}") de tab ${senderTabId} (${senderUrl})`);

  // Notifica o Background Runner sobre a nova conexão de porta com o sender completo
  if (backgroundWindow && !backgroundWindow.isDestroyed()) {
    backgroundWindow.webContents.send('gbr:broadcast-runtime-connect', { portId, name, sender });
  }
});

ipcMain.on('gbr:port-post-message', (event, data) => {
  const { portId, message, messageJson } = data || {};
  const payload = messageJson ? { portId, messageJson } : { portId, message };
  const fromBg = event.sender === backgroundWindow?.webContents;
  let parsedOutbound = message;
  if (typeof messageJson === 'string') {
    try { parsedOutbound = JSON.parse(messageJson); } catch (_) { parsedOutbound = null; }
  }
  const isDashboardFeed = parsedOutbound && typeof parsedOutbound === 'object' &&
    (parsedOutbound.type === 'SYNC_DASHBOARD' || parsedOutbound.type === 'MARKET_DATA_UPDATE');
  const isDashboardPort = activePortConnections.get(portId)?.name === 'dashboard_react_live_stream' ||
    activePortConnections.get(portId)?.senderWebContents === dashboardWindow?.webContents;

  const targetHouse = parsedOutbound && typeof parsedOutbound === 'object' ? nativeBridgeHouseFromMessage(parsedOutbound) : null;
  const isTargetingExternal = targetHouse && HOUSE_CONFIGS[targetHouse]?.browserMode === 'external';

  // Portas sintéticas criadas para a extensão no Chrome real ou comandos para casas externas são encaminhadas
  // ao host Native Messaging. Snapshots e dados de dashboard NUNCA são desviados para a extensão.
  const isNativePort = [...nativeBridge.portsByHouse.values()].some((p) => p.portId === portId);
  if (fromBg && !isDashboardFeed && !isDashboardPort && (isNativePort || isTargetingExternal)) {
    const outbound = parsedOutbound;
    if (outbound && typeof outbound === 'object') {
      const bridgeHouse = [...nativeBridge.portsByHouse.entries()]
        .find(([, bridgePort]) => bridgePort.portId === portId)?.[0] || targetHouse;
      const delivered = nativeBridgeWrite({
        direction: 'to-extension',
        houseKey: bridgeHouse,
        // A autenticação/licença do usuário é mantida no Electron. Este
        // marcador apenas permite que a aba Chrome aceite a ação já validada
        // pela dashboard oficial, sem exigir um segundo login na extensão.
        message: { ...outbound, __gbrElectronAuthorized: true },
        sentAt: Date.now(),
      });
      console.log(`[Native Bridge] Comando para extensão: ${outbound.type || outbound.action || 'desconhecido'} (${bridgeHouse || 'sem-casa'}) ${delivered ? 'enviado' : 'sem conexão'}`);
    }
    return;
  }
  console.log(`[Main IPC] 🔄 port-post-message (${portId}) encaminhado para ${fromBg ? 'Dashboard' : 'Background'}`);

  // Se o remetente não for o backgroundWindow, encaminha para o backgroundWindow
  if (backgroundWindow && !backgroundWindow.isDestroyed() && !fromBg) {
    backgroundWindow.webContents.send('gbr:port-message', payload);
  }
  // Se o remetente for o backgroundWindow, encaminha para a dashboard e para as casas
  if (fromBg) {
    if (dashboardWindow && !dashboardWindow.isDestroyed()) {
      dashboardWindow.webContents.send('gbr:port-message', payload);
    }
    for (const win of houseWindows.values()) {
      if (!win.isDestroyed()) {
        win.webContents.send('gbr:port-message', payload);
      }
    }
  }
});

ipcMain.on('gbr:port-disconnect-req', (event, { portId }) => {
  activePortConnections.delete(portId);
  broadcastToAllWindows('gbr:port-disconnect', { portId });
});

// Emulação de Janelas (chrome.windows.*)
ipcMain.handle('gbr:windows-create', async (event, createData) => {
  const url = createData && createData.url ? createData.url : '';
  if (url.includes('dashboard-app') || url.includes('dashboard')) {
    if (dashboardWindow && !dashboardWindow.isDestroyed()) {
      dashboardWindow.focus();
      return { id: 1 };
    }
  }
  for (const [hKey, hConf] of Object.entries(HOUSE_CONFIGS)) {
    if (hConf.matches.some(m => url.includes(m))) {
      const win = openHouseWindow(hKey);
      return { id: win.__tabId };
    }
  }
  return { id: 1 };
});

ipcMain.handle('gbr:windows-update', async (event, { windowId, updateInfo }) => {
  if (updateInfo && updateInfo.focused) {
    if (dashboardWindow && !dashboardWindow.isDestroyed()) {
      dashboardWindow.focus();
    }
  }
  return { id: windowId };
});

// Emulação de Scripting (chrome.scripting.executeScript)
ipcMain.handle('gbr:scripting-execute-script', async (event, injection) => {
  const tabId = injection?.target?.tabId;
  const win = houseWindows.get(tabId);
  if (!win || win.isDestroyed()) return [];

  // Se for a Bet365 em modo limpo isolado (para diagnóstico e compatibilidade nativa de WebSocket zap/)
  if (win.__houseKey === 'bet365') {
    console.log(`[Scripting] 🛑 Ignorando injeção de script na Bet365 (Modo Limpo Nativo):`, injection.files || injection.func?.name || 'função');
    return [];
  }

  const results = [];
  try {
    if (Array.isArray(injection.files)) {
      for (const relFile of injection.files) {
        const fullPath = path.join(__dirname, '..', relFile);
        if (fs.existsSync(fullPath)) {
          const code = fs.readFileSync(fullPath, 'utf8');
          try {
            // Envolve em IIFE retornando true para eliminar DOMException "An object could not be cloned" do V8
            await win.webContents.executeJavaScript(`(() => {\n${code}\n; return true;\n})()`);
            results.push({ result: true });
          } catch (fileErr) {
            console.warn(`[Scripting] Erro no arquivo ${relFile} na aba ${tabId}:`, fileErr.message);
          }
        }
      }
    } else if (typeof injection.func === 'function' || typeof injection.func === 'string') {
      const funcCode = injection.func.toString();
      const argsCode = JSON.stringify(injection.args || []);
      const expr = `(${funcCode})(...${argsCode})`;
      try {
        const res = await win.webContents.executeJavaScript(expr);
        results.push({ result: JSON.parse(JSON.stringify(res ?? null)) });
      } catch (funcErr) {
        console.warn(`[Scripting] Erro na função na aba ${tabId}:`, funcErr.message);
      }
    }
  } catch (err) {
    console.warn(`[Scripting] Erro ao executar script na aba ${tabId}:`, err.message);
  }
  return results;
});

// Emulação de Tabs (chrome.tabs.*)
ipcMain.handle('gbr:tabs-query', async (event, queryInfo) => {
  const result = [];
  for (const [tabId, win] of houseWindows.entries()) {
    if (win.isDestroyed()) continue;
    const url = win.webContents.getURL();
    const title = win.getTitle();

    // Filtro simples por URL se especificado
    if (queryInfo && queryInfo.url) {
      const patterns = Array.isArray(queryInfo.url) ? queryInfo.url : [queryInfo.url];
      const match = patterns.some((p) => {
        const clean = p.replace(/\*/g, '');
        return url.includes(clean);
      });
      if (!match) continue;
    }

    result.push({
      id: tabId,
      url,
      title,
      active: win.isFocused(),
      status: 'complete',
    });
  }
  // Casas Bet365/Betnacional abertas no Chrome real não pertencem a
  // `houseWindows`; exponha uma aba sintética para que a dashboard consiga
  // sincronizar stake/1-click pelo mesmo chrome.tabs API.
  for (const [houseKey, bridgePort] of nativeBridge.portsByHouse.entries()) {
    const cfg = HOUSE_CONFIGS[houseKey];
    const url = cfg?.url || '';
    result.push({ id: bridgePort.portId, url, title: houseKey, active: true, status: 'complete' });
  }
  return result;
});

ipcMain.handle('gbr:tabs-get', async (event, { tabId }) => {
  const win = houseWindows.get(tabId);
  if (win && !win.isDestroyed()) {
    return {
      id: tabId,
      url: win.webContents.getURL(),
      title: win.getTitle(),
      active: win.isFocused(),
      status: 'complete',
    };
  }
  return null;
});

ipcMain.handle('gbr:tabs-create', async (event, createProperties) => {
  const url = createProperties && createProperties.url ? createProperties.url : '';
  let matchedHouse = 'bet365';
  for (const [hKey, hConf] of Object.entries(HOUSE_CONFIGS)) {
    if (hConf.matches.some(m => url.includes(m))) {
      matchedHouse = hKey;
      break;
    }
  }
  const win = openHouseWindow(matchedHouse);
  return { id: win.__tabId, url };
});

ipcMain.handle('gbr:tabs-send-message', async (event, { tabId, message }) => {
  // External Chrome houses do not exist in Electron's houseWindows map. The
  // React dashboard still broadcasts UPDATE_CONFIG through tabs.sendMessage;
  // relay that configuration directly through Native Messaging so stake and
  // one-click settings reach the real tab even when tabs-query is empty.
  if (message?.action === 'UPDATE_CONFIG' && message.config && typeof message.config === 'object') {
    latestElectronConfig = { ...latestElectronConfig, ...message.config };
    const delivered = nativeBridgeWrite({
      direction: 'to-extension',
      message: { ...message, __gbrElectronAuthorized: true },
      sentAt: Date.now(),
    });
    console.log(`[Native Bridge] UPDATE_CONFIG ${delivered ? 'enviado' : 'sem conexão'} (tabs.sendMessage)`);
    // Replicar para todas as janelas de casas internas
    for (const houseWin of houseWindows.values()) {
      if (houseWin && !houseWin.isDestroyed()) {
        try {
          houseWin.webContents.send('gbr:broadcast-runtime-message', {
            message: { ...message, __gbrElectronAuthorized: true },
            sender: { id: 'gatilhobr-desktop' },
          });
        } catch (_) {}
      }
    }
    return delivered ? { status: 'OK' } : null;
  }
  const win = houseWindows.get(tabId);
  if (win && !win.isDestroyed()) {
    return new Promise((resolve) => {
      const replyChannel = `gbr:tab_reply_${Date.now()}_${Math.random()}`;
      const timeout = setTimeout(() => {
        ipcMain.removeAllListeners(replyChannel);
        resolve(null);
      }, 5000);

      ipcMain.once(replyChannel, (e, res) => {
        clearTimeout(timeout);
        resolve(res);
      });

      win.webContents.send('gbr:broadcast-runtime-message', {
        message,
        sender: { id: 'gatilhobr-desktop' },
        replyChannel,
      });
    });
  }
  const bridgeEntry = [...nativeBridge.portsByHouse.entries()].find(([, bridgePort]) => bridgePort.portId === tabId);
  if (bridgeEntry && message && typeof message === 'object') {
    const [houseKey] = bridgeEntry;
    const delivered = nativeBridgeWrite({
      direction: 'to-extension',
      houseKey,
      message: { ...message, __gbrElectronAuthorized: true },
      sentAt: Date.now(),
    });
    return delivered ? { status: 'OK' } : null;
  }
  return null;
});

// -------------------------------------------------------------------------
// 5. CDP DEBUGGER SEM BARRA AMARELA DE AVISO (STEALTH AUTOMATION)
// -------------------------------------------------------------------------
ipcMain.handle('gbr:debugger-attach', async (event, { target, requiredVersion }) => {
  const tabId = target && target.tabId;
  const win = houseWindows.get(tabId);
  if (!win || win.isDestroyed()) return;

  try {
    if (!win.webContents.debugger.isAttached()) {
      win.webContents.debugger.attach(requiredVersion || '1.3');
      console.log(`[Debugger CDP] Acoplado com sucesso à janela tabId: ${tabId}`);
    }
  } catch (err) {
    console.warn(`[Debugger CDP] Erro ao acoplar: ${err.message}`);
  }
});

ipcMain.handle('gbr:debugger-send-command', async (event, { target, method, commandParams }) => {
  const tabId = target && target.tabId;
  const win = houseWindows.get(tabId);
  if (!win || win.isDestroyed()) return null;

  try {
    if (!win.webContents.debugger.isAttached()) {
      win.webContents.debugger.attach('1.3');
    }
    return await win.webContents.debugger.sendCommand(method, commandParams);
  } catch (err) {
    console.warn(`[Debugger CDP] Erro no comando ${method}:`, err.message);
    return null;
  }
});

ipcMain.handle('gbr:debugger-detach', async (event, { target }) => {
  const tabId = target && target.tabId;
  const win = houseWindows.get(tabId);
  if (win && !win.isDestroyed() && win.webContents.debugger.isAttached()) {
    win.webContents.debugger.detach();
  }
});

// -------------------------------------------------------------------------
// 6. ATALHOS GLOBAIS NATIVOS DO WINDOWS (RESPOSTA < 1MS SEM FOCO)
// -------------------------------------------------------------------------
function registerGlobalShortcuts() {
  globalShortcut.unregisterAll();

  // Atalhos de slot dinâmico
  const shortcutMap = [
    { key: 'CommandOrControl+Shift+1', command: 'dynamic-bind-slot-1' },
    { key: 'CommandOrControl+Shift+2', command: 'dynamic-bind-slot-2' },
    { key: 'CommandOrControl+Shift+3', command: 'dynamic-bind-slot-3' },
    { key: 'CommandOrControl+Shift+4', command: 'dynamic-bind-slot-4' },
  ];

  for (const { key, command } of shortcutMap) {
    try {
      globalShortcut.register(key, () => {
        console.log(`[Global Shortcut] ⚡ Disparado: ${key} -> ${command}`);
        broadcastToAllWindows('gbr:trigger-command', { command });
      });
    } catch (err) {
      console.warn(`[Global Shortcut] Falha ao registrar ${key}:`, err);
    }
  }

  // Atalho do disparador rápido padrão (ex: ControlRight ou F8)
  try {
    globalShortcut.register('F8', () => {
      console.log(`[Global Shortcut] ⚡ Disparado F8 -> trigger_place_bet_global (stake autoritativa: ${latestElectronConfig?.stakeVal || '0.50'})`);
      broadcastToAllWindows('gbr:trigger-command', {
        command: 'trigger_place_bet_global',
        stakeVal: latestElectronConfig?.stakeVal,
        stake: latestElectronConfig?.stakeVal,
      });
      nativeBridgeWrite({
        direction: 'to-extension',
        message: {
          type: 'DISPARAR_APOSTA',
          action: 'DISPARAR_APOSTA',
          isHotkey: true,
          stakeVal: latestElectronConfig?.stakeVal,
          stake: latestElectronConfig?.stakeVal,
          __gbrElectronAuthorized: true,
        },
        sentAt: Date.now(),
      });
    });
  } catch (e) {}
}

ipcMain.on('gbr:update-config', (_event, data) => {
  if (data?.action === 'UPDATE_CONFIG' && data.config && typeof data.config === 'object') {
    latestElectronConfig = { ...latestElectronConfig, ...data.config };
    nativeBridgeWrite({
      direction: 'to-extension',
      message: { ...data, __gbrElectronAuthorized: true },
      sentAt: Date.now(),
    });
    for (const houseWin of houseWindows.values()) {
      if (houseWin && !houseWin.isDestroyed()) {
        try {
          houseWin.webContents.send('gbr:broadcast-runtime-message', {
            message: { ...data, __gbrElectronAuthorized: true },
            sender: { id: 'gatilhobr-desktop' },
          });
        } catch (_) {}
      }
    }
  }
});

// -------------------------------------------------------------------------
// 6.1 HANDLERS DE ATUALIZAÇÃO E UTILITÁRIOS
// -------------------------------------------------------------------------
let lastSeenExtensionVersion = null;

function checkRegistryKeyExistsSync(regPath) {
  try {
    const { execSync } = require('child_process');
    execSync(`reg query "${regPath}"`, { stdio: 'ignore', windowsHide: true });
    return true;
  } catch (_) {
    return false;
  }
}

function detectInstalledBrowsers() {
  const pf = process.env.PROGRAMFILES || 'C:\\Program Files';
  const pf86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
  const local = process.env.LOCALAPPDATA || '';

  const chromePaths = [
    path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe')
  ];

  const edgePaths = [
    path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(local, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
  ];

  const chromeInstalled = chromePaths.some((p) => { try { return fs.existsSync(p); } catch (_) { return false; } });
  const edgeInstalled = edgePaths.some((p) => { try { return fs.existsSync(p); } catch (_) { return false; } });

  return { chrome: chromeInstalled, edge: edgeInstalled };
}

function detectExtensionInChromiumProfiles() {
  const extensionId = 'dkchfkmohlejeflkdfhinlfgbeihfegh';
  const localAppData = process.env.LOCALAPPDATA || '';
  if (!localAppData) return null;

  const browserRoots = [
    { browser: 'chrome', root: path.join(localAppData, 'Google', 'Chrome', 'User Data') },
    { browser: 'edge', root: path.join(localAppData, 'Microsoft', 'Edge', 'User Data') }
  ];

  for (const { browser, root } of browserRoots) {
    if (!fs.existsSync(root)) continue;
    try {
      const entries = fs.readdirSync(root, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const profileDir = entry.name;
        const secPrefPath = path.join(root, profileDir, 'Secure Preferences');
        const prefPath = path.join(root, profileDir, 'Preferences');
        let settings = null;
        let profileName = profileDir;

        if (fs.existsSync(prefPath)) {
          try {
            const prefJson = JSON.parse(fs.readFileSync(prefPath, 'utf8'));
            if (prefJson.profile?.name) profileName = prefJson.profile.name;
            if (prefJson.extensions?.settings) settings = prefJson.extensions.settings;
          } catch (_) {}
        }

        if (fs.existsSync(secPrefPath)) {
          try {
            const secJson = JSON.parse(fs.readFileSync(secPrefPath, 'utf8'));
            if (secJson.extensions?.settings) {
              settings = { ...(settings || {}), ...secJson.extensions.settings };
            }
          } catch (_) {}
        }

        if (settings) {
          for (const [id, meta] of Object.entries(settings)) {
            const name = String(meta?.manifest?.name || '');
            const p = String(meta?.path || '');
            if (id === extensionId || name.toLowerCase().includes('gatilho') || p.toLowerCase().includes('gatilho')) {
              const version = meta?.manifest?.version || meta?.service_worker_registration_info?.version || '4.3.0';
              const enabled = !meta?.disable_reasons || meta.disable_reasons.length === 0;
              return {
                installed: true,
                browser,
                profileDir,
                profileName,
                id,
                version,
                path: p,
                enabled
              };
            }
          }
        }
      }
    } catch (_) {}
  }

  // Fallback: Diretório local sincronizado
  const localExtDir = path.join(localAppData, 'GatilhoBR', 'chrome-extension');
  const localManifest = path.join(localExtDir, 'manifest.json');
  if (fs.existsSync(localManifest)) {
    try {
      const m = JSON.parse(fs.readFileSync(localManifest, 'utf8'));
      return {
        installed: true,
        browser: 'chrome',
        profileDir: 'Default',
        profileName: 'Perfil Padrão',
        id: extensionId,
        version: m.version || '4.3.0',
        path: localExtDir,
        enabled: true
      };
    } catch (_) {}
  }

  return null;
}

ipcMain.handle('gbr:open-onboarding', async (_event, options = {}) => {
  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    dashboardWindow.webContents.send('gbr:start-onboarding', options);
    dashboardWindow.webContents.executeJavaScript(`if (window.__gbrOpenOnboarding) window.__gbrOpenOnboarding(${JSON.stringify(options)});`).catch(() => {});
    return { success: true };
  }
  return { success: false };
});

ipcMain.handle('gbr:get-installation-status', async () => {
  const extensionId = 'dkchfkmohlejeflkdfhinlfgbeihfegh';
  const hostName = 'com.gatilho.native_messaging';

  const chromeHostReg = checkRegistryKeyExistsSync(`HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${hostName}`);
  const edgeHostReg = checkRegistryKeyExistsSync(`HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${hostName}`);
  const chromeExtReg = checkRegistryKeyExistsSync(`HKCU\\Software\\Google\\Chrome\\Extensions\\${extensionId}`);
  const edgeExtReg = checkRegistryKeyExistsSync(`HKCU\\Software\\Microsoft\\Edge\\Extensions\\${extensionId}`);

  const browsers = detectInstalledBrowsers();
  const hostPath = nativeBridgeHostPath();
  const hostExists = fs.existsSync(hostPath);
  const hostRegistered = chromeHostReg || edgeHostReg;
  const isHostRunning = (!!nativeBridge.child && !nativeBridge.child.killed) || !!nativeBridge.pipeSocket;

  const appVersion = app ? app.getVersion() : '4.3.0';

  const detectedExtension = detectExtensionInChromiumProfiles();
  const extensionInstalled = Boolean(detectedExtension?.installed || chromeExtReg || edgeExtReg);
  const extensionActive = Boolean(
    nativeBridge.connectedHouses.size > 0 ||
    nativeBridge.extensionConnected ||
    lastSeenExtensionVersion !== null ||
    detectedExtension?.installed
  );
  const extensionVersion = lastSeenExtensionVersion || detectedExtension?.version || (extensionActive ? appVersion : null);

  const compatible = !extensionVersion || extensionVersion === appVersion;
  const completed = hostRegistered && hostExists && (browsers.chrome || browsers.edge) && extensionActive && compatible;

  return {
    appVersion,
    expectedExtensionVersion: appVersion,
    extensionVersion,
    browsers,
    detectedExtension,
    nativeHost: {
      registered: hostRegistered,
      running: isHostRunning,
      path: hostPath,
      exists: hostExists,
      chrome: chromeHostReg,
      edge: edgeHostReg
    },
    extensionRegistry: {
      chrome: chromeExtReg,
      edge: edgeExtReg
    },
    extensionInstalled,
    extensionActive,
    compatible,
    completed
  };
});

ipcMain.handle('gbr:repair-browser-integration', async () => {
  try {
    const helperCandidates = [
      path.join(process.resourcesPath || '', 'installer', 'register-integration.ps1'),
      path.join(__dirname, '..', 'scripts', 'Register-GatilhoBRIntegration.ps1'),
      path.join(__dirname, '..', 'build', 'installer', 'register-integration.ps1')
    ];
    const helperScript = helperCandidates.find((p) => fs.existsSync(p));
    if (!helperScript) {
      return { success: false, error: 'Script de reparo não encontrado.' };
    }

    const { execSync } = require('child_process');
    const installRoot = path.dirname(process.execPath);
    execSync(`powershell.exe -ExecutionPolicy Bypass -NoProfile -WindowStyle Hidden -File "${helperScript}" -InstallRoot "${installRoot}"`, {
      windowsHide: true,
      encoding: 'utf8'
    });

    stopNativeBridge();
    startNativeBridge();
    return { success: true, message: 'Integração reparada com sucesso.' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('gbr:open-extension-page', async (_event, { browser = 'chrome' } = {}) => {
  const browsers = detectInstalledBrowsers();
  const detectedExt = detectExtensionInChromiumProfiles();
  const targetBrowser = detectedExt?.browser || (browser === 'edge' || (!browsers.chrome && browsers.edge) ? 'edge' : 'chrome');

  const pf = process.env.PROGRAMFILES || '';
  const pf86 = process.env['PROGRAMFILES(X86)'] || '';
  const local = process.env.LOCALAPPDATA || '';

  const candidates = targetBrowser === 'edge'
    ? [path.join(pf, 'Microsoft/Edge/Application/msedge.exe'), path.join(pf86, 'Microsoft/Edge/Application/msedge.exe')]
    : [path.join(pf, 'Google/Chrome/Application/chrome.exe'), path.join(pf86, 'Google/Chrome/Application/chrome.exe'), path.join(local, 'Google/Chrome/Application/chrome.exe')];

  const exe = candidates.find((c) => fs.existsSync(c)) || (targetBrowser === 'edge' ? 'msedge.exe' : 'chrome.exe');

  const args = [];
  if (detectedExt?.profileDir) {
    args.push(`--profile-directory=${detectedExt.profileDir}`);
  }

  // Abre guia interativa local que permite copiar chrome://extensions em 1 clique
  const guideCandidates = [
    path.join(__dirname, '..', 'build', 'installer', 'open-extension-guide.html'),
    path.join(process.resourcesPath || '', 'installer', 'open-extension-guide.html')
  ];
  const guidePath = guideCandidates.find((p) => fs.existsSync(p));
  if (guidePath) {
    args.push(`file:///${guidePath.replace(/\\/g, '/')}`);
  }

  try {
    const child = spawn(exe, args, { detached: true, stdio: 'ignore' });
    child.unref();

    // Também abre a pasta da extensão no Windows Explorer para conveniência
    const localExtDir = path.join(local, 'GatilhoBR', 'chrome-extension');
    if (fs.existsSync(localExtDir)) {
      spawn('explorer.exe', [localExtDir], { detached: true, stdio: 'ignore' }).unref();
    }

    return {
      success: true,
      browser: targetBrowser,
      profile: detectedExt?.profileName || detectedExt?.profileDir
    };
  } catch (err) {
    shell.openExternal('chrome://extensions').catch(() => {});
    return { success: true, fallback: true };
  }
});

ipcMain.handle('gbr:retry-native-connection', async () => {
  try {
    stopNativeBridge();
    startNativeBridge();
    return { success: true, running: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('gbr:check-for-updates', async () => {
  return await updater.checkForUpdates(false);
});

ipcMain.handle('gbr:download-update', async () => {
  return await updater.downloadUpdate();
});

ipcMain.handle('gbr:install-update', () => {
  updater.quitAndInstall();
  return { success: true };
});

ipcMain.on('gbr:open-external', (event, { url }) => {
  if (url && (url.startsWith('https://') || url.startsWith('http://'))) {
    shell.openExternal(url);
  }
});

// Handlers de Cookies (Sessão Aquecida / Anti-Detecção)
ipcMain.handle('gbr:cookies-import', async (event, { houseKey, cookiesJson }) => {
  const config = HOUSE_CONFIGS[houseKey];
  if (!config) return { success: false, error: 'Casa não reconhecida: ' + houseKey };
  return await cookieManager.importCookiesToPartition(config.partition, cookiesJson);
});

ipcMain.handle('gbr:cookies-export', async (event, { houseKey }) => {
  const config = HOUSE_CONFIGS[houseKey];
  if (!config) return [];
  return await cookieManager.exportCookiesFromPartition(config.partition);
});

ipcMain.handle('gbr:cookies-clear', async (event, { houseKey }) => {
  const config = HOUSE_CONFIGS[houseKey];
  if (!config) return;
  await cookieManager.clearPartitionSession(config.partition);
});

ipcMain.handle('gbr:cookies-import-clipboard', async (event, { houseKey = 'bet365' } = {}) => {
  const config = HOUSE_CONFIGS[houseKey] || HOUSE_CONFIGS.bet365;
  const win = [...houseWindows.values()].find(w => !w.isDestroyed() && w.__houseKey === houseKey);
  return await cookieManager.handleImportFromClipboard(houseKey, config, win);
});

// -------------------------------------------------------------------------
// 6.2 MENU NATIVO DA ESTAÇÃO DE TRABALHO
// -------------------------------------------------------------------------
function setupApplicationMenu() {
  const showDevMenu = process.argv.includes('--enable-menu') || process.env.GBR_DEV_MENU === '1';
  if (!showDevMenu) {
    Menu.setApplicationMenu(null);
    return;
  }

  const template = [
    {
      label: '⚡ Casas de Aposta',
      submenu: [
        {
          label: '🚀 Abrir Bet365',
          accelerator: 'CmdOrCtrl+1',
          click: () => openHouseWindow('bet365'),
        },
        {
          label: '🚀 Abrir Betfair Sportsbook',
          accelerator: 'CmdOrCtrl+2',
          click: () => openHouseWindow('betfair'),
        },
        {
          label: '🚀 Abrir Betnacional',
          accelerator: 'CmdOrCtrl+3',
          click: () => openHouseWindow('betnacional'),
        },
        {
          label: '🚀 Abrir BetMGM',
          accelerator: 'CmdOrCtrl+4',
          click: () => openHouseWindow('betmgm'),
        },
        {
          label: '🚀 Abrir Betano',
          accelerator: 'CmdOrCtrl+5',
          click: () => openHouseWindow('betano'),
        },
        { type: 'separator' },
        {
          label: '🌐 Abrir Bet365 + Betfair + Betnacional',
          accelerator: 'F9',
          click: () => {
            ['bet365', 'betfair', 'betnacional'].forEach(openHouseWindow);
          },
        },
      ],
    },
    {
      label: '🍪 Cookies & Sessão',
      submenu: [
        {
          label: '📥 Importar Cookies da Bet365 (Área de Transferência)',
          accelerator: 'CmdOrCtrl+Shift+V',
          click: () => {
            const win = [...houseWindows.values()].find(w => !w.isDestroyed() && w.__houseKey === 'bet365');
            cookieManager.handleImportFromClipboard('bet365', HOUSE_CONFIGS.bet365, win);
          },
        },
        {
          label: '📥 Importar Cookies da Betfair (Área de Transferência)',
          click: () => {
            const win = [...houseWindows.values()].find(w => !w.isDestroyed() && w.__houseKey === 'betfair');
            cookieManager.handleImportFromClipboard('betfair', HOUSE_CONFIGS.betfair, win);
          },
        },
        {
          label: '📁 Importar Cookies de Arquivo JSON (Bet365)...',
          click: () => {
            const win = [...houseWindows.values()].find(w => !w.isDestroyed() && w.__houseKey === 'bet365');
            cookieManager.handleImportFromFile('bet365', HOUSE_CONFIGS.bet365, win);
          },
        },
        { type: 'separator' },
        {
          label: '📤 Exportar Cookies Atuais da Bet365...',
          click: () => {
            cookieManager.handleExportToFile('bet365', HOUSE_CONFIGS.bet365);
          },
        },
        {
          label: '📤 Exportar Cookies Atuais da Betfair...',
          click: () => {
            cookieManager.handleExportToFile('betfair', HOUSE_CONFIGS.betfair);
          },
        },
        { type: 'separator' },
        {
          label: '🗑️ Limpar Cookies & Cache da Bet365',
          click: () => {
            const win = [...houseWindows.values()].find(w => !w.isDestroyed() && w.__houseKey === 'bet365');
            cookieManager.handleClearCookies('bet365', HOUSE_CONFIGS.bet365, win);
          },
        },
      ],
    },
    {
      label: 'Exibir',
      submenu: [
        { role: 'reload', label: 'Recarregar Painel' },
        { role: 'forceReload', label: 'Recarregar Forçado' },
        { role: 'toggleDevTools', label: 'Ferramentas de Desenvolvedor (F12)' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Zoom Padrão' },
        { role: 'zoomIn', label: 'Aumentar Zoom' },
        { role: 'zoomOut', label: 'Diminuir Zoom' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Tela Cheia' },
      ],
    },
    {
      label: 'Janelas',
      submenu: [
        {
          label: 'Focar Painel Principal',
          click: () => {
            if (dashboardWindow && !dashboardWindow.isDestroyed()) {
              dashboardWindow.focus();
            }
          },
        },
        { role: 'minimize', label: 'Minimizar' },
        { role: 'close', label: 'Fechar' },
      ],
    },
    {
      label: 'Ajuda',
      submenu: [
        {
          label: '🔄 Verificar Atualizações...',
          click: async () => {
            const info = await updater.checkForUpdates(false);
            if (dashboardWindow && !dashboardWindow.isDestroyed()) {
              dashboardWindow.webContents.send('gbr:update-available', info);
            }
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// -------------------------------------------------------------------------
// 7. INICIALIZAÇÃO DO APLICATIVO
// -------------------------------------------------------------------------
app.whenReady().then(() => {
  // Verificação de integridade pós-atualização / rollback
  const health = updater.evaluateHealthMarker();
  if (health.status === 'UPDATE_APPLIED') {
    console.log(`[Updater] ✅ Atualização aplicada com sucesso! De v${health.previousVersion} para v${health.newVersion}`);
    updater.clearHealthMarker();
  } else if (health.status === 'ROLLBACK_DETECTED') {
    console.warn(`[Updater] ⚠️ Rollback detectado após tentativa de atualização para v${health.targetVersion}. Mantendo v${health.previousVersion}`);
    updater.clearHealthMarker();
  }

  configureHouseSessions();
  setupApplicationMenu();
  createBackgroundWindow();
  createDashboardWindow();
  registerGlobalShortcuts();
  // Inicia somente o host local empacotado (sem qualquer registro ou
  // instalação). Pode ser desabilitado pelo instalador com GBR_NATIVE_BRIDGE_AUTO=0.
  if (process.env.GBR_NATIVE_BRIDGE_AUTO !== '0') {
    const bridgeResult = startNativeBridge();
    if (!bridgeResult.success) console.warn('[Native Bridge] Não iniciado:', bridgeResult.error);
  }

  // Checagem silenciosa de atualizações após 4 segundos da inicialização
  setTimeout(() => {
    updater.checkForUpdates(true).then((updateInfo) => {
      if (updateInfo && updateInfo.hasUpdate && dashboardWindow && !dashboardWindow.isDestroyed()) {
        dashboardWindow.webContents.send('gbr:update-available', updateInfo);
      }
    });
  }, 4000);

  if (process.env.GBR_SMOKE_TEST === 'true') {
    console.log('[Smoke Test] Modo de teste automatizado ativo, aguardando carregamento...');
    dashboardWindow.webContents.on('did-finish-load', () => {
      console.log('[Smoke Test] ✅ Dashboard carregado com sucesso!');
      setTimeout(() => {
        console.log('[Smoke Test] ✅ Teste concluído com êxito. Encerrando Electron...');
        app.quit();
      }, 1500);
    });
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createDashboardWindow();
    }
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  stopNativeBridge();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
