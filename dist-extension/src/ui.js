// =========================================================================
// FAST TRIGGER PRO - INTERFACE VISUAL
// =========================================================================

function showFlashFeedback(text) {
  try {
    let flash = document.getElementById('fast-trigger-flash');
    if (!flash) {
      flash = document.createElement('div');
      flash.id = 'fast-trigger-flash';
      flash.style.cssText = `
        position: fixed !important;
        top: 30px !important;
        left: 50% !important;
        transform: translateX(-50%) translateY(-20px) !important;
        z-index: 2147483647 !important;
        background: #00ffcc !important;
        color: #000000 !important;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
        font-size: 15px !important;
        font-weight: 900 !important;
        padding: 12px 26px !important;
        border-radius: 40px !important;
        box-shadow: 0 0 30px rgba(0, 255, 204, 0.95), 0 6px 20px rgba(0,0,0,0.5) !important;
        pointer-events: none !important;
        transition: all 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275) !important;
        letter-spacing: 1px !important;
        opacity: 0 !important;
      `;
      (document.body || document.documentElement).appendChild(flash);
    }

    flash.innerText = text || '⚡ DISPARO EXECUTADO (0ms)';
    flash.style.opacity = '1';
    flash.style.transform = 'translateX(-50%) translateY(0)';

    setTimeout(() => {
      flash.style.opacity = '0';
      flash.style.transform = 'translateX(-50%) translateY(-20px)';
    }, 1200);
  } catch (e) {}
}

function applyFloatingButtonState() {
  if (window !== window.top) return;

  try {
    // O disparo continua disponível pelas binds/atalhos. O botão flutuante
    // nas casas foi removido; apagar um elemento antigo também permite que a
    // mudança tenha efeito sem exigir o fechamento da aba.
    document.getElementById('fast-trigger-floating-btn')?.remove();
  } catch (e) {}
}
