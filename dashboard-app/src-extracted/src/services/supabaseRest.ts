const SUPABASE_URL = "https://sclfkfghbvuchyubcksr.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNjbGZrZmdoYnZ1Y2h5dWJja3NyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUxMDg3OTEsImV4cCI6MjEwMDY4NDc5MX0.lSuxt1jQoEX7-pLWwzjyFNhLzIuyqfLOSsUFF0ys4CU";

const AUTH_KEYS = [
  "gbr_auth_token",
  "gbr_refresh_token",
  "gbr_auth_expires_at",
  "gbr_user_id",
  "gbr_user_email",
  "gbr_license_status",
  "gbr_user_profile",
  "gbr_license_result",
] as const;

const LEGACY_USER_DATA_KEYS = [
  "dynamicPlayerBinds",
  "favoriteMarketsByHouse",
  "playerPriorityRules",
  "gbr_player_priorities_updated_at",
  "gbr_dashboard_preferences",
  "gbr_priority_market_keys",
  "gbr_max_stake",
  "gbr_quick_stakes",
  "gbr_stake_by_house",
  "gbr_stake_updated_at",
  "fastTriggerStakeVal",
  "stakeVal",
  "autoTriggerDirectBool",
  "oneShot",
  "autoTrigger",
  "autoTriggerDirect",
  "gbr_activity_log",
  "fastTriggerHotkey",
  "ftQuickPresets",
] as const;

type StoredSession = {
  gbr_auth_token?: string;
  gbr_refresh_token?: string;
  gbr_auth_expires_at?: number;
  gbr_user_id?: string;
  gbr_user_email?: string;
  gbr_remember_access?: boolean;
  gbr_user_profile?: AuthProfile;
  gbr_license_status?: string;
};

type SupabaseAuthResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  expires_at?: number;
  user?: { id: string; email?: string; email_confirmed_at?: string | null };
  session?: SupabaseAuthResponse | null;
  error?: string;
  error_description?: string;
  msg?: string;
  code?: string;
};

export type AuthProfile = {
  id: string;
  email: string;
  status: string;
  role: string;
  trial_ends_at?: string | null;
  subscription_ends_at?: string | null;
  [key: string]: unknown;
};

export type AuthSummary = {
  accessToken: string;
  userId: string;
  email: string;
  profile: AuthProfile;
};

type ExtensionChrome = {
  runtime?: { id?: string; getURL?: (path: string) => string };
  storage?: {
    local?: {
      get(keys: string[] | Record<string, unknown>, callback: (value: unknown) => void): void;
      set(value: Record<string, unknown>, callback: () => void): void;
      remove(keys: readonly string[] | string[], callback: () => void): void;
    };
    sync?: {
      remove(keys: readonly string[] | string[], callback: () => void): void;
    };
  };
};

const extensionChrome = (globalThis as typeof globalThis & { chrome?: ExtensionChrome }).chrome;
let refreshInFlight: Promise<AuthSummary | null> | null = null;
let authSummaryInFlight: Promise<AuthSummary | null> | null = null;
type StoredSessionSummary = {
  accessToken: string;
  userId: string;
  email: string;
};
let storedSessionInFlight: Promise<StoredSessionSummary | null> | null = null;
let storedSessionCache: {
  value: StoredSessionSummary | null;
  expiresAt: number;
} | null = null;
const STORED_SESSION_CACHE_MS = 2_000;
type AuthRedirectType = "confirmation" | "recovery";
let authRedirectType: AuthRedirectType | null = null;
let pendingAuthHash = "";
let authRedirectBootstrap: Promise<void> | null = null;

const configuredAuthRedirectUrl = String(import.meta.env.VITE_AUTH_REDIRECT_URL || "").trim();

export function getAuthRedirectUrl(type: AuthRedirectType) {
  const extensionUrl = extensionChrome?.runtime?.getURL?.("dashboard-app/dist/index.html");
  const browserUrl = typeof window !== "undefined" ? window.location.href : `${SUPABASE_URL}/`;
  const url = new URL(extensionUrl || configuredAuthRedirectUrl || browserUrl);
  url.searchParams.set("auth", type);
  url.hash = "";
  return url.toString();
}

