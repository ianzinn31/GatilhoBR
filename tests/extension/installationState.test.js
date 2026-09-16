const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_INSTALLATION_STATE,
  getInstallationState,
  setInstallationState,
  handleInstallationPing,
  isAppVersionCompatible,
  canExecuteOperationalOrders
} = require('../../src/installationState');

// Mock in-memory chrome.storage.local
function createMockStorage(initialData = {}) {
  let store = { ...initialData };
  return {
    get: async (keys) => {
      if (typeof keys === 'string') return { [keys]: store[keys] };
      if (Array.isArray(keys)) {
        const res = {};
        keys.forEach(k => { res[k] = store[k]; });
        return res;
      }
      return { ...store };
    },
    set: async (items) => {
      Object.assign(store, items);
    },
    _raw: () => store
  };
}

test('installationState: returns default state when storage is uninitialized', async () => {
  const storage = createMockStorage();
  const state = await getInstallationState(storage);

  assert.equal(state.completed, false);
  assert.equal(state.lastSeenAppVersion, null);
  assert.equal(state.lastOnboardingStep, 'INITIAL');
  assert.equal(state.compatible, true);
});

test('installationState: setInstallationState merges patches atomically and preserves existing values', async () => {
  const storage = createMockStorage();
  await setInstallationState({ lastSeenAppVersion: '4.3.0', lastOnboardingStep: 'NATIVE_HOST' }, storage);

  const updated = await getInstallationState(storage);
  assert.equal(updated.lastSeenAppVersion, '4.3.0');
  assert.equal(updated.lastOnboardingStep, 'NATIVE_HOST');
  assert.equal(updated.completed, false); // preserved

  await setInstallationState({ completed: true }, storage);
  const completedState = await getInstallationState(storage);
  assert.equal(completedState.completed, true);
  assert.equal(completedState.lastSeenAppVersion, '4.3.0');
});

test('installationState: handleInstallationPing responds safely without executing any bet', () => {
  const response = handleInstallationPing({
    message: { type: 'GBR_INSTALLATION_PING', correlationId: 'ping-123' },
    extensionVersion: '4.3.0'
  });

  assert.ok(response, 'Must respond to ping');
  assert.equal(response.type, 'GBR_INSTALLATION_PONG');
  assert.equal(response.correlationId, 'ping-123');
  assert.equal(response.version, '4.3.0');
  assert.equal(response.protocol, '2.0');
  assert.equal(response.status, 'ready');
  assert.equal(response.safeMode, true);
  assert.ok(Array.isArray(response.capabilities));
  assert.ok(response.capabilities.includes('DIAGNOSTIC'));
});

test('installationState: version gate blocks orders on incompatible app without deleting user data', () => {
  // 1. Incompatible: app 3.9.0 vs min 4.0.0
  assert.equal(isAppVersionCompatible('3.9.0', '4.0.0'), false);
  const gate1 = canExecuteOperationalOrders({
    appVersion: '3.9.0',
    minAppVersion: '4.0.0'
  });
  assert.equal(gate1.allowed, false);
  assert.equal(gate1.reason, 'INCOMPATIBLE_APP_VERSION');
  assert.equal(gate1.canDiagnose, true, 'Diagnostics must remain enabled');

  // 2. Compatible: app 4.3.0 vs min 4.0.0
  assert.equal(isAppVersionCompatible('4.3.0', '4.0.0'), true);
  const gate2 = canExecuteOperationalOrders({
    appVersion: '4.3.0',
    minAppVersion: '4.0.0'
  });
  assert.equal(gate2.allowed, true);
});
