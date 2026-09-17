import { createFileRoute } from "@tanstack/react-router";

import { SectionHeader } from "@/components/gatilho/primitives";
import { StakePanel } from "@/components/gatilho/StakePanel";
import { useDashboard } from "@/store/dashboard";

export const Route = createFileRoute("/stake")({
  head: () => ({
    meta: [
      { title: "Stake e execução — GatilhoBR" },
      {
        name: "description",
        content:
          "Configure stake padrão, limite máximo, valores rápidos e o comportamento de execução dos disparos.",
      },
      { property: "og:title", content: "Stake e execução — GatilhoBR" },
      {
        property: "og:description",
        content: "Limites e confirmações para evitar disparos acidentais.",
      },
    ],
  }),
  component: StakePage,
});

function StakePage() {
  const { stake, actions } = useDashboard();

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Stake e execução"
        description="Valores e travas aplicadas a todo disparo encaminhado pelo painel."
      />
      <StakePanel stake={stake} onSave={(next) => actions.updateStake(next)} />
    </div>
  );
}
