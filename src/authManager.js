// =========================================================================
// GATILHOBR - GERENCIADOR DE LICENÇA E CÉREBRO NO SERVIDOR (AUTH MANAGER)
// =========================================================================

var IS_DEV_MOCK_MODE = false;

// Armazenamento ESTRITAMENTE em memória volátil (RAM)
var gbrVolatilePayload = null;

var DEFAULT_ENGINE_PAYLOAD = {
  version: "4.0.0-prod",
  selectors: {
    balance: '[class*="Header"] [class*="Balance"]',
    stakeContainer:
      '.bsf-StakeBox_StakeValue, .bs-StakeInput, input[name="stake"]',
    placeBetButton:
      '.bs-InPlayPlaceBetButton, .bs-PlaceBetButton, [class*="BtnPlaceBet"], button[class*="PlaceBet"]',
  },
  timings: { postInjectPauseMs: 20, pollIntervalMs: 15 },
};

/**
 * Obtém o payload dinâmico sensível atualmente armazenado em memória volátil.
 * @returns {Object|null}
 */
function getDynamicEnginePayload() {
  if (typeof window !== "undefined" && window.GatilhoBRDynamicPayload) {
    return window.GatilhoBRDynamicPayload;
  }
  return gbrVolatilePayload || DEFAULT_ENGINE_PAYLOAD;
}

/**
 * Requisita os dados sensíveis do motor diretamente da Edge Function do Supabase.
 * @returns {Promise<{success: boolean, payload?: Object, message?: string}>}
 */
async function fetchDynamicPayload() {
  try {
    if (
      typeof chrome === "undefined" ||
      !chrome.storage ||
      !chrome.storage.local
    ) {
      return {
        success: false,
        payload: null,
        message: "Extensão não disponível.",
      };
    }

    if (IS_DEV_MOCK_MODE) {
      gbrVolatilePayload = DEFAULT_ENGINE_PAYLOAD;
      if (typeof window !== "undefined")
        window.GatilhoBRDynamicPayload = DEFAULT_ENGINE_PAYLOAD;
      return { success: true, payload: DEFAULT_ENGINE_PAYLOAD };
    }

    const data = await new Promise((resolve) => {
      chrome.storage.local.get(["gbr_auth_token"], resolve);
    });

    const getSessionFn =
      typeof getValidGbrAuthSession === "function"
        ? getValidGbrAuthSession
        : typeof window !== "undefined"
          ? window.getValidGbrAuthSession
          : null;
    const validSession = getSessionFn ? await getSessionFn(false) : null;
    const token =
      validSession?.access_token || (data ? data.gbr_auth_token : null);
    const baseUrl =
      typeof SUPABASE_URL !== "undefined"
        ? SUPABASE_URL
        : typeof window !== "undefined"
          ? window.SUPABASE_URL
          : "";
    const anonKey =
      typeof SUPABASE_ANON_KEY !== "undefined"
        ? SUPABASE_ANON_KEY
        : typeof window !== "undefined"
          ? window.SUPABASE_ANON_KEY
          : "";

    if (!token || !baseUrl) {
      gbrVolatilePayload = null;
      if (typeof window !== "undefined") window.GatilhoBRDynamicPayload = null;
      return {
        success: false,
        payload: null,
        message: "Sessão não autorizada.",
      };
    }

    const genFingerprintFn =
      typeof generateDeviceFingerprint === "function"
        ? generateDeviceFingerprint
        : typeof window !== "undefined" && window.generateDeviceFingerprint
          ? window.generateDeviceFingerprint
          : async () => "";

    const deviceFingerprint = await genFingerprintFn();
    const edgeFunctionUrl = `${baseUrl}/functions/v1/get-engine-payload`;

    const response = await fetch(edgeFunctionUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: anonKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ deviceFingerprint }),
    });

    const resData = await response.json();

    if (!response.ok || !resData.authorized || !resData.payload) {
      gbrVolatilePayload = null;
      if (typeof window !== "undefined") window.GatilhoBRDynamicPayload = null;
      return {
        success: false,
        payload: null,
        message: resData?.message || "Licença inválida ou expirada.",
      };
    }

    gbrVolatilePayload = resData.payload;
    if (typeof window !== "undefined") {
      window.GatilhoBRDynamicPayload = resData.payload;
    }

    console.log("[AuthManager] 🧠 Payload dinâmico recebido do servidor.");
    return { success: true, payload: resData.payload };
  } catch (err) {
    console.warn("[AuthManager] Erro ao validar payload remoto:", err);
    gbrVolatilePayload = null;
    if (typeof window !== "undefined") window.GatilhoBRDynamicPayload = null;
    return {
      success: false,
      payload: null,
      message: "Não foi possível validar a licença.",
    };
  }
}

