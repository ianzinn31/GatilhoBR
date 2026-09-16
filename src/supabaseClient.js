// =========================================================================
// GATILHOBR - CLIENTE SUPABASE LEVE VIA FETCH NATIVO
// =========================================================================

var SUPABASE_URL = 'https://sclfkfghbvuchyubcksr.supabase.co';
var GBR_LEGACY_USER_DATA_KEYS = [
  'dynamicPlayerBinds', 'favoriteMarketsByHouse', 'playerPriorityRules',
  'gbr_dashboard_preferences', 'gbr_priority_market_keys', 'gbr_max_stake',
  'gbr_quick_stakes', 'gbr_stake_by_house', 'fastTriggerStakeVal', 'stakeVal',
  'autoTriggerDirectBool', 'oneShot', 'autoTrigger', 'autoTriggerDirect',
  'gbr_activity_log', 'fastTriggerHotkey', 'ftQuickPresets'
];

async function clearLegacyGbrUserData() {
  if (typeof chrome === 'undefined' || !chrome.storage) return;
  await Promise.all([
    new Promise(resolve => chrome.storage.local.remove(GBR_LEGACY_USER_DATA_KEYS, resolve)),
    new Promise(resolve => chrome.storage.sync.remove([
      'stakeVal', 'stakeValByHouse', 'autoAcceptOddsBool', 'triggerKeyStr', 'bookmaker',
      'customSelectorStr', 'autoFillStakeBool', 'targetMarketStr', 'showFloatingBtnBool'
    ], resolve)),
  ]);
}
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNjbGZrZmdoYnZ1Y2h5dWJja3NyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUxMDg3OTEsImV4cCI6MjEwMDY4NDc5MX0.lSuxt1jQoEX7-pLWwzjyFNhLzIuyqfLOSsUFF0ys4CU';

/**
 * Mapeia e traduz mensagens de erro brutas da API do Supabase Auth para português amigável.
 * @param {string} errorMessage
 * @returns {string}
 */
