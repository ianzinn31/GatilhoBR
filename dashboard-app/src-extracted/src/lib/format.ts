import type { ConnectionState, HouseId, MarketStatus } from "@/types/gatilho";

export const HOUSE_LABEL: Record<HouseId, string> = {
  bet365: "Bet365",
  betfair: "Betfair",
  betnacional: "Betnacional",
  betmgm: "BetMGM",
  superbet: "Superbet",
};

export const CONNECTION_LABEL: Record<ConnectionState, string> = {
  connected: "Conectada",
  disconnected: "Desconectada",
  loading: "Carregando",
  incompatible: "Página incompatível",
  expired: "Sessão expirada",
};

export const MARKET_STATUS_LABEL: Record<MarketStatus, string> = {
  open: "Aberto",
  suspended: "Suspenso",
  closed: "Fechado",
};

export function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

export function formatOdd(value: number | null) {
  if (value === null) return "—";
  return value.toFixed(2);
}

export function formatTime(iso: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(iso));
}

export function formatDateTime(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function relativeFromNow(iso: string | null) {
  if (!iso) return "nunca";
  const diff = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (diff < 10) return "agora mesmo";
  if (diff < 60) return `há ${diff}s`;
  if (diff < 3600) return `há ${Math.round(diff / 60)}min`;
  return `há ${Math.round(diff / 3600)}h`;
}
