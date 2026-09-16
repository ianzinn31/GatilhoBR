import { useMemo, useState } from "react";
import { Search, Star, Trash2, UserPlus, Users, Zap } from "lucide-react";

import { HouseSelector } from "@/components/gatilho/HouseSelector";
import { OddsCell } from "@/components/gatilho/PlayerOddsTable";
import { EmptyState } from "@/components/gatilho/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  findPriorityPlayerCandidate,
  getPriorityPlayerCandidates,
  getPriorityPlayerShots,
  isPriorityPlayerMarket,
  PLAYER_PRIORITY_HOUSES,
  priorityHouseFromPlayerId,
  priorityPlayerDisplayName,
  type PlayerPriorityHouse,
  type PriorityPlayerNote,
} from "@/lib/playerPriorities";
import { canonicalLabel } from "@/lib/selectors";
import { cn } from "@/lib/utils";
import type { MarketCanonicalKey, MarketModel, Selection } from "@/types/gatilho";

const HOUSE_LABEL: Record<PlayerPriorityHouse, string> = {
  bet365: "Bet365",
  betfair: "Betfair",
};

export function PriorityPlayerManager({
  favoritePlayerIds,
  priorityPlayerNotes,
  priorityMarketKeys,
  prioritiesFirst,
  markets,
  teamNames,
  selectedHouse,
  selectedSelectionId,
  onSelectHouse,
  onTogglePlayer,
  onAddPlayer,
  onRemovePlayer,
  onToggleMarket,
  onTogglePrioritiesFirst,
  onFire,
}: {
  favoritePlayerIds: string[];
  priorityPlayerNotes: PriorityPlayerNote[];
  priorityMarketKeys: MarketCanonicalKey[];
  prioritiesFirst: boolean;
  markets: MarketModel[];
  teamNames: string[];
  selectedHouse: PlayerPriorityHouse;
  selectedSelectionId: string | null;
  onSelectHouse: (house: PlayerPriorityHouse) => void;
  onTogglePlayer: (playerId: string, playerName?: string) => void;
  onAddPlayer: (house: PlayerPriorityHouse, name: string) => Promise<boolean>;
  onRemovePlayer: (playerId: string) => void;
  onToggleMarket: (key: MarketCanonicalKey) => void;
  onTogglePrioritiesFirst: (value: boolean) => void;
  onFire: (selection: Selection) => void;
}) {
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const houseLabel = HOUSE_LABEL[selectedHouse];
  // O array de times chega novo a cada render; a chave estável evita recalcular
  // a varredura de mercados sem motivo.
  const teamKey = teamNames.filter(Boolean).join("|");
  const scanOptions = useMemo(
    () => ({ teamNames: teamKey ? teamKey.split("|") : [] }),
    [teamKey],
  );
  const candidates = useMemo(
    () => getPriorityPlayerCandidates(markets, selectedHouse, scanOptions),
    [markets, selectedHouse, scanOptions],
  );

  /**
   * Cada jogador salvo da casa escolhida, ligado ao candidato ao vivo quando o
   * evento aberto tem o atleta. `shots` são os mercados prontos para disparo.
   */
  const saved = useMemo(
    () =>
      favoritePlayerIds
        .filter((playerId) => priorityHouseFromPlayerId(playerId) === selectedHouse)
        .map((playerId) => {
          const name = priorityPlayerDisplayName(playerId, priorityPlayerNotes, candidates);
          const live = findPriorityPlayerCandidate(playerId, name, candidates);
          return {
            id: playerId,
            name,
            live,
            shots: live ? getPriorityPlayerShots(markets, live.id, scanOptions) : [],
          };
        })
        .sort((left, right) => {
          const liveDelta = Number(Boolean(right.live)) - Number(Boolean(left.live));
          return (
            liveDelta || left.name.localeCompare(right.name, "pt-BR", { sensitivity: "base" })
          );
        }),
    [favoritePlayerIds, priorityPlayerNotes, candidates, markets, selectedHouse, scanOptions],
  );

  const savedIds = new Set(saved.map((item) => item.id));
  const liveSaved = saved.filter((item) => item.live && item.shots.length > 0);
  const normalizedQuery = query.trim().toLocaleLowerCase("pt-BR");
  const visibleCandidates = candidates
    .filter((candidate) =>
      !normalizedQuery ||
      candidate.name.toLocaleLowerCase("pt-BR").includes(normalizedQuery) ||
      candidate.marketNames.some((market) =>
        market.toLocaleLowerCase("pt-BR").includes(normalizedQuery)
      )
    )
    .sort((left, right) => {
      const priorityDelta =
        Number(favoritePlayerIds.includes(right.id)) - Number(favoritePlayerIds.includes(left.id));
      return priorityDelta || left.name.localeCompare(right.name, "pt-BR", { sensitivity: "base" });
    });
  const betfairPlayerMarketKeys = [
    ...new Set(
      markets
        .filter((market) => market.house === "betfair" && isPriorityPlayerMarket(market, scanOptions))
        .map((market) => market.canonicalKey),
    ),
  ];
  const betfairCoverageKeys = [...new Set([...priorityMarketKeys, ...betfairPlayerMarketKeys])];

  async function submitDraft() {
    const name = draft.trim();
    if (!name || saving) return;
    setSaving(true);
    const added = await onAddPlayer(selectedHouse, name);
    setSaving(false);
    if (added) setDraft("");
  }

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-border bg-card p-3.5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Casa da prioridade
            </p>
            <HouseSelector
              selectedHouse={selectedHouse}
              onSelectHouse={(house) => onSelectHouse(house as PlayerPriorityHouse)}
              allowedHouses={[...PLAYER_PRIORITY_HOUSES]}
              className="mt-2"
            />
          </div>
          <div className="rounded-lg border border-odds/25 bg-odds/5 px-3 py-2 text-right">
            <strong className="block text-lg tabular-nums text-odds">{saved.length}</strong>
            <span className="text-[11px] text-muted-foreground">
              {saved.length === 1 ? "jogador salvo" : "jogadores salvos"}
            </span>
          </div>
        </div>

        <div className="mt-3 grid gap-2 border-t border-border pt-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <div>
            <Label htmlFor="priorities-first" className="text-xs font-medium">
              Manter prioridades no topo dos mercados
            </Label>
            <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
              {selectedHouse === "betfair"
                ? "Ordena as linhas capturadas e mantém os grupos escolhidos no radar da coleta read-only."
                : "Ordena as linhas já disponíveis na Bet365. Não abre mercados nem cria apostas."}
            </p>
          </div>
          <Switch
            id="priorities-first"
            checked={prioritiesFirst}
            onCheckedChange={onTogglePrioritiesFirst}
          />
        </div>
      </section>
      <section className="rounded-xl border border-border bg-card p-3.5">
        <h2 className="text-sm font-semibold">Meus jogadores favoritos</h2>
        <p className="mt-0.5 max-w-3xl text-[11px] leading-relaxed text-muted-foreground">
          Salve o nome como a {houseLabel} publica. Eles ficam guardados mesmo sem
          jogo aberto e aparecem para disparo assim que entrarem em um evento.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <div className="relative min-w-0 flex-1 sm:max-w-sm">
            <Input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                void submitDraft();
              }}
              placeholder="Ex.: Estêvão"
              className="h-9 text-xs"
              aria-label={`Nome do jogador favorito na ${houseLabel}`}
            />
          </div>
          <Button
            type="button"
            size="sm"
            className="h-9"
            disabled={!draft.trim() || saving}
            onClick={() => void submitDraft()}
          >
            <UserPlus className="mr-1.5 size-3.5" />
            {saving ? "Salvando…" : "Salvar jogador"}
          </Button>
        </div>

        {saved.length === 0 ? (
          <p className="mt-3 rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
            Nenhum jogador salvo na {houseLabel}. Digite um nome acima ou use a
            estrela na tabela de mercados.
          </p>
        ) : (
          <ul className="mt-3 flex flex-wrap gap-2">
            {saved.map((player) => (
              <li
                key={player.id}
                className={cn(
                  "flex items-center gap-2 rounded-full border px-2.5 py-1.5",
                  player.live ? "border-odds/45 bg-odds/10" : "border-border bg-surface",
                )}
              >
                <Star className="size-3 shrink-0 fill-odds text-odds" />
                <span className="max-w-[180px] truncate text-[12px] font-medium">
                  {player.name}
                </span>
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                    player.live ? "bg-odds/15 text-odds" : "bg-muted text-muted-foreground",
                  )}
                >
                  {player.live ? "no evento" : "fora do evento"}
                </span>
                <button
                  type="button"
                  onClick={() => onRemovePlayer(player.id)}
                  aria-label={`Remover ${player.name} dos jogadores salvos`}
                  title="Remover"
                  className="shrink-0 rounded-sm text-muted-foreground transition-colors hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="rounded-xl border border-primary/25 bg-primary/[0.04] p-3.5">
        <div className="flex items-center gap-2">
          <Zap className="size-4 text-primary" />
          <h2 className="text-sm font-semibold">Disparo rápido</h2>
        </div>
        <p className="mt-0.5 max-w-3xl text-[11px] leading-relaxed text-muted-foreground">
          Odds ao vivo dos jogadores salvos que estão no evento aberto da {houseLabel}.
          O clique usa a mesma rota do botão de odd do painel. Odds suspensas
          continuam visíveis e travadas.
        </p>

        {liveSaved.length === 0 ? (
          <div className="mt-3">
            <EmptyState
              icon={<Zap className="size-5" />}
              title="Nenhum jogador salvo está no evento aberto"
              description={`Salve jogadores acima e abra um evento da ${houseLabel} com mercados de atleta.`}
            />
          </div>
        ) : (
          <ul className="mt-3 space-y-2">
            {liveSaved.map((player) => (
              <li key={player.id} className="rounded-lg border border-border bg-card p-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <strong className="truncate text-[13px]">{player.name}</strong>
                  <span className="text-[10px] text-muted-foreground">
                    {player.shots.length} {player.shots.length === 1 ? "mercado" : "mercados"}
                  </span>
                </div>
                <div className="mt-2 space-y-2">
                  {player.shots.map((shot) => (
                    <div key={shot.marketId}>
                      <p className="truncate text-[11px] text-muted-foreground" title={shot.marketName}>
                        {shot.marketName}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {shot.cells.map((cell, index) =>
                          cell ? (
                            <div key={cell.id} className="w-[74px]">
                              <span className="block truncate text-center text-[10px] text-muted-foreground">
                                {cell.source?.optionLabel || cell.line}
                              </span>
                              <OddsCell
                                selection={cell}
                                selected={cell.id === selectedSelectionId}
                                onSelect={onFire}
                                compact
                              />
                            </div>
                          ) : (
                            <span key={`${shot.marketId}-${index}`} className="sr-only">
                              sem odd
                            </span>
                          )
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="rounded-xl border border-border bg-card p-3.5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Jogadores do evento ao vivo</h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Somente linhas que a {houseLabel} publica como atleta. Times, placares
              e opções de mercado ficam fora.
            </p>
          </div>
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar jogador ou mercado"
              className="h-9 pl-8 text-xs"
              aria-label="Buscar jogador prioritário"
            />
          </div>
        </div>

        {visibleCandidates.length === 0 ? (
          <div className="mt-3">
            <EmptyState
              icon={<Users className="size-5" />}
              title={query ? "Nenhum jogador corresponde à busca" : "Nenhum mercado de jogador disponível"}
              description={
                query
                  ? "Limpe a busca ou tente parte do nome exibido pela casa."
                  : `Abra um evento com mercados de jogador na ${houseLabel} e sincronize novamente.`
              }
            />
          </div>
        ) : (
          <ul className="mt-3 grid gap-2 md:grid-cols-2">
            {visibleCandidates.map((candidate) => {
              const active = savedIds.has(candidate.id);
              return (
                <li key={candidate.id}>
                  <button
                    type="button"
                    aria-pressed={active}
                    onClick={() => onTogglePlayer(candidate.id, candidate.name)}
                    className={cn(
                      "grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      active
                        ? "border-odds/45 bg-odds/10"
                        : "border-border bg-surface hover:border-ring/45 hover:bg-surface-2",
                    )}
                  >
                    <Star className={cn("size-4", active && "fill-odds text-odds")} />
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-semibold">{candidate.name}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {candidate.teamName ? `${candidate.teamName} · ` : ""}
                        {candidate.marketNames.length} {candidate.marketNames.length === 1 ? "mercado" : "mercados"} · {candidate.openSelectionCount} odds abertas
                      </span>
                      <span className="mt-0.5 block truncate text-[10px] text-muted-foreground/80">
                        {candidate.marketNames.slice(0, 3).join(" · ")}
                      </span>
                    </span>
                    <span className={cn(
                      "rounded-full px-2 py-1 text-[10px] font-semibold",
                      active ? "bg-odds/15 text-odds" : "bg-muted text-muted-foreground",
                    )}>
                      {active ? "Salvo" : "Salvar"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      {selectedHouse === "betfair" ? (
        <section className="rounded-xl border border-border bg-card p-3.5">
          <h2 className="text-sm font-semibold">Cobertura de mercados recolhidos</h2>
          <p className="mt-0.5 max-w-3xl text-[11px] leading-relaxed text-muted-foreground">
            Escolha quais grupos de jogador a coleta da Betfair pode abrir temporariamente para atualizar as linhas prioritárias. A expansão é serializada, read-only e restaura o estado anterior.
          </p>
          {betfairCoverageKeys.length === 0 ? (
            <p className="mt-3 rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
              Nenhum grupo de jogador foi identificado neste evento.
            </p>
          ) : (
            <div className="mt-3 flex flex-wrap gap-2">
              {betfairCoverageKeys.map((key) => {
                const active = priorityMarketKeys.includes(key);
                return (
                  <Button
                    key={key}
                    type="button"
                    size="sm"
                    variant={active ? "secondary" : "outline"}
                    className="h-8"
                    aria-pressed={active}
                    onClick={() => onToggleMarket(key)}
                  >
                    {canonicalLabel(key)}
                  </Button>
                );
              })}
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
