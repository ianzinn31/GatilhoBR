import { Star } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState, HouseBadge, MarketStatusPill } from "@/components/gatilho/primitives";
import { HOUSES } from "@/data/mocks/catalog";
import { availableCanonicalKeys, canonicalLabel, countOpenSelections, findMarket } from "@/lib/selectors";
import { cn } from "@/lib/utils";
import type { MarketCanonicalKey, MarketModel } from "@/types/gatilho";

export function FavoriteMarketManager({
  markets,
  favoriteMarketKeys,
  onToggle,
}: {
  markets: MarketModel[];
  favoriteMarketKeys: MarketCanonicalKey[];
  onToggle: (key: MarketCanonicalKey) => void;
}) {
  const allKeys = [...new Set([...favoriteMarketKeys, ...availableCanonicalKeys(markets)])];
  const favorites = allKeys.filter((key) => favoriteMarketKeys.includes(key));
  const others = allKeys.filter((key) => !favoriteMarketKeys.includes(key));

  return (
    <div className="space-y-4">
      <section className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Favoritos ({favorites.length})
        </h2>
        {favorites.length === 0 ? (
          <EmptyState
            icon={<Star className="size-5" />}
            title="Nenhum mercado favorito"
            description="Marque mercados abaixo para que apareçam primeiro no painel ao vivo."
          />
        ) : (
          <ul className="space-y-2">
            {favorites.map((key) => (
              <MarketKeyRow
                key={key}
                canonicalKey={key}
                markets={markets}
                favorite
                onToggle={() => onToggle(key)}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Outros mercados
        </h2>
        <ul className="space-y-2">
          {others.map((key) => (
            <MarketKeyRow
              key={key}
              canonicalKey={key}
              markets={markets}
              favorite={false}
              onToggle={() => onToggle(key)}
            />
          ))}
        </ul>
      </section>
    </div>
  );
}

function MarketKeyRow({
  canonicalKey,
  markets,
  favorite,
  onToggle,
}: {
  canonicalKey: MarketCanonicalKey;
  markets: MarketModel[];
  favorite: boolean;
  onToggle: () => void;
}) {
  const perHouse = HOUSES.map((house) => ({
    house,
    market: findMarket(markets, house.id, canonicalKey),
  }));

  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{canonicalLabel(canonicalKey)}</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {perHouse.map(({ house, market }) => (
            <span key={house.id} className="flex items-center gap-1.5">
              <HouseBadge house={house.id} />
              {market ? (
                <>
                  <MarketStatusPill status={market.status} />
                  <span className="text-[11px] tabular text-muted-foreground">
                    {countOpenSelections(market)} linhas
                  </span>
                </>
              ) : (
                <span className="text-[11px] text-muted-foreground">não ofertado</span>
              )}
            </span>
          ))}
        </div>
      </div>

      <Button
        variant={favorite ? "secondary" : "outline"}
        size="sm"
        className="h-8 shrink-0 gap-1.5"
        onClick={onToggle}
      >
        <Star className={cn("size-3.5", favorite && "fill-odds text-odds")} />
        {favorite ? "Favorito" : "Favoritar"}
      </Button>
    </li>
  );
}