function translateAuthError(errorMessage) {
  if (!errorMessage || typeof errorMessage !== 'string') {
    return '❌ Erro de comunicação com o servidor de autenticação.';
  }

  const lower = errorMessage.toLowerCase();

  if (lower.includes('email rate limit exceeded') || lower.includes('rate limit')) {
    return '⏱️ Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.';
  }

  if (lower.includes('user already registered') || lower.includes('already registered') || lower.includes('user_already_exists')) {
    return '⚠️ Este e-mail já possui uma conta cadastrada. Faça login.';
  }

  if (lower.includes('invalid login credentials') || lower.includes('invalid_credentials') || lower.includes('invalid email or password')) {
    return '❌ E-mail ou senha incorretos.';
  }

  if (lower.includes('email not confirmed') || lower.includes('email_not_confirmed')) {
    return '📩 Seu e-mail ainda não foi confirmado. Verifique sua caixa de entrada.';
  }

  if (lower.includes('password should be at least')) {
    return '⚠️ A senha deve conter no mínimo 6 caracteres.';
  }

  if (lower.includes('unable to validate email address') || lower.includes('invalid email')) {
    return '⚠️ Por favor, insira um e-mail válido.';
  }

  // Se a mensagem já contiver um emoji no início, retorna sem alterar
  if (/^[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u.test(errorMessage.trim())) {
    return errorMessage;
  }

  return `❌ ${errorMessage}`;
}

async function claimPendingCaktoPurchase(accessToken, email) {
  if (!accessToken || !email) return null;
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/auth-email-gateway`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        action: 'claim_pending',
        email: String(email).trim().toLowerCase()
      })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.warn('[SupabaseClient] Compra Cakto ainda não vinculada:', result?.error || response.status);
      return null;
    }
    return result;
  } catch (err) {
    // A reconciliação é complementar ao login: uma falha transitória não
    // pode impedir a entrada do usuário. O próximo login tentará novamente.
    console.warn('[SupabaseClient] Falha ao reconciliar compra Cakto:', err);
    return null;
  }
}

/**
 * Realiza o cadastro de usuário via Supabase Auth (/auth/v1/signup).
 * @param {string} email
 * @param {string} password
 * @param {string} deviceFingerprint
 * @returns {Promise<Object>}
 */
async function signUpUser(email, password, deviceFingerprint) {
  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: email,
        password: password,
        data: {
          device_fingerprint: deviceFingerprint
        }
      })
    });

    const data = await response.json();

    if (!response.ok || data.error || data.error_description || data.msg) {
      const rawMsg = data.error_description || data.msg || data.error || 'Erro ao realizar cadastro.';
      return {
        error: true,
        message: translateAuthError(rawMsg)
      };
    }

    const accessToken = data.access_token || data.session?.access_token || null;
    const user = data.user || data;
    const purchaseClaim = accessToken
      ? await claimPendingCaktoPurchase(accessToken, user?.email || email)
      : null;

    return {
      success: true,
      access_token: accessToken,
      refresh_token: data.refresh_token || data.session?.refresh_token || '',
      expires_in: data.expires_in || data.session?.expires_in || 3600,
      expires_at: data.expires_at || data.session?.expires_at || null,
      user: user,
      session: data.session || null,
      purchase_claim: purchaseClaim
    };
  } catch (err) {
    console.error('[SupabaseClient] Erro no cadastro:', err);
    const purchaseClaim = await claimPendingCaktoPurchase(
      data.access_token,
      data.user?.email || email,
    );

    return {
      error: true,
      message: translateAuthError(err.message || 'Falha de conexão com a rede.')
    };
  }
}

/**
 * Realiza o login de usuário via Supabase Auth (/auth/v1/token?grant_type=password).
 * @param {string} email
 * @param {string} password
 * @returns {Promise<Object>}
 */
async function signInUser(email, password) {
  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: email,
        password: password
      })
    });

    const data = await response.json();

    if (!response.ok || data.error || data.error_description || data.msg) {
      const rawMsg = data.error_description || data.msg || data.error || 'E-mail ou senha incorretos.';
      return {
        error: true,
        message: translateAuthError(rawMsg)
      };
    }

    return {
      success: true,
      access_token: data.access_token,
      refresh_token: data.refresh_token || '',
      expires_in: data.expires_in || 3600,
      expires_at: data.expires_at || null,
      token_type: data.token_type || 'bearer',
      user: data.user,
      purchase_claim: purchaseClaim
    };
  } catch (err) {
    console.error('[SupabaseClient] Erro no login:', err);
    return {
      error: true,
      message: translateAuthError(err.message || 'Falha de conexão com a rede.')
    };
  }
}

/**
 * Consulta o perfil do usuário na tabela `profiles` via REST.
 * @param {string} token
 * @param {string} userId
 * @returns {Promise<Object|null>}
 */
const GBR_AUTH_STORAGE_KEYS = [
  'gbr_auth_token',
  'gbr_refresh_token',
  'gbr_auth_expires_at',
  'gbr_user_id',
  'gbr_user_email',
  'gbr_license_status',
  'gbr_user_profile',
  'gbr_license_result'
];
let gbrRefreshInFlight = null;

function getSupabaseExpiryMs(session) {
  const directExpiry = Number(session && session.expires_at);
  if (Number.isFinite(directExpiry) && directExpiry > 0) {
    return directExpiry > 1000000000000 ? directExpiry : directExpiry * 1000;
  }
  const expiresIn = Number(session && session.expires_in);
  return Date.now() + ((Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600) * 1000);
}

async function persistGbrAuthSession(session, rememberAccess = true) {
  if (!session || !session.access_token || !session.user?.id) {
    return { success: false, error: 'Sessão inválida.' };
  }
  if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
    return { success: false, error: 'Armazenamento da extensão indisponível.' };
  }

  const stored = await new Promise(resolve => {
    chrome.storage.local.get(['gbr_refresh_token', 'gbr_user_id'], resolve);
  });
  if (stored.gbr_user_id && stored.gbr_user_id !== session.user.id) {
    await clearLegacyGbrUserData();
  }
  const values = {
    gbr_auth_token: session.access_token,
    gbr_refresh_token: session.refresh_token || stored.gbr_refresh_token || '',
    gbr_auth_expires_at: getSupabaseExpiryMs(session),
    gbr_user_id: session.user.id,
    gbr_user_email: session.user.email || '',
    gbr_remember_access: !!rememberAccess
  };
  await new Promise(resolve => chrome.storage.local.set(values, resolve));
  return { success: true, ...values };
}

async function refreshGbrAuthSession(refreshToken) {
  if (!refreshToken) return { success: false, error: 'Refresh token ausente.' };
  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ refresh_token: refreshToken })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.access_token || !data.user?.id) {
      return {
        success: false,
        invalidRefreshToken: response.status === 400 || response.status === 401,
        error: translateAuthError(data.error_description || data.msg || data.error || 'Não foi possível renovar a sessão.')
      };
    }
    return {
      success: true,
      access_token: data.access_token,
      refresh_token: data.refresh_token || refreshToken,
      expires_in: data.expires_in || 3600,
      expires_at: data.expires_at || null,
      token_type: data.token_type || 'bearer',
      user: data.user
    };
  } catch (error) {
    return { success: false, networkError: true, error: error.message || 'Falha de rede ao renovar a sessão.' };
  }
}

async function getValidGbrAuthSession(forceRefresh = false) {
  if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return null;
  const stored = await new Promise(resolve => {
    chrome.storage.local.get([
      'gbr_auth_token',
      'gbr_refresh_token',
      'gbr_auth_expires_at',
      'gbr_user_id',
      'gbr_user_email',
      'gbr_remember_access'
    ], resolve);
  });

  if (!stored.gbr_auth_token || !stored.gbr_user_id) return null;
  const expiresAt = Number(stored.gbr_auth_expires_at || 0);
  const shouldRefresh = forceRefresh || !expiresAt || expiresAt <= Date.now() + 60000;
  if (!shouldRefresh) {
    return {
      access_token: stored.gbr_auth_token,
      refresh_token: stored.gbr_refresh_token || '',
      expires_at: expiresAt,
      user: { id: stored.gbr_user_id, email: stored.gbr_user_email || '' }
    };
  }

  if (!stored.gbr_refresh_token) {
    return expiresAt > Date.now()
      ? {
          access_token: stored.gbr_auth_token,
          refresh_token: '',
          expires_at: expiresAt,
          user: { id: stored.gbr_user_id, email: stored.gbr_user_email || '' }
        }
      : null;
  }

  if (!gbrRefreshInFlight) {
    gbrRefreshInFlight = refreshGbrAuthSession(stored.gbr_refresh_token)
      .finally(() => {
        gbrRefreshInFlight = null;
      });
  }
  const refreshed = await gbrRefreshInFlight;
  if (!refreshed.success) {
    if (refreshed.invalidRefreshToken) {
      const latest = await new Promise(resolve => {
        chrome.storage.local.get([
          'gbr_auth_token',
          'gbr_refresh_token',
          'gbr_auth_expires_at',
          'gbr_user_id',
          'gbr_user_email'
        ], resolve);
      });
      if (
        latest.gbr_auth_token &&
        latest.gbr_refresh_token &&
        latest.gbr_refresh_token !== stored.gbr_refresh_token &&
        Number(latest.gbr_auth_expires_at || 0) > Date.now()
      ) {
        return {
          access_token: latest.gbr_auth_token,
          refresh_token: latest.gbr_refresh_token,
          expires_at: Number(latest.gbr_auth_expires_at),
          user: { id: latest.gbr_user_id, email: latest.gbr_user_email || '' }
        };
      }
      await new Promise(resolve => chrome.storage.local.remove(GBR_AUTH_STORAGE_KEYS, resolve));
    }
    return null;
  }

  await persistGbrAuthSession(refreshed, stored.gbr_remember_access === true);
  return {
    access_token: refreshed.access_token,
    refresh_token: refreshed.refresh_token,
    expires_at: getSupabaseExpiryMs(refreshed),
    user: refreshed.user
  };
}

async function clearGbrAuthSession() {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    await new Promise(resolve => chrome.storage.local.remove(GBR_AUTH_STORAGE_KEYS, resolve));
  }
}

async function getUserProfile(token, userId) {
  try {
    const requestProfile = (accessToken, targetUserId) =>
      fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${targetUserId}`, {
        method: 'GET',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });

    let activeToken = token;
    let activeUserId = userId;
    let response = await requestProfile(activeToken, activeUserId);

    // Uma aba que atravessou a noite pode manter um access token cuja data
    // local ainda parece válida, embora o Supabase já o rejeite. Repara a
    // sessão uma única vez e repete a própria consulta antes de declarar a
    // licença inválida. Refresh inválido continua falhando fechado e limpa a
    // sessão pelo contrato de getValidGbrAuthSession().
    if (response.status === 401) {
      const getSessionFn =
        typeof getValidGbrAuthSession === 'function'
          ? getValidGbrAuthSession
          : typeof window !== 'undefined'
            ? window.getValidGbrAuthSession
            : null;
      const refreshedSession = getSessionFn ? await getSessionFn(true) : null;
      const refreshedToken = refreshedSession?.access_token || '';
      const refreshedUserId = refreshedSession?.user?.id || activeUserId;
      if (refreshedToken && refreshedToken !== activeToken) {
        activeToken = refreshedToken;
        activeUserId = refreshedUserId;
        response = await requestProfile(activeToken, activeUserId);
      }
    }

    if (!response.ok) {
      console.warn('[SupabaseClient] Falha HTTP na consulta de perfil:', response.status);
      return null;
    }

    const data = await response.json();
    if (!Array.isArray(data) || data.length === 0) {
      return null;
    }

    return data[0];
  } catch (err) {
    console.warn('[SupabaseClient] Perfil não localizado:', err.message || err);
    return null;
  }
}

