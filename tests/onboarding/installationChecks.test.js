const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// We will test dashboard-app/src/onboarding/installationChecks.js
const {
  computeInstallationStatus,
  normalizeInstallationError,
  InstallationStep
} = require('../../dashboard-app/src/onboarding/installationChecks.js');

test('installationChecks: identifies "missing" status when extension or host is not registered', () => {
  const input = {
    appVersion: '4.3.0',
    expectedExtensionVersion: '4.3.0',
    extensionVersion: null,
    browsers: { chrome: true, edge: false },
    nativeHost: { registered: false, running: false },
    extensionActive: false,
    completed: false
  };

  const status = computeInstallationStatus(input);
  assert.equal(status.state, 'missing');
  assert.equal(status.compatible, false);
  assert.ok(status.currentStep, 'Must indicate current pending step');
  assert.equal(status.currentStep.id, InstallationStep.NATIVE_HOST);
  assert.ok(status.actions.includes('repair'), 'Must offer repair action');
});

test('installationChecks: identifies "disabled" status when host is registered but extension is inactive', () => {
  const input = {
    appVersion: '4.3.0',
    expectedExtensionVersion: '4.3.0',
    extensionVersion: null,
    browsers: { chrome: true, edge: true },
    nativeHost: { registered: true, running: true },
    extensionActive: false,
    completed: false
  };

  const status = computeInstallationStatus(input);
  assert.equal(status.state, 'disabled');
  assert.equal(status.compatible, false);
  assert.equal(status.currentStep.id, InstallationStep.EXTENSION);
  assert.ok(status.actions.includes('open-extension-page'), 'Must offer opening browser extensions page');
});

test('installationChecks: identifies "incompatible" when versions do not match', () => {
  const input = {
    appVersion: '4.3.0',
    expectedExtensionVersion: '4.3.0',
    extensionVersion: '4.2.0',
    browsers: { chrome: true, edge: false },
    nativeHost: { registered: true, running: true },
    extensionActive: true,
    completed: false
  };

  const status = computeInstallationStatus(input);
  assert.equal(status.state, 'incompatible');
  assert.equal(status.compatible, false);
  assert.ok(status.message.toLowerCase().includes('incompatível') || status.message.toLowerCase().includes('atualizar'));
  assert.ok(status.actions.includes('repair'));
});

test('installationChecks: identifies "connected" when all components match and respond', () => {
  const input = {
    appVersion: '4.3.0',
    expectedExtensionVersion: '4.3.0',
    extensionVersion: '4.3.0',
    browsers: { chrome: true, edge: true },
    nativeHost: { registered: true, running: true },
    extensionActive: true,
    completed: true
  };

  const status = computeInstallationStatus(input);
  assert.equal(status.state, 'connected');
  assert.equal(status.compatible, true);
  assert.equal(status.currentStep.id, InstallationStep.COMPLETED);
});

test('installationChecks: normalizeInstallationError handles known IPC and timeout errors', () => {
  const err1 = normalizeInstallationError(new Error('Native host has exited with code 1'));
  assert.ok(err1.userMessage.includes('Host nativo'));

  const err2 = normalizeInstallationError(new Error('Extension port disconnected'));
  assert.ok(err2.userMessage.includes('Extensão'));

  const err3 = normalizeInstallationError('Unknown timeout');
  assert.ok(err3.userMessage.length > 0);
});
