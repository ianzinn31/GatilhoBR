import type {
  AffiliateApplicationInput,
  AffiliateProfile,
  AffiliateProgramRules,
  AffiliateSummary,
  Commission,
  CommissionFilters,
  PromotionChannel,
  PromotionalMaterial,
  Referral,
  ReferralFilters,
  ReferralLink,
  ReferralLinkInput,
  SummaryPeriod,
  Withdrawal,
  WithdrawalRequestInput,
} from "@/types/affiliate";
import { getStoredSession, supabaseRequest } from "@/services/supabaseRest";

const AFFILIATE_BASE_URL = "https://gatilhobr.com.br/indicacao";

type DbRecord = Record<string, any>;
let rowsCache: { at: number; value: Awaited<ReturnType<typeof fetchAffiliateRows>> } | null = null;

function buildUrl(slug: string) {
  return `${AFFILIATE_BASE_URL}/${slug}`;
}

function iso(value: unknown) {
  return typeof value === "string" ? value : new Date().toISOString();
}

function mapProfile(row?: DbRecord): AffiliateProfile {
  if (!row) {
    return { id: "", status: "not_registered", code: "", displayName: "", mainChannel: "instagram" };
  }
  return {
    id: row.user_id,
    status: row.status,
    code: row.code || "",
    displayName: row.display_name,
    mainChannel: row.main_channel,
    channelUrl: row.channel_url || undefined,
    audienceEstimate: row.audience_estimate || undefined,
    joinedAt: row.joined_at || undefined,
    appliedAt: row.applied_at || undefined,
    statusReason: row.status_reason || undefined,
    payoutMethod: row.payout_method || undefined,
  };
}

function mapLink(row: DbRecord, counts?: { clicks: number; referrals: DbRecord[]; commissions: DbRecord[] }): ReferralLink {
  const referrals = counts?.referrals.filter((item) => item.link_id === row.id) || [];
  const referralIds = new Set(referrals.map((item) => item.id));
  const commissions = counts?.commissions.filter((item) => referralIds.has(item.attribution_id)) || [];
  return {
    id: row.id,
    campaignId: row.id,
    campaignName: row.campaign_name,
    channel: row.channel,
    slug: row.slug,
    url: buildUrl(row.slug),
    destination: row.destination,
    utm: row.utm || undefined,
    clicks: counts?.clicks || 0,
    signups: referrals.length,
    conversions: referrals.filter((item) => item.converted_at).length,
    commission: commissions.reduce((sum, item) => sum + Number(item.amount || 0), 0),
    createdAt: iso(row.created_at),
    status: row.status,
    isPrimary: !!row.is_primary,
  };
}

async function fetchAffiliateRows() {
  const session = await getStoredSession();
  if (!session) throw new Error("Faça login para acessar o programa de afiliados.");
  const [profiles, terms, links, referrals, commissions, withdrawals, materials] = await Promise.all([
    supabaseRequest<DbRecord[]>(`/rest/v1/affiliate_profiles?user_id=eq.${session.userId}&select=*`),
    supabaseRequest<DbRecord[]>(`/rest/v1/affiliate_terms?affiliate_user_id=eq.${session.userId}&active=eq.true&select=*&order=version.desc&limit=1`),
    supabaseRequest<DbRecord[]>(`/rest/v1/referral_links?affiliate_user_id=eq.${session.userId}&select=*&order=created_at.asc`),
    supabaseRequest<DbRecord[]>(`/rest/v1/referral_attributions?affiliate_user_id=eq.${session.userId}&select=*`),
    supabaseRequest<DbRecord[]>(`/rest/v1/affiliate_ledger_commissions?affiliate_user_id=eq.${session.userId}&select=*&order=created_at.desc`),
    supabaseRequest<DbRecord[]>(`/rest/v1/affiliate_withdrawals?affiliate_user_id=eq.${session.userId}&select=*&order=requested_at.desc`),
    supabaseRequest<DbRecord[]>(`/rest/v1/affiliate_materials?active=eq.true&select=*&order=updated_at.desc`),
  ]);
  return { session, profile: profiles[0], terms: terms[0], links, referrals, commissions, withdrawals, materials };
}

