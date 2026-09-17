/**
 * @module installationState
 * Gerenciamento de estado de instalação, handshake de diagnóstico e controle de compatibilidade.
 */

const DEFAULT_INSTALLATION_STATE = {
  completed: false,
  lastSeenAppVersion: null,
  lastOnboardingStep: 'INITIAL',
  compatible: true
};

const STORAGE_KEY = 'gbr_installation_state';

function parseSemver(v) {
  if (!v) return [0, 0, 0];
  return String(v).replace(/^v/i, '').split('-')[0].split('.').map(n => parseInt(n, 10) || 0);
}

function isAppVersionCompatible(appVersion, minRequiredVersion = '4.0.0') {
  if (!appVersion) return false;
  const a = parseSemver(appVersion);
  const min = parseSemver(minRequiredVersion);

  for (let i = 0; i < Math.max(a.length, min.length); i++) {
    const aVal = a[i] || 0;
    const mVal = min[i] || 0;
    if (aVal > mVal) return true;
    if (aVal < mVal) return false;
  }
  return true; // Exatamente igual
}

function canExecuteOperationalOrders(context = {}) {
  const { appVersion, minAppVersion = '4.0.0' } = context;

  if (appVersion && !isAppVersionCompatible(appVersion, minAppVersion)) {
    return {
      allowed: false,
      reason: 'INCOMPATIBLE_APP_VERSION',
      message: `Versão do aplicativo desktop (v${appVersion}) incompatível com a extensão. Atualize o app.`,
      canDiagnose: true
    };
  }

  return {
    allowed: true,
    canDiagnose: true
  };
}

async function getInstallationState(customStorage) {
  const storage = customStorage || (typeof chrome !== 'undefined' && chrome.storage ? chrome.storage.local : null);
  if (!storage) return { ...DEFAULT_INSTALLATION_STATE };

  try {
    const data = await storage.get(STORAGE_KEY);
    const stored = data && data[STORAGE_KEY];
    return { ...DEFAULT_INSTALLATION_STATE, ...(stored || {}) };
  } catch (_) {
    return { ...DEFAULT_INSTALLATION_STATE };
  }
}

async function setInstallationState(patch, customStorage) {
  const storage = customStorage || (typeof chrome !== 'undefined' && chrome.storage ? chrome.storage.local : null);
  if (!storage) return;

  const current = await getInstallationState(storage);
  const updated = { ...current, ...patch };

  await storage.set({ [STORAGE_KEY]: updated });
  return updated;
}

function handleInstallationPing(options = {}) {
  const { message = {}, extensionVersion = '4.3.0' } = options;

  return {
    type: 'GBR_INSTALLATION_PONG',
    correlationId: message.correlationId || null,
    version: extensionVersion,
    protocol: '2.0',
    status: 'ready',
    safeMode: true,
    capabilities: [
      'PING',
      'DIAGNOSTIC',
      'CONFIG_SYNC',
      'NATIVE_MESSAGING_V2'
    ],
    timestamp: Date.now()
  };
}

const exported = {
  DEFAULT_INSTALLATION_STATE,
  isAppVersionCompatible,
  canExecuteOperationalOrders,
  getInstallationState,
  setInstallationState,
  handleInstallationPing
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = exported;
}
if (typeof globalThis !== 'undefined') {
  globalThis.GbrInstallationState = exported;
}
