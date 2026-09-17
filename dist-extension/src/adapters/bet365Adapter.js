// =========================================================================
// FAST TRIGGER PRO - ADAPTER BET365 (INTEGRADO AO HUMANIZER UNIVERSAL)
// =========================================================================

(function () {
  'use strict';

  class Bet365Adapter {
    constructor() {
      this.siteName = 'Bet365';
    }

    /**
     * Verifica se o hostname pertence à Bet365.
     * @param {string} hostname 
     * @returns {boolean}
     */
    static isMatchingSite(hostname) {
      if (!hostname) return false;
      const host = hostname.toLowerCase();
      return host.includes('bet365.com') || host.includes('bet365.bet.br') || host.includes('bet365.es');
    }

    /**
     * Executa a raspagem de mercados limpos na Bet365.
     * @param {Element} [root] 
     * @returns {Array}
     */
    scrapeClean(root) {
      if (typeof scrapeBet365Clean === 'function') {
        return scrapeBet365Clean(root);
      }
      return [];
    }

    /**
     * Lê a aposta atualmente selecionada no cupom da Bet365.
     * @returns {string}
     */
    scanBetslip() {
      if (typeof scanActiveBetslip === 'function') {
        return scanActiveBetslip();
      }

      try {
        const betslipTitleEls = document.querySelectorAll(
          '[class*="Selection_Title"], [class*="SelectionName"], [class*="SelectionTitle"], [class*="Header_Title"]'
        );
        const oddsEls = document.querySelectorAll('.bs-Selection_Odds, [class*="OddsValue"]');

        let activeName = '';
        let activeOdds = '';

        if (betslipTitleEls.length > 0 && betslipTitleEls[0].offsetWidth > 0) {
          activeName = betslipTitleEls[0].innerText ? betslipTitleEls[0].innerText.trim() : '';
        }
        if (oddsEls.length > 0 && oddsEls[0].offsetWidth > 0) {
          activeOdds = oddsEls[0].innerText ? oddsEls[0].innerText.trim() : '';
        }
        return activeName ? `${activeName} ${activeOdds ? '(' + activeOdds + ')' : ''}` : '';
      } catch (e) {
        return '';
      }
    }

    /**
     * Seleção do cupom para o caminho `DIRECT_NETWORK`, quando conhecida.
     *
     * A Bet365 não expõe o `selectionId` no DOM do cupom — nem o `scrapeClean`
     * nem o `scanBetslip` conseguem extrair id — então a identidade vem de duas
     * fontes, nesta ordem:
     *   1. O depósito que o resolvedor fez no instante do acionamento da célula
     *      (`FastTriggerState.directOrderSelection`).
     *   2. Segunda tentativa sobre a mesma célula (`retry`), porque o frame do
     *      mercado pode ter chegado nos milissegundos entre o clique e a
     *      confirmação.
     *
     * Sem nenhuma das duas o motor cai para `DOM_UI`, que é o comportamento
     * correto: ordem direta sem id de seleção seria aposta no escuro.
     * @returns {{selectionId: string, odds: (number|null)}|null}
     */
    getDirectOrderSelection() {
      const stored = window.FastTriggerState?.directOrderSelection;
      if (stored && typeof stored.selectionId === 'string' && stored.selectionId !== '') {
        return {
          selectionId: stored.selectionId,
          odds: stored.odds ?? null,
          actionId: stored.actionId || '',
          frameAt: stored.frameAt ?? null,
          source: stored.source || '',
          setAt: stored.setAt,
        };
      }

      const resolver = window.FastTriggerSelectionResolver;
      if (!resolver || typeof resolver.retry !== 'function') return null;
      try {
        const retried = resolver.retry();
        if (!retried || typeof retried.selectionId !== 'string' || retried.selectionId === '') {
          return null;
        }
        return {
          selectionId: retried.selectionId,
          odds: retried.odds ?? null,
          actionId: retried.actionId || '',
          frameAt: retried.frameAt ?? null,
          source: retried.source || '',
          setAt: retried.setAt,
        };
      } catch (error) {
        return null;
      }
    }

    /**
     * Executa o disparo humanizado de confirmação de aposta na Bet365.
     * @param {boolean} [isManualTrigger=false]
     * @returns {Promise<boolean>}
     */
    async triggerPlaceBet(
      isManualTrigger = false,
      isHotkey = false,
      stakeAlreadyPrepared = false,
      explicitStake = null,
    ) {
      try {
        const ensureLicense = (typeof ensureGatilhoBRLicense === 'function')
          ? ensureGatilhoBRLicense
          : (typeof window !== 'undefined' ? window.ensureGatilhoBRLicense : null);
        const hotLicense = typeof window.getHotLicenseSnapshot === 'function'
          ? window.getHotLicenseSnapshot()
          : null;
        const license = hotLicense || (ensureLicense ? await ensureLicense() : null);
        const electronAuthorized = Number(window.FastTriggerState?.electronAuthorizedUntil) > Date.now();
        if (!license?.valid && !electronAuthorized && window.FastTriggerExternalElectronMode !== true) {
          if (typeof showFlashFeedback === 'function') showFlashFeedback('🔒 Assinatura expirada ou não autorizada');
          return false;
        }
        // O adapter prepara a stake; a confirmacao final fica concentrada no
        // motor compartilhado para Bet365 e futuras casas.
        if (explicitStake != null && explicitStake !== '') {
          window.FastTriggerExpectedExecutionStake = explicitStake;
        }
        const stakeVal =
          explicitStake ||
          window.FastTriggerExpectedExecutionStake ||
          (window.FastTriggerConfig && window.FastTriggerConfig.stakeValByHouse && window.FastTriggerConfig.stakeValByHouse.bet365) ||
          (window.FastTriggerConfig ? window.FastTriggerConfig.stakeVal : null) ||
          '0,50';
        let stakeReady = true;

        if (!stakeAlreadyPrepared) {
          if (typeof pollAndFillStake === 'function') {
            stakeReady = await pollAndFillStake(
              10,
              isHotkey || window.FastTriggerState?.backgroundDispatchInProgress === true,
            );
          } else if (typeof fillBet365StakeGen5 === 'function') {
            stakeReady = await fillBet365StakeGen5(
              stakeVal,
              isHotkey || window.FastTriggerState?.backgroundDispatchInProgress === true,
            );
          }
        }

        if (!stakeReady) {
          console.warn('[Bet365 Adapter] Confirmacao cancelada: stake nao validada.');
          return false;
        }

        if (typeof window.triggerPlaceBet === 'function') {
          return await window.triggerPlaceBet(isManualTrigger, isHotkey);
        }

        console.error('[Bet365 Adapter] Motor compartilhado de confirmacao indisponivel.');
        return false;
      } catch (err) {
        console.error('[Bet365 Adapter] Erro no fluxo de confirmacao:', err);
        return false;
      }
    }
  }

  if (typeof window !== 'undefined') {
    window.Bet365Adapter = Bet365Adapter;
  }
})();
