import type {
  AffiliateStatus,
  CommissionStatus,
  CommissionType,
  MaterialFormat,
  PromotionChannel,
  ReferralStatus,
  SummaryPeriodPreset,
  WithdrawalStatus,
} from "@/types/affiliate";

export const CHANNEL_LABEL: Record<PromotionChannel, string> = {
  instagram: "Instagram",
  whatsapp: "WhatsApp",
  telegram: "Telegram",
  youtube: "YouTube",
  tiktok: "TikTok",
  x: "X",
  facebook: "Facebook",
  site: "Site",
  other: "Outro",
};

export const AFFILIATE_STATUS_LABEL: Record<AffiliateStatus, string> = {
  not_registered: "Não cadastrado",
  pending: "Em análise",
  active: "Ativo",
  suspended: "Suspenso",
};

export const REFERRAL_STATUS_LABEL: Record<ReferralStatus, string> = {
  visitor: "Visitante",
  signed_up: "Cadastrado",
  trialing: "Em período de teste",
  subscriber: "Assinante",
  canceled: "Cancelado",
  refunded: "Reembolsado",
  not_eligible: "Não elegível",
};

export const COMMISSION_STATUS_LABEL: Record<CommissionStatus, string> = {
  reviewing: "Em análise",
  pending: "Pendente",
  approved: "Aprovada",
  available: "Disponível",
  paid: "Paga",
  canceled: "Cancelada",
  held: "Retida",
};

export const COMMISSION_TYPE_LABEL: Record<CommissionType, string> = {
  first_payment: "Primeira mensalidade",
  recurring: "Recorrência",
  bonus: "Bônus",
  adjustment: "Ajuste / estorno",
};

export const WITHDRAWAL_STATUS_LABEL: Record<WithdrawalStatus, string> = {
  requested: "Solicitado",
  reviewing: "Em análise",
  processing: "Processando",
  paid: "Pago",
  rejected: "Recusado",
  canceled: "Cancelado",
};

export const MATERIAL_FORMAT_LABEL: Record<MaterialFormat, string> = {
  banner: "Banner",
  story: "Story",
  square: "Quadrado",
  text: "Texto sugerido",
  description: "Descrição",
  logo: "Logo",
  qr_code: "QR Code",
  script: "Modelo de chamada",
};

export const PERIOD_LABEL: Record<SummaryPeriodPreset, string> = {
  today: "Hoje",
  last_7_days: "Últimos 7 dias",
  last_30_days: "Últimos 30 dias",
  this_month: "Este mês",
  custom: "Período personalizado",
};

type Tone = "default" | "ok" | "info" | "odds" | "danger";

export const AFFILIATE_STATUS_TONE: Record<AffiliateStatus, Tone> = {
  not_registered: "default",
  pending: "odds",
  active: "ok",
  suspended: "danger",
};

export const REFERRAL_STATUS_TONE: Record<ReferralStatus, Tone> = {
  visitor: "default",
  signed_up: "info",
  trialing: "odds",
  subscriber: "ok",
  canceled: "danger",
  refunded: "danger",
  not_eligible: "default",
};

export const COMMISSION_STATUS_TONE: Record<CommissionStatus, Tone> = {
  reviewing: "odds",
  pending: "odds",
  approved: "info",
  available: "ok",
  paid: "ok",
  canceled: "danger",
  held: "danger",
};

export const WITHDRAWAL_STATUS_TONE: Record<WithdrawalStatus, Tone> = {
  requested: "info",
  reviewing: "odds",
  processing: "odds",
  paid: "ok",
  rejected: "danger",
  canceled: "default",
};

export function formatPercent(value: number, digits = 2) {
  return `${(value * 100).toFixed(digits).replace(".", ",")}%`;
}

export function formatDate(iso: string | null | undefined) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

/** Normaliza um slug digitado pelo usuário para uso em URL. */
export function normalizeSlug(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9-_]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
}
