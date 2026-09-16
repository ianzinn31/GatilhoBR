/**
 * GatilhoBR - Guia de Instalação e Boas-Vindas
 * 
 * Filosofia de Design:
 * - Linguagem 100% humana e sem termos técnicos difíceis.
 * - 3 passos claros e rápidos:
 *     1. Onde você vai apostar? (Escolha do Navegador: Google Chrome / Microsoft Edge)
 *     2. Sua Extensão (Verificação automática ou botão de 1 clique para ativar)
 *     3. Tudo Pronto! (Entrar no Painel de Apostas)
 * - Identidade visual oficial GATILHOBR: Dark profundo (#060A12) + Verde (#00E676 / #00C853).
 */

(function () {
  'use strict';

  function getApi() {
    return window.gbrElectron || window.__gbrElectronApi || globalThis.gbrElectron || globalThis.__gbrElectronApi || null;
  }

  // 3 Passos Simples e Diretos
  const SIMPLE_STEPS = [
    {
      id: 'browser',
      stepNum: 1,
      badge: 'PASSO 1 DE 3 • SEU NAVEGADOR',
      title: 'Onde você vai apostar?',
      subtitle: 'O GatilhoBR conecta direto no seu navegador para você apostar em 1 clique com velocidade máxima.',
      btnText: 'Continuar com o Google Chrome →'
    },
    {
      id: 'extension',
      stepNum: 2,
      badge: 'PASSO 2 DE 3 • SUA EXTENSÃO',
      title: 'Conectando sua Extensão',
      subtitle: 'A extensão é o que faz suas apostas serem disparadas no mesmo milissegundo em que você aperta a tecla.',
      btnText: 'Avançar para o Teste Rápido →'
    },
    {
      id: 'ready',
      stepNum: 3,
      badge: 'PASSO 3 DE 3 • TUDO PRONTO',
      title: 'Tudo Pronto para Começar!',
      subtitle: 'Seu aplicativo e seu navegador já estão sincronizados e funcionando perfeitamente.',
      btnText: '🚀 Começar a Usar Agora'
    }
  ];

  let currentStepIndex = 0;
  let selectedBrowser = 'chrome';
  let cachedStatus = null;

  function injectQuizStyles() {
    if (document.getElementById('gbr-quiz-styles')) return;
    const style = document.createElement('style');
    style.id = 'gbr-quiz-styles';
    style.textContent = `
      @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800;900&display=swap');

      .gbr-quiz-backdrop {
        position: fixed;
        inset: 0;
        background: radial-gradient(circle at 50% 20%, rgba(0, 230, 118, 0.16) 0%, rgba(6, 10, 18, 0.97) 65%, #03060B 100%);
        backdrop-filter: blur(28px);
        -webkit-backdrop-filter: blur(28px);
        z-index: 9999999;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
        opacity: 0;
        transition: opacity 0.25s cubic-bezier(0.16, 1, 0.3, 1);
        font-family: 'Plus Jakarta Sans', -apple-system, sans-serif;
      }
      .gbr-quiz-backdrop.active {
        opacity: 1;
      }

      .gbr-quiz-container {
        width: 100%;
        max-width: 680px;
        background: rgba(11, 17, 30, 0.92);
        border: 1px solid rgba(0, 230, 118, 0.35);
        box-shadow: 0 0 60px rgba(0, 230, 118, 0.15), 0 35px 60px -15px rgba(0, 0, 0, 0.95);
        border-radius: 28px;
        overflow: hidden;
        position: relative;
        transform: scale(0.96) translateY(12px);
        transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1);
      }
      .gbr-quiz-backdrop.active .gbr-quiz-container {
        transform: scale(1) translateY(0);
      }

      /* Botão Fechar no Topo */
      .gbr-close-btn {
        position: absolute;
        top: 18px;
        right: 24px;
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(255, 255, 255, 0.12);
        color: #94A3B8;
        padding: 6px 14px;
        border-radius: 9999px;
        font-size: 12px;
        font-weight: 800;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 6px;
        transition: all 0.2s ease;
        z-index: 10;
      }
      .gbr-close-btn:hover {
        background: rgba(255, 255, 255, 0.15);
        color: #FFFFFF;
        border-color: rgba(255, 255, 255, 0.3);
      }

      /* Stepper Luminoso em 3 Barras */
      .gbr-stepper {
        display: flex;
        gap: 8px;
        padding: 24px 130px 12px 36px;
      }
      .gbr-stepper-bar {
        height: 6px;
        flex: 1;
        border-radius: 9999px;
        background: rgba(255, 255, 255, 0.12);
        overflow: hidden;
        transition: all 0.3s ease;
      }
      .gbr-stepper-bar.done {
        background: #00E676;
        box-shadow: 0 0 10px rgba(0, 230, 118, 0.6);
      }
      .gbr-stepper-bar.active {
        background: #00E676;
        box-shadow: 0 0 16px rgba(0, 230, 118, 0.9);
      }

      /* Conteúdo Interno */
      .gbr-slide-body {
        padding: 16px 36px 32px 36px;
        animation: gbrFadeSlide 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards;
      }
      @keyframes gbrFadeSlide {
        from { opacity: 0; transform: translateY(8px); }
        to { opacity: 1; transform: translateY(0); }
      }

      /* Tipografia com Size Marcante */
      .gbr-badge-pill {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 5px 12px;
        border-radius: 9999px;
        background: rgba(0, 230, 118, 0.12);
        border: 1px solid rgba(0, 230, 118, 0.3);
        color: #00E676;
        font-size: 11px;
        font-weight: 800;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        margin-bottom: 12px;
      }
      .gbr-pulse-dot {
        width: 7px;
        height: 7px;
        border-radius: 9999px;
        background: #00E676;
        box-shadow: 0 0 10px #00E676;
        animation: gbrPulse 2s infinite;
      }
      @keyframes gbrPulse {
        0%, 100% { opacity: 1; transform: scale(1); }
        50% { opacity: 0.4; transform: scale(0.85); }
      }

      .gbr-main-title {
        font-size: 26px;
        font-weight: 900;
        color: #FFFFFF;
        letter-spacing: -0.02em;
        line-height: 1.25;
        margin-bottom: 8px;
      }
      .gbr-main-subtitle {
        font-size: 14.5px;
        font-weight: 500;
        color: #94A3B8;
        line-height: 1.5;
        margin-bottom: 24px;
      }

      /* Cards Interativos de Escolha */
      .gbr-options-row {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 14px;
        margin-bottom: 24px;
      }
      .gbr-choice-card {
        background: rgba(15, 23, 42, 0.7);
        border: 2px solid rgba(255, 255, 255, 0.08);
        border-radius: 20px;
        padding: 22px 16px;
        cursor: pointer;
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        gap: 10px;
        transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
      }
      .gbr-choice-card:hover {
        background: rgba(15, 23, 42, 0.95);
        border-color: rgba(0, 230, 118, 0.5);
        transform: translateY(-2px);
      }
      .gbr-choice-card.selected {
        border-color: #00E676;
        background: rgba(0, 230, 118, 0.1);
        box-shadow: 0 0 28px rgba(0, 230, 118, 0.3);
      }
      .gbr-choice-name {
        font-size: 18px;
        font-weight: 800;
        color: #FFFFFF;
      }
      .gbr-choice-tag {
        font-size: 12px;
        font-weight: 800;
        padding: 4px 10px;
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.08);
        color: #94A3B8;
      }
      .gbr-choice-card.selected .gbr-choice-tag {
        background: rgba(0, 230, 118, 0.25);
        color: #00E676;
      }

      /* Card de Status Simplificado */
      .gbr-info-box {
        background: rgba(8, 14, 26, 0.85);
        border: 1px solid rgba(0, 230, 118, 0.35);
        border-radius: 20px;
        padding: 22px 24px;
        margin-bottom: 24px;
        background: linear-gradient(180deg, rgba(0, 230, 118, 0.08) 0%, rgba(8, 14, 26, 0.95) 100%);
      }
      .gbr-info-box.attention {
        border-color: rgba(245, 158, 11, 0.5);
        background: linear-gradient(180deg, rgba(245, 158, 11, 0.08) 0%, rgba(8, 14, 26, 0.95) 100%);
      }
      .gbr-info-row {
        display: flex;
        align-items: center;
        gap: 14px;
        margin-bottom: 12px;
      }
      .gbr-icon-badge {
        width: 38px;
        height: 38px;
        border-radius: 12px;
        background: #00E676;
        color: #040810;
        font-size: 18px;
        font-weight: 900;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }
      .gbr-icon-badge.amber {
        background: #F59E0B;
        color: #040810;
      }
      .gbr-info-headline {
        font-size: 18px;
        font-weight: 900;
        color: #FFFFFF;
      }
      .gbr-info-description {
        font-size: 14px;
        color: #CBD5E1;
        line-height: 1.6;
        padding-left: 52px;
      }

      /* Benefícios da Conclusão */
      .gbr-ready-perks {
        display: flex;
        flex-direction: column;
        gap: 10px;
        margin-top: 14px;
        text-align: left;
      }
      .gbr-perk-item {
        display: flex;
        align-items: center;
        gap: 10px;
        font-size: 14px;
        font-weight: 600;
        color: #E2E8F0;
      }
      .gbr-perk-check {
        color: #00E676;
        font-weight: 900;
        font-size: 16px;
      }

      /* Rodapé e Botões */
      .gbr-footer-actions {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding-top: 14px;
        border-top: 1px solid rgba(255, 255, 255, 0.08);
      }
      .gbr-btn-secondary {
        background: transparent;
        border: 1px solid rgba(255, 255, 255, 0.15);
        color: #94A3B8;
        font-size: 14px;
        font-weight: 700;
        padding: 15px 22px;
        border-radius: 14px;
        cursor: pointer;
        transition: all 0.2s ease;
      }
      .gbr-btn-secondary:hover {
        color: #FFFFFF;
        border-color: rgba(255, 255, 255, 0.3);
      }

      /* Botão Primário Verde */
      .gbr-btn-submit {
        flex: 1;
        background: linear-gradient(135deg, #00E676 0%, #00C853 100%);
        color: #040810;
        font-size: 17px;
        font-weight: 900;
        letter-spacing: 0.01em;
        padding: 17px 26px;
        border-radius: 14px;
        border: none;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        box-shadow: 0 10px 25px -4px rgba(0, 230, 118, 0.5);
        transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
      }
      .gbr-btn-submit:hover {
        transform: translateY(-2px);
        box-shadow: 0 15px 35px -4px rgba(0, 230, 118, 0.65);
        filter: brightness(1.05);
      }
      .gbr-btn-submit:active {
        transform: translateY(0);
      }

      .gbr-btn-inline {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 12px 18px;
        border-radius: 12px;
        background: rgba(0, 230, 118, 0.15);
        border: 1px solid rgba(0, 230, 118, 0.4);
        color: #00E676;
        font-size: 13px;
        font-weight: 800;
        cursor: pointer;
        transition: all 0.2s ease;
      }
      .gbr-btn-inline:hover {
        background: rgba(0, 230, 118, 0.25);
      }
    `;
    document.head.appendChild(style);
  }

  function getStepBarsHTML() {
    return SIMPLE_STEPS.map((s, idx) => {
      let state = 'pending';
      if (idx < currentStepIndex) state = 'done';
      else if (idx === currentStepIndex) state = 'active';
      return `<div class="gbr-stepper-bar ${state}"></div>`;
    }).join('');
  }

  function renderStepContent(step, status) {
    const isChromeAvailable = Boolean(status?.browsers?.chrome);
    const isEdgeAvailable = Boolean(status?.browsers?.edge);
    const ext = status?.detectedExtension;
    const hasExtension = Boolean(ext?.installed || status?.extensionInstalled || status?.extensionActive);

    // PASSO 1: NAVEGADOR
    if (step.id === 'browser') {
      return `
        <div class="gbr-options-row">
          <div class="gbr-choice-card ${selectedBrowser === 'chrome' ? 'selected' : ''}" onclick="window.__gbrPickBrowser('chrome')">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="#00E676" stroke-width="2"/>
              <circle cx="12" cy="12" r="4" fill="#00E676"/>
            </svg>
            <div class="gbr-choice-name">Google Chrome</div>
            <div class="gbr-choice-tag">${isChromeAvailable ? '✓ Instalado no seu PC' : 'Navegador Padrão'}</div>
          </div>
          <div class="gbr-choice-card ${selectedBrowser === 'edge' ? 'selected' : ''}" onclick="window.__gbrPickBrowser('edge')">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="#94A3B8" stroke-width="2"/>
              <circle cx="12" cy="12" r="4" fill="#94A3B8"/>
            </svg>
            <div class="gbr-choice-name">Microsoft Edge</div>
            <div class="gbr-choice-tag">${isEdgeAvailable ? '✓ Disponível' : 'Alternativo'}</div>
          </div>
        </div>
      `;
    }

    // PASSO 2: EXTENSÃO
    if (step.id === 'extension') {
      if (hasExtension) {
        const profileName = ext?.profileName || 'Seu Chrome';
        return `
          <div class="gbr-info-box">
            <div class="gbr-info-row">
              <div class="gbr-icon-badge">✓</div>
              <div class="gbr-info-headline">Extensão Encontrada e Conectada!</div>
            </div>
            <div class="gbr-info-description">
              Detectamos o GatilhoBR ativo no seu perfil: <strong style="color: #00E676;">${profileName}</strong>.<br>
              Você não precisa configurar nada no navegador — está 100% pronto para uso.
            </div>
          </div>
        `;
      } else {
        return `
          <div class="gbr-info-box attention">
            <div class="gbr-info-row">
              <div class="gbr-icon-badge amber">!</div>
              <div class="gbr-info-headline">Extensão Ainda Não Instalada</div>
            </div>
            <div class="gbr-info-description">
              <p style="margin-bottom: 12px; color: #CBD5E1;">
                 Para que suas apostas sejam enviadas em 1 clique e com velocidade máxima, precisamos adicionar a extensão ao seu Google Chrome.
              </p>
              
              <div style="background: rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.08); border-radius: 14px; padding: 14px 16px; margin-bottom: 16px;">
                <div style="font-size: 13px; font-weight: 800; color: #00E676; margin-bottom: 8px;">Como ativar em 2 passos rápidos:</div>
                <div style="font-size: 12.5px; color: #E2E8F0; line-height: 1.65;">
                  1️⃣ Clique no botão verde abaixo para abrir o instalador no Chrome.<br>
                  2️⃣ Na confirmação do navegador, clique em <strong>"Ativar extensão"</strong>.<br>
                  3️⃣ Pronto! O GatilhoBR vai reconhecer a conexão na mesma hora.
                </div>
              </div>

              <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                <button class="gbr-btn-inline" onclick="window.__gbrOpenBrowserExt()" style="background: linear-gradient(135deg, #00E676 0%, #00C853 100%); color: #040810; font-size: 13.5px; padding: 13px 20px; border: none; font-weight: 900; box-shadow: 0 6px 20px rgba(0,230,118,0.45); cursor: pointer;">
                  🌐 Adicionar Extensão ao Chrome Agora
                </button>
                <button class="gbr-btn-inline" onclick="window.__gbrRefreshStatus()" style="cursor: pointer;">
                  🔄 Já ativei no Chrome, verificar agora
                </button>
              </div>
            </div>
          </div>
        `;
      }
    }

    // PASSO 3: TUDO PRONTO
    if (step.id === 'ready') {
      return `
        <div class="gbr-info-box" style="text-align: center; padding: 26px 20px;">
          <div style="font-size: 42px; margin-bottom: 8px;">🚀</div>
          <div style="font-size: 20px; font-weight: 900; color: #FFFFFF; margin-bottom: 8px;">
            Sua estação de apostas está liberada!
          </div>
          <div class="gbr-ready-perks" style="max-width: 440px; margin: 0 auto;">
            <div class="gbr-perk-item">
              <span class="gbr-perk-check">✓</span>
              <span>Disparos instantâneos configurados em menos de 1 segundo</span>
            </div>
            <div class="gbr-perk-item">
              <span class="gbr-perk-check">✓</span>
              <span>Cotações ao vivo sincronizadas direto com seu navegador</span>
            </div>
            <div class="gbr-perk-item">
              <span class="gbr-perk-check">✓</span>
              <span>Atalho F8 e binds rápidos prontos para operar</span>
            </div>
          </div>
        </div>
      `;
    }

    return '';
  }

  function renderModal() {
    let backdrop = document.getElementById('gbr-quiz-backdrop');
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.id = 'gbr-quiz-backdrop';
      backdrop.className = 'gbr-quiz-backdrop';
      document.body.appendChild(backdrop);
    }

    const step = SIMPLE_STEPS[currentStepIndex];
    const isFirstStep = currentStepIndex === 0;

    backdrop.innerHTML = `
      <div class="gbr-quiz-container">
        <!-- Botão Fechar no Topo Direito -->
        <button class="gbr-close-btn" onclick="window.__gbrDismissQuiz()" title="Ir direto para o painel de apostas">
          <span>✕ Fechar</span>
        </button>

        <!-- Stepper Luminoso -->
        <div class="gbr-stepper">
          ${getStepBarsHTML()}
        </div>

        <!-- Slide com Conteúdo Simples -->
        <div class="gbr-slide-body">
          <div class="gbr-badge-pill">
            <span class="gbr-pulse-dot"></span>
            <span>${step.badge}</span>
          </div>

          <div class="gbr-main-title">${step.title}</div>
          <div class="gbr-main-subtitle">${step.subtitle}</div>

          <!-- Conteúdo da Etapa -->
          ${renderStepContent(step, cachedStatus)}

          <!-- Rodapé com Botão Primário Verde -->
          <div class="gbr-footer-actions">
            ${!isFirstStep ? `
              <button class="gbr-btn-secondary" onclick="window.__gbrBackStep()">← Voltar</button>
            ` : ''}
            <button class="gbr-btn-submit" onclick="window.__gbrForwardStep()">
              <span>${step.btnText}</span>
            </button>
          </div>
        </div>
      </div>
    `;

    setTimeout(() => {
      backdrop.classList.add('active');
    }, 10);
  }

  // Ações globais
  window.__gbrPickBrowser = function (b) {
    selectedBrowser = b;
    renderModal();
  };

  window.__gbrBackStep = function () {
    if (currentStepIndex > 0) {
      currentStepIndex--;
      renderModal();
    }
  };

  window.__gbrForwardStep = async function () {
    if (currentStepIndex >= SIMPLE_STEPS.length - 1) {
      window.__gbrDismissQuiz();
      return;
    }
    currentStepIndex++;
    renderModal();
  };

  window.__gbrOpenBrowserExt = async function () {
    const api = getApi();
    if (api?.openExtensionPage) {
      await api.openExtensionPage(selectedBrowser);
    }
  };

  window.__gbrRefreshStatus = async function () {
    const api = getApi();
    if (api?.getInstallationStatus) {
      cachedStatus = await api.getInstallationStatus();
      renderModal();
    }
  };

  window.__gbrDismissQuiz = function () {
    const backdrop = document.getElementById('gbr-quiz-backdrop');
    if (backdrop) {
      backdrop.classList.remove('active');
      setTimeout(() => backdrop.remove(), 250);
    }
    try {
      localStorage.setItem('gbr_onboarding_completed', 'true');
    } catch (_) {}
  };

  // Expõe abertura manual
  window.__gbrOpenOnboarding = function () {
    currentStepIndex = 0;
    loadStatus();
  };

  async function loadStatus() {
    const api = getApi();
    if (api?.getInstallationStatus) {
      try {
        cachedStatus = await api.getInstallationStatus();
        renderModal();
        return;
      } catch (e) {
        console.warn('[GatilhoBR] Erro ao buscar status:', e);
      }
    }
    renderModal();
  }

  // Inicialização
  async function init() {
    injectQuizStyles();

    // Registra listener IPC para gbr:start-onboarding
    const api = getApi();
    if (api?.on) {
      api.on('gbr:start-onboarding', () => {
        window.__gbrOpenOnboarding();
      });
    }

    const params = new URLSearchParams(window.location.search);
    const forceOnboarding = params.get('onboarding') === 'install' ||
      window.location.search.includes('onboarding') ||
      window.location.hash.includes('onboarding') ||
      Boolean(api?.isOnboardingRequested);

    const isCompleted = localStorage.getItem('gbr_onboarding_completed') === 'true';

    // Se for primeiro acesso pós-instalação ou solicitado expressamente:
    if (forceOnboarding) {
      try { localStorage.removeItem('gbr_onboarding_completed'); } catch (_) {}
      loadStatus();
      return;
    }

    if (!isCompleted) {
      loadStatus();
      return;
    }

    // Se já completou, o usuário entra direto no painel
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
