import { useEffect, useState, type FormEvent } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  LoaderCircle,
  LockKeyhole,
  Mail,
  ShieldCheck,
  Zap,
} from "lucide-react";

import { useAuth } from "@/components/auth/AuthProvider";
import { LegalDocumentDialog } from "@/components/auth/LegalDocumentDialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  PRIVACY_VERSION,
  TERMS_VERSION,
  type LegalDocumentKind,
} from "@/content/legal";
import { requestPasswordReset, resendConfirmationEmail } from "@/services/supabaseRest";

type Mode = "signin" | "signup" | "verify" | "reset" | "recovery";

export function AuthScreen({ initialMode = "signin" }: { initialMode?: Mode }) {
  const { login, signup, updatePassword, completePasswordRecovery } = useAuth();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [acceptedLegal, setAcceptedLegal] = useState(false);
  const [openLegalDocument, setOpenLegalDocument] = useState<LegalDocumentKind | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);

  useEffect(() => {
    setMode(initialMode);
    setMessage(null);
  }, [initialMode]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    if (mode === "reset") {
      if (!email.trim()) {
        setMessage({ type: "error", text: "Informe seu e-mail para receber o link de redefinicao." });
        return;
      }
      setLoading(true);
      try {
        await requestPasswordReset(email);
        setMessage({
          type: "success",
          text: "Se o e-mail estiver cadastrado, enviaremos um link para redefinir sua senha.",
        });
      } catch (error) {
        setMessage({
          type: "error",
          text: error instanceof Error ? error.message : "Nao foi possivel enviar o link.",
        });
      } finally {
        setLoading(false);
      }
      return;
    }

    if (mode === "recovery") {
      if (password.length < 6) {
        setMessage({ type: "error", text: "A nova senha deve ter pelo menos 6 caracteres." });
        return;
      }
      if (password !== confirmPassword) {
        setMessage({ type: "error", text: "As senhas digitadas nao sao iguais." });
        return;
      }
      setLoading(true);
      try {
        await updatePassword(password);
        await completePasswordRecovery();
        setPassword("");
        setConfirmPassword("");
        setMode("signin");
        setMessage({ type: "success", text: "Senha atualizada. Entre com sua nova senha." });
      } catch (error) {
        setMessage({
          type: "error",
          text: error instanceof Error ? error.message : "Nao foi possivel atualizar a senha.",
        });
      } finally {
        setLoading(false);
      }
      return;
    }

    if (!email.trim() || password.length < 6) {
      setMessage({ type: "error", text: "Informe um e-mail válido e uma senha com pelo menos 6 caracteres." });
      return;
    }
    if (mode === "signup" && password !== confirmPassword) {
      setMessage({ type: "error", text: "As senhas digitadas não são iguais." });
      return;
    }
    if (mode === "signup" && !acceptedLegal) {
      setMessage({
        type: "error",
        text: "Leia e aceite os Termos de Uso e a Política de Privacidade para criar sua conta.",
      });
      return;
    }
    setLoading(true);
    try {
      if (mode === "signin") {
        await login(email, password, remember);
      } else {
        const result = await signup(email, password, remember, {
          accepted: acceptedLegal,
          termsVersion: TERMS_VERSION,
          privacyVersion: PRIVACY_VERSION,
        });
        if (result.requiresEmailConfirmation) {
          setMode("verify");
          setMessage({ type: "success", text: "Conta criada. Enviamos a confirmação para seu e-mail." });
        }
      }
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Não foi possível concluir a autenticação.",
      });
    } finally {
      setLoading(false);
    }
  }

  async function checkConfirmation() {
    setLoading(true);
    setMessage(null);
    try {
      await login(email, password, remember);
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "A confirmação ainda não foi localizada.",
      });
    } finally {
      setLoading(false);
    }
  }

  async function resend() {
    setLoading(true);
    try {
      await resendConfirmationEmail(email);
      setMessage({ type: "success", text: "E-mail de confirmação reenviado." });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Falha ao reenviar." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="relative grid min-h-screen overflow-hidden bg-background lg:grid-cols-[minmax(340px,0.9fr)_minmax(480px,1.1fr)]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_16%_18%,color-mix(in_oklab,var(--color-primary)_18%,transparent),transparent_34%),radial-gradient(circle_at_82%_76%,color-mix(in_oklab,var(--color-odds)_12%,transparent),transparent_32%)]" />

      <section className="relative hidden flex-col justify-between border-r border-border bg-sidebar/75 p-10 lg:flex">
        <div className="flex items-center gap-3">
          <img
            src="./logo-gatilho.png"
            alt="GatilhoBR"
            className="h-16 w-32 rounded-xl object-contain"
          />
          <div>
            <p className="text-lg font-semibold tracking-tight">GatilhoBR</p>
            <p className="text-xs uppercase tracking-[0.22em] text-primary">Painel operacional</p>
          </div>
        </div>

        <div className="max-w-lg">
          <span className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
            <Zap className="size-3.5" /> Reação rápida, decisão humana
          </span>
          <h1 className="mt-5 text-4xl font-semibold leading-tight tracking-tight">
            Seus mercados, jogadores e binds em um único lugar.
          </h1>
          <p className="mt-4 text-sm leading-6 text-muted-foreground">
            Entre para sincronizar sua configuração e controlar Bet365 e Betfair com a mesma conta.
          </p>
          <div className="mt-8 grid gap-3">
            <Feature icon={<ShieldCheck className="size-4" />} text="Sessão protegida e sincronizada com segurança" />
            <Feature icon={<LockKeyhole className="size-4" />} text="Configurações protegidas por usuário" />
            <Feature icon={<CheckCircle2 className="size-4" />} text="Nenhuma aposta é disparada ao entrar" />
          </div>
        </div>

        <p className="text-xs text-muted-foreground">Uso exclusivo para maiores de 18 anos. Aposte com responsabilidade.</p>
      </section>

      <section className="relative flex items-center justify-center px-4 py-8 sm:px-8">
        <div className="w-full max-w-md">
          <div className="mb-7 flex items-center gap-3 lg:hidden">
            <img
              src="./logo-gatilho.png"
              alt="GatilhoBR"
              className="h-14 w-28 rounded-xl object-contain"
            />
            <div>
              <p className="font-semibold">GatilhoBR</p>
              <p className="text-xs text-muted-foreground">Painel operacional</p>
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card/90 p-5 shadow-2xl shadow-black/20 backdrop-blur sm:p-7">
            {mode === "reset" ? (
              <div>
                <span className="mx-auto grid size-12 place-items-center rounded-full bg-primary/15 text-primary">
                  <Mail className="size-5" />
                </span>
                <h2 className="mt-4 text-center text-xl font-semibold">Redefinir senha</h2>
                <p className="mt-2 text-center text-sm leading-6 text-muted-foreground">
                  Informe seu e-mail e enviaremos um link para criar uma nova senha.
                </p>
                <form className="mt-5 space-y-4" onSubmit={submit}>
                  <div>
                    <Label htmlFor="reset-email">E-mail</Label>
                    <div className="relative mt-1.5">
                      <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                      <Input id="reset-email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="h-11 pl-9" placeholder="voce@email.com" />
                    </div>
                  </div>
                  {message ? <AuthMessage message={message} /> : null}
                  <Button type="submit" className="h-11 w-full" disabled={loading}>
                    {loading ? <LoaderCircle className="size-4 animate-spin" /> : <Mail className="size-4" />}
                    Enviar link de redefinicao
                  </Button>
                </form>
                <button type="button" className="mt-4 block w-full text-center text-xs text-muted-foreground hover:text-foreground" onClick={() => { setMode("signin"); setMessage(null); }}>
                  Voltar para o login
                </button>
              </div>
            ) : mode === "recovery" ? (
              <div>
                <span className="mx-auto grid size-12 place-items-center rounded-full bg-primary/15 text-primary">
                  <LockKeyhole className="size-5" />
                </span>
                <h2 className="mt-4 text-center text-xl font-semibold">Defina uma nova senha</h2>
                <p className="mt-2 text-center text-sm leading-6 text-muted-foreground">
                  Escolha uma senha nova para proteger sua conta.
                </p>
                <form className="mt-5 space-y-4" onSubmit={submit}>
                  <div>
                    <Label htmlFor="recovery-password">Nova senha</Label>
                    <div className="relative mt-1.5">
                      <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                      <Input id="recovery-password" type={showPassword ? "text" : "password"} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} className="h-11 px-9" placeholder="Minimo de 6 caracteres" />
                      <button type="button" aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => setShowPassword((value) => !value)}>
                        {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                      </button>
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="recovery-password-confirmation">Confirme a nova senha</Label>
                    <Input id="recovery-password-confirmation" type={showPassword ? "text" : "password"} autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className="mt-1.5 h-11" />
                  </div>
                  {message ? <AuthMessage message={message} /> : null}
                  <Button type="submit" className="h-11 w-full" disabled={loading}>
                    {loading ? <LoaderCircle className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                    Salvar nova senha
                  </Button>
                </form>
              </div>
            ) : mode === "verify" ? (
              <div className="text-center">
                <span className="mx-auto grid size-12 place-items-center rounded-full bg-primary/15 text-primary">
                  <Mail className="size-5" />
                </span>
                <h2 className="mt-4 text-xl font-semibold">Confirme seu e-mail</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Enviamos uma mensagem para <strong className="text-foreground">{email}</strong>. Abra o link e volte aqui.
                </p>
                {message ? <AuthMessage message={message} /> : null}
                <Button className="mt-5 w-full" disabled={loading} onClick={() => void checkConfirmation()}>
                  {loading ? <LoaderCircle className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                  Já confirmei meu e-mail
                </Button>
                <Button className="mt-2 w-full" variant="ghost" disabled={loading} onClick={() => void resend()}>
                  Reenviar confirmação
                </Button>
                <button type="button" className="mt-4 text-xs text-muted-foreground hover:text-foreground" onClick={() => setMode("signin")}>
                  Voltar para o login
                </button>
              </div>
            ) : (
              <>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
                    {mode === "signin" ? "Bem-vindo de volta" : "Comece agora"}
                  </p>
                  <h2 className="mt-2 text-2xl font-semibold tracking-tight">
                    {mode === "signin" ? "Entre na sua conta" : "Crie sua conta"}
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {mode === "signin"
                      ? "Sua sessão e seu perfil serão validados antes de abrir o painel."
                      : "Use um e-mail que você consiga confirmar."}
                  </p>
                </div>

                <div className="mt-5 grid grid-cols-2 rounded-lg bg-surface p-1">
                  <button type="button" className={tabClass(mode === "signin")} onClick={() => { setMode("signin"); setMessage(null); }}>
                    Entrar
                  </button>
                  <button type="button" className={tabClass(mode === "signup")} onClick={() => { setMode("signup"); setMessage(null); }}>
                    Criar conta
                  </button>
                </div>

                <form className="mt-5 space-y-4" onSubmit={submit}>
                  <div>
                    <Label htmlFor="auth-email">E-mail</Label>
                    <div className="relative mt-1.5">
                      <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                      <Input id="auth-email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="h-11 pl-9" placeholder="voce@email.com" />
                    </div>
                  </div>

                  <div>
                    <Label htmlFor="auth-password">Senha</Label>
                    <div className="relative mt-1.5">
                      <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                      <Input id="auth-password" type={showPassword ? "text" : "password"} autoComplete={mode === "signin" ? "current-password" : "new-password"} value={password} onChange={(event) => setPassword(event.target.value)} className="h-11 px-9" placeholder="Mínimo de 6 caracteres" />
                      <button type="button" aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => setShowPassword((value) => !value)}>
                        {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                      </button>
                    </div>
                  </div>

                  {mode === "signup" ? (
                    <div>
                      <Label htmlFor="auth-password-confirmation">Confirme a senha</Label>
                      <Input id="auth-password-confirmation" type={showPassword ? "text" : "password"} autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className="mt-1.5 h-11" />
                    </div>
                  ) : null}

                  {mode === "signup" ? (
                    <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-primary/25 bg-primary/5 p-3">
                      <Checkbox
                        aria-label="Aceitar Termos de Uso e Política de Privacidade"
                        checked={acceptedLegal}
                        onCheckedChange={(checked) => setAcceptedLegal(checked === true)}
                      />
                      <span className="text-xs leading-5 text-muted-foreground">
                        Ao criar sua conta, você declara que leu e aceita os{" "}
                        <button
                          type="button"
                          className="font-medium text-primary underline underline-offset-2 hover:text-primary/80"
                          onClick={(event) => {
                            event.preventDefault();
                            setOpenLegalDocument("terms");
                          }}
                        >
                          Termos de Uso
                        </button>{" "}
                        e a{" "}
                        <button
                          type="button"
                          className="font-medium text-primary underline underline-offset-2 hover:text-primary/80"
                          onClick={(event) => {
                            event.preventDefault();
                            setOpenLegalDocument("privacy");
                          }}
                        >
                          Política de Privacidade
                        </button>
                        .
                      </span>
                    </label>
                  ) : null}

                  <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border bg-surface/70 p-3">
                    <Checkbox checked={remember} onCheckedChange={(checked) => setRemember(checked === true)} />
                    <span>
                      <span className="block text-sm font-medium">Lembrar meu acesso</span>
                      <span className="block text-xs leading-5 text-muted-foreground">
                        Mantém a sessão neste navegador até você clicar em sair.
                      </span>
                    </span>
                  </label>

                  {message ? <AuthMessage message={message} /> : null}

                  <Button
                    type="submit"
                    className="h-11 w-full"
                    disabled={loading || (mode === "signup" && !acceptedLegal)}
                  >
                    {loading ? <LoaderCircle className="size-4 animate-spin" /> : null}
                    {mode === "signin" ? "Entrar no painel" : "Criar minha conta"}
                    {!loading ? <ArrowRight className="size-4" /> : null}
                  </Button>
                  {mode === "signin" ? (
                    <button type="button" className="w-full text-center text-xs text-muted-foreground hover:text-foreground" onClick={() => { setMode("reset"); setMessage(null); }}>
                      Esqueci minha senha
                    </button>
                  ) : null}
                </form>
              </>
            )}
          </div>
          <div className="mt-4 flex justify-center gap-4 text-xs text-muted-foreground">
            <button type="button" className="hover:text-foreground" onClick={() => setOpenLegalDocument("terms")}>
              Termos de Uso
            </button>
            <button type="button" className="hover:text-foreground" onClick={() => setOpenLegalDocument("privacy")}>
              Política de Privacidade
            </button>
          </div>
        </div>
      </section>
      <LegalDocumentDialog
        document={openLegalDocument}
        onOpenChange={(open) => {
          if (!open) setOpenLegalDocument(null);
        }}
      />
    </main>
  );
}

function Feature({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-3 text-sm text-muted-foreground">
      <span className="grid size-8 place-items-center rounded-lg border border-primary/20 bg-primary/10 text-primary">{icon}</span>
      {text}
    </div>
  );
}

function AuthMessage({ message }: { message: { type: "error" | "success"; text: string } }) {
  return (
    <div className={`mt-4 rounded-lg border px-3 py-2.5 text-sm ${message.type === "error" ? "border-danger/30 bg-danger/10 text-danger" : "border-ok/30 bg-ok/10 text-ok"}`}>
      {message.text}
    </div>
  );
}

function tabClass(active: boolean) {
  return `rounded-md px-3 py-2 text-sm font-medium transition-colors ${
    active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
  }`;
}
