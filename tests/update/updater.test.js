const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  isVersionNewer,
  checkCompatibility,
  writeHealthMarker,
  evaluateHealthMarker,
  clearHealthMarker,
  GatilhoUpdater
} = require('../../electron/updater');

test('updater: isVersionNewer accurately compares semantic versions', () => {
  assert.equal(isVersionNewer('4.3.1', '4.3.0'), true);
  assert.equal(isVersionNewer('5.0.0', '4.3.0'), true);
  assert.equal(isVersionNewer('4.4.0', '4.3.9'), true);
  assert.equal(isVersionNewer('v4.3.1', '4.3.0'), true);

  assert.equal(isVersionNewer('4.3.0', '4.3.0'), false);
  assert.equal(isVersionNewer('4.2.9', '4.3.0'), false);
  assert.equal(isVersionNewer('3.9.9', '4.0.0'), false);
});

test('updater: checkCompatibility verifies app and extension compatibility contracts', () => {
  // 1. Both compatible
  const res1 = checkCompatibility({
    appVersion: '4.3.0',
    extensionVersion: '4.3.0',
    minAppVersion: '4.0.0',
    minExtensionVersion: '4.0.0'
  });
  assert.equal(res1.compatible, true);

  // 2. App outdated
  const res2 = checkCompatibility({
    appVersion: '3.9.0',
    extensionVersion: '4.3.0',
    minAppVersion: '4.0.0'
  });
  assert.equal(res2.compatible, false);
  assert.equal(res2.reason, 'APP_OUTDATED');

  // 3. Extension outdated
  const res3 = checkCompatibility({
    appVersion: '4.3.0',
    extensionVersion: '3.8.0',
    minExtensionVersion: '4.0.0'
  });
  assert.equal(res3.compatible, false);
  assert.equal(res3.reason, 'EXTENSION_OUTDATED');
});

test('updater: health marker tracks pending updates and verifies startup health', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gbr-health-'));
  const markerFile = path.join(tempDir, 'update-pending.json');

  try {
    // 1. Write marker before restart
    writeHealthMarker({
      fromVersion: '4.2.0',
      toVersion: '4.3.0',
      markerPath: markerFile
    });

    assert.ok(fs.existsSync(markerFile), 'Health marker file must exist');

    // 2. Evaluate fresh marker (healthy update in progress)
    const freshEval = evaluateHealthMarker({
      markerPath: markerFile,
      currentVersion: '4.3.0'
    });
    assert.equal(freshEval.status, 'UPDATE_APPLIED');
    assert.equal(freshEval.previousVersion, '4.2.0');

    // 3. Clear marker once startup health is verified
    clearHealthMarker(markerFile);
    assert.equal(fs.existsSync(markerFile), false, 'Marker must be removed after successful health check');

    // 4. Test expired / failed marker (simulated crash/rollback)
    const pastTime = Date.now() - 3600000; // 1 hour ago
    fs.writeFileSync(markerFile, JSON.stringify({
      fromVersion: '4.2.0',
      toVersion: '4.3.0',
      timestamp: pastTime
    }));

    const failedEval = evaluateHealthMarker({
      markerPath: markerFile,
      currentVersion: '4.2.0', // rolled back to 4.2.0
      maxAgeMs: 120000
    });
    assert.equal(failedEval.status, 'ROLLBACK_DETECTED');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('updater: GatilhoUpdater instance manages channel and mandatory update flag', () => {
  const testUpdater = new GatilhoUpdater({ currentVersion: '4.3.0' });

  assert.equal(testUpdater.channel, 'stable');
  testUpdater.setChannel('beta');
  assert.equal(testUpdater.channel, 'beta');

  // Verify parseUpdatePayload logic
  const payload = {
    version: '4.4.0',
    mandatory: true,
    releaseNotes: 'Correção crítica',
    url: 'https://releases.gatilhobr.com/stable/GatilhoBR-Setup.exe'
  };

  const parsed = testUpdater.evaluatePayload(payload);
  assert.equal(parsed.hasUpdate, true);
  assert.equal(parsed.mandatory, true);
  assert.equal(parsed.latestVersion, '4.4.0');
});
