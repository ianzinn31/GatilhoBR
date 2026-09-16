import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  clearAuthRedirectState,
  getCachedAuthSummary,
  getAuthSummary,
  getAuthRedirectType,
  signInDashboard,
  signOutDashboard,
  signUpDashboard,
  updatePasswordDashboard,
  type AuthSummary,
} from "@/services/supabaseRest";

type AuthContextValue = {
  account: AuthSummary | null;
  passwordRecovery: boolean;
  loading: boolean;
  login(email: string, password: string, rememberAccess: boolean): Promise<AuthSummary>;
  signup(
    email: string,
    password: string,
    rememberAccess: boolean,
    legalAcceptance: {
      accepted: boolean;
      termsVersion: string;
      privacyVersion: string;
    },
  ): ReturnType<typeof signUpDashboard>;
  refresh(): Promise<AuthSummary | null>;
  updatePassword(password: string): Promise<void>;
  completePasswordRecovery(): Promise<void>;
  logout(): Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<AuthSummary | null>(null);
  const [passwordRecovery, setPasswordRecovery] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const next = await getAuthSummary();
    setAccount(next);
    return next;
  }, []);

  useEffect(() => {
    let active = true;
    let hasCachedAccount = false;
    void getCachedAuthSummary()
      .then((cached) => {
        hasCachedAccount = Boolean(cached);
        if (active && cached) {
          setAccount(cached);
          setPasswordRecovery(getAuthRedirectType() === "recovery");
          // A sessão/perfil local já é suficiente para pintar a dashboard;
          // a validação online continua em paralelo.
          setLoading(false);
        }
        return getAuthSummary();
      })
      .then((next) => {
        if (active) {
          setAccount(next);
          setPasswordRecovery(getAuthRedirectType() === "recovery");
        }
      })
      .catch(() => {
        if (active && !hasCachedAccount) {
          setAccount(null);
          setPasswordRecovery(false);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      account,
      passwordRecovery,
      loading,
      async login(email, password, rememberAccess) {
        const next = await signInDashboard(email, password, rememberAccess);
        setAccount(next);
        return next;
      },
      async signup(email, password, rememberAccess, legalAcceptance) {
        const result = await signUpDashboard(email, password, rememberAccess, legalAcceptance);
        if (result.summary) setAccount(result.summary);
        return result;
      },
      refresh,
      async updatePassword(password) {
        await updatePasswordDashboard(password);
      },
      async completePasswordRecovery() {
        await signOutDashboard();
        clearAuthRedirectState();
        setAccount(null);
        setPasswordRecovery(false);
      },
      async logout() {
        await signOutDashboard();
        setAccount(null);
        setPasswordRecovery(false);
      },
    }),
    [account, loading, passwordRecovery, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth precisa estar dentro de AuthProvider");
  return context;
}
