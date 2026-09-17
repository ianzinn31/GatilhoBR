import { useEffect, useState } from "react";
import { AlertTriangle, Save, Zap } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { statusToast } from "@/components/gatilho/StatusToast";
import { HOUSES } from "@/data/mocks/catalog";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { HouseId, OddsChangePolicy, StakeSettings } from "@/types/gatilho";

export function StakePanel({
  stake,
  onSave,
}: {
  stake: StakeSettings;
  onSave: (next: StakeSettings) => Promise<StakeSettings | void>;
}) {
  const [draft, setDraft] = useState<StakeSettings>(stake);
  const [saving, setSaving] = useState(false);

  useEffect(() => setDraft(stake), [stake]);

  const patch = (partial: Partial<StakeSettings>) => setDraft((prev) => ({ ...prev, ...partial }));
  const currentOddsPolicy: OddsChangePolicy =
    draft.oddsChangePolicy ?? (draft.acceptOddsChange ? "accept_any" : "reject_changes");
  const overLimit =
    draft.stake > draft.maxStake ||
    Object.values(draft.stakeByHouse ?? {}).some((value) => value > draft.maxStake);
  const dirty = JSON.stringify(draft) !== JSON.stringify(stake);

  const setHouseStake = (house: HouseId, rawValue: string) => {
    const next = { ...(draft.stakeByHouse ?? {}) };
    if (!rawValue.trim()) {
      delete next[house];
    } else {
      const value = Number(rawValue);
      if (Number.isFinite(value)) next[house] = value;
    }
    patch({ stakeByHouse: next });
  };

  return (
    <div className="space-y-3">
      <section className="rounded-lg border border-border bg-card p-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Valores
        </h2>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <Label className="mb-1 block text-[11px] text-muted-foreground">Stake padrão</Label>
            <Input
              type="number"
              min={0}
              value={draft.stake}
              onChange={(event) => patch({ stake: Number(event.target.value) })}
              className={cn("h-9 tabular", overLimit && "border-danger")}
            />
          </div>
          <div>
            <Label className="mb-1 block text-[11px] text-muted-foreground">Limite máximo</Label>
            <Input
              type="number"
              min={0}
              value={draft.maxStake}
              onChange={(event) => patch({ maxStake: Number(event.target.value) })}
              className="h-9 tabular"
            />
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {draft.quickValues.map((value) => (
            <Button
              key={value}
              type="button"
              size="sm"
              variant={draft.stake === value ? "secondary" : "outline"}
              className="h-8 tabular"
              onClick={() => patch({ stake: value })}
            >
              {formatCurrency(value)}
            </Button>
          ))}
        </div>

        {overLimit ? (
          <p className="mt-2 flex items-center gap-1.5 text-[11px] font-medium text-danger">
            <AlertTriangle className="size-3.5" />A stake padrão está acima do limite máximo —
            disparos serão bloqueados.
          </p>
        ) : null}
      </section>

      <section className="rounded-lg border border-border bg-card p-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Stake por casa
        </h2>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Opcional. Deixe em branco para usar a stake geral nesta casa.
        </p>

        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {HOUSES.map((house) => {
            const override = draft.stakeByHouse?.[house.id];
            const houseOverLimit = override !== undefined && override > draft.maxStake;

            return (
              <div key={house.id}>
                <Label
                  htmlFor={`stake-${house.id}`}
                  className="mb-1 block text-[11px] text-muted-foreground"
                >
                  {house.name}
                </Label>
                <Input
                  id={`stake-${house.id}`}
                  type="number"
                  min={0}
                  step="0.01"
                  value={override ?? ""}
                  placeholder={formatCurrency(draft.stake)}
                  onChange={(event) => setHouseStake(house.id, event.target.value)}
                  className={cn("h-9 tabular", houseOverLimit && "border-danger")}
                />
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {override === undefined
                    ? `Usando geral: ${formatCurrency(draft.stake)}`
                    : `Personalizada: ${formatCurrency(override)}`}
                </p>
              </div>
            );
          })}
        </div>

        {overLimit ? (
          <p className="mt-2 flex items-center gap-1.5 text-[11px] font-medium text-danger">
            <AlertTriangle className="size-3.5" />
            Uma das stakes configuradas está acima do limite máximo — disparos serão bloqueados.
          </p>
        ) : null}
      </section>

      <section className="rounded-lg border border-border bg-card p-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Comportamento de execução
        </h2>
        <div className="mt-3 space-y-3">
          <div
            className={cn(
              "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border p-3",
              draft.executionMode === "DIRECT_NETWORK"
                ? "border-primary/40 bg-primary/5"
                : "border-border bg-background/40",
            )}
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Zap className="size-4 text-primary" />
                <Label htmlFor="direct-network" className="text-[13px] font-semibold">
                  Aceleração automática Bet365
                </Label>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {draft.executionMode === "DIRECT_NETWORK"
                  ? "A extensão configura a rota direta sozinha. Se ainda precisar aprender o perfil da casa, a próxima aposta usa o fluxo visual uma vez e mantém o fallback seguro."
                  : "Usa somente o fluxo visual da Bet365. Ative para reduzir a latência sem console ou configuração técnica."}
              </p>
            </div>
            <Switch
              id="direct-network"
              checked={draft.executionMode === "DIRECT_NETWORK"}
              onCheckedChange={(checked) =>
                patch({
                  executionMode: checked ? "DIRECT_NETWORK" : "DOM_UI",
                  directOrderAutoSelection: checked,
                })
              }
              className="shrink-0"
            />
          </div>
          <ToggleRow
            id="one-click"
            label="Um clique"
            description="Dispara sem etapa de confirmação. Use com atenção."
            checked={draft.oneClick}
            onChange={(checked) => patch({ oneClick: checked })}
          />
          <ToggleRow
            id="auto-fill"
            label="Preencher stake automaticamente"
            description="Coloca o valor no boletim da casa assim que a seleção abre."
            checked={draft.autoFill}
            onChange={(checked) => patch({ autoFill: checked })}
          />
          <div>
            <Label className="mb-1 block text-[11px] text-muted-foreground">
              Política para mudança de odd
            </Label>
            <Select
              value={currentOddsPolicy}
              onValueChange={(value) => {
                const policy = value as OddsChangePolicy;
                patch({
                  oddsChangePolicy: policy,
                  acceptOddsChange: policy !== "reject_changes",
                });
              }}
            >
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="reject_changes">Rejeitar qualquer mudança</SelectItem>
                <SelectItem value="accept_higher_only">Aceitar apenas aumento</SelectItem>
                <SelectItem value="accept_any">Aceitar qualquer mudança</SelectItem>
              </SelectContent>
            </Select>
            <p className="mt-1 text-[11px] text-muted-foreground">
              O aceite da nova cotação é uma etapa separada do botão financeiro.
            </p>
          </div>
          <div>
            <Label className="mb-1 block text-[11px] text-muted-foreground">
              Tecla de confirmação
            </Label>
            <Input
              value={draft.triggerKey}
              onChange={(event) => patch({ triggerKey: event.target.value })}
              className="h-9 sm:max-w-[200px]"
            />
          </div>
        </div>
      </section>

      <div className="flex justify-end">
        <Button
          disabled={!dirty || saving}
          className="gap-1.5"
          onClick={async () => {
            setSaving(true);
            try {
              await onSave(draft);
              statusToast.success("Configuração de stake salva");
            } catch (error) {
              statusToast.blocked(
                error instanceof Error
                  ? error.message
                  : "Não foi possível salvar a configuração de stake.",
              );
            } finally {
              setSaving(false);
            }
          }}
        >
          <Save className="size-4" />
          {saving ? "Salvando…" : "Salvar alterações"}
        </Button>
      </div>
    </div>
  );
}

function ToggleRow({
  id,
  label,
  description,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
      <div className="min-w-0">
        <Label htmlFor={id} className="text-[13px] font-medium">
          {label}
        </Label>
        <p className="text-[11px] text-muted-foreground">{description}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} className="shrink-0" />
    </div>
  );
}
