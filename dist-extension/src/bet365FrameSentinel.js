// =========================================================================
// GATILHOBR - SENTINELA LEVE DE FRAMES BET365
// =========================================================================

(function () {
  "use strict";

  // A versão atual não executa ações financeiras fora do frame principal e o
  // coletor de mercados é registrado somente no top frame. Este sentinela
  // mantém a presença declarativa em todos os frames sem carregar o motor
  // completo repetidamente e publica uma prova leve de que o frame continua
  // contendo nós de mercado/odds.
  if (typeof window === "undefined" || window === window.top) return;
  if (window.__gbrBet365FrameSentinel === true) return;
  window.__gbrBet365FrameSentinel = true;

  const frameToken = Math.random().toString(36).slice(2, 14);
  const MARKET_SIGNAL_SELECTOR =
    '[data-testid*="market" i], [data-testid*="odd" i], [class*="Market"], [class*="Odds"]';

  function announce() {
    let marketNodeCount = 0;
    try {
      marketNodeCount = Math.min(
        500,
        document.querySelectorAll(MARKET_SIGNAL_SELECTOR).length,
      );
    } catch (error) {}

    try {
      window.parent.postMessage(
        {
          type: "GBR_BET365_FRAME_SENTINEL",
          schemaVersion: 1,
          frameToken,
          marketNodeCount,
          seenAt: Date.now(),
        },
        "*",
      );
    } catch (error) {}
  }

  announce();
  window.setInterval(announce, 1500);
})();