function clearAuthRedirectLocation() {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.delete("auth");
  url.hash = "";
  window.history.replaceState({}, document.title, `${url.pathname}${url.search}`);
}

export function prepareAuthRedirect() {
  if (typeof window === "undefined") return;
  const hash = window.location.hash;
  if (!hash || (!hash.includes("access_token=") && !hash.includes("error_code="))) return;
  pendingAuthHash = hash;
  const url = new URL(window.location.href);
  url.hash = "";
  window.history.replaceState({}, document.title, `${url.pathname}${url.search}`);
}

export function getAuthRedirectType() {
  return authRedirectType;
}

export function clearAuthRedirectState() {
  authRedirectType = null;
  pendingAuthHash = "";
  authRedirectBootstrap = null;
  clearAuthRedirectLocation();
}

export async function bootstrapAuthRedirect() {
  if (authRedirectBootstrap) return authRedirectBootstrap;
  authRedirectBootstrap = (async () => {
    if (typeof window === "undefined") return;
    const hash = pendingAuthHash || window.location.hash;
    if (!hash) return;

    const params = new URLSearchParams(hash.replace(/^#/, ""));
    const authType = params.get("type");
    authRedirectType = authType === "recovery" ? "recovery" : "confirmation";
    const errorDescription = params.get("error_description") || params.get("error_code");
    if (errorDescription) {
      clearAuthRedirectLocation();
      throw new Error(errorDescription.replace(/\+/g, " "));
    }

    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    if (!accessToken || !refreshToken) return;

    const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${accessToken}`,
      },
    });
    const user = await parseResponse(response);
    if (!response.ok || !user?.id) {
      clearAuthRedirectLocation();
      throw new Error(authError(user, "NÃ£o foi possÃ­vel validar o link de autenticaÃ§Ã£o."));
    }

    await persistSession(
      {
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_in: Number(params.get("expires_in") || 3600),
        user,
      },
      true,
    );
    pendingAuthHash = "";
    clearAuthRedirectLocation();
  })().finally(() => {
    authRedirectBootstrap = null;
  });
  return authRedirectBootstrap;
}

function storageGet<T extends object>(keys: string[] | Record<string, unknown>): Promise<T> {
  if (!extensionChrome?.storage?.local) return Promise.resolve({} as T);
  return new Promise((resolve) =>
    extensionChrome.storage!.local!.get(keys, (value: unknown) => resolve(value as T)),
  );
}

function storageSet(value: Record<string, unknown>): Promise<void> {
  if (!extensionChrome?.storage?.local) return Promise.resolve();
  return new Promise((resolve) => extensionChrome.storage!.local!.set(value, resolve));
}

function storageRemove(keys: readonly string[]): Promise<void> {
  if (!extensionChrome?.storage?.local) return Promise.resolve();
  return new Promise((resolve) => extensionChrome.storage!.local!.remove([...keys], resolve));
}

function storageSyncRemove(keys: readonly string[]): Promise<void> {
  if (!extensionChrome?.storage?.sync) return Promise.resolve();
  return new Promise((resolve) => extensionChrome.storage!.sync!.remove([...keys], resolve));
}

function invalidateStoredSessionCache() {
  storedSessionCache = null;
}

async function clearLegacyUserData() {
  await Promise.all([
    storageRemove(LEGACY_USER_DATA_KEYS),
    storageSyncRemove([
      "stakeVal",
      "stakeValByHouse",
      "autoAcceptOddsBool",
      "triggerKeyStr",
      "bookmaker",
      "customSelectorStr",
      "autoFillStakeBool",
      "targetMarketStr",
      "showFloatingBtnBool",
    ]),
  ]);
}

async function parseResponse(response: Response) {
  const raw = await response.text();
  let data: any = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = raw;
  }
  return data;
}

function authError(data: SupabaseAuthResponse | null, fallback: string) {
  const raw = String(data?.error_description || data?.msg || data?.error || fallback);
  const normalized = raw.toLowerCase();
  if (normalized.includes("invalid login credentials")) return "E-mail ou senha incorretos.";
  if (normalized.includes("email not confirmed")) return "Confirme seu e-mail antes de entrar.";
  if (normalized.includes("user already registered")) return "Este e-mail já possui uma conta.";
  if (normalized.includes("password should be at least"))
    return "A senha deve ter pelo menos 6 caracteres.";
  if (normalized.includes("rate limit"))
    return "Muitas tentativas. Aguarde alguns minutos e tente novamente.";
  if (normalized.includes("invalid email")) return "Digite um endereço de e-mail válido.";
  return raw;
}

async function generateDeviceFingerprint() {
  const source = [
    navigator.userAgent || "",
    `${screen.width || 0}x${screen.height || 0}x${screen.colorDepth || 0}`,
    extensionChrome?.runtime?.id || "gatilhobr",
  ].join("|");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

async function persistSession(data: SupabaseAuthResponse, rememberAccess: boolean) {
  const session = data.session || data;
  const previous = await storageGet<{ gbr_user_id?: string }>(["gbr_user_id"]);
  if (previous.gbr_user_id && previous.gbr_user_id !== session.user?.id) {
    await clearLegacyUserData();
  }
  if (!session.access_token || !session.user?.id) throw new Error("Sessão retornada é inválida.");
  const expiresAt = session.expires_at
    ? Number(session.expires_at) * (Number(session.expires_at) < 1e12 ? 1000 : 1)
    : Date.now() + Number(session.expires_in || 3600) * 1000;
  await storageSet({
    gbr_auth_token: session.access_token,
    gbr_refresh_token: session.refresh_token || "",
    gbr_auth_expires_at: expiresAt,
    gbr_user_id: session.user.id,
    gbr_user_email: session.user.email || "",
    gbr_remember_access: rememberAccess,
  });
  invalidateStoredSessionCache();
  return {
    accessToken: session.access_token,
    userId: session.user.id,
    email: session.user.email || "",
  };
}

async function refreshStoredSession(stored: StoredSession) {
  if (!stored.gbr_refresh_token) {
    await storageRemove(AUTH_KEYS);
    return null;
  }
  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ refresh_token: stored.gbr_refresh_token }),
  });
  const data = (await parseResponse(response)) as SupabaseAuthResponse;
  if (!response.ok || !data.access_token || !data.user?.id) {
    if (response.status === 400 || response.status === 401) await storageRemove(AUTH_KEYS);
    return null;
  }
  const session = await persistSession(data, stored.gbr_remember_access === true);
  return { ...session, profile: null as never };
}

export async function getStoredSession() {
  const now = Date.now();
  if (storedSessionCache && storedSessionCache.expiresAt > now) {
    return storedSessionCache.value;
  }
  if (storedSessionInFlight) return storedSessionInFlight;

  storedSessionInFlight = (async () => {
    const stored = await storageGet<StoredSession>([...AUTH_KEYS, "gbr_remember_access"]);
    if (!stored.gbr_auth_token || !stored.gbr_user_id) return null;
    if (Number(stored.gbr_auth_expires_at || 0) <= Date.now() + 60_000) {
      if (!refreshInFlight) {
        refreshInFlight = refreshStoredSession(stored).finally(() => {
          refreshInFlight = null;
        });
      }
      const refreshed = await refreshInFlight;
      if (!refreshed) return null;
      return {
        accessToken: refreshed.accessToken,
        userId: refreshed.userId,
        email: refreshed.email,
      };
    }
    return {
      accessToken: stored.gbr_auth_token,
      userId: stored.gbr_user_id,
      email: stored.gbr_user_email || "",
    };
  })();

  try {
    const value = await storedSessionInFlight;
    storedSessionCache = {
      value,
      expiresAt: Date.now() + STORED_SESSION_CACHE_MS,
    };
    return value;
  } finally {
    storedSessionInFlight = null;
  }
}

type ApiRateBucket = {
  timestamps: number[];
  maxRequests: number;
  windowMs: number;
};

const apiRateBuckets: Record<"read" | "write", ApiRateBucket> = {
  // Initial dashboard loads can legitimately fan out into several reads.
  read: { timestamps: [], maxRequests: 180, windowMs: 10_000 },
  write: { timestamps: [], maxRequests: 60, windowMs: 10_000 },
};

const inFlightGetRequests = new Map<string, Promise<unknown>>();

function enforceApiRateLimit(path: string, method: string): void {
  const bucketName = method === "GET" ? "read" : "write";
  const bucket = apiRateBuckets[bucketName];
  const isPixCharge = path.startsWith("/functions/v1/create-pix-charge");
  const maxRequests = isPixCharge ? 8 : bucket.maxRequests;
  const windowMs = isPixCharge ? 60_000 : bucket.windowMs;
  const now = Date.now();
  while (bucket.timestamps.length > 0 && now - bucket.timestamps[0] > windowMs) {
    bucket.timestamps.shift();
  }
  if (bucket.timestamps.length >= maxRequests) {
    throw new Error("Muitas requisições em sequência. Aguarde alguns instantes.");
  }
  bucket.timestamps.push(now);
}

async function performSupabaseRequest<T>(
  path: string,
  init: RequestInit & { prefer?: string } = {},
): Promise<T> {
  const method = String(init.method || "GET").toUpperCase();
  const session = await getStoredSession();
  if (!session) throw new Error("Faça login para acessar esta área.");
  enforceApiRateLimit(path, method);
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${session.accessToken}`,
      "Content-Type": "application/json",
      ...(init.prefer ? { Prefer: init.prefer } : {}),
      ...(init.headers || {}),
    },
  });
  const data = await parseResponse(response);
  if (!response.ok) {
    if (response.status === 401) {
      await storageRemove(AUTH_KEYS);
      invalidateStoredSessionCache();
    }
    throw new Error(
      data?.message ||
        data?.error_description ||
        data?.error ||
        data?.hint ||
        `HTTP ${response.status}`,
    );
  }
  return data as T;
}

export async function supabaseRequest<T>(
  path: string,
  init: RequestInit & { prefer?: string } = {},
): Promise<T> {
  const method = String(init.method || "GET").toUpperCase();
  if (method !== "GET") return performSupabaseRequest<T>(path, init);

  const session = await getStoredSession();
  if (!session) throw new Error("Faca login para acessar esta area.");
  const requestKey = `${session.userId}:${path}`;
  const existingRequest = inFlightGetRequests.get(requestKey);
  if (existingRequest) return existingRequest as Promise<T>;

  const request = performSupabaseRequest<T>(path, init);
  inFlightGetRequests.set(requestKey, request);
  try {
    return await request;
  } finally {
    if (inFlightGetRequests.get(requestKey) === request) {
      inFlightGetRequests.delete(requestKey);
    }
  }
}

export async function invokeFunction<T>(name: string, body: unknown): Promise<T> {
  return supabaseRequest<T>(`/functions/v1/${name}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

async function ensureAndReadProfile(userId: string) {
  await supabaseRequest("/rest/v1/rpc/ensure_user_profile", {
    method: "POST",
    body: "{}",
  });
  const profiles = await supabaseRequest<AuthProfile[]>(
    `/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=*`,
  );
  if (!profiles[0]) throw new Error("Não foi possível criar ou localizar seu perfil.");
  await storageSet({
    gbr_user_profile: profiles[0],
    gbr_license_status: profiles[0].status,
  });
  return profiles[0];
}

export async function getCachedAuthSummary(): Promise<AuthSummary | null> {
  await bootstrapAuthRedirect();
  const [session, cached] = await Promise.all([
    getStoredSession(),
    storageGet<Pick<StoredSession, "gbr_user_profile">>(["gbr_user_profile"]),
  ]);
  if (!session || !cached.gbr_user_profile) return null;
  return {
    accessToken: session.accessToken,
    userId: session.userId,
    email: session.email,
    profile: cached.gbr_user_profile,
  };
}

export async function getAuthSummary(): Promise<AuthSummary | null> {
  if (authSummaryInFlight) return authSummaryInFlight;

  const request = (async () => {
    await bootstrapAuthRedirect();
    const session = await getStoredSession();
    if (!session) return null;
    const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${session.accessToken}`,
      },
    });
    const user = await parseResponse(response);
    if (!response.ok || !user?.id) {
      if (response.status === 401) {
        await storageRemove(AUTH_KEYS);
        invalidateStoredSessionCache();
      }
      return null;
    }
    const profile = await ensureAndReadProfile(user.id);
    return {
      accessToken: session.accessToken,
      userId: user.id,
      email: user.email || session.email,
      profile,
    };
  })();

  authSummaryInFlight = request;
  try {
    return await request;
  } finally {
    if (authSummaryInFlight === request) authSummaryInFlight = null;
  }
}

