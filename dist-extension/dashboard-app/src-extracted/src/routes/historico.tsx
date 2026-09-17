import { createFileRoute } from "@tanstack/react-router";

import { ActivityLog } from "@/components/gatilho/ActivityLog";
import { SectionHeader } from "@/components/gatilho/primitives";
import { useDashboard } from "@/store/dashboard";

export const Route = createFileRoute("/historico")({
  head: () => ({
    meta: [
      { title: "Histórico de ações — GatilhoBR" },
      {
        name: "description",
        content:
          "Registro de binds acionadas, bloqueios e erros com data, casa, mercado, jogador e resultado.",
      },
      { property: "og:title", content: "Histórico de ações — GatilhoBR" },
      {
        property: "og:description",
        content: "Auditoria completa das ações do painel, exportável em CSV.",
      },
    ],
  }),
  component: HistoryPage,
});

function HistoryPage() {
  const { activity } = useDashboard();

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Histórico de ações"
        description="Tudo o que o painel encaminhou, bloqueou ou falhou em executar."
      />
      <ActivityLog records={activity} />
    </div>
  );
}