/**
 * Gera uma string hash única combinando navigator.userAgent, resolução da tela e ID da extensão.
 * @returns {Promise<string>}
 */
async function generateDeviceFingerprint() {
  try {
    const ua = navigator.userAgent || '';
    const screenRes = `${window.screen?.width || 0}x${window.screen?.height || 0}x${window.screen?.colorDepth || 0}`;
    const extId = (typeof chrome !== 'undefined' && chrome.runtime?.id) ? chrome.runtime.id : 'gatilhobr_ext';
    const rawString = `${ua}|${screenRes}|${extId}`;

    if (typeof crypto !== 'undefined' && crypto.subtle && typeof TextEncoder !== 'undefined') {
      const msgBuffer = new TextEncoder().encode(rawString);
      const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    let hash = 0;
    for (let i = 0; i < rawString.length; i++) {
      const char = rawString.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }
    return 'fp_' + Math.abs(hash).toString(16);
  } catch (e) {
    return 'fp_fallback_' + Date.now();
  }
}

/**
 * Reenvia o e-mail de confirmação de cadastro via Supabase Auth (/auth/v1/resend).
 * @param {string} email
 * @returns {Promise<{success?: boolean, error?: boolean, message?: string}>}
 */
async function resendConfirmationEmail(email) {
  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/resend`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        type: 'signup',
        email: email
      })
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok || data.error || data.error_description || data.msg) {
      const rawMsg = data.error_description || data.msg || data.error || 'Erro ao reenviar e-mail de confirmação.';
      return {
        error: true,
        message: translateAuthError(rawMsg)
      };
    }

    return { success: true };
  } catch (err) {
    console.error('[SupabaseClient] Erro ao reenviar e-mail:', err);
    return { error: true, message: translateAuthError(err.message || 'Falha de conexão com a rede.') };
  }
}

/**
 * Força o encerramento limpo da sessão local e revoga tokens ativos.
 * @returns {Promise<void>}
 */
async function signOutUser() {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.clear();
    }
    await clearLegacyGbrUserData();
    await clearGbrAuthSession();
  } catch (err) {
    console.warn('[SupabaseClient] Aviso no signOutUser:', err);
  }
}

// Objeto cliente Supabase leve e compatível para escopo global
const supabaseCompatClient = {
  from(table) {
    return {
      select(columns = '*') {
        return {
          eq(column, value) {
            return {
              async single() {
                try {
                  const validSession = await getValidGbrAuthSession(false);
                  const storage = (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local)
                    ? await new Promise(r => chrome.storage.local.get(['gbr_auth_token'], r))
                    : {};
                  const token = validSession?.access_token || storage.gbr_auth_token || '';

                  const headers = {
                    'apikey': SUPABASE_ANON_KEY,
                    'Content-Type': 'application/json'
                  };
                  if (token) headers['Authorization'] = `Bearer ${token}`;

                  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${column}=eq.${value}&select=${columns}`, {
                    method: 'GET',
                    headers: headers
                  });

                  if (!res.ok) {
                    return { data: null, error: { message: `HTTP ${res.status}` } };
                  }

                  const data = await res.json();
                  if (Array.isArray(data) && data.length > 0) {
                    return { data: data[0], error: null };
                  }
                  return { data: null, error: { message: 'Registro não encontrado' } };
                } catch (err) {
                  return { data: null, error: err };
                }
              }
            };
          }
        };
      }
    };
  },
  auth: {
    async getSession() {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        const validSession = await getValidGbrAuthSession(false);
        if (validSession) {
          return { data: { session: validSession }, error: null };
        }
        const stored = await new Promise(r => chrome.storage.local.get(['gbr_user_id', 'gbr_auth_token'], r));
        if (stored && stored.gbr_user_id) {
          return {
            data: {
              session: {
                user: { id: stored.gbr_user_id },
                access_token: stored.gbr_auth_token
              }
            },
            error: null
          };
        }
      }
      return { data: { session: null }, error: null };
    }
  }
};

// Exposição para escopo global no navegador / extensões Web V3
if (typeof window !== 'undefined') {
  window.SUPABASE_URL = SUPABASE_URL;
  window.SUPABASE_ANON_KEY = SUPABASE_ANON_KEY;
  window.translateAuthError = translateAuthError;
  window.signUpUser = signUpUser;
  window.signInUser = signInUser;
  window.persistGbrAuthSession = persistGbrAuthSession;
  window.refreshGbrAuthSession = refreshGbrAuthSession;
  window.getValidGbrAuthSession = getValidGbrAuthSession;
  window.clearGbrAuthSession = clearGbrAuthSession;
  window.getUserProfile = getUserProfile;
  window.generateDeviceFingerprint = generateDeviceFingerprint;
  window.resendConfirmationEmail = resendConfirmationEmail;
  window.signOutUser = signOutUser;
  window.supabase = window.supabase || supabaseCompatClient;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    translateAuthError,
    signUpUser,
    signInUser,
    persistGbrAuthSession,
    refreshGbrAuthSession,
    getValidGbrAuthSession,
    clearGbrAuthSession,
    getUserProfile,
    generateDeviceFingerprint,
    resendConfirmationEmail,
    signOutUser
  };
}