async function requestAuthEmailGateway(
  action: "signup" | "recover" | "resend_confirmation" | "claim_pending",
  email: string,
  options: {
    password?: string;
    data?: Record<string, unknown>;
    accessToken?: string;
  } = {},
) {
  const { accessToken, ...requestOptions } = options;
  const response = await fetch(`${SUPABASE_URL}/functions/v1/auth-email-gateway`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${accessToken || SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action,
      email: email.trim(),
      redirectTo: getAuthRedirectUrl(action === "recover" ? "recovery" : "confirmation"),
      ...requestOptions,
    }),
  });
  const data = (await parseResponse(response)) as SupabaseAuthResponse;
  if (!response.ok) throw new Error(authError(data, "Não foi possível processar o e-mail."));
  return data;
}

export async function signInDashboard(email: string, password: string, rememberAccess: boolean) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email: email.trim(), password }),
  });
  const data = (await parseResponse(response)) as SupabaseAuthResponse;
  if (!response.ok || !data.access_token || !data.user?.id) {
    throw new Error(authError(data, "Não foi possível entrar."));
  }
  await persistSession(data, rememberAccess);
  try {
    await requestAuthEmailGateway("claim_pending", email, {
      accessToken: data.access_token,
    });
  } catch (error) {
    // A compra continua na fila pendente e será reconciliada no próximo login.
    console.warn("[Auth] Não foi possível reconciliar compra Cakto no login", error);
  }
  const summary = await getAuthSummary();
  if (!summary) throw new Error("A sessão não pôde ser validada.");
  return summary;
}

