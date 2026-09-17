import { BadgePercent, CalendarClock, Ban, ShieldCheck, Wallet } from "lucide-react";

import { formatCurrency } from "@/lib/format";
import { formatPercent } from "@/lib/affiliate-format";
import type { AffiliateProgramRules } from "@/types/affiliate";
import { LoadingRows, PanelCard } from "./shared";

function RuleList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      <ul className="mt-2 space-y-1.5">
        {items.map((item) => (
          <li key={item} className="flex gap-2 text-xs text-foreground">
            <span className="mt-1.5 size-1 shrink-0 rounded-full bg-primary" aria-hidden />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ProgramRules({ rules }: { rules: AffiliateProgramRules | null }) {
  if (!rules) return <LoadingRows rows={5} />;

  return (
    <div className="space-y-3">
      <PanelCard
        title="Como a comissão funciona"
        description="Valores e prazos são configuráveis pelo programa e podem mudar mediante aviso."
      >
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
          {[
            {
              icon: <BadgePercent className="size-4" />,
              label: "Comissão",
              value: formatPercent(rules.commissionRate, 0),
              hint: rules.commissionModel,
            },
            {
              icon: <CalendarClock className="size-4" />,
              label: "Validação",
              value: `${rules.validationDays} dias`,
              hint: `Cookie de atribuição: ${rules.cookieDays} dias`,
            },
            {
              icon: <Wallet className="size-4" />,
              label: "Mínimo para saque",
              value: formatCurrency(rules.minWithdrawal),
              hint: rules.payoutScheduleLabel,
            },
            {
              icon: <ShieldCheck className="size-4" />,
              label: "Recorrência",
              value:
                rules.recurringMonths === "unlimited"
                  ? "Vitalícia"
                  : `${rules.recurringMonths} meses`,
              hint: `Pagamento em até ${rules.payoutEtaDays} dias úteis`,
            },
          ].map((item) => (
            <div key={item.label} className="rounded-lg border border-border bg-surface p-3">
              <div className="flex items-center gap-2 text-muted-foreground">
                {item.icon}
                <span className="text-[11px] font-medium uppercase tracking-wide">
                  {item.label}
                </span>
              </div>
              <p className="odds-num mt-1 text-lg font-semibold text-foreground">{item.value}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{item.hint}</p>
            </div>
          ))}
        </div>
      </PanelCard>

      <div className="grid gap-3 lg:grid-cols-2">
        <RuleList title="Critérios de elegibilidade" items={rules.eligibility} />
        <RuleList title="Cancelamentos e reembolsos" items={rules.cancellationPolicy} />
        <RuleList title="Condutas proibidas" items={rules.prohibitedConduct} />
        <RuleList title="Política antifraude e autoindicação" items={rules.fraudPolicy} />
        <RuleList title="Divulgação responsável" items={rules.responsibleAdvertising} />
        <div className="rounded-lg border border-odds/40 bg-odds/8 p-3">
          <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-odds">
            <Ban className="size-4" aria-hidden />
            Termos do programa
          </h3>
          <p className="mt-2 text-xs text-muted-foreground">
            A participação implica aceite integral dos termos. O programa pode revisar percentuais,
            prazos e valor mínimo, comunicando com antecedência. Descumprimento das regras pode
            gerar retenção de comissões e encerramento da conta de afiliado.
          </p>
          <a
            href={rules.termsUrl}
            className="mt-2 inline-block text-xs font-semibold text-primary underline underline-offset-4"
          >
            Ler os termos completos
          </a>
        </div>
      </div>
    </div>
  );
}
