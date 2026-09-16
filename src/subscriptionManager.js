// =========================================================================
// GATILHOBR - GERENCIADOR DE ASSINATURA E PAGAMENTO VIA PIX (EFÍ BANK)
// =========================================================================

let pixRealtimeTimer = null;
let trialTimerInterval = null;

/**
 * Formata um objeto Date ou string ISO no formato brasileiro DD/MM/AAAA.
 * @param {string|Date} dateVal
 * @returns {string}
 */
function formatDateBR(dateVal) {
  if (!dateVal) return 'N/A';
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) return 'N/A';
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

/**
 * Para o cronômetro regressivo de teste de 24h se estiver rodando.
 */
function pararTrialTimer() {
  if (trialTimerInterval) {
    clearInterval(trialTimerInterval);
    trialTimerInterval = null;
  }
}

/**
 * Inicia o cronômetro regressivo em tempo real de 24 horas (exibindo HH:MM:SS).
 * @param {string|Date} trialEndsAt
 */
function startTrialTimer(trialEndsAt) {
  pararTrialTimer();

  const statusTextEl = document.getElementById('subscription-status-text');
  const userLicenseBadge = document.getElementById('userLicenseBadge');

  if (!trialEndsAt) return;
  let expirationTime = new Date(trialEndsAt).getTime();

  // Se a data for inválida ou não informada, considera 24h a partir do momento atual
  if (isNaN(expirationTime)) {
    expirationTime = Date.now() + (24 * 60 * 60 * 1000);
  }

  const updateCountdown = () => {
    const now = Date.now();
    const diff = expirationTime - now;

    if (diff <= 0) {
      pararTrialTimer();
      const expiredMsg = '🔒 Teste Expirado (Renove sua Licença)';
      if (statusTextEl) {
        statusTextEl.textContent = expiredMsg;
        statusTextEl.style.color = '#EF4444';
      }
      if (userLicenseBadge) {
        userLicenseBadge.style.display = 'none';
      }
      return;
    }

    const totalSeconds = Math.floor(diff / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const formattedH = String(hours).padStart(2, '0');
    const formattedM = String(minutes).padStart(2, '0');
    const formattedS = String(seconds).padStart(2, '0');

    const msg = `⏱️ Período de Teste: ${formattedH}h ${formattedM}m ${formattedS}s restantes`;

    if (statusTextEl) {
      statusTextEl.textContent = msg;
      statusTextEl.style.color = '#F59E0B';
    }

    if (userLicenseBadge) {
      userLicenseBadge.textContent = `⏱️ TESTE 24H (${formattedH}:${formattedM}:${formattedS})`;
      userLicenseBadge.style.display = 'inline-flex';
    }
  };

  updateCountdown();
  trialTimerInterval = setInterval(updateCountdown, 1000);
}

/**
 * Atualiza visualmente os textos de status da licença na dashboard.
 * @param {Object} profile
 */
function atualizarStatusLicencaNaTela(profile) {
  const statusTextEl = document.getElementById('subscription-status-text');
  const userLicenseBadge = document.getElementById('userLicenseBadge');

  if (!profile) {
    pararTrialTimer();
    if (statusTextEl) statusTextEl.textContent = '🔒 Nenhuma licença ativa. Faça login.';
    return;
  }

  const role = (profile.role || '').toLowerCase();
  if (role === 'admin' || role === 'dev') {
    pararTrialTimer();
    if (statusTextEl) {
      statusTextEl.textContent = '⚙️ CONTA DEV (Acesso Ilimitado)';
      statusTextEl.style.color = '#38BDF8';
    }
    if (userLicenseBadge) {
      userLicenseBadge.textContent = '⚙️ CONTA DEV (ILIMITADA)';
      userLicenseBadge.style.display = 'inline-flex';
      userLicenseBadge.style.background = '#8B5CF6';
      userLicenseBadge.style.color = '#FFFFFF';
    }
    return;
  }

  if (profile.status === 'active') {
    pararTrialTimer();
    const expiresDate = profile.expires_at || profile.subscription_ends_at || profile.trial_ends_at;
    const formattedDate = formatDateBR(expiresDate);
    const msg = `⚡ Assinatura Ativa (Ativo até: ${formattedDate})`;
    
    if (statusTextEl) {
      statusTextEl.textContent = msg;
      statusTextEl.style.color = '#10B981';
    }
    if (userLicenseBadge) {
      userLicenseBadge.textContent = '⚡ ASSINATURA ATIVA';
      userLicenseBadge.style.display = 'inline-flex';
    }
  } else if (profile.status === 'trial') {
    let trialEnds = profile.trial_ends_at;
    if (!trialEnds && profile.created_at) {
      const createdDate = new Date(profile.created_at);
      trialEnds = new Date(createdDate.getTime() + (24 * 60 * 60 * 1000)).toISOString();
    } else if (trialEnds && profile.created_at) {
      const createdDate = new Date(profile.created_at);
      const trialDate = new Date(trialEnds);
      if (!Number.isNaN(createdDate.getTime()) && !Number.isNaN(trialDate.getTime())) {
        const maxTrialEnd = createdDate.getTime() + (24 * 60 * 60 * 1000);
        trialEnds = new Date(Math.min(trialDate.getTime(), maxTrialEnd)).toISOString();
      }
    }
    startTrialTimer(trialEnds);
  } else {
    pararTrialTimer();
    const msg = '🔒 Assinatura Expirada (Renove para liberar o motor)';
    if (statusTextEl) {
      statusTextEl.textContent = msg;
      statusTextEl.style.color = '#EF4444';
    }
    if (userLicenseBadge) {
      userLicenseBadge.style.display = 'none';
    }
  }
}

/**
 * Abre o modal do Pix com as informações geradas.
 */
function abrirModalPix(qrcode, copiaECola) {
  const modalPix = document.getElementById('modal-pix');
  const pixQrImg = document.getElementById('pix-qr-img');
  const pixCopiaInput = document.getElementById('pix-copia-e-cola');

  if (pixQrImg && qrcode) {
    pixQrImg.src = qrcode.startsWith('data:') || qrcode.startsWith('http')
      ? qrcode
      : `data:image/png;base64,${qrcode}`;
  }

  if (pixCopiaInput && copiaECola) {
    pixCopiaInput.value = copiaECola;
  }

  if (modalPix) {
    modalPix.style.display = 'flex';
  }
}

/**
 * Fecha o modal do Pix e interrompe o polling de verificação.
 */
function fecharModalPix() {
  const modalPix = document.getElementById('modal-pix');
  if (modalPix) {
    modalPix.style.display = 'none';
  }
  pararRealtimeMonitor();
}

/**
 * Interrompe a escuta em tempo real / polling do pagamento.
 */
function pararRealtimeMonitor() {
  if (pixRealtimeTimer) {
    clearInterval(pixRealtimeTimer);
    pixRealtimeTimer = null;
  }
}

/**
 * Inicia a escuta em tempo real / polling de atualização do perfil do usuário.
 * @param {string} userId
 * @param {string} token
 */
function iniciarRealtimeMonitor(userId, token) {
  pararRealtimeMonitor();

  pixRealtimeTimer = setInterval(async () => {
    try {
      const fetchProfileFn = (typeof getUserProfile === 'function') ? getUserProfile : window.getUserProfile;
      if (!fetchProfileFn) return;

      const profile = await fetchProfileFn(token, userId);
      if (profile && profile.status === 'active') {
        fecharModalPix();
        
        const bannerFn = (typeof showAuthStatusBanner === 'function') ? showAuthStatusBanner : window.showAuthStatusBanner;
        if (typeof bannerFn === 'function') {
          bannerFn('info', '🎉 Pagamento confirmado! Sua assinatura foi estendida por +30 dias.');
        }

        atualizarStatusLicencaNaTela(profile);

        if (typeof verifyDashboardLicense === 'function') {
          verifyDashboardLicense();
        }
      }
    } catch (e) {
      console.warn('[SubscriptionManager] Erro no polling do pagamento:', e);
    }
  }, 3000);
}

/**
 * Solicita a geração da cobrança Pix à Edge Function create-pix-charge.
 */
async function gerarCobrancaPix() {
  const btnRenew = document.getElementById('btn-renew-license');
  const btnGenPixModal = document.getElementById('btnGeneratePix');

  const updateButtons = (loading, text) => {
    [btnRenew, btnGenPixModal].forEach(btn => {
      if (btn) {
        btn.disabled = loading;
        btn.textContent = text;
      }
    });
  };

  try {
    updateButtons(true, '⚡ Gerando Pix Seguro...');

    const storageData = await new Promise(r => chrome.storage.local.get(['gbr_auth_token', 'gbr_user_id', 'gbr_user_email'], r));
    const getSessionFn = (typeof getValidGbrAuthSession === 'function')
      ? getValidGbrAuthSession
      : (typeof window !== 'undefined' ? window.getValidGbrAuthSession : null);
    const validSession = getSessionFn ? await getSessionFn(false) : null;
    const token = validSession?.access_token || (storageData ? storageData.gbr_auth_token : null);
    const userId = validSession?.user?.id || (storageData ? storageData.gbr_user_id : null);
    const email = validSession?.user?.email || (storageData ? storageData.gbr_user_email : null);

    if (!token && !userId) {
      alert('Sessão de usuário não identificada. Faça o login na extensão e tente novamente.');
      updateButtons(false, '⚡ Renovar Licença (R$ 50,00 / 30 Dias)');
      return;
    }

    const anonKey = (typeof SUPABASE_ANON_KEY !== 'undefined')
      ? SUPABASE_ANON_KEY
      : (window.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNjbGZrZmdoYnZ1Y2h5dWJja3NyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUxMDg3OTEsImV4cCI6MjEwMDY4NDc5MX0.lSuxt1jQoEX7-pLWwzjyFNhLzIuyqfLOSsUFF0ys4CU');

    const authToken = token || anonKey;

    const response = await fetch('https://sclfkfghbvuchyubcksr.supabase.co/functions/v1/create-pix-charge', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
        'apikey': anonKey
      },
      body: JSON.stringify({
        userId: userId,
        email: email
      })
    });

    const data = await response.json();

    if (!response.ok || data.error) {
      alert(`Falha ao gerar cobrança Pix: ${data.error || 'Erro interno no servidor'}`);
      updateButtons(false, '⚡ Renovar Licença (R$ 50,00 / 30 Dias)');
      return;
    }

    const qrcode = data.qrcode || data.imagemQrcode || '';
    const copiaECola = data.pixCopiaECola || '';

    abrirModalPix(qrcode, copiaECola);
    iniciarRealtimeMonitor(userId, authToken);

    updateButtons(false, '⚡ Renovar Licença (R$ 50,00 / 30 Dias)');

  } catch (err) {
    console.error('[SubscriptionManager] Erro ao gerar Pix:', err);
    alert('Erro de conexão ao gerar o Pix. Verifique sua rede e tente novamente.');
    updateButtons(false, '⚡ Renovar Licença (R$ 50,00 / 30 Dias)');
  }
}

