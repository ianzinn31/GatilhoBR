import { Keyboard, LockKeyhole, Star, TrendingDown, TrendingUp } from "lucide-react";

import { formatOdd } from "@/lib/format";
import {
  isPriorityPlayerMarket,
  looksLikePriorityPlayerName,
} from "@/lib/playerPriorities";
import { playerName } from "@/lib/selectors";
import { cn } from "@/lib/utils";
import type { MarketModel, MarketRow, Selection } from "@/types/gatilho";

export interface OddsCellProps {
  selection: Selection | null;
  selected: boolean;
  onSelect: (selection: Selection) => void;
  onCreateBind?: (selection: Selection) => void;
  compact?: boolean;
}

/** Célula única. Células vazias nunca viram botão. */
export function OddsCell({
  selection,
  selected,
  onSelect,
  onCreateBind,
  compact,
}: OddsCellProps) {
  if (!selection) {
    return (
      <div
        aria-hidden
        className={cn(
          "flex h-9 items-center justify-center text-xs text-muted-foreground/45",
          !compact && "rounded-lg border border-dashed border-border/50 bg-surface/35",
        )}
      >
        —
      </div>
    );
  }

  const disabled =
    selection.status === "locked" ||
    selection.status === "unavailable" ||
    selection.status === "suspended" ||
    selection.odds === null;
  const drifted =
    selection.status === "odds_changed" && selection.previousOdds !== undefined
      ? selection.odds! - selection.previousOdds
      : 0;

  return (
    <div className="group relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => onSelect(selection)}
        title={`${selection.playerName} · ${selection.marketDisplayName} · ${selection.line}`}
        aria-label={`${selection.playerName}, ${selection.marketDisplayName}, ${selection.line}, odd ${formatOdd(selection.odds)}${disabled ? ", indisponível" : ""}`}
        className={cn(
          "flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border text-xs font-semibold transition-[color,background-color,border-color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70",
          compact ? "px-1" : "px-2",
          disabled
            ? "cursor-not-allowed border-border/60 bg-surface/50 text-muted-foreground/60"
            : "border-border/80 bg-surface-2/80 text-foreground hover:border-primary/60 hover:bg-primary/10 hover:shadow-[0_0_18px_-12px_var(--primary)]",
          selected && "border-primary bg-primary/15 text-primary shadow-[0_0_18px_-10px_var(--primary)]",
          selection.status === "odds_changed" && !disabled && "border-odds/60 text-odds",
        )}
      >
        {selection.status === "suspended" ? (
          <>
            <LockKeyhole className="size-3" />
            <span>SUSP</span>
          </>
        ) : (
          <span className="odds-num">{formatOdd(selection.odds)}</span>
        )}
        {drifted !== 0 ? (
          drifted > 0 ? (
            <TrendingUp className="size-3 shrink-0" />
          ) : (
            <TrendingDown className="size-3 shrink-0" />
          )
        ) : null}
      </button>
      {onCreateBind && !disabled ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onCreateBind(selection);
          }}
          aria-label="Criar bind desta seleção"
          title="Criar bind desta seleção"
          className="pointer-events-none absolute right-1 top-1 grid size-6 place-items-center rounded-md border border-primary/20 bg-card/95 text-muted-foreground opacity-0 shadow-sm transition-opacity hover:text-primary focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary group-hover:pointer-events-auto group-hover:opacity-100"
        >
          <Keyboard className="size-3" />
        </button>
      ) : null}
    </div>
  );
}

export function PlayerOddsTable({
  market,
  rows,
  favoritePlayerIds,
  selectedSelectionId,
  compact = false,
  teamNames,
  onSelect,
  onCreateBind,
  onTogglePlayer,
}: {
  market: MarketModel;
  rows: MarketRow[];
  favoritePlayerIds: string[];
  selectedSelectionId: string | null;
  compact?: boolean;
  /** Nomes dos times do evento: uma linha com o nome do time não é atleta. */
  teamNames?: string[];
  onSelect: (selection: Selection) => void;
  onCreateBind?: (selection: Selection) => void;
  onTogglePlayer: (playerId: string, playerName?: string) => void;
}) {
  const hideRowHeader = !market.isPlayerMarket && rows.length === 1;
  // `isPlayerMarket` chega de heurística de título nas casas e marca mercados de
  // time e de placar. A estrela só aparece onde a linha é de fato um atleta,
  // senão "Mais de 2.5" entra na lista de prioritários.
  const playerMarket = isPriorityPlayerMarket(market, { teamNames });
  const compactMinWidth = Math.max(
    280,
    (hideRowHeader ? 12 : 132) + market.columns.length * 76,
  );

  return (
    <div className="overflow-x-auto rounded-xl border border-border/70 bg-surface/35 scroll-slim">
      <table
        className="w-full table-fixed border-collapse"
        style={{ minWidth: compact ? `${compactMinWidth}px` : "560px" }}
      >
        <colgroup>
          {!hideRowHeader ? <col style={{ width: compact ? "132px" : "180px" }} /> : null}
          {market.columns.map((column) => <col key={column.key} />)}
        </colgroup>
        <thead>
          <tr>
            {!hideRowHeader ? (
              <th className="sticky left-0 z-10 bg-surface-2/95 px-2.5 py-2 text-left text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground backdrop-blur-sm">
                {playerMarket ? "Jogador" : "Opção / linha"}
              </th>
            ) : null}
            {market.columns.map((column) => (
              <th
                key={column.key}
                title={column.label}
                className="truncate bg-surface-2/75 px-1 py-2 text-center text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground"
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const favorite = favoritePlayerIds.includes(row.playerId);
            const label = row.playerName || playerName(row.playerId);
            const canFavorite =
              playerMarket &&
              looksLikePriorityPlayerName(row.playerName || row.cells.find(Boolean)?.playerName, {
                excludeNames: [market.displayName, ...(teamNames ?? [])],
              });
            return (
              <tr key={row.playerId} className="group/row border-t border-border/55 transition-colors hover:bg-primary/[0.035]">
                {!hideRowHeader ? (
                  <th
                    scope="row"
                    className="sticky left-0 z-10 bg-card/95 px-2 py-1.5 text-left align-middle backdrop-blur-sm group-hover/row:bg-surface-2"
                  >
                    <div className="flex min-w-0 items-center gap-1.5">
                      {canFavorite ? (
                        <button
                          type="button"
                          onClick={() => onTogglePlayer(row.playerId, row.playerName || label)}
                          aria-label={
                            favorite
                              ? `Remover ${label} dos prioritários`
                              : `Marcar ${label} como prioritário`
                          }
                          className="shrink-0 rounded-sm text-muted-foreground transition-colors hover:text-odds focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-odds/70"
                        >
                          <Star className={cn("size-3.5", favorite && "fill-odds text-odds")} />
                        </button>
                      ) : null}
                        <span className="min-w-0 truncate text-[13px] font-semibold" title={label}>
                        {label}
                      </span>
                    </div>
                  </th>
                ) : null}
                {row.cells.map((cell, index) => (
                  <td key={market.columns[index]?.key ?? index} className="px-1 py-1.5">
                    <OddsCell
                      selection={cell}
                      selected={!!cell && cell.id === selectedSelectionId}
                      onSelect={onSelect}
                      onCreateBind={onCreateBind}
                      compact
                    />
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
