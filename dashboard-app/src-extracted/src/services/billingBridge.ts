import type {
  BillingCycle,
  HostedCheckout,
  Invoice,
  PaymentCharge,
  PaymentRequest,
  PixQuote,
  PlanModel,
  SubscriptionModel,
} from "@/types/billing";
import { getCaktoSdkBridge } from "@/services/caktoSdkBridge";
import { getStoredSession, invokeFunction, supabaseRequest } from "@/services/supabaseRest";

// Supabase REST rows are intentionally untyped at this boundary.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbRecord = Record<string, any>;

function daysRemaining(end: string) {
  return Math.max(0, Math.ceil((new Date(end).getTime() - Date.now()) / 86_400_000));
}

const TRIAL_DURATION_MS = 24 * 60 * 60 * 1000;

async function generateDeviceFingerprint() {
  const extensionRuntime = (globalThis as {
    chrome?: { runtime?: { id?: string } };
  }).chrome?.runtime;
  const source = [
    navigator.userAgent || "",
    `${screen.width || 0}x${screen.height || 0}x${screen.colorDepth || 0}`,
    extensionRuntime?.id || "gatilhobr",
  ].join("|");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function trialEndFromProfile(profile: DbRecord | undefined) {
  if (!profile) return null;
  const explicitEnd = profile.trial_ends_at
    ? new Date(profile.trial_ends_at).getTime()
    : Number.POSITIVE_INFINITY;
  if (!profile.created_at) {
    return Number.isFinite(explicitEnd) ? new Date(explicitEnd).toISOString() : null;
  }
  const createdAt = new Date(profile.created_at).getTime();
  if (!Number.isFinite(createdAt)) return null;
  return new Date(Math.min(explicitEnd, createdAt + TRIAL_DURATION_MS)).toISOString();
}

export const billingBridge = {
  async getPlans(): Promise<PlanModel[]> {
    const rows = await supabaseRequest<DbRecord[]>(
      "/rest/v1/subscription_plans?active=eq.true&select=*&order=monthly_price.asc",
    );
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      tagline: row.tagline,
      monthlyPrice: Number(row.monthly_price),
      yearlyPrice: Number(row.yearly_price || 0),
      features: Array.isArray(row.features) ? row.features : [],
      highlighted: !!row.highlighted,
      futurePrice: row.future_monthly_price == null ? undefined : Number(row.future_monthly_price),
      promoNote: row.promo_note || undefined,
    }));
  },

  async getSubscription(): Promise<SubscriptionModel> {
    const session = await getStoredSession();
    if (!session) throw new Error("Faça login para consultar sua assinatura.");
    const [rows, profiles] = await Promise.all([
      supabaseRequest<DbRecord[]>(
        `/rest/v1/user_subscriptions?user_id=eq.${session.userId}&status=in.(trial,active,past_due)&select=*,subscription_plans(name)&order=created_at.desc&limit=1`,
      ),
      supabaseRequest<DbRecord[]>(
        `/rest/v1/profiles?id=eq.${encodeURIComponent(session.userId)}&select=id,role,status,trial_ends_at,subscription_ends_at,created_at`,
      ),
    ]);
    const profile = profiles[0];
    const role = String(profile?.role || "").toLowerCase();

    if (role === "admin" || role === "dev") {
      return {
        id: "unlimited",
        planId: "plan_mensal",
        planName: "Acesso ilimitado",
        status: "active",
        cycle: "monthly",
        amount: 0,
        renewsAt: "9999-12-31T23:59:59.999Z",
        daysRemaining: 0,
        isUnlimited: true,
      };
    }

    const trialEndsAt = trialEndFromProfile(profile);
    const trialEndsMs = trialEndsAt ? new Date(trialEndsAt).getTime() : Number.NaN;
    if (profile?.status === "trial" && trialEndsAt && Number.isFinite(trialEndsMs)) {
      return {
        id: "trial",
        planId: "plan_mensal",
        planName: "Período de teste de 24 horas",
        status: trialEndsMs > Date.now() ? "trial" : "past_due",
        cycle: "monthly",
        amount: 0,
        renewsAt: trialEndsAt,
        daysRemaining: daysRemaining(trialEndsAt),
      };
    }

    const row = rows[0];
    if (!row) {
      const subscriptionEndsAt = profile?.subscription_ends_at;
      if (
        profile?.status === "active" &&
        subscriptionEndsAt &&
        new Date(subscriptionEndsAt) > new Date()
      ) {
        return {
          id: "active_profile",
          planId: "plan_mensal",
          planName: "Assinatura ativa",
          status: "active",
          cycle: "monthly",
          amount: 0,
          renewsAt: subscriptionEndsAt,
          daysRemaining: daysRemaining(subscriptionEndsAt),
        };
      }
      return {
        id: "sem_assinatura",
        planId: "plan_mensal",
        planName: "Sem assinatura",
        status: "past_due",
        cycle: "monthly",
        amount: 0,
        renewsAt: new Date().toISOString(),
        daysRemaining: 0,
      };
    }
    return {
      id: row.id,
      planId: row.plan_id,
      planName: row.subscription_plans?.name || "Mensal",
      status: row.status,
      cycle: row.billing_cycle,
      amount: Number(row.amount),
      renewsAt: row.current_period_end,
      daysRemaining: daysRemaining(row.current_period_end),
    };
  },

  async getInvoices(): Promise<Invoice[]> {
    const session = await getStoredSession();
    if (!session) throw new Error("Faça login para consultar suas faturas.");
    const rows = await supabaseRequest<DbRecord[]>(
      `/rest/v1/billing_invoices?user_id=eq.${session.userId}&select=*&order=created_at.desc`,
    );
    return rows.map((row) => ({
      id: row.id,
      description: row.description,
      amount: Number(row.amount),
      status: row.status === "paid" ? "paid" : row.status === "pending" ? "pending" : "failed",
      createdAt: row.created_at,
      paidAt: row.paid_at,
    }));
  },

  async quotePayment(planId: string, cycle: BillingCycle, coupon = ""): Promise<PixQuote> {
    const data = await invokeFunction<DbRecord>("create-pix-charge", {
      action: "quote",
      planId,
      cycle,
      coupon: coupon.trim() || undefined,
    });
    return {
      planId: data.planId || planId,
      cycle: data.cycle || cycle,
      baseAmount: Number(data.baseAmount),
      discountAmount: Number(data.discountAmount || 0),
      amount: Number(data.amount),
      couponApplied: data.couponApplied || null,
    };
  },

  async quotePixCharge(planId: string, cycle: BillingCycle, coupon = ""): Promise<PixQuote> {
    return this.quotePayment(planId, cycle, coupon);
  },

  async createHostedCheckout(
    planId: string,
    cycle: BillingCycle,
    coupon = "",
  ): Promise<HostedCheckout> {
    const data = await invokeFunction<DbRecord>("create-pix-charge", {
      action: "checkout",
      planId,
      cycle,
      coupon: coupon.trim() || undefined,
    });
    if (!data.checkoutUrl) throw new Error("A Cakto não retornou o link do checkout.");
    return {
      id: String(data.txid || data.id || ""),
      planId: data.planId || planId,
      cycle: data.cycle || cycle,
      amount: Number(data.amount),
      baseAmount: Number(data.baseAmount || data.amount),
      coupon: data.coupon || null,
      checkoutUrl: String(data.checkoutUrl),
      status: String(data.status || "checkout_open"),
      expiresAt: String(data.expiresAt || new Date(Date.now() + 86_400_000).toISOString()),
    };
  },

  async createPayment(
    planId: string,
    cycle: BillingCycle,
    coupon: string,
    payment: PaymentRequest,
  ): Promise<PaymentCharge> {
    const config = await invokeFunction<{ clientId?: string }>("create-pix-charge", {
      action: "config",
    });
    const sdk = getCaktoSdkBridge();
    await sdk.init(String(config.clientId || ""));
    try {
      const fingerprint = await generateDeviceFingerprint();
      const antifraudReference = await sdk.getAntifraudReference();
      const cardToken = payment.paymentMethod === "credit_card" && payment.card
        ? await sdk.tokenize(payment.card)
        : undefined;
      const data = await invokeFunction<DbRecord>("create-pix-charge", {
        action: "create",
        planId,
        cycle,
        coupon: coupon.trim() || undefined,
        paymentMethod: payment.paymentMethod,
        customer: {
          ...payment.customer,
          email: (await getStoredSession())?.email || undefined,
        },
        fingerprint,
        antifraudProfilingAttemptReference: antifraudReference,
        cardToken,
      });
      return {
        id: data.txid || data.id,
        paymentId: data.paymentId || undefined,
        refId: data.refId || undefined,
        planId: data.planId || planId,
        cycle: data.cycle || cycle,
        amount: Number(data.amount),
        paymentMethod: data.paymentMethod || payment.paymentMethod,
        status: data.status || "waiting_payment",
        payload: data.pixCopiaECola || "",
        expiresAt: data.expiresAt || new Date(Date.now() + 3600_000).toISOString(),
        qrCodeImage: data.qrcode || undefined,
        checkoutUrl: data.checkoutUrl || undefined,
      };
    } finally {
      await sdk.cleanup();
    }
  },

  async createPixCharge(planId: string, cycle: BillingCycle, coupon = ""): Promise<PaymentCharge> {
    throw new Error("Selecione seus dados e um metodo de pagamento para continuar.");
  },

  async cancelPixCharge(chargeId: string): Promise<void> {
    void chargeId;
    // A cobrança expira no provedor. Não marcamos como cancelada no cliente.
  },
};
