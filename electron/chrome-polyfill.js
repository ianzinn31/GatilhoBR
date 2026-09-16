// =========================================================================
// GATILHOBR DESKTOP - CHROME EXTENSION API EMULATION / POLYFILL
// =========================================================================
// Esta camada reproduz 100% da interface do chrome.* (runtime, storage, tabs,
// debugger, commands) usando IPC nativo do Electron com latência mínima.
// =========================================================================

(function initChromePolyfill(globalScope) {
  'use strict';

  if (globalScope.chrome && globalScope.chrome.__isGatilhoPolyfill) {
    return;
  }

  const electron = globalScope.__gbrElectronApi;
  if (!electron) {
    console.warn('[GatilhoBR Polyfill] __gbrElectronApi não encontrado no escopo global.');
    return;
  }

  // Serializador seguro de JSON para IPC que descarta nós do DOM, Window, referências circulares e propriedades não serializáveis
  function safeJsonStringify(obj) {
    if (typeof obj === 'string') return obj;
    const seen = new WeakSet();
    try {
      return JSON.stringify(obj, (key, value) => {
        if (value === null || value === undefined) return value;
        const t = typeof value;
        if (t === 'function' || t === 'symbol') return undefined;
        if (t === 'object') {
          if (seen.has(value)) return undefined;
          seen.add(value);

          // Descarta explicitamente nós do DOM, Window e Eventos
          if (
            value.nodeType !== undefined ||
            value.window === value ||
            value.self === value ||
            value.setInterval !== undefined
          ) {
            return undefined;
          }

          // Descarta propriedades com nomes típicos de referências de DOM na Betfair/Bet365
          if (
            key === 'marketRoot' ||
            key === 'lineElement' ||
            key === 'element' ||
            key === 'container' ||
            key === 'header' ||
            key === 'expandControl' ||
            key === 'titleElement' ||
            key === 'target' ||
            key === 'leaf' ||
            key === 'srcElement' ||
            key === 'currentTarget'
          ) {
            return undefined;
          }

          // Descarta qualquer classe do navegador (HTML*, SVG*, Node*, CSS*, etc.)
          const className = value.constructor ? value.constructor.name : '';
          if (className && !['Object', 'Array', 'Date', 'RegExp', 'Map', 'Set'].includes(className)) {
            if (
              className.startsWith('HTML') ||
              className.startsWith('SVG') ||
              className.includes('Element') ||
              className.includes('Node') ||
              className.includes('DOM') ||
              className.includes('CSS') ||
              className.includes('Event')
            ) {
              return undefined;
            }
          }
        }
        return value;
      }) || '{}';
    } catch (e) {
      console.warn('[Polyfill] safeJsonStringify fallback:', e);
      return '{}';
    }
  }

  function safeCloneForIPC(obj) {
    if (obj === null || obj === undefined || typeof obj !== 'object') return obj;
    try {
      const json = safeJsonStringify(obj);
      return JSON.parse(json);
    } catch (_) {
      return obj;
    }
  }

  const listeners = {
    runtimeMessage: new Set(),
    runtimeConnect: new Set(),
    runtimeInstalled: new Set(),
    runtimeStartup: new Set(),
    storageChanged: new Set(),
    debuggerDetach: new Set(),
    debuggerEvent: new Set(),
    tabsRemoved: new Set(),
    tabsActivated: new Set(),
    tabsUpdated: new Set(),
    command: new Set(),
  };

  const activePorts = new Map();
  let portCounter = 0;

  // Escuta mensagens vindas do processo principal (Electron Main)
  electron.on('gbr:broadcast-runtime-message', (data) => {
    const { message, sender } = data;
    listeners.runtimeMessage.forEach((cb) => {
      try {
        cb(message, sender, (response) => {
          if (data.replyChannel) {
            electron.send(data.replyChannel, response);
          }
        });
      } catch (err) {
        console.error('[Polyfill] Erro em runtime.onMessage listener:', err);
      }
    });
  });

  electron.on('gbr:broadcast-runtime-connect', (data) => {
    const { portId, name, sender } = data;
    const port = createPort(name, portId, true, sender);
    listeners.runtimeConnect.forEach((cb) => {
      try {
        cb(port);
      } catch (err) {
        console.error('[Polyfill] Erro em runtime.onConnect listener:', err);
      }
    });
  });

  electron.on('gbr:port-message', (data) => {
    let message = data.message;
    if (!message && data.messageJson) {
      try {
        message = JSON.parse(data.messageJson);
      } catch (e) {
        console.error('[Polyfill] Falha ao fazer parse de messageJson:', e);
      }
    }
    const { portId } = data;
    let port = activePorts.get(portId);
    if (!port && activePorts.size > 0) {
      for (const candidate of activePorts.values()) {
        if (candidate._onMessageListeners && candidate._onMessageListeners.size > 0) {
          port = candidate;
          break;
        }
      }
    }
    if (port && port._onMessageListeners) {
      port._onMessageListeners.forEach((cb) => {
        try {
          cb(message, port);
        } catch (err) {
          console.error('[Polyfill] Erro em port.onMessage:', err);
        }
      });
    }
  });

  electron.on('gbr:port-disconnect', (data) => {
    const { portId } = data;
    const port = activePorts.get(portId);
    if (port) {
      if (port._onDisconnectListeners) {
        port._onDisconnectListeners.forEach((cb) => {
          try {
            cb(port);
          } catch (err) {
            console.error('[Polyfill] Erro em port.onDisconnect:', err);
          }
        });
      }
      activePorts.delete(portId);
    }
  });

  electron.on('gbr:storage-changed', (data) => {
    const { changes, areaName } = data;
    listeners.storageChanged.forEach((cb) => {
      try {
        cb(changes, areaName);
      } catch (err) {
        console.error('[Polyfill] Erro em storage.onChanged:', err);
      }
    });
  });

  electron.on('gbr:trigger-command', (data) => {
    const { command } = data;
    listeners.command.forEach((cb) => {
      try {
        cb(command);
      } catch (err) {
        console.error('[Polyfill] Erro em commands.onCommand:', err);
      }
    });
  });

  electron.on('gbr:tabs-removed', (data) => {
    const tabId = typeof data === 'object' ? data.tabId : data;
    listeners.tabsRemoved.forEach((cb) => {
      try { cb(tabId); } catch (err) { console.error('[Polyfill] Erro em tabs.onRemoved:', err); }
    });
  });

  electron.on('gbr:tabs-activated', (data) => {
    listeners.tabsActivated.forEach((cb) => {
      try { cb(data); } catch (err) { console.error('[Polyfill] Erro em tabs.onActivated:', err); }
    });
  });

  electron.on('gbr:tabs-updated', (data) => {
    const { tabId, changeInfo, tab } = data || {};
    listeners.tabsUpdated.forEach((cb) => {
      try { cb(tabId, changeInfo, tab); } catch (err) { console.error('[Polyfill] Erro em tabs.onUpdated:', err); }
    });
  });

  // Emulação da classe Port
  function createPort(name, portId, isIncoming = false, customSender = null) {
    const onMessageListeners = new Set();
    const onDisconnectListeners = new Set();

    const portObj = {
      name: name || '',
      portId: portId,
      _onMessageListeners: onMessageListeners,
      _onDisconnectListeners: onDisconnectListeners,
      sender: customSender || {
        id: 'gatilhobr-desktop',
        tab: { id: electron.tabId || 1 },
        url: window.location.href,
        frameId: 0,
      },
      onMessage: {
        addListener(fn) {
          if (typeof fn === 'function') onMessageListeners.add(fn);
        },
        removeListener(fn) {
          onMessageListeners.delete(fn);
        },
        hasListener(fn) {
          return onMessageListeners.has(fn);
        },
      },
      onDisconnect: {
        addListener(fn) {
          if (typeof fn === 'function') onDisconnectListeners.add(fn);
        },
        removeListener(fn) {
          onDisconnectListeners.delete(fn);
        },
        hasListener(fn) {
          return onDisconnectListeners.has(fn);
        },
      },
      postMessage(msg) {
        try {
          const jsonStr = safeJsonStringify(msg);
          electron.send('gbr:port-post-message', { portId, messageJson: jsonStr });
        } catch (err) {
          console.error('[Polyfill Port] Erro ao enviar postMessage:', err);
        }
      },
      disconnect() {
        electron.send('gbr:port-disconnect-req', { portId });
        activePorts.delete(portId);
      },
    };

    activePorts.set(portId, portObj);
    return portObj;
  }

  // Emulação de Storage Area
  function createStorageArea(areaName) {
    return {
      get(keys, callback) {
        return new Promise((resolve) => {
          electron.invoke('gbr:storage-get', { area: areaName, keys }).then((res) => {
            if (typeof callback === 'function') {
              try { callback(res); } catch (e) { console.error(e); }
            }
            resolve(res);
          }).catch((err) => {
            console.error(`[Storage ${areaName}] get error:`, err);
            const empty = {};
            if (typeof callback === 'function') callback(empty);
            resolve(empty);
          });
        });
      },
      set(items, callback) {
        return new Promise((resolve) => {
          electron.invoke('gbr:storage-set', { area: areaName, items }).then(() => {
            if (typeof callback === 'function') {
              try { callback(); } catch (e) { console.error(e); }
            }
            resolve();
          }).catch((err) => {
            console.error(`[Storage ${areaName}] set error:`, err);
            if (typeof callback === 'function') callback();
            resolve();
          });
        });
      },
      remove(keys, callback) {
        return new Promise((resolve) => {
          electron.invoke('gbr:storage-remove', { area: areaName, keys }).then(() => {
            if (typeof callback === 'function') {
              try { callback(); } catch (e) { console.error(e); }
            }
            resolve();
          }).catch((err) => {
            console.error(`[Storage ${areaName}] remove error:`, err);
            if (typeof callback === 'function') callback();
            resolve();
          });
        });
      },
      clear(callback) {
        return new Promise((resolve) => {
          electron.invoke('gbr:storage-clear', { area: areaName }).then(() => {
            if (typeof callback === 'function') {
              try { callback(); } catch (e) { console.error(e); }
            }
            resolve();
          }).catch((err) => {
            console.error(`[Storage ${areaName}] clear error:`, err);
            if (typeof callback === 'function') callback();
            resolve();
          });
        });
      },
    };
  }

  const localStorageArea = createStorageArea('local');
  const sessionStorageArea = createStorageArea('session');
  const syncStorageArea = createStorageArea('sync');

  // Objeto Polyfill chrome.*
  const chromePolyfill = {
    __isGatilhoPolyfill: true,
    runtime: {
      id: 'gatilhobr-desktop',
      lastError: null,
      getManifest() {
        return {
          name: 'GatilhoBR Desktop',
          version: '4.3.0',
          manifest_version: 3,
        };
      },
      getURL(path) {
        return path;
      },
      sendMessage(arg1, arg2, arg3) {
        let extensionId = null;
        let message = arg1;
        let options = null;
        let callback = null;

        if (typeof arg2 === 'function') {
          callback = arg2;
        } else if (typeof arg3 === 'function') {
          callback = arg3;
          message = arg2;
        }

        return new Promise((resolve, reject) => {
          const cleanMessage = safeCloneForIPC(message);
          electron.invoke('gbr:runtime-send-message', { message: cleanMessage }).then((response) => {
            if (typeof callback === 'function') {
              try { callback(response); } catch (e) { console.error(e); }
            }
            resolve(response);
          }).catch((err) => {
            chromePolyfill.runtime.lastError = { message: err.message };
            if (typeof callback === 'function') {
              try { callback(null); } catch (e) { console.error(e); }
            }
            resolve(null);
          });
        });
      },
      connect(connectInfo) {
        const name = (connectInfo && connectInfo.name) || '';
        portCounter++;
        const portId = `port_${Date.now()}_${portCounter}`;
        const port = createPort(name, portId, false);
        electron.send('gbr:port-connect', { portId, name });
        return port;
      },
      onMessage: {
        addListener(fn) {
          if (typeof fn === 'function') listeners.runtimeMessage.add(fn);
        },
        removeListener(fn) {
          listeners.runtimeMessage.delete(fn);
        },
        hasListener(fn) {
          return listeners.runtimeMessage.has(fn);
        },
      },
      onConnect: {
        addListener(fn) {
          if (typeof fn === 'function') listeners.runtimeConnect.add(fn);
        },
        removeListener(fn) {
          listeners.runtimeConnect.delete(fn);
        },
        hasListener(fn) {
          return listeners.runtimeConnect.has(fn);
        },
      },
      onInstalled: {
        addListener(fn) {
          if (typeof fn === 'function') listeners.runtimeInstalled.add(fn);
        },
        removeListener(fn) {
          listeners.runtimeInstalled.delete(fn);
        },
        hasListener(fn) {
          return listeners.runtimeInstalled.has(fn);
        },
      },
      onStartup: {
        addListener(fn) {
          if (typeof fn === 'function') listeners.runtimeStartup.add(fn);
        },
        removeListener(fn) {
          listeners.runtimeStartup.delete(fn);
        },
        hasListener(fn) {
          return listeners.runtimeStartup.has(fn);
        },
      },
    },

    storage: {
      local: localStorageArea,
      session: sessionStorageArea,
      sync: syncStorageArea,
      onChanged: {
        addListener(fn) {
          if (typeof fn === 'function') listeners.storageChanged.add(fn);
        },
        removeListener(fn) {
          listeners.storageChanged.delete(fn);
        },
        hasListener(fn) {
          return listeners.storageChanged.has(fn);
        },
      },
    },

    tabs: {
      query(queryInfo, callback) {
        return new Promise((resolve) => {
          electron.invoke('gbr:tabs-query', queryInfo).then((tabs) => {
            if (typeof callback === 'function') {
              try { callback(tabs); } catch (e) { console.error(e); }
            }
            resolve(tabs);
          }).catch(() => {
            if (typeof callback === 'function') callback([]);
            resolve([]);
          });
        });
      },
      create(createProperties, callback) {
        return new Promise((resolve) => {
          electron.invoke('gbr:tabs-create', createProperties).then((tab) => {
            if (typeof callback === 'function') {
              try { callback(tab); } catch (e) { console.error(e); }
            }
            resolve(tab);
          });
        });
      },
      sendMessage(tabId, message, options, callback) {
        if (typeof options === 'function') {
          callback = options;
          options = {};
        }
        return new Promise((resolve) => {
          electron.invoke('gbr:tabs-send-message', { tabId, message }).then((res) => {
            if (typeof callback === 'function') {
              try { callback(res); } catch (e) { console.error(e); }
            }
            resolve(res);
          }).catch((err) => {
            if (typeof callback === 'function') callback(null);
            resolve(null);
          });
        });
      },
      update(tabId, updateProperties, callback) {
        return new Promise((resolve) => {
          electron.invoke('gbr:tabs-update', { tabId, updateProperties }).then((tab) => {
            if (typeof callback === 'function') {
              try { callback(tab); } catch (e) { console.error(e); }
            }
            resolve(tab);
          });
        });
      },
      get(tabId, callback) {
        return new Promise((resolve) => {
          electron.invoke('gbr:tabs-get', { tabId }).then((tab) => {
            if (typeof callback === 'function') {
              try { callback(tab); } catch (e) { console.error(e); }
            }
            resolve(tab);
          }).catch(() => {
            const fallback = { id: tabId, url: '', active: false, status: 'complete' };
            if (typeof callback === 'function') callback(fallback);
            resolve(fallback);
          });
        });
      },
      onRemoved: {
        addListener(fn) {
          if (typeof fn === 'function') listeners.tabsRemoved.add(fn);
        },
        removeListener(fn) {
          listeners.tabsRemoved.delete(fn);
        },
        hasListener(fn) {
          return listeners.tabsRemoved.has(fn);
        },
      },
      onActivated: {
        addListener(fn) {
          if (typeof fn === 'function') listeners.tabsActivated.add(fn);
        },
        removeListener(fn) {
          listeners.tabsActivated.delete(fn);
        },
        hasListener(fn) {
          return listeners.tabsActivated.has(fn);
        },
      },
      onUpdated: {
        addListener(fn) {
          if (typeof fn === 'function') listeners.tabsUpdated.add(fn);
        },
        removeListener(fn) {
          listeners.tabsUpdated.delete(fn);
        },
        hasListener(fn) {
          return listeners.tabsUpdated.has(fn);
        },
      },
    },

    windows: {
      create(createData, callback) {
        return new Promise((resolve) => {
          electron.invoke('gbr:windows-create', createData).then((win) => {
            if (typeof callback === 'function') callback(win);
            resolve(win);
          }).catch(() => {
            if (typeof callback === 'function') callback({});
            resolve({});
          });
        });
      },
      update(windowId, updateInfo, callback) {
        return new Promise((resolve) => {
          electron.invoke('gbr:windows-update', { windowId, updateInfo }).then((win) => {
            if (typeof callback === 'function') callback(win);
            resolve(win);
          }).catch(() => {
            if (typeof callback === 'function') callback({});
            resolve({});
          });
        });
      },
      get(windowId, getInfo, callback) {
        if (typeof getInfo === 'function') { callback = getInfo; getInfo = {}; }
        return new Promise((resolve) => {
          const win = { id: windowId || 1, focused: true, state: 'normal' };
          if (typeof callback === 'function') callback(win);
          resolve(win);
        });
      },
      getLastFocused(getInfo, callback) {
        if (typeof getInfo === 'function') { callback = getInfo; getInfo = {}; }
        return new Promise((resolve) => {
          const win = { id: 1, focused: true, state: 'normal' };
          if (typeof callback === 'function') callback(win);
          resolve(win);
        });
      },
    },

    debugger: {
      attach(target, requiredVersion, callback) {
        return new Promise((resolve) => {
          electron.invoke('gbr:debugger-attach', { target, requiredVersion }).then(() => {
            if (typeof callback === 'function') callback();
            resolve();
          });
        });
      },
      sendCommand(target, method, commandParams, callback) {
        return new Promise((resolve, reject) => {
          electron.invoke('gbr:debugger-send-command', { target, method, commandParams }).then((res) => {
            if (typeof callback === 'function') callback(res);
            resolve(res);
          }).catch((err) => {
            if (typeof callback === 'function') callback(null);
            reject(err);
          });
        });
      },
      detach(target, callback) {
        return new Promise((resolve) => {
          electron.invoke('gbr:debugger-detach', { target }).then(() => {
            if (typeof callback === 'function') callback();
            resolve();
          });
        });
      },
      onDetach: {
        addListener(fn) {
          if (typeof fn === 'function') listeners.debuggerDetach.add(fn);
        },
        removeListener(fn) {
          listeners.debuggerDetach.delete(fn);
        },
        hasListener(fn) {
          return listeners.debuggerDetach.has(fn);
        },
      },
      onEvent: {
        addListener(fn) {
          if (typeof fn === 'function') listeners.debuggerEvent.add(fn);
        },
        removeListener(fn) {
          listeners.debuggerEvent.delete(fn);
        },
        hasListener(fn) {
          return listeners.debuggerEvent.has(fn);
        },
      },
    },

    webRequest: {
      onBeforeRequest: {
        addListener() {},
        removeListener() {},
        hasListener() { return false; },
      },
    },

    commands: {
      getAll(callback) {
        return new Promise((resolve) => {
          electron.invoke('gbr:commands-get-all').then((commands) => {
            if (typeof callback === 'function') callback(commands);
            resolve(commands);
          });
        });
      },
      onCommand: {
        addListener(fn) {
          if (typeof fn === 'function') listeners.command.add(fn);
        },
        removeListener(fn) {
          listeners.command.delete(fn);
        },
        hasListener(fn) {
          return listeners.command.has(fn);
        },
      },
    },

    action: {
      onClicked: {
        addListener(fn) {
          if (typeof fn === 'function') listeners.actionClicked = fn;
        },
        removeListener() {
          delete listeners.actionClicked;
        },
        hasListener() {
          return Boolean(listeners.actionClicked);
        },
      },
      setTitle() {},
      setIcon() {},
      setBadgeText() {},
      setBadgeBackgroundColor() {},
    },

    scripting: {
      executeScript(injection, callback) {
        return new Promise((resolve) => {
          electron.invoke('gbr:scripting-execute-script', injection).then((res) => {
            if (typeof callback === 'function') callback(res);
            resolve(res);
          }).catch(() => {
            if (typeof callback === 'function') callback([]);
            resolve([]);
          });
        });
      },
    },
  };

  if (!globalScope.chrome) {
    globalScope.chrome = chromePolyfill;
  } else {
    Object.assign(globalScope.chrome, chromePolyfill);
  }
  globalScope.isGatilhoDesktop = true;
  console.log('[GatilhoBR Desktop] Polyfill chrome.* ativado com sucesso.');
})(typeof window !== 'undefined' ? window : globalThis);
