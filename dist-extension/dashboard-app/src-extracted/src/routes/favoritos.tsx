import { createFileRoute } from "@tanstack/react-router";

import { FavoriteMarketManager } from "@/components/gatilho/FavoriteMarketManager";
import { SectionHeader } from "@/components/gatilho/primitives";
import { useDashboard } from "@/store/dashboard";

export const Route = createFileRoute("/favoritos")({
  head: () => ({
    meta: [
      { title: "Mercados favoritos — GatilhoBR" },
      {
        name: "description",
        content:
          "Escolha quais mercados aparecem primeiro no painel ao vivo e veja a disponibilidade em cada casa.",
      },
      { property: "og:title", content: "Mercados favoritos — GatilhoBR" },
      {
        property: "og:description",
        content: "Ordene os mercados que você usa em toda partida.",
      },
    ],
  }),
  component: FavoritesPage,
});

function FavoritesPage() {
  const { markets, favoriteMarketKeys, actions } = useDashboard();

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Mercados favoritos"
        description="Favoritos sobem para o topo do painel ao vivo, mesmo com nomes diferentes entre casas."
      />
      <FavoriteMarketManager
        markets={markets}
        favoriteMarketKeys={favoriteMarketKeys}
        onToggle={actions.toggleFavoriteMarket}
      />
    </div>
  );
}
