import { useState } from "react";
import { ShieldAlert } from "lucide-react";

import { EmptyState } from "@/components/gatilho/primitives";
import { Input } from "@/components/ui/input";
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
  REFERRAL_STATUS_LABEL,
  REFERRAL_STATUS_TONE,
  formatDate,
} from "@/lib/affiliate-format";
import { formatCurrency } from "@/lib/format";
import type { Referral, ReferralLink, ReferralStatus } from "@/types/affiliate";
import { DemoDataBadge, LoadingRows, PanelCard, StatusPill } from "./shared";

const STATUSES: ReferralStatus[] = [
  "visitor",
  "signed_up",
  "trialing",
  "subscriber",
  "canceled",
  "refunded",
  "not_eligible",
];

export function ReferralsTable({
  referrals,
  links,
  loading,
  statusFilter,
  linkFilter,
  onStatusFilter,
  onLinkFilter,
}: {
  referrals: Referral[];
  links: ReferralLink[];
  loading: boolean;
  statusFilter: ReferralStatus | "all";
  linkFilter: string;
  onStatusFilter: (value: ReferralStatus | "all") => void;
  onLinkFilter: (value: string) => void;
}) {
  const [search, setSearch] = useState("");
  const visible = referrals.filter((referral) =>
    referral.maskedUser.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <PanelCard
      title="Indicações"
      description="Dados dos indicados são exibidos de forma anonimizada (LGPD)."
      actions={<DemoDataBadge />}
    >
      <div className="mb-3 grid gap-2 sm:grid-cols-3">
        <Input
          placeholder="Buscar indicado…"
          value={search}
          maxLength={60}
          onChange={(event) => setSearch(event.target.value)}
          className="h-9"
        />
        <Select
          value={statusFilter}
          onValueChange={(value) => onStatusFilter(value as ReferralStatus | "all")}
        >
          <SelectTrigger className="h-9">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            {STATUSES.map((status) => (
              <SelectItem key={status} value={status}>
                {REFERRAL_STATUS_LABEL[status]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={linkFilter} onValueChange={onLinkFilter}>
          <SelectTrigger className="h-9">
            <SelectValue placeholder="Campanha" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as campanhas</SelectItem>
            {links.map((link) => (
              <SelectItem key={link.id} value={link.id}>
                {link.campaignName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <LoadingRows rows={5} />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<ShieldAlert className="size-6" />}
          title="Nenhuma indicação encontrada"
          description="Ajuste os filtros ou divulgue seu link para começar."
        />
      ) : (
        <>
          {/* Desktop: tabela densa */}
          <div className="hidden overflow-x-auto lg:block">
            <table className="w-full min-w-[860px] border-collapse text-xs">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Indicado</th>
                  <th className="py-2 pr-3 font-medium">Cadastro</th>
                  <th className="py-2 pr-3 font-medium">Origem</th>
                  <th className="py-2 pr-3 font-medium">Plano</th>
                  <th className="py-2 pr-3 font-medium">Conversão</th>
                  <th className="py-2 pr-3 text-right font-medium">Valor elegível</th>
                  <th className="py-2 pr-3 text-right font-medium">Comissão</th>
                  <th className="py-2 font-medium">Status da comissão</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((referral) => (
                  <tr key={referral.id} className="border-b border-border/60 hover:bg-surface/60">
                    <td className="py-2 pr-3 font-medium text-foreground">{referral.maskedUser}</td>
                    <td className="py-2 pr-3 tabular text-muted-foreground">
                      {formatDate(referral.signedUpAt)}
                    </td>
                    <td className="py-2 pr-3 text-muted-foreground">{referral.originLabel}</td>
                    <td className="py-2 pr-3 text-muted-foreground">{referral.plan ?? "—"}</td>
                    <td className="py-2 pr-3">
                      <StatusPill
                        label={REFERRAL_STATUS_LABEL[referral.status]}
                        tone={REFERRAL_STATUS_TONE[referral.status]}
                      />
                    </td>
                    <td className="py-2 pr-3 text-right tabular">
                      {formatCurrency(referral.eligibleAmount)}
                    </td>
                    <td className="py-2 pr-3 text-right tabular font-semibold">
                      {formatCurrency(referral.commission)}
                    </td>
                    <td className="py-2">
                      {referral.commissionStatus ? (
                        <StatusPill
                          label={COMMISSION_STATUS_LABEL[referral.commissionStatus]}
                          tone={COMMISSION_STATUS_TONE[referral.commissionStatus]}
                        />
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Telas estreitas: cards */}
          <ul className="space-y-2 lg:hidden">
            {visible.map((referral) => (
              <li key={referral.id} className="rounded-lg border border-border bg-surface p-3">
                <div className="flex items-start justify-between gap-2">
                  <span className="truncate text-sm font-medium text-foreground">
                    {referral.maskedUser}
                  </span>
                  <StatusPill
                    label={REFERRAL_STATUS_LABEL[referral.status]}
                    tone={REFERRAL_STATUS_TONE[referral.status]}
                  />
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {formatDate(referral.signedUpAt)} · {referral.originLabel} ·{" "}
                  {referral.plan ?? "sem plano"}
                </p>
                <div className="mt-2 flex items-center justify-between gap-2 border-t border-border pt-2">
                  <span className="text-[11px] text-muted-foreground">
                    Elegível {formatCurrency(referral.eligibleAmount)}
                  </span>
                  <span className="odds-num text-sm font-semibold text-foreground">
                    {formatCurrency(referral.commission)}
                  </span>
                  {referral.commissionStatus ? (
                    <StatusPill
                      label={COMMISSION_STATUS_LABEL[referral.commissionStatus]}
                      tone={COMMISSION_STATUS_TONE[referral.commissionStatus]}
                    />
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </PanelCard>
  );
}
