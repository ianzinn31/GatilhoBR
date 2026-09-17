// Armazenamento operacional separado por conta autenticada.
// A sessao continua em chaves globais para o service worker localizar o usuario
// atual; configuracoes, binds e presets locais nunca usam essas chaves globais.
(function installGbrUserScopedStorage() {
  const PREFIX = 'gbr_user_';
  const chromeApi = typeof chrome === 'undefined' ? null : chrome;

  function userKey(userId, key) {
    return `${PREFIX}${userId}_${key}`;
  }

  async function currentUserId() {
    if (!chromeApi?.storage?.local) return '';
    const stored = await chromeApi.storage.local.get(['gbr_user_id']);
    return typeof stored?.gbr_user_id === 'string' ? stored.gbr_user_id.trim() : '';
  }

  function requestedKeys(keys) {
    if (Array.isArray(keys)) return keys.map(String);
    if (keys && typeof keys === 'object') return Object.keys(keys);
    return [];
  }

  function defaultsFor(keys) {
    return keys && typeof keys === 'object' && !Array.isArray(keys) ? keys : {};
  }

  async function get(areaName, keys) {
    const area = chromeApi?.storage?.[areaName];
    const userId = await currentUserId();
    if (!area || !userId) return { ...defaultsFor(keys) };

    if (keys == null) {
      const all = await area.get(null);
      const prefix = `${PREFIX}${userId}_`;
      return Object.fromEntries(Object.entries(all || {})
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, value]) => [key.slice(prefix.length), value]));
    }

    const logicalKeys = requestedKeys(keys);
    const scopedKeys = logicalKeys.map((key) => userKey(userId, key));
    const stored = await area.get(scopedKeys);
    const defaults = defaultsFor(keys);
    return Object.fromEntries(logicalKeys.map((key) => [
      key,
      stored?.[userKey(userId, key)] ?? defaults[key],
    ]));
  }

  async function set(areaName, values) {
    const area = chromeApi?.storage?.[areaName];
    const userId = await currentUserId();
    if (!area || !userId || !values || typeof values !== 'object') return;
    const scopedValues = Object.fromEntries(Object.entries(values).map(([key, value]) => [
      userKey(userId, key),
      value,
    ]));
    await area.set(scopedValues);
  }

  async function remove(areaName, keys) {
    const area = chromeApi?.storage?.[areaName];
    const userId = await currentUserId();
    if (!area || !userId) return;
    const logicalKeys = Array.isArray(keys) ? keys : [keys];
    await area.remove(logicalKeys.map((key) => userKey(userId, String(key))));
  }

  window.gbrUserScopedStorage = {
    prefix: PREFIX,
    key: userKey,
    get,
    set,
    remove,
    currentUserId,
  };
})();
