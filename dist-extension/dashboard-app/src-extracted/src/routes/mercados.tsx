import { createFileRoute } from "@tanstack/react-router";

import { HouseSelector } from "@/components/gatilho/HouseSelector";
import { LiveMatchHeader } from "@/components/gatilho/LiveMatchHeader";
import { MarketsBoard } from "@/components/gatilho/MarketsBoard";
import { SectionHeader } from "@/components/gatilho/primitives";
import { useDashboard } from "@/store/dashboard";

export const Route = createFileRoute("/mercados")({
  head: () => ({
    meta: [
      { title: "Mercados ao vivo — GatilhoBR" },
      {
        name: "description",
        content:
          "Tabelas densas de mercados de jogador com linhas, odds, suspensões e células vazias respeitando o que cada casa oferta.",
      },
      { property: "og:title", content: "Mercados ao vivo — GatilhoBR" },
      {
        property: "og:description",
        content:
          "Chutes, faltas, cartões e gols por jogador em Bet365, Betfair, Betnacional, BetMGM e Superbet.",
      },
    ],
  }),
  component: MarketsPage,
});

function MarketsPage() {
  const { events, connections, selectedHouse, actions } = useDashboard();
  const event = events[selectedHouse];
  const connection = connections.find((item) => item.house === selectedHouse);

  return (
    <div className="markets-page space-y-4 pb-8">
      <SectionHeader
        title="Mercados ao vivo"
        description="Somente linhas realmente ofertadas pela casa. Células vazias não são clicáveis."
        actions={
          <HouseSelector
            selectedHouse={selectedHouse}
            onSelectHouse={(houseId) => actions.selectHouse(houseId)}
          />
        }
      />

      {event ? <LiveMatchHeader event={event} connection={connection} /> : null}

      <MarketsBoard house={selectedHouse} />
    </div>
  );
}