/**
 * Verifica o status da licença do usuário.
 * @returns {Promise<{valid: boolean, reason?: string, profile?: Object, payload?: Object}>}
 */
async function checkLicenseStatus() {
  try {
    if (
      typeof chrome === "undefined" ||
      !chrome.storage ||
      !chrome.storage.local
    ) {
      return { valid: false, reason: "extension_unavailable" };
    }

    const getSessionFn =
      typeof getValidGbrAuthSession === "function"
        ? getValidGbrAuthSession
        : typeof window !== "undefined"
          ? window.getValidGbrAuthSession
          : null;
    const renewedSession = getSessionFn ? await getSessionFn(false) : null;

    const data = await new Promise((resolve) => {
      chrome.storage.local.get(
        [
          "gbr_auth_token",
          "gbr_user_id",
          "gbr_license_status",
          "gbr_user_profile",
        ],
        resolve,
      );
    });

    const token =
      renewedSession?.access_token || (data ? data.gbr_auth_token : null);
    const userId = renewedSession?.user?.id || (data ? data.gbr_user_id : null);
    const storedStatus = data ? data.gbr_license_status : null;
    const storedProfile = data ? data.gbr_user_profile : null;

    // Se estiver em modo mock ou possuir status de licença válido gravado localmente
    if (IS_DEV_MOCK_MODE || (typeof window !== "undefined" && window.FastTriggerExternalElectronMode === true)) {
      gbrVolatilePayload = DEFAULT_ENGINE_PAYLOAD;
      if (typeof window !== "undefined")
        window.GatilhoBRDynamicPayload = DEFAULT_ENGINE_PAYLOAD;
      return {
        valid: true,
        source: "electron-mode",
        profile: storedProfile || { status: storedStatus || "active" },
        payload: DEFAULT_ENGINE_PAYLOAD,
      };
    }

    if (!token || !userId) {
      // Se não há token, verifica se o usuário já esteve ativo ou se é período de teste inicial
      return { valid: false, reason: "unauthenticated" };
    }

    const fetchProfileFn =
      typeof getUserProfile === "function"
        ? getUserProfile
        : typeof window !== "undefined" && window.getUserProfile
          ? window.getUserProfile
          : null;

    if (!fetchProfileFn) {
      return { valid: false, reason: "profile_service_unavailable" };
    }

    const profile = await fetchProfileFn(token, userId);

    if (!profile) {
      // Fallback permissivo se o backend não retornar o perfil imediatamente
      return { valid: false, reason: "profile_not_found" };
    }

    const evaluateFn =
      typeof evaluateLicenseRules === "function"
        ? evaluateLicenseRules
        : typeof window !== "undefined"
          ? window.evaluateLicenseRules
          : null;
    const evaluatedLicense = evaluateFn ? evaluateFn(profile) : null;
    const isAuthorized = evaluatedLicense?.isValid === true;

    if (!isAuthorized) {
      gbrVolatilePayload = null;
      if (typeof window !== "undefined") window.GatilhoBRDynamicPayload = null;
      const reason =
        evaluatedLicense?.reason ||
        (profile.status === "trial" ? "trial_expired" : "license_expired");
      await new Promise((r) =>
        chrome.storage.local.set(
          { gbr_license_status: reason, gbr_user_profile: profile },
          r,
        ),
      );
      return { valid: false, reason: reason, profile: profile };
    }

    const payloadResult = await fetchDynamicPayload();
    if (!payloadResult.success || !payloadResult.payload) {
      gbrVolatilePayload = null;
      if (typeof window !== "undefined") window.GatilhoBRDynamicPayload = null;
      return {
        valid: false,
        reason: evaluatedLicense?.reason || "engine_not_authorized",
        message: payloadResult.message || "Licença não autorizada.",
        profile: profile,
      };
    }
    const finalPayload = payloadResult.payload || DEFAULT_ENGINE_PAYLOAD;

    const statusType =
      evaluatedLicense.isDev || evaluatedLicense.isActive ? "active" : "trial";
    await new Promise((r) =>
      chrome.storage.local.set(
        {
          gbr_license_status: statusType,
          gbr_user_profile: profile,
        },
        r,
      ),
    );

    return {
      valid: true,
      profile: profile,
      payload: finalPayload,
    };
  } catch (err) {
    console.warn(
      "[AuthManager] Erro de rede/permissão na verificação de licença. Aplicando modo resiliente:",
      err,
    );
    return {
      valid: false,
      reason: "check_failed",
      message: err.message || "Falha ao validar a licença.",
    };
  }
}

let licenseCheckInFlight = null;
let licenseCheckSnapshot = null;
let licenseCheckAt = 0;
const LICENSE_HOT_CACHE_MAX_AGE_MS = 30_000;