export async function signUpDashboard(
  email: string,
  password: string,
  rememberAccess: boolean,
  legalAcceptance: {
    accepted: boolean;
    termsVersion: string;
    privacyVersion: string;
  },
) {
  if (!legalAcceptance.accepted) {
    throw new Error("É necessário aceitar os Termos de Uso e a Política de Privacidade.");
  }
  const deviceFingerprint = await generateDeviceFingerprint();
  const data = await requestAuthEmailGateway("signup", email, {
    password,
    data: {
      device_fingerprint: deviceFingerprint,
      legal_acceptance: true,
      legal_terms_version: legalAcceptance.termsVersion,
      legal_privacy_version: legalAcceptance.privacyVersion,
    },
  });
  if (data.error || data.msg) {
    throw new Error(authError(data, "Não foi possível criar a conta."));
  }
  if (data.access_token || data.session?.access_token) {
    await persistSession(data, rememberAccess);
    try {
      await requestAuthEmailGateway("claim_pending", email, {
        accessToken: data.access_token || data.session?.access_token,
      });
    } catch (error) {
      console.warn("[Auth] Não foi possível reconciliar compra Cakto após cadastro", error);
    }
    return { requiresEmailConfirmation: false, summary: await getAuthSummary() };
  }
  return { requiresEmailConfirmation: true, summary: null };
}

export async function resendConfirmationEmail(email: string) {
  await requestAuthEmailGateway("resend_confirmation", email);
}

export async function requestPasswordReset(email: string) {
  await requestAuthEmailGateway("recover", email);
}

export async function updatePasswordDashboard(password: string) {
  await supabaseRequest("/auth/v1/user", {
    method: "PUT",
    body: JSON.stringify({ password }),
  });
}

export async function signOutDashboard() {
  const session = await getStoredSession();
  if (session) {
    await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${session.accessToken}`,
      },
    }).catch(() => undefined);
  }
  await clearLegacyUserData();
  await storageRemove(AUTH_KEYS);
  invalidateStoredSessionCache();
  clearAuthRedirectState();
}
