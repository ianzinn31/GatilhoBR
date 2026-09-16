const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const workspaceRoot = path.resolve(__dirname, '..');
const liveExtensionDir = 'C:\\Users\\ialve\\AppData\\Local\\GatilhoBR\\chrome-extension';
const asarExtractDir = path.resolve(workspaceRoot, 'test_asar_extract');
const targetAsarFile = path.resolve(workspaceRoot, 'dist-desktop/win-unpacked/resources/app.asar');

const filesToSync = [
  'background.js',
  'content.js',
  'electron/main.js',
  'src/config.js',
  'src/stakeEngine.js',
  'src/presetEngine.js',
  'src/triggerEngine.js',
  'src/quickExecEngine.js',
  'src/adapters/superbetAdapter.js',
  'src/adapters/betfairSportsbookAdapter.js',
  'src/adapters/betnacionalAdapter.js',
  'src/adapters/betmgmAdapter.js',
  'src/adapters/betanoAdapter.js',
  'src/adapters/bet365Adapter.js',
  'src/authManager.js',
  'src/installationState.js',
  'electron/preload-dashboard.js',
  'electron/chrome-polyfill.js',
  'electron/updater.js',
  'manifest.json',
  'build/installer/open-extension-guide.html',
  'dashboard-app/dist/betano-dashboard-loader.js',
  'dashboard-app/dist/onboarding-modal.js',
  'dashboard-app/dist/index.html'
];

console.log('=== SYNCING FILES TO LIVE EXTENSION & ASAR EXTRACT ===');

for (const relPath of filesToSync) {
  const srcFile = path.join(workspaceRoot, relPath);
  if (!fs.existsSync(srcFile)) {
    console.warn(`[SKIP] File not found in workspace: ${relPath}`);
    continue;
  }

  // 1. Copy to Live Chrome Extension
  const liveTarget = path.join(liveExtensionDir, relPath);
  try {
    fs.mkdirSync(path.dirname(liveTarget), { recursive: true });
    fs.copyFileSync(srcFile, liveTarget);
    console.log(`[OK -> Live Extension] ${relPath}`);
  } catch (err) {
    console.error(`[FAIL -> Live Extension] ${relPath}:`, err.message);
  }

  // 2. Copy to asar extract dir
  const asarTarget = path.join(asarExtractDir, relPath);
  try {
    fs.mkdirSync(path.dirname(asarTarget), { recursive: true });
    fs.copyFileSync(srcFile, asarTarget);
    console.log(`[OK -> Asar Extract] ${relPath}`);
  } catch (err) {
    console.error(`[FAIL -> Asar Extract] ${relPath}:`, err.message);
  }
}

// Check if app.asar should be repacked
if (fs.existsSync(asarExtractDir)) {
  console.log('\n=== REPACKING ASAR FILE ===');
  console.log(`Source: ${asarExtractDir}`);
  console.log(`Target: ${targetAsarFile}`);
  try {
    const output = execSync(`npx asar pack "${asarExtractDir}" "${targetAsarFile}"`, {
      cwd: workspaceRoot,
      encoding: 'utf-8'
    });
    console.log('[OK] Asar packed successfully:', output || '(no output)');
  } catch (err) {
    console.error('[FAIL] Asar pack error:', err.message);
  }
}

// Copy installer resources to dist-desktop unpacked if exists
const unpackedInstallerDir = path.join(workspaceRoot, 'dist-desktop/win-unpacked/resources/installer');
if (fs.existsSync(path.dirname(unpackedInstallerDir))) {
  try {
    fs.mkdirSync(unpackedInstallerDir, { recursive: true });
    for (const f of ['register-integration.ps1', 'open-extension-guide.html']) {
      const src = path.join(workspaceRoot, 'build/installer', f);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(unpackedInstallerDir, f));
        console.log(`[OK -> Win-Unpacked Resources] installer/${f}`);
      }
    }
  } catch (e) {
    console.warn('[WARN] Failed to copy installer resources to win-unpacked:', e.message);
  }
}

console.log('\n=== SYNC COMPLETE ===');

