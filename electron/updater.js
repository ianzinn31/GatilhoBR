// =========================================================================
// GATILHOBR DESKTOP - AUTO-UPDATER, HEALTH MARKER & VERIFICADOR DE VERSÃO
// =========================================================================

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

let electronApp = null;
let autoUpdater = null;
try {
  const electron = require('electron');
  electronApp = electron.app;
} catch (_) {}

try {
  const eu = require('electron-updater');
  autoUpdater = eu.autoUpdater;
} catch (_) {}

const CURRENT_VERSION = electronApp ? electronApp.getVersion() : '4.3.0';

const GITHUB_OWNER = 'ianzinn31';
const GITHUB_REPO = 'GatilhoBR';
const DEFAULT_UPDATE_BASE_URL = process.env.GBR_UPDATE_BASE_URL || `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases`;
const DEFAULT_UPDATE_CHECK_URL = process.env.GBR_UPDATE_URL ||
  `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;

/**
 * Compara duas versões semânticas (ex: "4.3.1" > "4.3.0").
 */
function isVersionNewer(remoteVer, localVer) {
  if (!remoteVer || !localVer) return false;
  try {
    const clean = (v) => v.replace(/^v/i, '').split('-')[0];
    const rParts = clean(remoteVer).split('.').map(n => parseInt(n, 10) || 0);
    const lParts = clean(localVer).split('.').map(n => parseInt(n, 10) || 0);
    const maxLen = Math.max(rParts.length, lParts.length);

    for (let i = 0; i < maxLen; i++) {
      const r = rParts[i] || 0;
      const l = lParts[i] || 0;
      if (r > l) return true;
      if (r < l) return false;
    }
  } catch (_) {
    return false;
  }
  return false;
}

/**
 * Valida o contrato de compatibilidade entre App e Extensão.
 */
function checkCompatibility(options = {}) {
  const {
    appVersion = CURRENT_VERSION,
    extensionVersion,
    minAppVersion = '4.0.0',
    minExtensionVersion = '4.0.0'
  } = options;

  if (minAppVersion && isVersionNewer(minAppVersion, appVersion)) {
    return {
      compatible: false,
      reason: 'APP_OUTDATED',
      message: `Aplicativo desktop (v${appVersion}) é inferior à versão mínima exigida (v${minAppVersion}).`
    };
  }

  if (extensionVersion && minExtensionVersion && isVersionNewer(minExtensionVersion, extensionVersion)) {
    return {
      compatible: false,
      reason: 'EXTENSION_OUTDATED',
      message: `Extensão (v${extensionVersion}) é inferior à versão mínima exigida (v${minExtensionVersion}).`
    };
  }

  return {
    compatible: true,
    message: 'Versões compatíveis.'
  };
}

/**
 * Grava o marcador de saúde (Health Marker) antes do reinício de atualização.
 */
function writeHealthMarker(options = {}) {
  const markerPath = options.markerPath || (electronApp ? path.join(electronApp.getPath('userData'), 'update-pending.json') : null);
  if (!markerPath) return;

  const data = {
    fromVersion: options.fromVersion || CURRENT_VERSION,
    toVersion: options.toVersion,
    timestamp: Date.now()
  };

  try {
    fs.mkdirSync(path.dirname(markerPath), { recursive: true });
    fs.writeFileSync(markerPath, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.warn('[Updater HealthMarker] Falha ao gravar marcador:', err.message);
  }
}

/**
 * Avalia o status do marcador de saúde na inicialização.
 */
function evaluateHealthMarker(options = {}) {
  const markerPath = options.markerPath || (electronApp ? path.join(electronApp.getPath('userData'), 'update-pending.json') : null);
  const currentVersion = options.currentVersion || CURRENT_VERSION;
  const maxAgeMs = options.maxAgeMs || (5 * 60 * 1000); // 5 minutos

  if (!markerPath || !fs.existsSync(markerPath)) {
    return { status: 'CLEAN' };
  }

  try {
    const raw = fs.readFileSync(markerPath, 'utf8');
    const marker = JSON.parse(raw);
    const age = Date.now() - (marker.timestamp || 0);

    if (currentVersion === marker.toVersion) {
      return {
        status: 'UPDATE_APPLIED',
        previousVersion: marker.fromVersion,
        newVersion: marker.toVersion
      };
    }

    if (currentVersion === marker.fromVersion || age > maxAgeMs) {
      return {
        status: 'ROLLBACK_DETECTED',
        previousVersion: marker.fromVersion,
        targetVersion: marker.toVersion,
        ageMs: age
      };
    }

    return { status: 'PENDING', marker };
  } catch (err) {
    return { status: 'ERROR', error: err.message };
  }
}

/**
 * Remove o marcador de saúde após verificação bem-sucedida.
 */
function clearHealthMarker(markerPath) {
  const target = markerPath || (electronApp ? path.join(electronApp.getPath('userData'), 'update-pending.json') : null);
  if (target && fs.existsSync(target)) {
    try {
      fs.unlinkSync(target);
    } catch (_) {}
  }
}

/**
 * Faz uma requisição HTTP/HTTPS simples e segura.
 */
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, { headers: { 'User-Agent': `GatilhoBR-Desktop/${CURRENT_VERSION}` } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(fetchJson(res.headers.location));
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP Status ${res.statusCode}`));
      }
      let rawData = '';
      res.on('data', (chunk) => { rawData += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(rawData);
          resolve(parsed);
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(8000, () => {
      req.destroy();
      reject(new Error('Timeout ao verificar atualizações'));
    });
  });
}

