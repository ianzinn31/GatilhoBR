const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '../..');

test('installer-config: package.json has required NSIS and extraResources configuration', () => {
  const pkgPath = path.join(projectRoot, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

  assert.ok(pkg.build, 'package.json must contain build configuration');
  assert.ok(pkg.build.nsis, 'build.nsis must be configured');
  assert.equal(pkg.build.nsis.oneClick, false, 'oneClick must be false for assisted installation');
  assert.equal(pkg.build.nsis.perMachine, false, 'perMachine must be false (user-level HKCU install)');
  assert.equal(pkg.build.nsis.include, 'build/installer/installer.nsh', 'nsis.include must point to installer.nsh');

  // Verify extraResources contain the integration registration script
  const extraResources = pkg.build.extraResources || [];
  const hasRegScript = extraResources.some(res =>
    (typeof res === 'string' && res.includes('Register-GatilhoBRIntegration.ps1')) ||
    (typeof res === 'object' && (res.from?.includes('Register-GatilhoBRIntegration.ps1') || res.to?.includes('register-integration.ps1')))
  );
  assert.ok(hasRegScript, 'extraResources must bundle the integration registration script');
});

test('installer-config: build/installer/installer.nsh exists and contains customInstall/customUnInstall hooks', () => {
  const nshPath = path.join(projectRoot, 'build/installer/installer.nsh');
  assert.ok(fs.existsSync(nshPath), 'build/installer/installer.nsh must exist');

  const content = fs.readFileSync(nshPath, 'utf8');
  assert.ok(content.includes('customInstall'), 'installer.nsh must define customInstall');
  assert.ok(content.includes('customUnInstall'), 'installer.nsh must define customUnInstall');
  assert.ok(content.includes('powershell'), 'installer.nsh must call powershell for registration');
  assert.ok(content.includes('--onboarding=install'), 'installer.nsh or launcher must pass --onboarding=install');
});

test('installer-config: onboarding-launcher validates prerequisites fail-closed', () => {
  const launcherPath = path.join(projectRoot, 'build/installer/onboarding-launcher.js');
  assert.ok(fs.existsSync(launcherPath), 'build/installer/onboarding-launcher.js must exist');

  const launcher = require(launcherPath);
  assert.equal(typeof launcher.validatePrerequisites, 'function', 'validatePrerequisites must be exported');

  // Should fail if manifest has no key
  assert.throws(
    () => {
      launcher.validatePrerequisites({
        manifest: { version: '4.3.0' },
        pkg: { version: '4.3.0' },
        updateUrl: 'https://releases.gatilhobr.com'
      });
    },
    /key/i
  );

  // Should fail if updateUrl is not HTTPS
  assert.throws(
    () => {
      launcher.validatePrerequisites({
        manifest: { version: '4.3.0', key: 'dummyKey' },
        pkg: { version: '4.3.0' },
        updateUrl: 'http://insecure.example.com'
      });
    },
    /https/i
  );

  // Should succeed if valid
  assert.doesNotThrow(() => {
    launcher.validatePrerequisites({
      manifest: { version: '4.3.0', key: 'validKey' },
      pkg: { version: '4.3.0' },
      updateUrl: 'https://releases.gatilhobr.com'
    });
  });
});
