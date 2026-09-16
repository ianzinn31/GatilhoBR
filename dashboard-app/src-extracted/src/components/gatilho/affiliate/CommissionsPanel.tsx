import { AlertTriangle, Clock, Wallet } from "lucide-react";

import { EmptyState } from "@/components/gatilho/primitives";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  COMMISSION_STATUS_LABEL,
  COMMISSION_STATUS_TONE,
  COMMISSION_TYPE_LABEL,
  formatDate,
} from "@/lib/affiliate-format";
import { formatCurrency } from "@/lib/format";
import type {
  Commission,
  CommissionStatus,
  CommissionType,
  AffiliateSummary,
} from "@/types/affiliate";
import { DemoDataBadge, LoadingRows, PanelCard, StatusPill } from "./shared";

const STATUSES: CommissionStatus[] = [
  "reviewing",
  "pending",
  "approved",
  "available",
  "paid",
  "canceled",
  "held",
];

const TYPES: CommissionType[] = ["first_payment", "recurring", "bonus", "adjustment"];

export function BalanceExplainer({ summary }: { summary: AffiliateSummary | null }) {
  const pending = summary?.pendingCommission ?? 0;
  const available = summary?.availableBalance ?? 0;

  return (
    <div className="grid gap-2.5 sm:grid-cols-2">
      <div className="rounded-lg border border-odds/40 bg-odds/8 p-3">
        <div className="flex items-center gap-2 text-odds">
          <Clock className="size-4" aria-hidden />
          <span className="text-xs font-semibold uppercase tracking-wide">Saldo pendente</span>
        </div>
        <p className="odds-num mt-1 text-xl font-semibold text-odds">{formatCurrency(pending)}</p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Comissões geradas que ainda estão no período de validação. Podem ser canceladas em caso de
          reembolso ou cancelamento do indicado.
        </p>
      </div>
      <div className="rounded-lg border border-ok/40 bg-ok/8 p-3">
        <div className="flex items-center gap-2 text-ok">
          <Wallet className="size-4" aria-hidden />
          <span className="text-xs font-semibold uppercase tracking-wide">Saldo disponível</span>
        </div>
        <p className="odds-num mt-1 text-xl font-semibold text-ok">{formatCurrency(available)}</p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Já validado e liberado. É este valor que pode ser solicitado em saque.
        </p>
      </div>
    </div>
  );
}

export function CommissionsPanel({
  commissions,
  loading,
  statusFilter,
  typeFilter,
  onStatusFilter,
  onTypeFilter,
}: {
  commissions: Commission[];
  loading: boolean;
  statusFilter: CommissionStatus | "all";
  typeFilter: CommissionType | "all";
  onStatusFilter: (value: CommissionStatus | "all") => void;
  onTypeFilter: (value: CommissionType | "all") => void;
}) {
  return (
    <PanelCard
      title="Extrato de comissões"
      description="Cada lançamento traz status, previsão de liberação e motivo de bloqueio quando houver."
      actions={<DemoDataBadge />}
    >
      <div className="mb-3 grid gap-2 sm:grid-cols-2">
        <Select
          value={statusFilter}
          onValueChange={(value) => onStatusFilter(value as CommissionStatus | "all")}
        >
          <SelectTrigger className="h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            {STATUSES.map((status) => (
              <SelectItem key={status} value={status}>
                {COMMISSION_STATUS_LABEL[status]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={typeFilter}
          onValueChange={(value) => onTypeFilter(value as CommissionType | "all")}
        >
          <SelectTrigger className="h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os tipos</SelectItem>
            {TYPES.map((type) => (
              <SelectItem key={type} value={type}>
                {COMMISSION_TYPE_LABEL[type]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <LoadingRows rows={5} />
      ) : commissions.length === 0 ? (
        <EmptyState
          title="Nenhuma comissão neste filtro"
          description="Assim que um indicado assinar, o lançamento aparece aqui."
        />
      ) : (
        <ul className="space-y-2">
          {commissions.map((commission) => (
            <li key={commission.id} className="rounded-lg border border-border bg-surface p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">
                    {commission.reference}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {formatDate(commission.createdAt)} ·{" "}
                    {COMMISSION_TYPE_LABEL[commission.type]}
                    {commission.releaseForecastAt
                      ? ` · liberação prevista ${formatDate(commission.releaseForecastAt)}`
                      : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span
                    className={
                      commission.amount < 0
                        ? "odds-num text-sm font-semibold text-danger"
                        : "odds-num text-sm font-semibold text-foreground"
                    }
                  >
                    {formatCurrency(commission.amount)}
                  </span>
                  <StatusPill
                    label={COMMISSION_STATUS_LABEL[commission.status]}
                    tone={COMMISSION_STATUS_TONE[commission.status]}
                  />
                </div>
              </div>
              {commission.blockReason ? (
                <p className="mt-2 flex items-start gap-1.5 rounded-md border border-danger/30 bg-danger/8 px-2 py-1.5 text-[11px] text-danger">
                  <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />
                  {commission.blockReason}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </PanelCard>
  );
}
