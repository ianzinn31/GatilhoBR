import {
  Check,
  Clock,
  Copy,
  CreditCard,
  QrCode,
  ShieldCheck,
  Sparkles,
  TicketPercent,
  X,
} from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useState, type FormEvent } from "react";

import { SectionHeader } from "@/components/gatilho/primitives";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type {
  BillingCycle,
  CardDetails,
  Invoice,
  PaymentCharge,
  PaymentMethod,
  PaymentRequest,
  PixQuote,
  PlanModel,
  SubscriptionModel,
} from "@/types/billing";

const TRIAL_DURATION_MS = 24 * 60 * 60 * 1000;

function formatCountdown(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}

export function SubscriptionPanel({
  subscription,
  plans,
  invoices,
  accountEmail,
  paymentCharge,
  hostedCheckout,
  openingCheckout,
  quote,
  onCreatePayment,
  onOpenCheckout,
  onApplyCoupon,
  onClearCoupon,
  onCancelPix,
  generating,
  quoting,
}: {
  subscription: SubscriptionModel;
  plans: PlanModel[];
  invoices: Invoice[];
  accountEmail: string;
  paymentCharge: PaymentCharge | null;
  hostedCheckout: boolean;
  openingCheckout: boolean;
  quote: PixQuote | null;
  onCreatePayment: (
    planId: string,
    cycle: BillingCycle,
    coupon: string,
    payment: PaymentRequest,
  ) => void;
  onOpenCheckout: (planId: string, cycle: BillingCycle, coupon: string) => void;
  onApplyCoupon: (planId: string, cycle: BillingCycle, coupon: string) => void;
  onClearCoupon: () => void;
  onCancelPix: () => void;
  generating: boolean;
  quoting: boolean;
}) {
  const hasYearly = plans.some((plan) => plan.yearlyPrice > 0);
  const [cycle, setCycle] = useState<BillingCycle>(hasYearly ? subscription.cycle : "monthly");
  const [selectedPlanId, setSelectedPlanId] = useState(subscription.planId);
  const [copied, setCopied] = useState(false);
  const [coupon, setCoupon] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("pix");
  const [customerName, setCustomerName] = useState("");
  const [phone, setPhone] = useState("");
  const [docType, setDocType] = useState<"cpf" | "cnpj">("cpf");
  const [docNumber, setDocNumber] = useState("");
  const [card, setCard] = useState<CardDetails>({
    holderName: "",
    cardNumber: "",
    cvv: "",
    expMonth: "",
    expYear: "",
  });
  const [validationError, setValidationError] = useState("");
  const [generatedQr, setGeneratedQr] = useState("");
  const [providerQrFailed, setProviderQrFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const promoPlan = plans.find((plan) => plan.promoNote || plan.futurePrice);

  const isTrial = subscription.status === "trial";
  const trialRemainingMs = isTrial
    ? Math.max(0, new Date(subscription.renewsAt).getTime() - now)
    : 0;
  const daysTotal = subscription.cycle === "yearly" ? 365 : 30;
  const remaining = isTrial
    ? Math.ceil(trialRemainingMs / 86_400_000)
    : Math.max(0, subscription.daysRemaining);
  const usedPct = subscription.isUnlimited
    ? 0
    : isTrial
      ? Math.min(
          100,
          Math.max(0, ((TRIAL_DURATION_MS - trialRemainingMs) / TRIAL_DURATION_MS) * 100),
        )
      : Math.min(100, ((daysTotal - remaining) / daysTotal) * 100);
  const expiring =
    !subscription.isUnlimited &&
    (isTrial ? trialRemainingMs <= 2 * 60 * 60 * 1000 : remaining <= 7);
  const visibleQr = (!providerQrFailed && paymentCharge?.qrCodeImage) || generatedQr;

  useEffect(() => {
    if (!isTrial) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [isTrial]);

  useEffect(() => {
    let active = true;
    setGeneratedQr("");
    setProviderQrFailed(false);
    if (!paymentCharge?.payload)
      return () => {
        active = false;
      };
    void QRCode.toDataURL(paymentCharge.payload, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 320,
      color: { dark: "#050706", light: "#ffffff" },
    })
      .then((image) => {
        if (active) setGeneratedQr(image);
      })
      .catch(() => {
        if (active) setGeneratedQr("");
      });
    return () => {
      active = false;
    };
  }, [paymentCharge?.id, paymentCharge?.payload]);

  async function copyPix(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  function submitPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanPhone = phone.replace(/\D/g, "");
    const cleanDocument = docNumber.replace(/\D/g, "");
    if (customerName.trim().length < 3) {
      setValidationError("Informe seu nome completo.");
      return;
    }
    if (cleanPhone.length < 10 || cleanPhone.length > 11) {
      setValidationError("Informe um telefone com DDD.");
      return;
    }
    if (cleanDocument.length !== (docType === "cnpj" ? 14 : 11)) {
      setValidationError(`Informe um ${docType === "cnpj" ? "CNPJ" : "CPF"} valido.`);
      return;
    }
    const cleanCard = {
      holderName: card.holderName.trim() || customerName.trim(),
      cardNumber: card.cardNumber.replace(/\D/g, ""),
      cvv: card.cvv.replace(/\D/g, ""),
      expMonth: card.expMonth.replace(/\D/g, "").padStart(2, "0"),
      expYear: card.expYear.replace(/\D/g, ""),
    };
    if (paymentMethod === "credit_card") {
      if (cleanCard.cardNumber.length < 13 || cleanCard.cardNumber.length > 19) {
        setValidationError("Informe um numero de cartao valido.");
        return;
      }
      if (cleanCard.cvv.length < 3 || cleanCard.cvv.length > 4) {
        setValidationError("Informe o codigo de seguranca do cartao.");
        return;
      }
      if (!/^\d{2}$/.test(cleanCard.expMonth) || !/^\d{2,4}$/.test(cleanCard.expYear)) {
        setValidationError("Informe a validade do cartao.");
        return;
      }
    }
    setValidationError("");
    const request: PaymentRequest = {
      paymentMethod,
      customer: {
        name: customerName.trim(),
        phone: cleanPhone,
        docType,
        docNumber: cleanDocument,
      },
      ...(paymentMethod === "credit_card" ? { card: cleanCard } : {}),
    };
    onCreatePayment(selectedPlanId, cycle, coupon, request);
  }

  return (
    <div className="space-y-4">
      {/* Status atual */}
      <section className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="grid gap-4 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold">{subscription.planName}</span>
              <Badge
                variant="outline"
                className={cn(
                  "border-transparent text-[10px] uppercase tracking-wide",
                  subscription.status === "active" && "bg-ok/15 text-ok",
                  subscription.status === "past_due" && "bg-danger/15 text-danger",
                  subscription.status === "canceled" && "bg-muted text-muted-foreground",
                  subscription.status === "trial" && "bg-info/15 text-info",
                )}
              >
                {STATUS_LABEL[subscription.status]}
              </Badge>
            </div>
            <p className="text-[13px] text-muted-foreground">
              Renova em{" "}
              <span className="tabular text-foreground">
                {formatDateTime(subscription.renewsAt)}
              </span>{" "}
              · {subscription.cycle === "yearly" ? "cobrança anual" : "cobrança mensal"}
            </p>
            {subscription.isUnlimited ? (
              <p className="text-[13px] text-ok">Acesso ilimitado, sem data de expiração.</p>
            ) : isTrial ? (
              <p className="flex items-center gap-1.5 text-[13px] font-medium text-info">
                <Clock className="size-3.5" />
                {formatCountdown(trialRemainingMs)} restantes no teste de 24 horas
              </p>
            ) : null}
            <div className="max-w-sm space-y-1">
              <Progress value={usedPct} className="h-1.5" />
              <p
                className={cn(
                  "text-[11px] tabular",
                  expiring ? "text-danger" : "text-muted-foreground",
                )}
              >
                {subscription.isUnlimited
                  ? "Licença sem expiração"
                  : isTrial
                    ? `${formatCountdown(trialRemainingMs)} restantes no teste`
                    : `${remaining} dia${remaining === 1 ? "" : "s"} restante${remaining === 1 ? "" : "s"} no ciclo atual`}
              </p>
            </div>
          </div>
          <div className="text-left sm:text-right">
            <p className="text-2xl font-semibold tabular">{formatCurrency(subscription.amount)}</p>
            <p className="text-[11px] text-muted-foreground">
              por {subscription.cycle === "yearly" ? "ano" : "mês"}
            </p>
          </div>
        </div>
        {expiring ? (
          <div className="border-t border-border bg-danger/10 px-4 py-2 text-[12px] text-danger">
            Sua assinatura vence em breve. Renove para manter binds e disparos ativos.
          </div>
        ) : null}
      </section>

      {/* Aviso de reajuste */}
      {promoPlan ? (
        <div className="flex items-start gap-2.5 rounded-xl border border-odds/40 bg-odds/10 p-3">
          <Sparkles className="mt-0.5 size-4 shrink-0 text-odds" />
          <p className="text-[12px] leading-relaxed text-foreground">
            {promoPlan.promoNote ??
              `Preço de lançamento. Em breve o plano passa a custar ${formatCurrency(
                promoPlan.futurePrice ?? 0,
              )}/mês.`}
          </p>
        </div>
      ) : null}

      {/* Planos */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionHeader
            title={plans.length === 1 ? "Seu plano" : "Escolha seu plano"}
            description="Pix, Pix Automático ou cartão, com liberação após a confirmação."
          />
          {hasYearly ? (
            <div className="inline-flex rounded-lg border border-border bg-surface p-0.5">
              {(["monthly", "yearly"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => {
                    setCycle(option);
                    onClearCoupon();
                  }}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors",
                    cycle === option
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {option === "monthly" ? "Mensal" : "Anual −20%"}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className={cn("grid gap-3", plans.length > 1 && "md:grid-cols-3")}>
          {plans.map((plan) => {
            const price = cycle === "yearly" ? plan.yearlyPrice : plan.monthlyPrice;
            const current = plan.id === subscription.planId;
            const selected = plan.id === selectedPlanId;
            return (
              <article
                key={plan.id}
                className={cn(
                  "relative flex flex-col rounded-xl border bg-card p-4 transition-colors",
                  selected
                    ? "border-primary shadow-[0_0_0_1px_var(--color-primary)]"
                    : "border-border",
                )}
              >
                {plan.highlighted ? (
                  <span className="absolute -top-2 right-3 inline-flex items-center gap-1 rounded-full bg-odds px-2 py-0.5 text-[10px] font-semibold text-odds-foreground">
                    <Sparkles className="size-3" /> Preço de lançamento
                  </span>
                ) : null}
                <h3 className="text-sm font-semibold">{plan.name}</h3>
                <p className="mt-0.5 text-[12px] text-muted-foreground">{plan.tagline}</p>
                <p className="mt-3 flex flex-wrap items-baseline gap-2 text-2xl font-semibold tabular">
                  <span>
                    {formatCurrency(price)}
                    <span className="ml-1 text-[11px] font-normal text-muted-foreground">
                      /{cycle === "yearly" ? "ano" : "mês"}
                    </span>
                  </span>
                  {plan.futurePrice && cycle === "monthly" ? (
                    <span className="text-[13px] font-normal text-muted-foreground line-through">
                      {formatCurrency(plan.futurePrice)}
                    </span>
                  ) : null}
                </p>
                {plan.futurePrice && cycle === "monthly" ? (
                  <p className="mt-1 text-[11px] text-odds">
                    Depois passa a {formatCurrency(plan.futurePrice)}/mês
                  </p>
                ) : null}
                <ul className="mt-3 flex-1 space-y-1.5">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex gap-2 text-[12px] text-muted-foreground">
                      <Check className="mt-0.5 size-3.5 shrink-0 text-primary" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
                <Button
                  type="button"
                  variant={selected ? "default" : "secondary"}
                  className="mt-4 w-full"
                  onClick={() => {
                    setSelectedPlanId(plan.id);
                    onClearCoupon();
                  }}
                >
                  {current ? "Renovar este plano" : selected ? "Selecionado" : "Selecionar"}
                </Button>
              </article>
            );
          })}
        </div>
      </section>

      {/* Checkout hospedado da Cakto iniciado pela extensao */}
      <section className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-primary" />
            <h3 className="text-sm font-semibold">Pagamento seguro pela Cakto</h3>
          </div>

          {paymentCharge ? (
            paymentCharge.paymentMethod === "credit_card" ? (
              <div className="mt-3 space-y-3">
                <div className="rounded-lg border border-border bg-surface p-4">
                  <div className="flex items-center gap-2">
                    <CreditCard className="size-5 text-primary" />
                    <p className="text-sm font-semibold">Pagamento enviado para análise</p>
                  </div>
                  <p className="mt-2 text-[13px] text-muted-foreground">
                    Status atual: <span className="font-medium text-foreground">
                      {PAYMENT_STATUS_LABEL[paymentCharge.status] || paymentCharge.status}
                    </span>.
                    A assinatura será liberada automaticamente após a aprovação.
                  </p>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Valor <span className="tabular">{formatCurrency(paymentCharge.amount)}</span>
                  {paymentCharge.refId ? ` · referência ${paymentCharge.refId}` : ""}
                </p>
                <Button type="button" variant="ghost" onClick={onCancelPix}>
                  Fechar
                </Button>
              </div>
            ) : (
              <div className="mt-3 space-y-3">
                <div className="flex items-center justify-center rounded-lg border border-border bg-surface p-4">
                  {visibleQr ? (
                    <img
                      src={visibleQr}
                      alt="QR Code da cobrança Pix"
                      className="size-40 rounded bg-white object-contain p-1"
                      onError={() => setProviderQrFailed(true)}
                    />
                  ) : (
                    <QrCode
                      className="size-32 text-muted-foreground"
                      aria-label="QR Code indisponível"
                    />
                  )}
                </div>
                <div className="rounded-lg border border-border bg-surface p-2.5">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {paymentCharge.paymentMethod === "pix_auto"
                      ? "Pix copia e cola para autorizar a recorrência"
                      : "Pix copia e cola"}
                  </p>
                  <p className="mt-1 break-all text-[11px] tabular text-muted-foreground">
                    {paymentCharge.payload || "A Cakto ainda não retornou o código Pix."}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    disabled={!paymentCharge.payload}
                    onClick={() => void copyPix(paymentCharge.payload)}
                  >
                    {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                    {copied ? "Código copiado" : "Copiar código"}
                  </Button>
                  <Button type="button" variant="ghost" onClick={onCancelPix}>
                    Fechar
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {paymentCharge.paymentMethod === "pix_auto"
                    ? "Esta autorização permite as próximas cobranças recorrentes. "
                    : "Liberação automática após a confirmação. "}
                  Expira em {formatDateTime(paymentCharge.expiresAt)} · valor{" "}
                  <span className="tabular">{formatCurrency(paymentCharge.amount)}</span>
                </p>
              </div>
            )
          ) : hostedCheckout ? (
            <form
              className="mt-3 space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                onOpenCheckout(selectedPlanId, cycle, coupon.trim());
              }}
            >
              <p className="text-[13px] text-muted-foreground">
                O pagamento será finalizado no checkout oficial da Cakto, com Pix, Pix Automático
                e cartão. A aprovação será enviada automaticamente para sua conta.
              </p>
              <div className="rounded-lg border border-border bg-surface p-3">
                <label
                  htmlFor="billing-coupon"
                  className="flex items-center gap-1.5 text-[12px] font-medium"
                >
                  <TicketPercent className="size-3.5 text-odds" /> Possui um cupom?
                </label>
                <Input
                  id="billing-coupon"
                  value={coupon}
                  disabled={openingCheckout}
                  placeholder="Código promocional"
                  autoComplete="off"
                  maxLength={64}
                  className="mt-2 uppercase"
                  onChange={(event) => setCoupon(event.target.value.replace(/[^a-zA-Z0-9_-]/g, ""))}
                />
                <p className="mt-2 text-[11px] text-muted-foreground">
                  O valor final e a validade do cupom serão confirmados pela Cakto.
                </p>
              </div>
              <Button type="submit" className="w-full" disabled={openingCheckout}>
                <ShieldCheck className="size-4" />
                {openingCheckout ? "Abrindo checkout…" : "Continuar para o checkout da Cakto"}
              </Button>
              <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <ShieldCheck className="size-3.5 text-primary" />
                Você será encaminhado para pay.cakto.com.br. Os dados de pagamento serão tratados
                pela Cakto.
              </p>
            </form>
          ) : (
            <form className="mt-3 space-y-3" onSubmit={submitPayment}>
              <p className="text-[13px] text-muted-foreground">
                Escolha como pagar. Todo o checkout acontece dentro da extensão e a confirmação é
                processada pela Cakto.
              </p>
              <div className="grid grid-cols-3 gap-1 rounded-lg border border-border bg-surface p-1">
                {PAYMENT_METHODS.map((method) => (
                  <button
                    key={method.value}
                    type="button"
                    aria-pressed={paymentMethod === method.value}
                    disabled={generating || quoting}
                    onClick={() => {
                      setPaymentMethod(method.value);
                      setValidationError("");
                    }}
                    className={cn(
                      "rounded-md px-2 py-2 text-[11px] font-medium transition-colors",
                      paymentMethod === method.value
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {method.label}
                  </button>
                ))}
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <label className="space-y-1 sm:col-span-2">
                  <span className="text-[11px] font-medium">Nome completo</span>
                  <Input
                    value={customerName}
                    disabled={generating}
                    autoComplete="name"
                    placeholder="Como aparece no documento"
                    onChange={(event) => setCustomerName(event.target.value)}
                  />
                </label>
                <label className="space-y-1 sm:col-span-2">
                  <span className="text-[11px] font-medium">E-mail da conta</span>
                  <Input value={accountEmail} readOnly className="text-muted-foreground" />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] font-medium">Telefone com DDD</span>
                  <Input
                    value={phone}
                    disabled={generating}
                    inputMode="tel"
                    autoComplete="tel"
                    placeholder="(11) 99999-9999"
                    onChange={(event) => setPhone(event.target.value)}
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] font-medium">Documento</span>
                  <div className="flex gap-2">
                    <select
                      value={docType}
                      disabled={generating}
                      aria-label="Tipo de documento"
                      className="h-9 rounded-md border border-input bg-transparent px-2 text-xs"
                      onChange={(event) => setDocType(event.target.value as "cpf" | "cnpj")}
                    >
                      <option value="cpf">CPF</option>
                      <option value="cnpj">CNPJ</option>
                    </select>
                    <Input
                      value={docNumber}
                      disabled={generating}
                      inputMode="numeric"
                      autoComplete="off"
                      placeholder={docType === "cpf" ? "Somente dígitos" : "CNPJ"}
                      onChange={(event) => setDocNumber(event.target.value)}
                    />
                  </div>
                </label>
              </div>

              {paymentMethod === "credit_card" ? (
                <div className="space-y-2 rounded-lg border border-border bg-surface p-3">
                  <p className="flex items-center gap-1.5 text-[12px] font-medium">
                    <CreditCard className="size-3.5 text-primary" /> Dados do cartão
                  </p>
                  <label className="block space-y-1">
                    <span className="text-[11px] text-muted-foreground">Nome impresso no cartão</span>
                    <Input
                      value={card.holderName}
                      disabled={generating}
                      autoComplete="cc-name"
                      onChange={(event) => setCard({ ...card, holderName: event.target.value })}
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-[11px] text-muted-foreground">Número do cartão</span>
                    <Input
                      value={card.cardNumber}
                      disabled={generating}
                      inputMode="numeric"
                      autoComplete="cc-number"
                      placeholder="Somente dígitos"
                      onChange={(event) => setCard({ ...card, cardNumber: event.target.value })}
                    />
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    <label className="space-y-1">
                      <span className="text-[11px] text-muted-foreground">Mês</span>
                      <Input
                        value={card.expMonth}
                        disabled={generating}
                        inputMode="numeric"
                        autoComplete="cc-exp-month"
                        placeholder="MM"
                        maxLength={2}
                        onChange={(event) => setCard({ ...card, expMonth: event.target.value })}
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-[11px] text-muted-foreground">Ano</span>
                      <Input
                        value={card.expYear}
                        disabled={generating}
                        inputMode="numeric"
                        autoComplete="cc-exp-year"
                        placeholder="AA"
                        maxLength={4}
                        onChange={(event) => setCard({ ...card, expYear: event.target.value })}
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-[11px] text-muted-foreground">CVV</span>
                      <Input
                        value={card.cvv}
                        disabled={generating}
                        type="password"
                        inputMode="numeric"
                        autoComplete="cc-csc"
                        maxLength={4}
                        onChange={(event) => setCard({ ...card, cvv: event.target.value })}
                      />
                    </label>
                  </div>
                </div>
              ) : null}

              <div className="rounded-lg border border-border bg-surface p-3">
                <label
                  htmlFor="billing-coupon"
                  className="flex items-center gap-1.5 text-[12px] font-medium"
                >
                  <TicketPercent className="size-3.5 text-odds" /> Possui um cupom?
                </label>
                <div className="mt-2 flex gap-2">
                  <Input
                    id="billing-coupon"
                    value={coupon}
                    disabled={quoting || generating}
                    placeholder="Código promocional"
                    autoComplete="off"
                    maxLength={64}
                    className="uppercase"
                    onChange={(event) => {
                      setCoupon(event.target.value.replace(/[^a-zA-Z0-9_-]/g, ""));
                      onClearCoupon();
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && coupon.trim()) {
                        event.preventDefault();
                        onApplyCoupon(selectedPlanId, cycle, coupon);
                      }
                    }}
                  />
                  {quote?.couponApplied ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Remover cupom"
                      onClick={() => {
                        setCoupon("");
                        onClearCoupon();
                      }}
                    >
                      <X className="size-4" />
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={!coupon.trim() || quoting}
                      onClick={() => onApplyCoupon(selectedPlanId, cycle, coupon)}
                    >
                      {quoting ? "Validandoâ€¦" : "Aplicar"}
                    </Button>
                  )}
                </div>
                {quote?.couponApplied ? (
                  <div className="mt-2 flex items-center justify-between gap-3 text-[12px]">
                    <span className="text-ok">
                      Cupom {quote.couponApplied.toUpperCase()} aplicado
                    </span>
                    <span className="tabular">
                      <span className="mr-1.5 text-muted-foreground line-through">
                        {formatCurrency(quote.baseAmount)}
                      </span>
                      <strong className="text-odds">{formatCurrency(quote.amount)}</strong>
                    </span>
                  </div>
                ) : null}
              </div>
              {validationError ? (
                <p className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-[11px] text-danger">
                  {validationError}
                </p>
              ) : null}
              <Button type="submit" className="w-full" disabled={generating || quoting}>
                {paymentMethod === "credit_card" ? <CreditCard className="size-4" /> : <QrCode className="size-4" />}
                {generating ? "Processando pagamento…" : PAYMENT_ACTION_LABEL[paymentMethod]}
              </Button>
              <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <ShieldCheck className="size-3.5 text-primary" />
                O cartão é tokenizado no navegador; número e CVV nunca chegam ao backend.
              </p>
            </form>
          )}
        </div>

        {/* Faturas */}
        <div className="rounded-xl border border-border bg-card p-4">
          <h3 className="text-sm font-semibold">Histórico de faturas</h3>
          <ul className="mt-3 divide-y divide-border">
            {invoices.map((invoice) => (
              <li key={invoice.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium">{invoice.description}</p>
                  <p className="text-[11px] tabular text-muted-foreground">
                    {formatDateTime(invoice.paidAt ?? invoice.createdAt)}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-[13px] font-semibold tabular">
                    {formatCurrency(invoice.amount)}
                  </p>
                  <span
                    className={cn(
                      "text-[10px] uppercase tracking-wide",
                      invoice.status === "paid" && "text-ok",
                      invoice.status === "pending" && "text-odds",
                      invoice.status === "failed" && "text-danger",
                    )}
                  >
                    {INVOICE_LABEL[invoice.status]}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}

const PAYMENT_METHODS: Array<{ value: PaymentMethod; label: string }> = [
  { value: "pix", label: "Pix" },
  { value: "pix_auto", label: "Pix Automático" },
  { value: "credit_card", label: "Cartão" },
];

const PAYMENT_ACTION_LABEL: Record<PaymentMethod, string> = {
  pix: "Gerar cobrança Pix",
  pix_auto: "Autorizar Pix Automático",
  credit_card: "Pagar com cartão",
};

const PAYMENT_STATUS_LABEL: Record<string, string> = {
  waiting_payment: "Aguardando pagamento",
  processing: "Em processamento",
  paid: "Aprovado",
  approved: "Aprovado",
  purchase_approved: "Aprovado",
  refused: "Recusado",
  failed: "Falhou",
};

const STATUS_LABEL: Record<SubscriptionModel["status"], string> = {
  active: "Ativa",
  past_due: "Vencida",
  canceled: "Cancelada",
  trial: "Teste",
};

const INVOICE_LABEL: Record<Invoice["status"], string> = {
  paid: "Pago",
  pending: "Pendente",
  failed: "Falhou",
};
