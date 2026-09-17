// =========================================================================
// FAST TRIGGER PRO - MOTOR DE ESCUTA UNIVERSAL (DISPARO INSTANTÂNEO)
// =========================================================================

var currentHotkey = { type: 'keyboard', code: 'ControlRight', label: 'ControlRight' };

// Carrega a configuração do storage e escuta alterações em tempo real
if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
  const scoped = window.gbrUserScopedStorage;
  if (!scoped) {
    currentHotkey = { type: 'keyboard', code: '__disabled__', label: '__disabled__' };
  }
  scoped?.get('local', ['fastTriggerHotkey']).then((res) => {
    if (res && res.fastTriggerHotkey) {
      if (typeof res.fastTriggerHotkey === 'string') {
        currentHotkey = { type: 'keyboard', code: res.fastTriggerHotkey, label: res.fastTriggerHotkey };
      } else {
        currentHotkey = res.fastTriggerHotkey;
      }
    }
  }).catch(() => {});

  if (chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes) => {
      if (Object.keys(changes).some((key) => key.endsWith('_fastTriggerHotkey'))) {
        const val = changes[Object.keys(changes).find((key) => key.endsWith('_fastTriggerHotkey'))].newValue;
        if (typeof val === 'string') {
          currentHotkey = { type: 'keyboard', code: val, label: val };
        } else if (val) {
          currentHotkey = val;
        }
        console.log('[Fast Trigger] 🔄 Atalho atualizado na aba ativa:', currentHotkey);
      }
    });
  }
}

// Executa o disparo de aposta com segurança
function executeTriggerIfValid(e) {
  if (
    window !== window.top ||
    !e ||
    !e.isTrusted ||
    e.repeat ||
    (window.FastTriggerState && window.FastTriggerState.bindingCaptureInProgress) ||
    (window.FastTriggerState && window.FastTriggerState.nativeTextEntryInProgress) ||
    (window.FastTriggerState && (Date.now() - window.FastTriggerState.bootedAt) < 2000)
  ) {
    return;
  }

  // Evita disparar se o usuário estiver digitando um texto manualmente em algum campo ativo
  const activeEl = document.activeElement;
  const isTypingText = activeEl && (
    activeEl.tagName === 'INPUT' || 
    activeEl.tagName === 'TEXTAREA' || 
    activeEl.isContentEditable
  );

  if (isTypingText) return;

  e.preventDefault();
  e.stopPropagation();

  console.log(`[Fast Trigger] ⚡ DISPARO DE HARDWARE DETECTADO [${currentHotkey.label}]!`);

  const isHotkey = true; // Sinaliza que o disparo foi por atalho de hardware/teclado

  // Chama o motor de disparo que aceita "Fazer aposta" ou "Aceitar Alterações"
  if (typeof triggerPlaceBet === 'function') {
    triggerPlaceBet(true, isHotkey);
  } else if (typeof executeCachedTrigger === 'function') {
    executeCachedTrigger(isHotkey);
  }
}

// 1. ESCUTA DE TECLADO (KEYDOWN - CAPTURA DE ALTA PRIORIDADE)
window.addEventListener('keydown', (e) => {
  if (currentHotkey.type === 'keyboard' && (e.code === currentHotkey.code || e.key === currentHotkey.code)) {
    executeTriggerIfValid(e);
  }
}, true); // 'true' captura o evento antes que a Bet365 possa interceptá-lo


// 2. ESCUTA DE MOUSE (MOUSEDOWN / AUXCLICK - BOTÕES LATERAIS E EXTRAS)
window.addEventListener('mousedown', (e) => {
  if (currentHotkey.type === 'mouse' && `Mouse${e.button}` === currentHotkey.code) {
    executeTriggerIfValid(e);
  }
}, true);

// Bloqueia menus de contexto indesejados ao usar o botão direito como gatilho
window.addEventListener('contextmenu', (e) => {
  if (currentHotkey.type === 'mouse' && currentHotkey.code === 'Mouse2') {
    e.preventDefault();
  }
}, true);

// 3. RECEBEDOR DE COMANDOS DE SEGUNDO PLANO (DESPACHO GLOBAL SEM FOCO VIA SERVICE WORKER)
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request && request.action === "TRIGGER_PLACE_BET_NOW") {
      if (
        typeof window.consumeFastTriggerIntent !== 'function' ||
        !window.consumeFastTriggerIntent(request, 'trigger_bet')
      ) {
        sendResponse({ success: false, error: "invalid_or_stale_intent" });
        return true;
      }

      console.log("[Fast Trigger] ⚡ Comando de disparo recebido do Background (Fora de Foco)!");
      const isHotkey = request.isHotkey !== undefined ? request.isHotkey : true;

      if (typeof triggerPlaceBet === 'function') {
        triggerPlaceBet(true, isHotkey).then(success => {
          sendResponse({ success: !!success });
        });
        return true;
      } else if (typeof executeCachedTrigger === 'function') {
        executeCachedTrigger(isHotkey);
        sendResponse({ success: true });
        return true;
      } else {
        sendResponse({ success: false, error: "triggerPlaceBet não carregado" });
      }
    }
  });
}
