// =========================================================================
// FAST TRIGGER PRO - SECURITY GUARD & RATE LIMITER
// =========================================================================

(function () {
  'use strict';

  if (typeof window === 'undefined') return;

  let isTopFrame = true;
  try {
    isTopFrame = window === window.top;
  } catch (error) {
    isTopFrame = false;
  }

  // Estado global de segurança
  window.FastTriggerSecurity = window.FastTriggerSecurity || {
    isDevToolsOpen: false,
    rateLimiter: {
      actionTimestamps: [],
      apiTimestamps: new Map(),
    },
    
    /**
     * Rate Limiter com Janela Deslizante (Sliding Window)
     * @param {string} type - Tipo da requisição ou ação ('action', 'api:supabase', etc.)
     * @param {number} maxRequests - Máximo de requisições permitidas na janela
     * @param {number} windowMs - Tamanho da janela em milissegundos
     * @returns {boolean} True se permitida, False se violou o rate limit
     */
    checkRateLimit(type = 'action', maxRequests = 15, windowMs = 5000) {
      const now = Date.now();
      
      if (type === 'action') {
        this.rateLimiter.actionTimestamps = this.rateLimiter.actionTimestamps.filter(t => now - t < windowMs);
        if (this.rateLimiter.actionTimestamps.length >= maxRequests) {
          console.warn(`[GatilhoBR Security] ⚠️ Rate limit excedido para ações de disparo (${this.rateLimiter.actionTimestamps.length}/${maxRequests} em ${windowMs}ms).`);
          return false;
        }
        this.rateLimiter.actionTimestamps.push(now);
        return true;
      }

      // Rate limit por endpoint de API
      let timestamps = this.rateLimiter.apiTimestamps.get(type) || [];
      timestamps = timestamps.filter(t => now - t < windowMs);
      if (timestamps.length >= maxRequests) {
        console.warn(`[GatilhoBR Security] ⚠️ Rate limit excedido para a API "${type}" (${timestamps.length}/${maxRequests} em ${windowMs}ms).`);
        return false;
      }
      timestamps.push(now);
      this.rateLimiter.apiTimestamps.set(type, timestamps);
      return true;
    },

    /**
     * Verifica se a execução está bloqueada por pausa explícita ou Rate Limit
     */
    isBlocked() {
      if (window.FastTriggerConfig && window.FastTriggerConfig.securityPaused) {
        console.warn('[GatilhoBR Security] ⛔ Execução pausada por segurança.');
        return true;
      }
      return false;
    }
  };

  // A geometria da janela não é uma evidência confiável de DevTools: zoom,
  // dock lateral e o próprio CDP podem produzir a mesma diferença. Mantemos
  // apenas o estado diagnóstico inicial e não pausamos o motor por inferência.
  if (!isTopFrame) {
    window.FastTriggerSecurity.isDevToolsOpen = false;
    if (window.FastTriggerConfig) {
      window.FastTriggerConfig.securityPaused = false;
    }
    if (window.FastTriggerState) {
      window.FastTriggerState.devToolsPaused = false;
    }
    return;
  }

})();
