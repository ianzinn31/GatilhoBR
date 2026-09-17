import { Copy, FlaskConical, Pencil, Trash2, Zap } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ConfirmationDialog } from "@/components/gatilho/ConfirmationDialog";
import { HouseBadge, KeyCap } from "@/components/gatilho/primitives";
import { formatOdd } from "@/lib/format";
import {
  bindShortcut,
  bindTargetLabel,
  canonicalLabel,
  isMarketSelectionBind,
  teamName,
} from "@/lib/selectors";
import { cn } from "@/lib/utils";
import type { BindAvailability, BindLineStrategy, BindResolution } from "@/types/gatilho";

const AVAILABILITY_TONE: Record<BindAvailability, string> = {
  available: "text-ok",
  house_disconnected: "text-danger",
  market_unavailable: "text-odds",
  player_unavailable: "text-odds",
  selection_unavailable: "text-odds",
  line_unavailable: "text-odds",
};

export const LINE_STRATEGY_LABEL: Record<BindLineStrategy, string> = {
  exact: "Linha exata",
  first_available: "Primeira linha aberta",
  next_available: "Próxima linha após a primeira",
  max_line: "Maior linha aberta",
};

export function BindCard({
  resolution,
  conflicting,
  onEdit,
  onDuplicate,
  onDelete,
  onTest,
  onExecute,
  onToggleEnabled,
}: {
  resolution: BindResolution;
  conflicting: boolean;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onTest: () => void;
  onExecute: () => void;
  onToggleEnabled: () => void;
}) {
  const { bind, selection, availability, reason } = resolution;

  return (
    <li
      className={cn(
        "rounded-lg border bg-card p-3",
        conflicting ? "border-danger/50" : "border-border",
      )}
    >
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3">
        <KeyCap value={bindShortcut(bind) || "—"} />

        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="truncate text-sm font-semibold">{bindTargetLabel(bind)}</span>
            <HouseBadge house={bind.houseId} />
          </div>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {isMarketSelectionBind(bind) ? (
              <>{canonicalLabel(bind.marketCanonicalKey)} · Opção exata</>
            ) : (
              <>
                {teamName(bind.teamId)} · {canonicalLabel(bind.marketCanonicalKey)} ·{" "}
                {LINE_STRATEGY_LABEL[bind.lineStrategy]}
                {bind.lineStrategy === "exact" && bind.line ? ` (${bind.line})` : ""}
              </>
            )}
          </p>
          <p className={cn("mt-1 text-[11px] font-medium", AVAILABILITY_TONE[availability])}>
            {selection
              ? `Alvo: ${selection.source?.targetName || selection.line} @ ${formatOdd(selection.odds)}`
              : reason}
          </p>
          {conflicting ? (
            <p className="mt-1 text-[11px] font-medium text-danger">
              Conflito: outra bind usa o mesmo atalho.
            </p>
          ) : null}
        </div>

        <Switch
          checked={bind.enabled}
          onCheckedChange={onToggleEnabled}
          aria-label={bind.enabled ? "Desativar bind" : "Ativar bind"}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border pt-2.5">
        <Button
          size="sm"
          className="h-8 gap-1.5"
          disabled={!bind.enabled || availability !== "available"}
          onClick={onExecute}
        >
          <Zap className="size-3.5" />
          Executar
        </Button>
        <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={onTest}>
          <FlaskConical className="size-3.5" />
          Testar alvo
        </Button>
        <Button variant="ghost" size="sm" className="h-8 gap-1.5" onClick={onEdit}>
          <Pencil className="size-3.5" />
          Editar
        </Button>
        <Button variant="ghost" size="sm" className="h-8 gap-1.5" onClick={onDuplicate}>
          <Copy className="size-3.5" />
          Duplicar
        </Button>
        <ConfirmationDialog
          title="Remover esta bind?"
          description="A tecla deixa de disparar imediatamente. Você pode recriá-la depois."
          confirmLabel="Remover"
          destructive
          onConfirm={onDelete}
          trigger={
            <Button variant="ghost" size="sm" className="ml-auto h-8 gap-1.5 text-danger">
              <Trash2 className="size-3.5" />
              Remover
            </Button>
          }
        />
      </div>
    </li>
  );
}
