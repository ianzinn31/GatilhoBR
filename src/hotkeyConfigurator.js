// =========================================================================
// FAST TRIGGER PRO - CAPTURADOR UNIVERSAL DE ATALHO (TECLADO + MOUSE)
// =========================================================================

function initUniversalHotkeyConfigurator() {
  const hotkeyBtn = document.getElementById('btn-change-hotkey'); // ID do botão no painel
  if (!hotkeyBtn) return;

  // Carrega o atalho salvo ao iniciar o painel
  if (!window.gbrUserScopedStorage) return;
  window.gbrUserScopedStorage.get('local', ['fastTriggerHotkey']).then((res) => {
    if (res && res.fastTriggerHotkey && res.fastTriggerHotkey.label) {
      hotkeyBtn.innerText = `Atalho: ${res.fastTriggerHotkey.label}`;
    } else {
      hotkeyBtn.innerText = 'Atalho: ControlRight';
    }
  }).catch(() => {});

  hotkeyBtn.addEventListener('click', () => {
    hotkeyBtn.innerText = 'Pressione qualquer tecla ou botão do mouse...';
    hotkeyBtn.classList.add('recording');

    let isCaptured = false;

    // Função de gravação e salvamento
    const saveHotkey = (type, code, label) => {
      if (isCaptured) return;
      isCaptured = true;

      const hotkeyData = { type, code, label };

      // Salva no Chrome Storage para sincronização automática entre abas
      if (!window.gbrUserScopedStorage) return;
      window.gbrUserScopedStorage.set('local', { fastTriggerHotkey: hotkeyData }).then(() => {
        hotkeyBtn.innerText = `Atalho: ${label}`;
        const dispEl = document.getElementById('dispHotkey');
        if (dispEl) dispEl.innerText = label;
        hotkeyBtn.classList.remove('recording');
        console.log('[Fast Trigger] 💾 Atalho Universal Salvo:', hotkeyData);
      }).catch(() => {
        isCaptured = false;
        hotkeyBtn.classList.remove('recording');
      });

      cleanupListeners();
    };

    // 1. Captura de Teclado
    const handleKeyDown = (e) => {
      e.preventDefault();
      e.stopPropagation();

      // Evita mapear apenas a tecla Escape caso queira cancelar a gravação
      if (e.code === 'Escape') {
        hotkeyBtn.innerText = 'Gravação cancelada';
        hotkeyBtn.classList.remove('recording');
        cleanupListeners();
        return;
      }

      // Utiliza 'e.code' para identificar a posição física exata da tecla
      const label = e.code.replace('Key', '').replace('Digit', 'Nº ');
      saveHotkey('keyboard', e.code, label);
    };

    // 2. Captura de Mouse (Gamer/Trader - Botão Lateral, Rodinha, etc.)
    const handleMouseDown = (e) => {
      // Impede captura do clique esquerdo padrão (button 0) para não travar o clique de seleção
      if (e.button === 0 && e.target === hotkeyBtn) return;

      e.preventDefault();
      e.stopPropagation();

      const mouseMap = {
        1: 'Mouse Roda (Scroll Click)',
        2: 'Mouse Botão Direito',
        3: 'Mouse Lateral (Voltar)',
        4: 'Mouse Lateral (Avançar)',
        5: 'Mouse Extra 5',
        6: 'Mouse Extra 6'
      };

      const label = mouseMap[e.button] || `Mouse Botão ${e.button}`;
      saveHotkey('mouse', `Mouse${e.button}`, label);
    };

    // Limpeza dos escutadores de gravação
    const cleanupListeners = () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('mousedown', handleMouseDown, true);
      window.removeEventListener('contextmenu', preventContextMenu, true);
    };

    const preventContextMenu = (e) => e.preventDefault();

    // Registra os escutadores prioritários
    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('mousedown', handleMouseDown, true);
    window.addEventListener('contextmenu', preventContextMenu, true);
  });
}

// Auto-inicializa quando o DOM do painel carrega
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initUniversalHotkeyConfigurator);
  } else {
    initUniversalHotkeyConfigurator();
  }
}
