// =========================================================================
// FAST TRIGGER PRO - MOTOR DE LICENCIAMENTO E VALIDAÇÃO SEGURA VIA SUPABASE
// =========================================================================

/**
 * Avalia as regras de liberação de acesso da licença do usuário.
 * @param {Object} profile - Dados do perfil vindos do Supabase ('profiles')
 * @returns {Object} { isValid, isDev, isTrial, isActive, timeRemaining, reason, message, profile }
 */
function evaluateLicenseRules(profile) {
  if (!profile) {
    return {
      isValid: false,
      reason: 'PROFILE_NOT_FOUND',
      message: 'Perfil de usuário não localizado.',
      profile: null
    };
  }

  const role = (profile.role || '').toLowerCase();
  const status = (profile.status || '').toLowerCase();
  const now = new Date();

  // 1. REGRA DE DESENVOLVEDOR / ADMIN (Acesso Ilimitado)
  if (role === 'admin' || role === 'dev') {
    return {
      isValid: true,
      isDev: true,
      role: role,
      message: '⚙️ CONTA DEV (ILIMITADA)',
      profile: profile
    };
  }

  // 2. REGRA DE ASSINATURA ATIVA (Status 'active')
  if (status === 'active') {
    const subEndsAt = profile.subscription_ends_at || profile.expires_at;
    const subEndsDate = subEndsAt ? new Date(subEndsAt) : null;

    // Conta comum só fica ativa enquanto o backend informar um prazo válido.
    // Status "active" sem data não pode virar acesso permanente por acidente.
    if (subEndsDate && !Number.isNaN(subEndsDate.getTime()) && subEndsDate > now) {
      return {
        isValid: true,
        isActive: true,
        isDev: false,
        isTrial: false,
        expiresAt: subEndsAt,
        message: '⚡ Assinatura Ativa',
        profile: profile
      };
    }

    return {
      isValid: false,
      isDev: false,
      reason: 'SUBSCRIPTION_EXPIRED',
      message: '🔒 Assinatura Expirada',
      profile: profile
    };
  }

  // 3. REGRA DE PERÍODO DE TESTE (Status 'trial')
  if (status === 'trial') {
    let trialEndsAt = profile.trial_ends_at;

    // O limite máximo sempre é 24h após a criação, mesmo que um registro antigo
    // tenha recebido acidentalmente uma data futura maior.
    if (profile.created_at) {
      const createdDate = new Date(profile.created_at);
      if (!Number.isNaN(createdDate.getTime())) {
        const maxTrialEnd = createdDate.getTime() + (24 * 60 * 60 * 1000);
        const parsedTrialEnd = trialEndsAt ? new Date(trialEndsAt).getTime() : Number.POSITIVE_INFINITY;
        const currentTrialEnd = Number.isFinite(parsedTrialEnd) ? parsedTrialEnd : Number.POSITIVE_INFINITY;
        trialEndsAt = new Date(Math.min(currentTrialEnd, maxTrialEnd)).toISOString();
      }
    }

    if (trialEndsAt) {
      const trialEndDate = new Date(trialEndsAt);
      const diffMs = trialEndDate.getTime() - now.getTime();

      if (diffMs > 0) {
        const totalSeconds = Math.floor(diffMs / 1000);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;

        const timeRemaining = {
          totalMs: diffMs,
          hours,
          minutes,
          seconds,
          formatted: `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
        };

        return {
          isValid: true,
          isTrial: true,
          isDev: false,
          trialEndsAt: trialEndsAt,
          timeRemaining: timeRemaining,
          message: `⏱️ Teste 24h Ativo (${timeRemaining.formatted})`,
          profile: profile
        };
      }
    }

    return {
      isValid: false,
      isDev: false,
      isTrial: true,
      reason: 'TRIAL_EXPIRED',
      message: '🔒 Período de Teste Expirado',
      profile: profile
    };
  }

  // 4. QUALQUER OUTRO STATUS / BLOQUEIO
  return {
    isValid: false,
    isDev: false,
    reason: 'INACTIVE_LICENSE',
    message: '🔒 Licença Inativa ou Expirada',
    profile: profile
  };
}

/**
 * Consulta a licença do usuário de forma 100% segura via Supabase client.
 * @param {string} [userId] - ID do usuário. Se não informado, recupera da sessão do Supabase ou storage local.
 * @returns {Promise<Object>} Resultado da validação
 */
async function checkUserLicenseSecure(userId) {
  try {
    let targetUserId = userId;
    let token = '';

    const getSessionFn = (typeof getValidGbrAuthSession === 'function')
      ? getValidGbrAuthSession
      : (typeof window !== 'undefined' ? window.getValidGbrAuthSession : null);
    const renewedSession = getSessionFn ? await getSessionFn(false) : null;
    if (renewedSession) {
      if (!targetUserId) targetUserId = renewedSession.user?.id;
      token = renewedSession.access_token || '';
    }

    // 1. Tenta recuperar o userId e o token do chrome.storage.local
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      const stored = await new Promise(r => chrome.storage.local.get(['gbr_user_id', 'gbr_auth_token'], r));
      if (stored) {
        if (!targetUserId) targetUserId = stored.gbr_user_id;
        token = token || stored.gbr_auth_token || '';
      }
    }

    // 2. Tenta recuperar da sessão ativa do Supabase client se disponível
    const client = (typeof supabase !== 'undefined' ? supabase : (typeof window !== 'undefined' ? window.supabase : null));
    if (!targetUserId && client && client.auth && typeof client.auth.getSession === 'function') {
      try {
        const { data: sessionData } = await client.auth.getSession();
        if (sessionData && sessionData.session && sessionData.session.user) {
          targetUserId = sessionData.session.user.id;
          token = token || sessionData.session.access_token;
        }
      } catch (e) {}
    }

    if (!targetUserId) {
      return {
        isValid: false,
        reason: 'USER_NOT_AUTHENTICATED',
        message: '🔑 Usuário não autenticado.',
        profile: null
      };
    }

    // 3. Tenta primeiro através da API do cliente Supabase (caso .from exista)
    if (client && typeof client.from === 'function') {
      try {
        const { data, error } = await client
          .from('profiles')
          .select('id, email, role, status, trial_ends_at, subscription_ends_at, created_at')
          .eq('id', targetUserId)
          .single();

        if (!error && data) {
          const result = evaluateLicenseRules(data);
          if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            chrome.storage.local.set({
              gbr_user_profile: data,
              gbr_license_result: result,
              gbr_license_status: result.isValid ? 'valid' : 'invalid'
            }).catch(() => {});
          }
          return result;
        }
      } catch (e) {
        console.warn('[LicensingEngine] Falha na consulta via client objeto, alternando para fetch REST:', e);
      }
    }

    // 4. Consulta REST direta via fetch nativo (fallback de altíssima confiabilidade)
    const baseUrl = (typeof SUPABASE_URL !== 'undefined' ? SUPABASE_URL : (window.SUPABASE_URL || 'https://sclfkfghbvuchyubcksr.supabase.co'));
    const apiKey = (typeof SUPABASE_ANON_KEY !== 'undefined' ? SUPABASE_ANON_KEY : (window.SUPABASE_ANON_KEY || ''));

    const headers = {
      'apikey': apiKey,
      'Content-Type': 'application/json'
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${baseUrl}/rest/v1/profiles?id=eq.${targetUserId}&select=id,email,role,status,trial_ends_at,subscription_ends_at,created_at`, {
      method: 'GET',
      headers: headers
    });

    if (!response.ok) {
      console.warn('[LicensingEngine] HTTP status de erro na consulta REST:', response.status);
      return {
        isValid: false,
        reason: 'PROFILE_NOT_FOUND',
        message: 'Perfil de licença não localizado no servidor.',
        profile: null
      };
    }

    const profilesArr = await response.json();
    if (!Array.isArray(profilesArr) || profilesArr.length === 0) {
      return {
        isValid: false,
        reason: 'PROFILE_NOT_FOUND',
        message: 'Perfil de licença não encontrado.',
        profile: null
      };
    }

    const data = profilesArr[0];
    const result = evaluateLicenseRules(data);

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({
        gbr_user_profile: data,
        gbr_license_result: result,
        gbr_license_status: result.isValid ? 'valid' : 'invalid'
      }).catch(() => {});
    }

    return result;
  } catch (err) {
    console.error('[LicensingEngine] Erro ao verificar licença segura:', err);
    return {
      isValid: false,
      reason: 'CHECK_FAILED',
      message: err.message || 'Erro inesperado na verificação da licença.',
      profile: null
    };
  }
}

// Exportações globais
if (typeof window !== 'undefined') {
  window.evaluateLicenseRules = evaluateLicenseRules;
  window.checkUserLicenseSecure = checkUserLicenseSecure;
}
