// FAST TRIGGER PRO - ESPERA ORIENTADA A ESTADO DO DOM
// =========================================================================

(function () {
  "use strict";

  function waitFor(predicate, options = {}) {
    const timeoutMs = Number.isFinite(options.timeoutMs)
      ? Math.max(0, options.timeoutMs)
      : 1200;
    const intervalMs = Number.isFinite(options.intervalMs)
      ? Math.max(4, options.intervalMs)
      : 8;
    const root = options.root || document;

    return new Promise((resolve) => {
      let settled = false;
      let observer = null;
      let intervalId = null;
      let timeoutId = null;

      const finish = (value) => {
        if (settled) return;
        settled = true;
        if (observer) observer.disconnect();
        if (intervalId) clearInterval(intervalId);
        if (timeoutId) clearTimeout(timeoutId);
        resolve(value || null);
      };

      const check = () => {
        if (settled) return;
        let value = null;
        try {
          value = predicate();
        } catch (error) {
          value = null;
        }
        if (value) finish(value);
      };

      check();
      if (settled) return;

      if (typeof MutationObserver === "function") {
        observer = new MutationObserver(check);
        const observeRoot = root.nodeType === 9 ? root.documentElement || root : root;
        try {
          observer.observe(observeRoot, {
            childList: true,
            subtree: true,
            attributes: true,
            characterData: true,
          });
        } catch (error) {
          observer = null;
        }
      }

      intervalId = setInterval(check, intervalMs);
      timeoutId = setTimeout(() => finish(null), timeoutMs);
    });
  }

  function waitForSignal(predicate, options = {}) {
    const timeoutMs = Number.isFinite(options.timeoutMs)
      ? Math.max(0, options.timeoutMs)
      : 1200;
    const root = options.root || document;
    const eventRoot = root && typeof root.addEventListener === "function"
      ? root
      : document;
    const events = Array.isArray(options.events) && options.events.length > 0
      ? options.events
      : ["input", "change", "focusout"];

    return new Promise((resolve) => {
      let settled = false;
      let observer = null;
      let timeoutId = null;
      let fallbackIntervalId = null;

      const finish = (value) => {
        if (settled) return;
        settled = true;
        if (observer) observer.disconnect();
        events.forEach((eventName) => {
          eventRoot.removeEventListener(eventName, check, true);
        });
        if (timeoutId !== null) clearTimeout(timeoutId);
        if (fallbackIntervalId !== null) clearInterval(fallbackIntervalId);
        resolve(value || null);
      };

      const check = () => {
        if (settled) return;
        let value = null;
        try {
          value = predicate();
        } catch (error) {
          value = null;
        }
        if (value) finish(value);
      };

      check();
      if (settled) return;

      if (typeof MutationObserver === "function") {
        observer = new MutationObserver(check);
        const observeRoot = root.nodeType === 9
          ? root.documentElement || root
          : root;
        try {
          observer.observe(observeRoot, {
            childList: true,
            subtree: true,
            attributes: true,
            characterData: true,
          });
        } catch (error) {
          observer = null;
        }
      }

      events.forEach((eventName) => {
        eventRoot.addEventListener(eventName, check, true);
      });

      // Só usa polling como compatibilidade quando o observador não puder ser
      // criado. Em Chrome moderno o caminho normal é dirigido por eventos.
      if (!observer) fallbackIntervalId = setInterval(check, 50);
      timeoutId = setTimeout(() => {
        check();
        if (!settled) finish(null);
      }, timeoutMs);
    });
  }

  function waitForVisible(selectors, options = {}) {
    const root = options.root || document;
    const selectorList = Array.isArray(selectors) ? selectors : [selectors];

    return waitFor(
      () => {
        for (const selector of selectorList) {
          let candidates = [];
          try {
            candidates = Array.from(root.querySelectorAll(selector));
          } catch (error) {
            continue;
          }

          const visible = candidates.find((element) => {
            if (!element || element.disabled || !element.isConnected) return false;
            const rect = element.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          });
          if (visible) return visible;
        }
        return null;
      },
      { ...options, root },
    );
  }

  if (typeof window !== "undefined") {
    window.FastTriggerDom = { waitFor, waitForSignal, waitForVisible };
  }
})();