/**
 * Executa a cópia do código Pix Copia e Cola para a área de transferência.
 */
function copiarChavePix() {
  const pixInput = document.getElementById('pix-copia-e-cola') || document.getElementById('pixCopiaEColaInput');
  const btnCopy = document.getElementById('btn-copy-pix') || document.getElementById('btnCopyPixCode');

  if (!pixInput || !pixInput.value) return;

  const codeVal = pixInput.value;
  navigator.clipboard.writeText(codeVal).then(() => {
    if (btnCopy) {
      const origText = btnCopy.textContent;
      btnCopy.textContent = 'Copiado! 🚀';
      btnCopy.style.borderColor = '#10B981';
      btnCopy.style.color = '#10B981';

      setTimeout(() => {
        btnCopy.textContent = origText;
        btnCopy.style.borderColor = '';
        btnCopy.style.color = '';
      }, 1500);
    }
  }).catch(() => {
    pixInput.select();
    document.execCommand('copy');
  });
}

// Exposição global dos métodos de assinatura
if (typeof window !== 'undefined') {
  window.formatDateBR = formatDateBR;
  window.startTrialTimer = startTrialTimer;
  window.pararTrialTimer = pararTrialTimer;
  window.atualizarStatusLicencaNaTela = atualizarStatusLicencaNaTela;
  window.abrirModalPix = abrirModalPix;
  window.fecharModalPix = fecharModalPix;
  window.gerarCobrancaPix = gerarCobrancaPix;
  window.copiarChavePix = copiarChavePix;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    formatDateBR,
    startTrialTimer,
    pararTrialTimer,
    atualizarStatusLicencaNaTela,
    abrirModalPix,
    fecharModalPix,
    gerarCobrancaPix,
    copiarChavePix
  };
}