async function loadAffiliateRows() {
  if (rowsCache && Date.now() - rowsCache.at < 1_500) return rowsCache.value;
  const value = await fetchAffiliateRows();
  rowsCache = { at: Date.now(), value };
  return value;
}

function invalidateAffiliateRows() {
  rowsCache = null;
}

function inPeriod(date: string, period: SummaryPeriod) {
  const value = new Date(date).getTime();
  const now = Date.now();
  let from = 0;
  if (period.preset === "today") from = new Date().setHours(0, 0, 0, 0);
  if (period.preset === "last_7_days") from = now - 7 * 864e5;
  if (period.preset === "last_30_days") from = now - 30 * 864e5;
  if (period.preset === "this_month") from = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
  if (period.preset === "custom") from = new Date(period.from || 0).getTime();
  const to = period.preset === "custom" && period.to ? new Date(period.to).getTime() + 864e5 : now;
  return value >= from && value <= to;
}

export const affiliateBridge = {
  async getAffiliateProfile(): Promise<AffiliateProfile> {
    const rows = await loadAffiliateRows();
    return mapProfile(rows.profile);
  },

  async applyToAffiliateProgram(input: AffiliateApplicationInput): Promise<AffiliateProfile> {
    const session = await getStoredSession();
    if (!session) throw new Error("Faça login antes de enviar a solicitação.");
    await supabaseRequest<DbRecord[]>("/rest/v1/affiliate_applications?select=*", {
      method: "POST",
      prefer: "return=representation",
      body: JSON.stringify({
        user_id: session.userId,
        display_name: input.displayName,
        main_channel: input.mainChannel,
        channel_url: input.channelUrl,
        audience_estimate: input.audienceEstimate,
        promotion_plan: input.promotionPlan,
        accepted_terms: input.acceptedTerms,
      }),
    });
    invalidateAffiliateRows();
    return {
      id: session.userId,
      status: "pending",
      code: "",
      displayName: input.displayName,
      mainChannel: input.mainChannel,
      channelUrl: input.channelUrl,
      audienceEstimate: input.audienceEstimate,
      appliedAt: new Date().toISOString(),
      statusReason: "Cadastro em análise.",
    };
  },

  async getAffiliateSummary(period: SummaryPeriod): Promise<AffiliateSummary> {
    const rows = await loadAffiliateRows();
    const refs = rows.referrals.filter((item) => inPeriod(item.attributed_at, period));
    const commissions = rows.commissions.filter((item) => inPeriod(item.created_at, period));
    const converted = refs.filter((item) => item.converted_at).length;
    const sumStatus = (status: string) =>
      commissions.filter((item) => item.status === status).reduce((sum, item) => sum + Number(item.amount || 0), 0);
    return {
      period,
      clicks: 0,
      signups: refs.length,
      convertedUsers: converted,
      conversionsInPeriod: converted,
      conversionRate: refs.length ? converted / refs.length : 0,
      pendingCommission: sumStatus("pending") + sumStatus("reviewing"),
      approvedCommission: sumStatus("approved"),
      paidCommission: sumStatus("paid"),
      availableBalance: rows.commissions
        .filter((item) => item.status === "available")
        .reduce((sum, item) => sum + Number(item.amount || 0), 0),
      funnel: [
        { key: "clicks", label: "Cliques", value: 0 },
        { key: "signups", label: "Cadastros", value: refs.length },
        { key: "subscriptions", label: "Assinaturas", value: converted },
        { key: "approved_commissions", label: "Comissões aprovadas", value: commissions.filter((item) => ["approved", "available", "paid"].includes(item.status)).length },
      ],
    };
  },

  async getReferralLinks(): Promise<ReferralLink[]> {
    const rows = await loadAffiliateRows();
    return rows.links.map((row) => mapLink(row, { clicks: 0, referrals: rows.referrals, commissions: rows.commissions }));
  },

  async createReferralLink(data: ReferralLinkInput): Promise<ReferralLink> {
    const rows = await loadAffiliateRows();
    if (!rows.profile || !rows.terms) throw new Error("A conta ainda não foi ativada como afiliada.");
    const created = await supabaseRequest<DbRecord[]>("/rest/v1/referral_links?select=*", {
      method: "POST",
      prefer: "return=representation",
      body: JSON.stringify({
        affiliate_user_id: rows.session.userId,
        terms_id: rows.terms.id,
        campaign_name: data.campaignName,
        channel: data.channel,
        slug: data.slug.trim().toLowerCase(),
        destination: data.destination,
        utm: data.utm || {},
      }),
    });
    invalidateAffiliateRows();
    return mapLink(created[0]);
  },

  async updateReferralLink(id: string, data: Partial<ReferralLinkInput>): Promise<ReferralLink> {
    const payload: DbRecord = {};
    if (data.campaignName !== undefined) payload.campaign_name = data.campaignName;
    if (data.channel !== undefined) payload.channel = data.channel;
    if (data.slug !== undefined) payload.slug = data.slug.trim().toLowerCase();
    if (data.destination !== undefined) payload.destination = data.destination;
    if (data.utm !== undefined) payload.utm = data.utm;
    const updated = await supabaseRequest<DbRecord[]>(
      `/rest/v1/referral_links?id=eq.${encodeURIComponent(id)}&select=*`,
      { method: "PATCH", prefer: "return=representation", body: JSON.stringify(payload) },
    );
    invalidateAffiliateRows();
    return mapLink(updated[0]);
  },

  async disableReferralLink(id: string): Promise<ReferralLink> {
    const current = await supabaseRequest<DbRecord[]>(`/rest/v1/referral_links?id=eq.${encodeURIComponent(id)}&select=*`);
    const updated = await supabaseRequest<DbRecord[]>(
      `/rest/v1/referral_links?id=eq.${encodeURIComponent(id)}&select=*`,
      {
        method: "PATCH",
        prefer: "return=representation",
        body: JSON.stringify({ status: current[0]?.status === "active" ? "disabled" : "active" }),
      },
    );
    invalidateAffiliateRows();
    return mapLink(updated[0]);
  },

  async getReferrals(filters: ReferralFilters = {}): Promise<Referral[]> {
    const rows = await loadAffiliateRows();
    const linkNames = new Map(rows.links.map((item) => [item.id, item.campaign_name]));
    return rows.referrals
      .filter((item) => !filters.status || filters.status === "all" || item.status === filters.status)
      .filter((item) => !filters.linkId || filters.linkId === "all" || item.link_id === filters.linkId)
      .map((item) => {
        const commission = rows.commissions.find((value) => value.attribution_id === item.id);
        const short = String(item.referred_user_id || "").slice(0, 8);
        return {
          id: item.id,
          maskedUser: `Usuário ${short}…`,
          signedUpAt: iso(item.attributed_at),
          linkId: item.link_id,
          originLabel: linkNames.get(item.link_id) || "Link de indicação",
          plan: item.converted_at ? "Mensal" : null,
          status: item.status,
          eligibleAmount: Number(commission?.eligible_amount || 0),
          commission: Number(commission?.amount || 0),
          commissionStatus: commission?.status || null,
        };
      });
  },

  async getCommissions(filters: CommissionFilters = {}): Promise<Commission[]> {
    const rows = await loadAffiliateRows();
    return rows.commissions
      .filter((item) => !filters.status || filters.status === "all" || item.status === filters.status)
      .filter((item) => !filters.type || filters.type === "all" || item.type === filters.type)
      .map((item) => ({
        id: item.id,
        createdAt: iso(item.created_at),
        reference: `Pagamento ${item.payment_reference}`,
        referralId: item.attribution_id,
        type: item.type,
        amount: Number(item.amount || 0),
        status: item.status,
        releaseForecastAt: item.release_at || null,
        blockReason: item.block_reason || undefined,
      }));
  },

  async getWithdrawalHistory(): Promise<Withdrawal[]> {
    const rows = await loadAffiliateRows();
    return rows.withdrawals.map((item) => ({
      id: item.id,
      requestedAt: iso(item.requested_at),
      amount: Number(item.amount),
      method: "pix",
      maskedDestination: item.masked_destination,
      status: item.status,
      settledAt: item.settled_at || undefined,
      statusReason: item.status_reason || undefined,
    }));
  },

  async requestWithdrawal(data: WithdrawalRequestInput): Promise<Withdrawal> {
    const created = await supabaseRequest<DbRecord[]>("/rest/v1/rpc/request_affiliate_withdrawal", {
      method: "POST",
      body: JSON.stringify({ p_amount: data.amount, p_payout_method_id: data.payoutMethodId }),
    });
    invalidateAffiliateRows();
    const item = Array.isArray(created) ? created[0] : created;
    return {
      id: item.id,
      requestedAt: iso(item.requested_at),
      amount: Number(item.amount),
      method: "pix",
      maskedDestination: item.masked_destination,
      status: item.status,
    };
  },

  async getPromotionalMaterials(): Promise<PromotionalMaterial[]> {
    const rows = await loadAffiliateRows();
    return rows.materials.map((item) => ({
      id: item.id,
      title: item.title,
      format: item.format,
      channels: item.channels || [],
      dimensions: item.dimensions || undefined,
      text: item.body_text || undefined,
      downloadUrl: item.download_url || undefined,
      updatedAt: iso(item.updated_at),
    }));
  },

  async getProgramRules(): Promise<AffiliateProgramRules> {
    const rows = await loadAffiliateRows();
    const terms = rows.terms;
    const payments = terms?.commission_model === "recurring" ? "unlimited" : Number(terms?.commission_payment_count || 1);
    return {
      commissionRate: Number(terms?.commission_rate || 20) / 100,
      commissionModel: terms
        ? `${terms.commission_rate}% por ${payments === "unlimited" ? "todo o período ativo" : `${payments} pagamento(s)`}`
        : "Condições definidas após a aprovação do afiliado",
      recurringMonths: payments,
      validationDays: Number(terms?.validation_days || 14),
      cookieDays: Number(terms?.cookie_days || 30),
      minWithdrawal: Number(terms?.minimum_withdrawal || 50),
      payoutScheduleLabel: "Saques processados após análise",
      payoutEtaDays: 3,
      eligibility: ["Conta de afiliado aprovada.", "Divulgação apenas para maiores de 18 anos."],
      cancellationPolicy: ["Reembolsos e chargebacks anulam a comissão correspondente."],
      prohibitedConduct: ["Spam, autoindicação, contas falsas e promessa de lucro garantido."],
      fraudPolicy: ["Conversões suspeitas ficam retidas para análise."],
      responsibleAdvertising: ["Divulgue como ferramenta de apoio e inclua o aviso de jogo responsável."],
      termsUrl: "#termos-do-programa",
      updatedAt: iso(terms?.created_at),
    };
  },

  async copyReferralLink(id: string): Promise<boolean> {
    const links = await this.getReferralLinks();
    const link = links.find((item) => item.id === id);
    return link ? copyText(link.url) : false;
  },

  async shareReferralLink(
    id: string,
    channel: PromotionChannel | "native" | "copy",
    message?: string,
  ): Promise<{ shared: boolean; fallbackUrl?: string }> {
    const links = await this.getReferralLinks();
    const link = links.find((item) => item.id === id);
    if (!link) return { shared: false };
    const text = message ?? `Conheça o GatilhoBR: ${link.url}`;
    if (channel === "copy") return { shared: await copyText(text) };
    if (channel === "native" && "share" in navigator) {
      try {
        await navigator.share({ title: "GatilhoBR", text, url: link.url });
        return { shared: true };
      } catch {
        return { shared: false, fallbackUrl: link.url };
      }
    }
    if (channel === "native") return { shared: false, fallbackUrl: link.url };
    const encoded = encodeURIComponent(text);
    const encodedUrl = encodeURIComponent(link.url);
    const targets: Partial<Record<PromotionChannel, string>> = {
      whatsapp: `https://wa.me/?text=${encoded}`,
      telegram: `https://t.me/share/url?url=${encodedUrl}&text=${encoded}`,
      x: `https://twitter.com/intent/tweet?text=${encoded}`,
      facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`,
    };
    const target = targets[channel];
    if (!target) return { shared: false, fallbackUrl: link.url };
    window.open(target, "_blank", "noopener,noreferrer");
    return { shared: true };
  },
};

export async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}
