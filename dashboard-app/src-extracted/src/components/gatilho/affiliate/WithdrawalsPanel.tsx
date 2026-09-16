import { useState } from "react";
import { AlertTriangle, Banknote, Lock } from "lucide-react";

import { EmptyState } from "@/components/gatilho/primitives";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  WITHDRAWAL_STATUS_LABEL,
  WITHDRAWAL_STATUS_TONE,
  formatDate,
} from "@/lib/affiliate-format";
import { formatCurrency } from "@/lib/format";
import type {
  AffiliatePayoutMethod,
  AffiliateProgramRules,
  Withdrawal,
  WithdrawalRequestInput,
} from "@/types/affiliate";
import { DemoDataBadge, LoadingRows, PanelCard, StatusPill } from "./shared";

export function WithdrawalDialog({
  open,
  onOpenChange,
  availableBalance,
  rules,
  payoutMethod,
  submitting,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  availableBalance: number;
  rules: AffiliateProgramRules;
  payoutMethod?: AffiliatePayoutMethod;
  submitting: boolean;
  onConfirm: (input: WithdrawalRequestInput) => void;
}) {
  const [amount, setAmount] = useState<string>("");
  const [step, setStep] = useState<"form" | "review">("form");
  const [confirmed, setConfirmed] = useState(false);

  const numericAmount = Number(amount.replace(",", "."));
  const hasMethod = Boolean(payoutMethod);
  const belowMin = numericAmount < rules.minWithdrawal;
  const aboveBalance = numericAmount > availableBalance;
  const valid =
    hasMethod && Number.isFinite(numericAmount) && numericAmount > 0 && !belowMin && !aboveBalance;

  function close(next: boolean) {
    onOpenChange(next);
    if (!next) {
      setStep("form");
      setConfirmed(false);
      setAmount("");
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {step === "form" ? "Solicitar saque" : "Revise antes de confirmar"}
          </DialogTitle>
          <DialogDescription>
            {step === "form"
              ? "O valor sai do saldo disponível e é processado pelo provedor de pagamentos."
              : "Confira os dados. Após confirmar, a solicitação entra em análise."}
          </DialogDescription>
        </DialogHeader>

        {step === "form" ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-ok/40 bg-ok/8 p-2.5">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Saldo disponível
                </p>
                <p className="odds-num text-base font-semibold text-ok">
                  {formatCurrency(availableBalance)}
                </p>
              </div>
              <div className="rounded-lg border border-border bg-surface p-2.5">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Valor mínimo
                </p>
                <p className="odds-num text-base font-semibold text-foreground">
                  {formatCurrency(rules.minWithdrawal)}
                </p>
              </div>
            </div>

            <div>
              <Label htmlFor="wdr-amount">Valor solicitado (R$)</Label>
              <Input
                id="wdr-amount"
                inputMode="decimal"
                maxLength={10}
                placeholder="0,00"
                value={amount}
                onChange={(event) => setAmount(event.target.value.replace(/[^\d.,]/g, ""))}
              />
              {amount && belowMin ? (
                <p className="mt-1 text-[11px] text-danger">
                  Abaixo do mínimo de {formatCurrency(rules.minWithdrawal)}.
                </p>
              ) : null}
              {amount && aboveBalance ? (
                <p className="mt-1 text-[11px] text-danger">
                  Valor maior que o saldo disponível.
                </p>
              ) : null}
            </div>

            <div className="rounded-lg border border-border bg-surface p-2.5">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Método de recebimento
              </p>
              {payoutMethod ? (
                <>
                  <p className="mt-0.5 text-sm font-medium text-foreground">
                    Pix · {payoutMethod.maskedKey}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    Titular {payoutMethod.holderName} · chave {payoutMethod.pixKeyType}
                  </p>
                  <p className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                    <Lock className="size-3" aria-hidden />
                    Alterar a chave exige confirmação adicional de identidade.
                  </p>
                </>
              ) : (
                <p className="mt-0.5 text-xs text-danger">
                  Nenhuma chave Pix cadastrada. Cadastre antes de solicitar saque.
                </p>
              )}
            </div>

            <p className="text-[11px] text-muted-foreground">
              Prazo estimado: até {rules.payoutEtaDays} dias úteis. {rules.payoutScheduleLabel}.
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            <dl className="divide-y divide-border rounded-lg border border-border bg-surface text-sm">
              {[
                ["Valor solicitado", formatCurrency(numericAmount)],
                ["Método", "Pix"],
                ["Destino", payoutMethod?.maskedKey ?? "—"],
                ["Prazo estimado", `até ${rules.payoutEtaDays} dias úteis`],
                ["Saldo após o saque", formatCurrency(availableBalance - numericAmount)],
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between gap-3 px-3 py-2">
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="tabular text-sm font-medium text-foreground">{value}</dd>
                </div>
              ))}
            </dl>

            <label className="flex items-start gap-2 rounded-lg border border-border bg-surface p-2.5 text-xs text-muted-foreground">
              <Checkbox
                checked={confirmed}
                onCheckedChange={(value) => setConfirmed(value === true)}
                className="mt-0.5"
              />
              <span>
                Confirmo que sou o titular da chave Pix informada e autorizo esta solicitação.
              </span>
            </label>

            <p className="flex items-start gap-1.5 rounded-md border border-odds/40 bg-odds/8 px-2 py-1.5 text-[11px] text-odds">
              <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />
              Ambiente de demonstração: nenhum pagamento real é feito nesta etapa.
            </p>
          </div>
        )}

        <DialogFooter>
          {step === "form" ? (
            <>
              <Button variant="outline" onClick={() => close(false)}>
                Cancelar
              </Button>
              <Button disabled={!valid} onClick={() => setStep("review")}>
                Revisar solicitação
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setStep("form")}>
                Voltar
              </Button>
              <Button
                disabled={!confirmed || submitting}
                onClick={() =>
                  onConfirm({
                    amount: numericAmount,
                    method: "pix",
                    payoutMethodId: "payout_default",
                  })
                }
              >
                {submitting ? "Enviando…" : "Confirmar saque"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function WithdrawalsPanel({
  withdrawals,
  loading,
  availableBalance,
  rules,
  onRequest,
}: {
  withdrawals: Withdrawal[];
  loading: boolean;
  availableBalance: number;
  rules: AffiliateProgramRules;
  onRequest: () => void;
}) {
  const canWithdraw = availableBalance >= rules.minWithdrawal;

  return (
    <PanelCard
      title="Saques"
      description={`Mínimo de ${formatCurrency(rules.minWithdrawal)} · ${rules.payoutScheduleLabel}`}
      actions={
        <>
          <DemoDataBadge />
          <Button size="sm" onClick={onRequest} disabled={!canWithdraw}>
            <Banknote className="size-4" />
            Solicitar saque
          </Button>
        </>
      }
    >
      {!canWithdraw ? (
        <p className="mb-3 rounded-md border border-border bg-surface px-3 py-2 text-[11px] text-muted-foreground">
          Saldo disponível ({formatCurrency(availableBalance)}) abaixo do mínimo para saque.
        </p>
      ) : null}

      {loading ? (
        <LoadingRows rows={3} />
      ) : withdrawals.length === 0 ? (
        <EmptyState
          title="Nenhum saque solicitado"
          description="Quando você solicitar, o acompanhamento aparece aqui."
        />
      ) : (
        <ul className="space-y-2">
          {withdrawals.map((withdrawal) => (
            <li
              key={withdrawal.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface p-3"
            >
              <div className="min-w-0">
                <p className="odds-num text-sm font-semibold text-foreground">
                  {formatCurrency(withdrawal.amount)}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Solicitado em {formatDate(withdrawal.requestedAt)} · Pix{" "}
                  {withdrawal.maskedDestination}
                  {withdrawal.settledAt ? ` · pago em ${formatDate(withdrawal.settledAt)}` : ""}
                </p>
                {withdrawal.statusReason ? (
                  <p className="mt-0.5 text-[11px] text-danger">{withdrawal.statusReason}</p>
                ) : null}
              </div>
              <StatusPill
                label={WITHDRAWAL_STATUS_LABEL[withdrawal.status]}
                tone={WITHDRAWAL_STATUS_TONE[withdrawal.status]}
              />
            </li>
          ))}
        </ul>
      )}
    </PanelCard>
  );
}