class GatilhoUpdater {
  constructor(options = {}) {
    this.currentVersion = options.currentVersion || CURRENT_VERSION;
    this.channel = options.channel || 'stable';
    this.owner = options.owner || GITHUB_OWNER;
    this.repo = options.repo || GITHUB_REPO;
    this.updateBaseUrl = (options.updateBaseUrl || DEFAULT_UPDATE_BASE_URL).replace(/\/+$/, '');
    this.updateUrl = options.updateUrl || DEFAULT_UPDATE_CHECK_URL;
    this.isChecking = false;
    this.rollbackAvailable = false;

    if (autoUpdater) {
      autoUpdater.autoDownload = true;
      autoUpdater.autoInstallOnAppQuit = true;
      try {
        autoUpdater.setFeedURL({
          provider: 'github',
          owner: this.owner,
          repo: this.repo
        });
      } catch (_) {}
    }
  }

  setChannel(channel) {
    if (channel) {
      this.channel = channel;
    }
  }

  setUpdateUrl(url) {
    if (url) this.updateUrl = url;
  }

  evaluatePayload(payload) {
    if (!payload) {
      return { hasUpdate: false, currentVersion: this.currentVersion };
    }

    const remoteVersion = payload.tag_name || payload.version;
    if (!remoteVersion) {
      return { hasUpdate: false, currentVersion: this.currentVersion };
    }

    const hasUpdate = isVersionNewer(remoteVersion, this.currentVersion);
    const setupAsset = Array.isArray(payload.assets)
      ? payload.assets.find(a => a.name && a.name.toLowerCase().includes('setup') && a.name.endsWith('.exe'))
      : null;

    const downloadUrl = setupAsset?.browser_download_url || payload.downloadUrl || payload.url || '';

    return {
      hasUpdate,
      currentVersion: this.currentVersion,
      latestVersion: String(remoteVersion).replace(/^v/i, ''),
      releaseNotes: payload.body || payload.releaseNotes || 'Melhorias e correções.',
      downloadUrl,
      mandatory: payload.mandatory === true,
      rollbackAvailable: this.rollbackAvailable
    };
  }

  async checkForUpdates(silent = true) {
    if (this.isChecking) return { status: 'checking' };
    this.isChecking = true;

    if (autoUpdater && electronApp && electronApp.isPackaged) {
      try {
        if (!silent) console.log(`[Updater] Verificando atualizações no GitHub (${this.owner}/${this.repo})...`);
        const result = await autoUpdater.checkForUpdates();
        this.isChecking = false;
        if (result && result.updateInfo) {
          return {
            hasUpdate: isVersionNewer(result.updateInfo.version, this.currentVersion),
            currentVersion: this.currentVersion,
            latestVersion: result.updateInfo.version,
            releaseNotes: result.updateInfo.releaseNotes || 'Nova versão disponível.',
            downloadUrl: `https://github.com/${this.owner}/${this.repo}/releases/tag/v${result.updateInfo.version}`
          };
        }
      } catch (err) {
        if (!silent) console.warn('[Updater] electron-updater nativo falhou, consultando API pública:', err.message);
      }
    }

    try {
      if (!silent) console.log(`[Updater] Verificando atualizações em: ${this.updateUrl}`);
      const info = await fetchJson(this.updateUrl);
      this.isChecking = false;
      return this.evaluatePayload(info);
    } catch (err) {
      this.isChecking = false;
      if (!silent) console.warn(`[Updater] Não foi possível verificar atualizações: ${err.message}`);
      return {
        hasUpdate: false,
        error: err.message,
        currentVersion: this.currentVersion
      };
    }
  }

  async downloadUpdate() {
    if (autoUpdater) {
      return await autoUpdater.downloadUpdate();
    }
    return { success: false, error: 'autoUpdater não inicializado' };
  }

  quitAndInstall() {
    writeHealthMarker({
      fromVersion: this.currentVersion,
      toVersion: 'pending-install'
    });

    if (autoUpdater) {
      autoUpdater.quitAndInstall();
    } else if (electronApp) {
      electronApp.quit();
    }
  }
}

const defaultInstance = new GatilhoUpdater();

defaultInstance.isVersionNewer = isVersionNewer;
defaultInstance.checkCompatibility = checkCompatibility;
defaultInstance.writeHealthMarker = writeHealthMarker;
defaultInstance.evaluateHealthMarker = evaluateHealthMarker;
defaultInstance.clearHealthMarker = clearHealthMarker;
defaultInstance.GatilhoUpdater = GatilhoUpdater;

module.exports = defaultInstance;
