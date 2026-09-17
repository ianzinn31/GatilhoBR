import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { SectionHeader } from "@/components/gatilho/primitives";
import { SubscriptionPanel } from "@/components/gatilho/SubscriptionPanel";
import { billingBridge } from "@/services/billingBridge";
import { getStoredSession } from "@/services/supabaseRest";
import type {
  BillingCycle,
  Invoice,
  PaymentCharge,
  PaymentRequest,
  PixQuote,
  PlanModel,
  SubscriptionModel,
} from "@/types/billing";

export const Route = createFileRoute("/assinatura")({
  head: () => ({
    meta: [
      { title: "Assinatura e renovação — GatilhoBR" },
      {
        name: "description",
        content:
          "Gerencie seu plano, pague via Pix, Pix Automático ou cartão e acompanhe o histórico de faturas do GatilhoBR.",
      },
      { property: "og:title", content: "Assinatura e renovação — GatilhoBR" },
      {
        property: "og:description",
        content: "Planos, pagamentos pela Cakto e faturas do painel GatilhoBR.",
      },
    ],
  }),
  component: SubscriptionPage,
});

function SubscriptionPage() {
  const [plans, setPlans] = useState<PlanModel[]>([]);
  const [subscription, setSubscription] = useState<SubscriptionModel | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [accountEmail, setAccountEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [paymentCharge, setPaymentCharge] = useState<PaymentCharge | null>(null);
  const [generating, setGenerating] = useState(false);
  const [openingCheckout, setOpeningCheckout] = useState(false);
  const [quoting, setQuoting] = useState(false);
  const [quote, setQuote] = useState<PixQuote | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([
      billingBridge.getPlans(),
      billingBridge.getSubscription(),
      billingBridge.getInvoices(),
      getStoredSession(),
    ])
      .then(([planRows, subscriptionRow, invoiceRows, session]) => {
        if (!active) return;
        setPlans(planRows);
        setSubscription(subscriptionRow);
        setInvoices(invoiceRows);
        setAccountEmail(session?.email || "");
      })
      .catch((error) =>
        toast.error(error instanceof Error ? error.message : "Falha ao carregar assinatura."),
      )
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const paymentChargeId = paymentCharge?.id;
    const subscriptionIsUnlimited = subscription?.isUnlimited;
    const subscriptionStatus = subscription?.status;
    const subscriptionRenewsAt = subscription?.renewsAt;
    if (!paymentChargeId || !subscriptionStatus || !subscriptionRenewsAt || subscriptionIsUnlimited) return;

    let active = true;
    const baselineStatus = subscriptionStatus;
    const baselineEndsAt = new Date(subscriptionRenewsAt).getTime();

    async function refreshAfterPix() {
      try {
        const [nextSubscription, nextInvoices] = await Promise.all([
          billingBridge.getSubscription(),
          billingBridge.getInvoices(),
        ]);
        if (!active) return;
        setSubscription(nextSubscription);
        setInvoices(nextInvoices);

        const nextEndsAt = new Date(nextSubscription.renewsAt).getTime();
        const settled =
          nextSubscription.status === "active" &&
          (baselineStatus !== "active" || nextEndsAt > baselineEndsAt);
        if (settled) {
          setPaymentCharge(null);
          toast.success("Pagamento confirmado", {
            description: "Sua assinatura foi renovada e o acesso já está liberado.",
          });
        }
      } catch {
        // O webhook pode levar alguns segundos; a próxima tentativa continua o acompanhamento.
      }
    }

    const timer = window.setInterval(() => void refreshAfterPix(), 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [paymentCharge?.id, subscription?.isUnlimited, subscription?.status, subscription?.renewsAt]);

  async function handleApplyCoupon(planId: string, cycle: BillingCycle, coupon: string) {
    setQuoting(true);
    try {
      const nextQuote = await billingBridge.quotePayment(planId, cycle, coupon);
      setQuote(nextQuote);
      if (coupon.trim()) {
        toast.success(
          nextQuote.couponApplied ? "Cupom aplicado" : "Cupom vÃ¡lido para outra condiÃ§Ã£o",
        );
      }
    } catch (error) {
      setQuote(null);
      toast.error(error instanceof Error ? error.message : "NÃ£o foi possÃ­vel validar o cupom.");
    } finally {
      setQuoting(false);
    }
  }

  async function handleCreatePayment(
    planId: string,
    cycle: BillingCycle,
    coupon: string,
    payment: PaymentRequest,
  ) {
    setGenerating(true);
    try {
      const charge = await billingBridge.createPayment(planId, cycle, coupon, payment);
      setPaymentCharge(charge);
      toast.success(
        payment.paymentMethod === "credit_card" ? "Pagamento enviado" : "Cobrança Pix gerada",
        {
          description: payment.paymentMethod === "credit_card"
            ? "A Cakto está processando o pagamento."
            : "Escaneie o QR Code ou use o código copia e cola.",
        },
      );
    } catch (error) {
      if (error instanceof Error) {
        toast.error(error.message);
        return;
      }
      toast.error("Não foi possível iniciar o pagamento.");
    } finally {
      setGenerating(false);
    }
  }

  async function handleOpenCheckout(planId: string, cycle: BillingCycle, coupon: string) {
    setOpeningCheckout(true);
    try {
      const checkout = await billingBridge.createHostedCheckout(planId, cycle, coupon);
      const chromeApi = (globalThis as {
        chrome?: {
          tabs?: { create?: (properties: { url: string }) => void };
        };
      }).chrome;
      if (chromeApi?.tabs?.create) {
        chromeApi.tabs.create({ url: checkout.checkoutUrl });
      } else if (!window.open(checkout.checkoutUrl, "_blank", "noopener,noreferrer")) {
        throw new Error("O navegador bloqueou a abertura do checkout da Cakto.");
      }
      toast.success("Checkout da Cakto aberto", {
        description: checkout.coupon
          ? `O cupom ${checkout.coupon.toUpperCase()} será aplicado no checkout.`
          : "Finalize o pagamento na página segura da Cakto.",
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível abrir o checkout.");
    } finally {
      setOpeningCheckout(false);
    }
  }

  async function handleCancelPix() {
    if (!paymentCharge) return;
    await billingBridge.cancelPixCharge(paymentCharge.id);
    setPaymentCharge(null);
    toast.info("Pagamento removido da tela", {
      description: "Se ainda estiver pendente, a cobrança expira automaticamente na Cakto.",
    });
  }

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Assinatura e renovação"
        description="Planos, renovação via Pix e histórico real da sua conta."
      />
      {loading || !subscription || plans.length === 0 ? (
        <div className="h-64 animate-pulse rounded-xl border border-border bg-card" />
      ) : (
        <SubscriptionPanel
          subscription={subscription}
          plans={plans}
          invoices={invoices}
          accountEmail={accountEmail}
          paymentCharge={paymentCharge}
          hostedCheckout
          openingCheckout={openingCheckout}
          generating={generating}
          quoting={quoting}
          quote={quote}
          onApplyCoupon={(planId, cycle, coupon) => void handleApplyCoupon(planId, cycle, coupon)}
          onClearCoupon={() => setQuote(null)}
          onCreatePayment={(planId, cycle, coupon, payment) =>
            void handleCreatePayment(planId, cycle, coupon, payment)}
          onOpenCheckout={(planId, cycle, coupon) =>
            void handleOpenCheckout(planId, cycle, coupon)}
          onCancelPix={() => void handleCancelPix()}
        />
      )}
    </div>
  );
}
