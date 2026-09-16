import { useState } from "react";
import { ChevronDown, Star } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PlayerOddsTable } from "@/components/gatilho/PlayerOddsTable";
import { HouseBadge, MarketStatusPill } from "@/components/gatilho/primitives";
import { relativeFromNow } from "@/lib/format";
import { canonicalLabel, countOpenSelections, sortRows } from "@/lib/selectors";
import { cn } from "@/lib/utils";
import type { MarketModel, Selection } from "@/types/gatilho";

export function MarketCard({
  market,
  favorite,
  favoritePlayerIds,
  prioritiesFirst,
  selectedSelectionId,
  narrow = false,
  teamNames,
  onToggleFavorite,
  onTogglePlayer,
  onSelect,
  onCreateBind,
}: {
  market: MarketModel;
  favorite: boolean;
  favoritePlayerIds: string[];
  prioritiesFirst: boolean;
  selectedSelectionId: string | null;
  narrow?: boolean;
  teamNames?: string[];
  onToggleFavorite: () => void;
  onTogglePlayer: (playerId: string, playerName?: string) => void;
  onSelect: (selection: Selection) => void;
  onCreateBind?: (selection: Selection) => void;
}) {
  const [open, setOpen] = useState(true);
  const rows = sortRows(market, favoritePlayerIds, prioritiesFirst);
  const openCount = countOpenSelections(market);

  return (
    <section className="group/market relative overflow-hidden rounded-xl border border-border/80 bg-card/95 shadow-[0_14px_32px_-30px_color-mix(in_srgb,var(--primary)_60%,transparent)] transition-[border-color,box-shadow] hover:border-primary/25 hover:shadow-[0_18px_42px_-32px_color-mix(in_srgb,var(--primary)_60%,transparent)]">
      <div
        className={cn(
          "absolute inset-y-0 left-0 w-[3px]",
          market.status === "open" && "bg-ok",
          market.status === "suspended" && "bg-odds",
          market.status === "closed" && "bg-danger",
        )}
        aria-hidden
      />
      <header className="relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border/70 px-3 py-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-label={open ? "Recolher mercado" : "Expandir mercado"}
            className="grid size-7 shrink-0 place-items-center rounded-lg border border-border/70 bg-surface-2/70 text-muted-foreground transition-colors hover:border-primary/35 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronDown className={cn("size-4 transition-transform", !open && "-rotate-90")} />
          </button>
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2.5">
              <h2 className="truncate text-sm font-bold tracking-[-0.015em] sm:text-[15px]">{market.displayName}</h2>
              <HouseBadge house={market.house} />
            </div>
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
              <span className="truncate">{canonicalLabel(market.canonicalKey)}</span>
              <span className="size-1 rounded-full bg-border" aria-hidden />
              <span>{openCount} {openCount === 1 ? "odd aberta" : "odds abertas"}</span>
              <span className="size-1 rounded-full bg-border" aria-hidden />
              <span>atualizado {relativeFromNow(market.updatedAt)}</span>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <span className="hidden text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground lg:inline">
            {market.columns.length} {market.columns.length === 1 ? "coluna" : "colunas"}
          </span>
          <MarketStatusPill status={market.status} />
          <Button
            variant="ghost"
            size="icon"
            className="size-8 rounded-lg text-muted-foreground hover:bg-primary/10 hover:text-primary"
            onClick={onToggleFavorite}
            aria-label={favorite ? "Remover mercado dos favoritos" : "Adicionar mercado aos favoritos"}
          >
            <Star className={cn("size-4", favorite && "fill-odds text-odds")} />
          </Button>
        </div>
      </header>

      {open ? (
        <div className="relative px-2.5 pb-3 pt-2.5 sm:px-3 sm:pb-3.5">
          <PlayerOddsTable
            market={market}
            rows={rows}
            favoritePlayerIds={favoritePlayerIds}
            selectedSelectionId={selectedSelectionId}
            compact={narrow}
            teamNames={teamNames}
            onSelect={onSelect}
            onCreateBind={onCreateBind}
            onTogglePlayer={onTogglePlayer}
          />
        </div>
      ) : null}
    </section>
  );
}