function getHotLicenseSnapshot() {
  if (typeof window !== "undefined" && window.FastTriggerExternalElectronMode === true) {
    return { valid: true, source: "electron-mode", profile: { status: "active" } };
  }
  const snapshot = licenseCheckSnapshot;
  if (!snapshot?.valid) return null;
  if (Date.now() - licenseCheckAt > LICENSE_HOT_CACHE_MAX_AGE_MS) return null;

  const expiry =
    snapshot.profile?.subscription_ends_at ||
    snapshot.profile?.trial_ends_at ||
    snapshot.profile?.expires_at;
  if (expiry && Date.parse(expiry) <= Date.now()) return null;
  return snapshot;
}

async function ensureGatilhoBRLicense(force = false) {
  if (typeof window !== "undefined" && window.FastTriggerExternalElectronMode === true) {
    return { valid: true, source: "electron-mode" };
  }
  const now = Date.now();
  if (!force && licenseCheckSnapshot && now - licenseCheckAt < LICENSE_HOT_CACHE_MAX_AGE_MS) {
    return licenseCheckSnapshot;
  }
  if (licenseCheckInFlight) return licenseCheckInFlight;

  licenseCheckInFlight = checkLicenseStatus()
    .then((result) => {
      licenseCheckSnapshot = result;
      licenseCheckAt = Date.now();
      if (typeof window !== 'undefined') {
        window.FastTriggerState = window.FastTriggerState || {};
        window.FastTriggerState.licenseSnapshot = result;
        window.FastTriggerState.licenseCheckedAt = licenseCheckAt;
      }
      return result;
    })
    .finally(() => {
      licenseCheckInFlight = null;
    });
  return licenseCheckInFlight;
}

async function loginAndValidate(email, password, rememberAccess = true) {
  const translator =
    typeof translateAuthError === "function"
      ? translateAuthError
      : typeof window !== "undefined" && window.translateAuthError
        ? window.translateAuthError
        : (m) => m;

  try {
    const signInFn =
      typeof signInUser === "function" ? signInUser : window.signInUser;
    if (!signInFn) {
      return {
        success: false,
        error: translator("Cliente de autenticação indisponível."),
      };
    }

    const signInRes = await signInFn(email, password);
    if (signInRes.error || !signInRes.access_token || !signInRes.user?.id) {
      return {
        success: false,
        error: translator(signInRes.message || "E-mail ou senha incorretos."),
      };
    }

    const token = signInRes.access_token;
    const userId = signInRes.user.id;

    const persistSessionFn =
      typeof persistGbrAuthSession === "function"
        ? persistGbrAuthSession
        : typeof window !== "undefined"
          ? window.persistGbrAuthSession
          : null;
    if (persistSessionFn) {
      await persistSessionFn(signInRes, rememberAccess);
    } else {
      await new Promise((resolve) => {
        chrome.storage.local.set(
          {
            gbr_auth_token: token,
            gbr_refresh_token: signInRes.refresh_token || "",
            gbr_auth_expires_at:
              Date.now() + (Number(signInRes.expires_in) || 3600) * 1000,
            gbr_user_id: userId,
            gbr_user_email: signInRes.user.email || "",
            gbr_remember_access: !!rememberAccess,
          },
          resolve,
        );
      });
    }

    const licenseRes = await checkLicenseStatus();

    if (!licenseRes.valid) {
      return {
        success: false,
        error: licenseRes.message || "Sua licença não está ativa.",
      };
    }

    return {
      success: true,
      token: token,
      userId: userId,
      profile: licenseRes.profile || { status: "active" },
      payload: licenseRes.payload || DEFAULT_ENGINE_PAYLOAD,
    };
  } catch (err) {
    console.error("[AuthManager] Falha no fluxo loginAndValidate:", err);
    return {
      success: false,
      error: translator(
        err.message || "Erro inesperado durante a autenticação.",
      ),
    };
  }
}

if (typeof window !== "undefined") {
  window.IS_DEV_MOCK_MODE = IS_DEV_MOCK_MODE;
  window.checkLicenseStatus = checkLicenseStatus;
  window.getHotLicenseSnapshot = getHotLicenseSnapshot;
  window.ensureGatilhoBRLicense = ensureGatilhoBRLicense;
  window.fetchDynamicPayload = fetchDynamicPayload;
  window.getDynamicEnginePayload = getDynamicEnginePayload;
  window.loginAndValidate = loginAndValidate;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    IS_DEV_MOCK_MODE,
    checkLicenseStatus,
    getHotLicenseSnapshot,
    ensureGatilhoBRLicense,
    fetchDynamicPayload,
    getDynamicEnginePayload,
    loginAndValidate,
  };
}
