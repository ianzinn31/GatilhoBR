import { createFileRoute } from "@tanstack/react-router";

import { BindCenter } from "@/components/gatilho/BindCenter";
import { SectionHeader } from "@/components/gatilho/primitives";

export const Route = createFileRoute("/binds")({
  head: () => ({
    meta: [
      { title: "Central de binds — GatilhoBR" },
      {
        name: "description",
        content:
          "Crie, edite, duplique e teste atalhos de teclado com estratégias de linha e detecção de conflitos.",
      },
      { property: "og:title", content: "Central de binds — GatilhoBR" },
      {
        property: "og:description",
        content: "Atalhos guiados por casa, jogador, mercado e estratégia de linha.",
      },
    ],
  }),
  component: BindsPage,
});

function BindsPage() {
  return (
    <div className="space-y-4">
      <SectionHeader
        title="Central de binds"
        description="Cada bind aponta para uma seleção estável. O teste apenas destaca, nunca envia aposta."
      />
      <BindCenter />
    </div>
  );
}
