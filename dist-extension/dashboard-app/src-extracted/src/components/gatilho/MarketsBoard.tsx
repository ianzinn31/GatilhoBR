import { useMemo, useState } from "react";
import { Activity } from "lucide-react";

import { BindEditor } from "@/components/gatilho/BindEditor";
import { MarketCard } from "@/components/gatilho/MarketCard";
import { MarketFilters } from "@/components/gatilho/MarketFilters";
import { EmptyState } from "@/components/gatilho/primitives";
import { statusToast } from "@/components/gatilho/StatusToast";
import { useIsMobile } from "@/hooks/use-mobile";
import { formatOdd } from "@/lib/format";
import {
  DEFAULT_MARKET_FILTERS,
  availableCanonicalKeys,
  bindTargetLabel,
  eventTeamNames,
  filterMarkets,
  marketsByHouse,
  type MarketFilterState,
} from "@/lib/selectors";
import { useDashboard } from "@/store/dashboard";
import type { HouseId, Selection } from "@/types/gatilho";

export function MarketsBoard({ house }: { house?: HouseId }) {
  const {
    markets,
    binds,
    connections,
    events,
    favoriteMarketKeys,
    favoritePlayerIds,
    preferences,
    selectedSelectionId,
    lastSync,
    actions,
  } = useDashboard();
  const isMobile = useIsMobile();
  const [bindSelection, setBindSelection] = useState<Selection | null>(null);
  const [bindEditorOpen, setBindEditorOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [filters, setFilters] = useState<MarketFilterState>({
    ...DEFAULT_MARKET_FILTERS,
    favoritesFirst: preferences.favoritesFirst,
  });

  const scoped = useMemo(
    () => (house ? marketsByHouse(markets, house) : markets),
    [markets, house],
  );
  const visible = useMemo(
    () => filterMarkets(scoped, filters, favoriteMarketKeys),
    [scoped, filters, favoriteMarketKeys],
  );
  const keys = useMemo(() => availableCanonicalKeys(scoped), [scoped]);

  return (
    <div className="space-y-4">
      <MarketFilters
        value={filters}
        onChange={setFilters}
        availableKeys={keys}
        count={visible.length}
        lastSync={lastSync}
        refreshing={syncing}
        onRefresh={() => {
          if (syncing) return;
          setSyncing(true);
          statusToast.info("Sincronizando com as abas abertas…");
          void actions
            .sync()
            .then((result) => {
              statusToast.success(
                "Mercados sincronizados",
                `${result.refreshedHouses.length} casa(s) atualizada(s) agora.`,
              );
            })
            .catch((error) => {
              statusToast.error(
                "Não foi possível concluir a sincronização",
                error instanceof Error ? error.message : "Tente novamente.",
              );
            })
            .finally(() => setSyncing(false));
        }}
      />

      {visible.length === 0 ? (
        <EmptyState
          icon={<Activity className="size-5" />}
          title="Nenhum mercado corresponde aos filtros"
          description="Ajuste a busca, o mercado ou desative os filtros para ver mais linhas."
        />
      ) : (
        <div className="space-y-3">
          {visible.map((market) => (
            <MarketCard
              key={market.id}
              market={market}
              favorite={favoriteMarketKeys.includes(market.canonicalKey)}
              favoritePlayerIds={favoritePlayerIds}
              prioritiesFirst={preferences.prioritiesFirst}
              selectedSelectionId={selectedSelectionId}
              narrow={isMobile}
              teamNames={eventTeamNames(events[market.house])}
              onToggleFavorite={() => actions.toggleFavoriteMarket(market.canonicalKey)}
              onTogglePlayer={(playerId, name) => actions.toggleFavoritePlayer(playerId, name)}
              onCreateBind={(selection) => {
                setBindSelection(selection);
                setBindEditorOpen(true);
              }}
              onSelect={async (selection) => {
                actions.selectOdd(selection);
                const result = await actions.triggerBet(selection);
                if (result.ok) {
                  statusToast.success(
                    "Disparo encaminhado",
                    `${selection.playerName} · ${selection.line} @ ${formatOdd(selection.odds)}`,
                  );
                } else {
                  statusToast.blocked(result.message);
                }
              }}
            />
          ))}
        </div>
      )}

      <BindEditor
        open={bindEditorOpen}
        onOpenChange={setBindEditorOpen}
        markets={markets}
        connections={connections}
        binds={binds}
        initial={null}
        initialSelection={bindSelection}
        defaultHouse={preferences.defaultHouse}
        onSave={(draft) => {
          void actions
            .saveBind(draft)
            .then((result) => {
              statusToast.success(
                result.replaced > 0 ? "Bind substituída" : "Bind criada",
                bindTargetLabel(result.bind),
              );
            })
            .catch(() => statusToast.blocked("Não foi possível salvar a bind."));
        }}
      />
    </div>
  );
}
