(function () {
  "use strict";

  var sdk = null;
  var sdkReady = null;

  function waitForSdk() {
    if (sdkReady) return sdkReady;
    sdkReady = new Promise(function (resolve, reject) {
      var startedAt = Date.now();
      var timer = window.setInterval(function () {
        if (window.Cakto && typeof window.Cakto.CaktoSDK === "function") {
          window.clearInterval(timer);
          resolve(window.Cakto);
          return;
        }
        if (Date.now() - startedAt > 15000) {
          window.clearInterval(timer);
          reject(new Error("O SDK da Cakto nao foi carregado."));
        }
      }, 50);
    });
    return sdkReady;
  }

  function send(requestId, ok, value, error) {
    window.parent.postMessage({
      source: "gbr-cakto-sdk",
      requestId: requestId,
      ok: ok,
      value: value,
      error: error || "",
    }, "*");
  }

  function getPayload(request) {
    return request && request.payload && typeof request.payload === "object"
      ? request.payload
      : {};
  }

  async function handle(request) {
    var payload = getPayload(request);
    var Cakto = await waitForSdk();

    if (request.type === "init") {
      if (!sdk) {
        sdk = new Cakto.CaktoSDK({ client_id: String(payload.clientId || "") });
      }
      return { initialized: true };
    }

    if (!sdk) throw new Error("SDK da Cakto ainda nao foi inicializado.");

    if (request.type === "antifraud") {
      await sdk.initAntifraud();
      await sdk.completeAntifraudProfile();
      var reference = sdk.getAntifraudReference();
      if (!reference) throw new Error("A Cakto nao retornou a referencia antifraude.");
      return { reference: reference };
    }

    if (request.type === "tokenize") {
      var tokenized = await sdk.createToken({
        holderName: String(payload.holderName || ""),
        cardNumber: String(payload.cardNumber || ""),
        cvv: String(payload.cvv || ""),
        expMonth: String(payload.expMonth || ""),
        expYear: String(payload.expYear || ""),
      });
      return { cardToken: String(tokenized && tokenized.cardToken || "") };
    }

    if (request.type === "cleanup") {
      if (typeof sdk.cleanupAntifraud === "function") sdk.cleanupAntifraud();
      return { cleaned: true };
    }

    throw new Error("Operacao SDK desconhecida.");
  }

  window.addEventListener("message", function (event) {
    var request = event.data;
    if (!request || request.source !== "gbr-cakto-sdk-parent" || !request.requestId) return;
    handle(request)
      .then(function (value) { send(request.requestId, true, value); })
      .catch(function (error) {
        send(request.requestId, false, null, error && error.message || "Falha no SDK da Cakto.");
      });
  });
}());
