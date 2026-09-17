import { useState } from "react";
import { CalendarRange, MousePointerClick, TrendingUp, UserPlus, Users, Wallet } from "lucide-react";

import { StatCard } from "@/components/gatilho/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCurrency } from "@/lib/format";
import { PERIOD_LABEL, formatPercent } from "@/lib/affiliate-format";
import { cn } from "@/lib/utils";
import type { AffiliateSummary, SummaryPeriod, SummaryPeriodPreset } from "@/types/affiliate";
import { DemoDataBadge, LoadingRows, PanelCard } from "./shared";

const PRESETS: SummaryPeriodPreset[] = [
  "today",
  "last_7_days",
  "last_30_days",
  "this_month",
  "custom",
];

export function PeriodFilter({
  period,
  onChange,
}: {
  period: SummaryPeriod;
  onChange: (period: SummaryPeriod) => void;
}) {
  const [from, setFrom] = useState(period.from ?? "");
  const [to, setTo] = useState(period.to ?? "");

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map((preset) => (
          <Button
            key={preset}
            type="button"
            size="sm"
            variant={period.preset === preset ? "default" : "outline"}
            onClick={() =>
              onChange(
                preset === "custom"
                  ? { preset, from: from || undefined, to: to || undefined }
                  : { preset },
              )
            }
          >
            {preset === "custom" ? <CalendarRange className="size-4" /> : null}
            {PERIOD_LABEL[preset]}
          </Button>
        ))}
      </div>

      {period.preset === "custom" ? (
        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-surface p-2.5">
          <div className="min-w-32 flex-1">
            <Label htmlFor="period-from" className="text-[11px] text-muted-foreground">
              De
            </Label>
            <Input
              id="period-from"
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              className="h-8"
            />
          </div>
          <div className="min-w-32 flex-1">
            <Label htmlFor="period-to" className="text-[11px] text-muted-foreground">
              Até
            </Label>
            <Input
              id="period-to"
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              className="h-8"
            />
          </div>
          <Button
            type="button"
            size="sm"
            onClick={() => onChange({ preset: "custom", from, to })}
            disabled={!from || !to}
          >
            Aplicar
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function SummaryCards({
  summary,
  loading,
}: {
  summary: AffiliateSummary | null;
  loading: boolean;
}) {
  if (loading || !summary) return <LoadingRows rows={3} />;

  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-5">
      <StatCard
        label="Cliques no link"
        value={summary.clicks.toLocaleString("pt-BR")}
        icon={<MousePointerClick className="size-4" />}
      />
      <StatCard
        label="Cadastros"
        value={summary.signups.toLocaleString("pt-BR")}
        icon={<UserPlus className="size-4" />}
      />
      <StatCard
        label="Usuários convertidos"
        value={summary.convertedUsers.toLocaleString("pt-BR")}
        icon={<Users className="size-4" />}
        tone="info"
      />
      <StatCard
        label="Conversões no período"
        value={summary.conversionsInPeriod.toLocaleString("pt-BR")}
        icon={<TrendingUp className="size-4" />}
      />
      <StatCard
        label="Taxa de conversão"
        value={formatPercent(summary.conversionRate)}
        hint="Convertidos ÷ cliques"
        tone="ok"
      />
      <StatCard
        label="Comissão pendente"
        value={formatCurrency(summary.pendingCommission)}
        hint="Aguardando período de validação"
        tone="odds"
      />
      <StatCard
        label="Comissão aprovada"
        value={formatCurrency(summary.approvedCommission)}
        hint="Validada, liberação agendada"
        tone="info"
      />
      <StatCard
        label="Comissão recebida"
        value={formatCurrency(summary.paidCommission)}
        hint="Já paga em saques anteriores"
      />
      <StatCard
        label="Saldo para saque"
        value={formatCurrency(summary.availableBalance)}
        hint="Liberado agora"
        icon={<Wallet className="size-4" />}
        tone="ok"
      />
    </div>
  );
}

export function ConversionFunnel({ summary }: { summary: AffiliateSummary | null }) {
  if (!summary) return <LoadingRows rows={4} />;
  const max = Math.max(...summary.funnel.map((stage) => stage.value), 1);

  return (
    <PanelCard
      title="Funil de conversão"
      description="Cliques → Cadastros → Assinaturas → Comissões aprovadas"
      actions={<DemoDataBadge />}
    >
      <ol className="space-y-2.5">
        {summary.funnel.map((stage, index) => {
          const width = Math.max(6, (stage.value / max) * 100);
          const previous = index > 0 ? summary.funnel[index - 1].value : null;
          const rate = previous && previous > 0 ? stage.value / previous : null;
          return (
            <li key={stage.key}>
              <div className="flex items-baseline justify-between gap-2 text-xs">
                <span className="truncate font-medium text-foreground">{stage.label}</span>
                <span className="odds-num shrink-0 font-semibold text-foreground">
                  {stage.value.toLocaleString("pt-BR")}
                  {rate !== null ? (
                    <span className="ml-2 font-normal text-muted-foreground">
                      {formatPercent(rate, 1)}
                    </span>
                  ) : null}
                </span>
              </div>
              <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-surface-2">
                <div
                  className={cn(
                    "h-full rounded-full transition-[width] duration-500",
                    index === 0 && "bg-info",
                    index === 1 && "bg-primary",
                    index === 2 && "bg-odds",
                    index === 3 && "bg-ok",
                  )}
                  style={{ width: `${width}%` }}
                />
              </div>
            </li>
          );
        })}
      </ol>
    </PanelCard>
  );
}
