const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function checkRegistryKeyExistsSync(regPath) {
  try {
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

  return null;
}

console.log('Browsers:', detectInstalledBrowsers());
console.log('Extension in profiles:', detectExtensionInChromiumProfiles());
console.log('Chrome host reg:', checkRegistryKeyExistsSync('HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.gatilho.native_messaging'));
console.log('Chrome ext reg:', checkRegistryKeyExistsSync('HKCU\\Software\\Google\\Chrome\\Extensions\\dkchfkmohlejeflkdfhinlfgbeihfegh'));
