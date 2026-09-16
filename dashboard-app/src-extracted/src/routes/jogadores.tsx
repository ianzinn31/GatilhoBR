import { createFileRoute } from "@tanstack/react-router";

import { PriorityPlayerManager } from "@/components/gatilho/PriorityPlayerManager";
import { statusToast } from "@/components/gatilho/StatusToast";
import { formatOdd } from "@/lib/format";
import { isPlayerPriorityHouse, type PlayerPriorityHouse } from "@/lib/playerPriorities";
import { eventTeamNames } from "@/lib/selectors";
import { SectionHeader } from "@/components/gatilho/primitives";
import { useDashboard } from "@/store/dashboard";

export const Route = createFileRoute("/jogadores")({
  head: () => ({
    meta: [
      { title: "Jogadores prioritários — GatilhoBR" },
      {
        name: "description",
        content:
          "Escolha por casa quais jogadores aparecem primeiro nos mercados ao vivo.",
      },
      { property: "og:title", content: "Jogadores prioritários — GatilhoBR" },
      {
        property: "og:description",
        content: "Priorize jogadores reais da Betfair e da Bet365 sem misturar eventos ou casas.",
      },
    ],
  }),
  component: PlayersPage,
});

function PlayersPage() {
  const {
    markets,
    events,
    selectedHouse,
    selectedSelectionId,
    favoritePlayerIds,
    priorityPlayerNotes,
    priorityMarketKeys,
    preferences,
    actions,
  } = useDashboard();
  const priorityHouse: PlayerPriorityHouse = isPlayerPriorityHouse(selectedHouse)
    ? selectedHouse
    : "bet365";

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Jogadores prioritários"
        description="Salve seus jogadores favoritos por casa e dispare direto neles quando entrarem em um jogo. A prioridade também organiza as linhas e orienta a coleta read-only."
      />
      <PriorityPlayerManager
        favoritePlayerIds={favoritePlayerIds}
        priorityPlayerNotes={priorityPlayerNotes}
        priorityMarketKeys={priorityMarketKeys}
        prioritiesFirst={preferences.prioritiesFirst}
        markets={markets}
        teamNames={eventTeamNames(events[priorityHouse])}
        selectedHouse={priorityHouse}
        selectedSelectionId={selectedSelectionId}
        onSelectHouse={(house) => actions.selectHouse(house)}
        onTogglePlayer={(playerId, name) => void actions.toggleFavoritePlayer(playerId, name)}
        onAddPlayer={(house, name) => actions.addPriorityPlayer(house, name)}
        onRemovePlayer={(playerId) => void actions.removePriorityPlayer(playerId)}
        onToggleMarket={actions.togglePriorityMarket}
        onTogglePrioritiesFirst={(value) =>
          void actions.updatePreferences({ ...preferences, prioritiesFirst: value })
        }
        onFire={(selection) => {
          actions.selectOdd(selection);
          void actions.triggerBet(selection).then((result) => {
            if (result.ok) {
              statusToast.success(
                "Disparo encaminhado",
                `${selection.playerName} · ${selection.line} @ ${formatOdd(selection.odds)}`,
              );
            } else {
              statusToast.blocked(result.message);
            }
          });
        }}
      />
    </div>
  );
}
