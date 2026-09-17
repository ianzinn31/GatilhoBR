// =========================================================================
// FAST TRIGGER PRO - MÓDULO UTILITÁRIO DE HUMANIZAÇÃO AVANÇADA (ANTI-DETECÇÃO)
// =========================================================================

(function () {
  "use strict";

  // Armazena a última posição conhecida do cursor do usuário para trajetórias reais
  let lastKnownMousePos = {
    x: window.innerWidth ? Math.floor(window.innerWidth / 2) : 500,
    y: window.innerHeight ? Math.floor(window.innerHeight / 2) : 400,
  };

  // Escuta movimentação real do usuário para atualizar a posição inicial da curva de Bézier
  if (typeof window !== "undefined") {
    window.addEventListener(
      "mousemove",
      (e) => {
        if (e.clientX && e.clientY) {
          lastKnownMousePos.x = e.clientX;
          lastKnownMousePos.y = e.clientY;
        }
      },
      { passive: true },
    );
  }

  /**
   * Gera números com Distribuição Gaussiana (Normal) via Transformada de Box-Muller.
   * @param {number} mean Média desejada
   * @param {number} stdDev Desvio padrão
   * @returns {number}
   */
  function gaussianRandom(mean = 250, stdDev = 40) {
    let u = 0,
      v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    const num = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    return mean + num * stdDev;
  }

  /**
   * Retorna um atraso aleatório com Distribuição Gaussiana (Curva de Bell).
   * Se for disparo por Hotkey (isHotkey = true), configura a latência para a faixa ultra-curta (12ms a 35ms) sem hesitação longa.
   * @param {number} minMs
   * @param {number} maxMs
   * @param {boolean} isHotkey
   * @returns {Promise<void>}
   */
  const randomJitter = (minMs = 210, maxMs = 420, isHotkey = false) => {
    if (isHotkey) {
      minMs = 12;
      maxMs = 35;
    }

    // 3.5% de chance de hesitação humana apenas para cliques manuais sem hotkey
    if (!isHotkey && minMs > 50 && Math.random() < 0.035) {
      const longDelay = 750 + Math.random() * 400;
      return new Promise((resolve) => setTimeout(resolve, longDelay));
    }

    const mean = (minMs + maxMs) / 2;
    const stdDev = Math.max(1, (maxMs - minMs) / 5);
    let delay = gaussianRandom(mean, stdDev);
    delay = Math.max(minMs, Math.min(maxMs, delay));

    return new Promise((resolve) => setTimeout(resolve, delay));
  };

  /**
   * Calcula pontos de uma Curva Bézier Cúbica ultrarrápida (4 a 6 pontos max).
   */
  function generateBezierPath(startX, startY, endX, endY, steps = 5) {
    // Reduz rigorosamente para 4 a 6 pontos intermediários max
    const safeSteps = Math.min(6, Math.max(4, Math.round(steps)));
    const points = [];

    // Pontos de controle com desvios orgânicos contidos
    const ctrl1X = startX + (endX - startX) * 0.25 + (Math.random() * 20 - 10);
    const ctrl1Y = startY + (endY - startY) * 0.1 + (Math.random() * 20 - 10);
    const ctrl2X = startX + (endX - startX) * 0.75 + (Math.random() * 20 - 10);
    const ctrl2Y = startY + (endY - startY) * 0.9 + (Math.random() * 20 - 10);

    for (let i = 0; i <= safeSteps; i++) {
      const t = i / safeSteps;
      const easeT = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;

      const u = 1 - easeT;
      const tt = easeT * easeT;
      const uu = u * u;
      const uuu = uu * u;
      const ttt = tt * easeT;

      let x =
        uuu * startX +
        3 * uu * easeT * ctrl1X +
        3 * u * tt * ctrl2X +
        ttt * endX;
      let y =
        uuu * startY +
        3 * uu * easeT * ctrl1Y +
        3 * u * tt * ctrl2Y +
        ttt * endY;

      points.push({ x: Math.round(x), y: Math.round(y) });
    }
    return points;
  }

  /**
   * Executa a sequência completa de aproximação por Curva de Bézier e clique nativo no elemento.
   * A trajetória completa do mouse leva NO MÁXIMO 35ms.
   * @param {Element} element
   * @param {boolean} isHotkey Indica se o disparo veio de um Atalho de Teclado
   * @returns {Promise<boolean>}
   */
  async function simulateHumanClick(
    element,
    isHotkey = false,
    fastMode = false,
  ) {
    if (!element) return false;
    try {
      const isBackgroundDispatch =
        !!window.FastTriggerState?.backgroundDispatchInProgress;
      const currentHost = String(window.location?.hostname || "").toLowerCase();
      // Betnacional e BetMGM processam o handler React pelo clique DOM do
      // próprio content script. Tentar CDP nessas casas adicionava o custo de
      // anexar o debugger e, no primeiro disparo após uma página fria, podia
      // devolver OK sem o accordion do cupom reagir.
      const prefersDomClick =
        currentHost.includes("betnacional") || currentHost.includes("betmgm") || currentHost.includes("betano");
      if (typeof element.scrollIntoView === "function") {
        element.scrollIntoView({
          block: "center",
          inline: "center",
          behavior: "instant",
        });
      }

      const nextFrame = () =>
        new Promise((resolve) => {
          if (typeof requestAnimationFrame === "function") {
            requestAnimationFrame(() => resolve());
          } else {
            setTimeout(resolve, 0);
          }
        });
      if (!isBackgroundDispatch && !fastMode) await nextFrame();
      let rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        await nextFrame();
        rect = element.getBoundingClientRect();
      }
      if (!element.isConnected || rect.width <= 0 || rect.height <= 0) {
        return false;
      }
      const targetX = rect.left + rect.width / 2 + (Math.random() * 4 - 2);
      const targetY = rect.top + rect.height / 2 + (Math.random() * 4 - 2);
      const insideViewport =
        targetX >= 0 &&
        targetY >= 0 &&
        targetX < Number(window.innerWidth || 0) &&
        targetY < Number(window.innerHeight || 0);
      const hitTarget = insideViewport
        ? document.elementFromPoint?.(targetX, targetY) || null
        : null;
      const targetOwnsPoint = Boolean(
        hitTarget &&
          (hitTarget === element ||
            element.contains?.(hitTarget) ||
            hitTarget.contains?.(element)),
      );
      if (!targetOwnsPoint) {
        console.error(
          "[Fast Trigger Humanizer Safety] Clique cancelado: a célula alvo não ocupa mais a coordenada validada.",
        );
        return false;
      }

      const startX = lastKnownMousePos.x;
      const startY = lastKnownMousePos.y;
      // 1. Simulação da Trajetória de Aproximação (Mouse Movement ultrarrápido: 4 a 6 pontos max)
      const path =
        isBackgroundDispatch || fastMode
          ? []
          : generateBezierPath(startX, startY, targetX, targetY, 5);

      // Trajetória completa leva NO MÁXIMO 35ms (distribuída em pequenos atrasos por ponto)
      const maxDuration = isHotkey ? 15 : 28; // Duracao max em ms
      const stepDelay =
        path.length > 0
          ? Math.max(1, Math.floor(maxDuration / path.length))
          : 0;

      for (const pt of path) {
        const moveInit = {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: pt.x,
          clientY: pt.y,
          screenX: pt.x + (window.screenX || 0),
          screenY: pt.y + (window.screenY || 0),
        };
        element.dispatchEvent(new MouseEvent("mousemove", moveInit));
        await new Promise((r) => setTimeout(r, stepDelay));
      }

      // Atualiza última posição
      lastKnownMousePos.x = targetX;
      lastKnownMousePos.y = targetY;

      const clickInit = {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: targetX,
        clientY: targetY,
        screenX: targetX + (window.screenX || 0),
        screenY: targetY + (window.screenY || 0),
      };

      element.dispatchEvent(new MouseEvent("mouseenter", clickInit));
      element.dispatchEvent(new MouseEvent("mouseover", clickInit));

      // Jitter ultra-curto (12ms-35ms se Hotkey, 10ms-20ms se manual)
      if (isBackgroundDispatch || fastMode) {
        // A intenção humana já foi validada no painel. Em uma guia executada
        // em segundo plano, timers de trajetória podem ser congelados pelo Chrome.
      } else if (isHotkey) {
        await randomJitter(12, 35, true);
      } else {
        await randomJitter(10, 20, false);
      }

      // 2. Envia o clique físico nativo com isTrusted = true via Chrome DevTools Protocol (CDP).
      // O modo rápido remove apenas as esperas artificiais; a Bet365 ainda
      // precisa do evento confiável para processar a seleção corretamente.
      let cdpSuccess = false;
      if (
        !isBackgroundDispatch &&
        !prefersDomClick &&
        typeof chrome !== "undefined" &&
        chrome.runtime &&
        chrome.runtime.sendMessage
      ) {
        try {
          const res = await new Promise((resolve) => {
            let settled = false;
            const finish = (value) => {
              if (settled) return;
              settled = true;
              clearTimeout(timeoutId);
              resolve(value);
            };
            const timeoutId = setTimeout(
              () => finish({ status: "ERROR", error: "trusted_click_timeout" }),
              fastMode ? 350 : 650,
            );
            chrome.runtime.sendMessage(
              {
                action: "PRODUCE_TRUSTED_CLICK",
                x: targetX,
                y: targetY,
              },
              (response) => {
                if (chrome.runtime.lastError) {
                  finish({
                    status: "ERROR",
                    error: chrome.runtime.lastError.message,
                  });
                  return;
                }
                finish(response);
              },
            );
          });
          if (res && res.status === "OK") {
            cdpSuccess = true;
            console.log(
              `[Fast Trigger Humanizer] ⚡ Clique Nativo (isTrusted=true) executado via CDP em ${res.latencyMs || "<3"}ms!`,
            );
          }
        } catch (err) {}
      }

      // 3. Fallback: Se o CDP não estiver ativo, dispara os eventos de mouse nativos do DOM
      if (!cdpSuccess) {
        try {
          element.dispatchEvent(new PointerEvent("pointerdown", { ...clickInit, pointerId: 1, isPrimary: true, button: 0, buttons: 1 }));
        } catch (_) {}
        element.dispatchEvent(new MouseEvent("mousedown", clickInit));
        try { element.focus?.(); } catch (_) {}
        if (!fastMode) {
          await (isHotkey
            ? randomJitter(12, 35, true)
            : randomJitter(10, 20, false));
        }
        try {
          element.dispatchEvent(new PointerEvent("pointerup", { ...clickInit, pointerId: 1, isPrimary: true, button: 0, buttons: 1 }));
        } catch (_) {}
        element.dispatchEvent(new MouseEvent("mouseup", clickInit));
        if (typeof element.click === "function") {
          element.click();
        } else {
          element.dispatchEvent(new MouseEvent("click", clickInit));
        }
      }
      return true;
    } catch (e) {
      console.error(
        "[Fast Trigger Humanizer Safety] Clique cancelado antes da entrega:",
        e,
      );
      return false;
    }
  }

  /**
   * Inserção de texto humanizada via Keystroke Dynamics com tempo gaussiano entre teclas.
   * @param {Element} inputElement
   * @param {string|number} textValue
   * @param {boolean} isHotkey
   * @returns {Promise<boolean>}
   */
  async function simulateHumanTyping(
    inputElement,
    textValue,
    isHotkey = false,
  ) {
    if (!inputElement) return false;

    try {
      await simulateHumanClick(inputElement, isHotkey);
      inputElement.focus();
      await (isHotkey
        ? randomJitter(12, 35, true)
        : randomJitter(20, 40, false));

      const cleanStr = (textValue || "").toString().replace(/R\$/gi, "").trim();
      inputElement.value = "";

      if (
        document.queryCommandSupported &&
        document.queryCommandSupported("insertText")
      ) {
        document.execCommand("insertText", false, cleanStr);
      } else {
        for (const char of cleanStr) {
          inputElement.dispatchEvent(
            new KeyboardEvent("keydown", { key: char, bubbles: true }),
          );
          inputElement.dispatchEvent(
            new KeyboardEvent("keypress", { key: char, bubbles: true }),
          );
          inputElement.value += char;
          inputElement.dispatchEvent(new Event("input", { bubbles: true }));
          inputElement.dispatchEvent(
            new KeyboardEvent("keyup", { key: char, bubbles: true }),
          );
          await (isHotkey
            ? randomJitter(12, 35, true)
            : randomJitter(15, 35, false));
        }
      }
      inputElement.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    } catch (e) {
      if (inputElement) {
        inputElement.value = (textValue || "").toString();
        inputElement.dispatchEvent(new Event("input", { bubbles: true }));
        inputElement.dispatchEvent(new Event("change", { bubbles: true }));
      }
      return true;
    }
  }

  if (typeof window !== "undefined") {
    window.gaussianRandom = gaussianRandom;
    window.randomJitter = randomJitter;
    window.simulateHumanClick = simulateHumanClick;
    window.simulateHumanTyping = simulateHumanTyping;
  }
})();
