// =========================================================================
// GATILHOBR - PONTE ISOLATED -> MAIN DO FEED DE REDE BET365
// =========================================================================
//
// Duas chaves locais pedem o mesmo observador, com finalidades diferentes:
//
//   gbr_network_feed_experiment   diagnóstico manual: liga o feed E o resumo
//                                 de observações publicado por frame.
//   gbr_direct_order_experiment   execução direta: o despachante do MAIN world
//                                 lê `window.__gbrMarketStateCache` de forma
//                                 síncrona; sem o observador instalado ele
//                                 devolve `no_cache` e todo disparo volta ao
//                                 fluxo visual.
//
// Por isso `enabled` é a união das duas, e `observations` segue apenas a chave
// de diagnóstico: no caminho de execução o resumo por frame seria um
// `postMessage` extra dentro do trecho sensível a latência.
// =========================================================================

(function () {
  "use strict";

  if (typeof window === "undefined" || window.__gbrNetworkFeedBridgeBooted === true) {
    return;
  }
  window.__gbrNetworkFeedBridgeBooted = true;

  const FEED_KEY = "gbr_network_feed_experiment";
  const DIRECT_ORDER_KEY = "gbr_direct_order_experiment";

  function publishControl(enabled, observations) {
    try {
      window.postMessage(
        {
          type: "GBR_NETWORK_FEED_CONTROL",
          schemaVersion: 1,
          enabled: enabled === true,
          observations: observations === true,
        },
        window.location.origin,
      );
    } catch (error) {}
  }

  function publishFromFlags(stored) {
    const diagnostic = stored?.[FEED_KEY] === true;
    const execution = stored?.[DIRECT_ORDER_KEY] === true;
    publishControl(diagnostic || execution, diagnostic);
  }

  function republishFromStorage() {
    try {
      chrome.storage.local
        .get([FEED_KEY, DIRECT_ORDER_KEY])
        .then(publishFromFlags)
        .catch(() => {});
    } catch (error) {}
  }

  chrome.runtime.onMessage.addListener((message) => {
    const type = message?.action;
    if (
      type !== "ENABLE_BET365_NETWORK_FEED" &&
      type !== "DISABLE_BET365_NETWORK_FEED"
    ) {
      return;
    }

    // `observations` é opcional: quem manda só `action` continua recebendo o
    // resumo, para não mudar o contrato do diagnóstico manual.
    publishControl(
      type === "ENABLE_BET365_NETWORK_FEED",
      message?.observations !== false,
    );
  });

  // O switch da dashboard grava a chave e a aba já aberta precisa acompanhar
  // sem depender de o service worker acordar para avisar.
  try {
    if (chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "local" || !changes) return;
        if (changes[FEED_KEY] === undefined && changes[DIRECT_ORDER_KEY] === undefined) {
          return;
        }
        republishFromStorage();
      });
    }
  } catch (error) {}

  // A configuração é lida no próprio document_start. Isso permite que o
  // MAIN world seja armado antes de a aplicação criar o WebSocket principal,
  // sem exigir que o service worker acorde depois do carregamento.
  republishFromStorage();
})();
