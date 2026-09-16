import { createFileRoute } from "@tanstack/react-router";

import { PresetManager } from "@/components/gatilho/PresetManager";
import { SectionHeader } from "@/components/gatilho/primitives";
import { useDashboard } from "@/store/dashboard";

export const Route = createFileRoute("/presets")({
  head: () => ({
    meta: [
      { title: "Presets — GatilhoBR" },
      {
        name: "description",
        content:
          "Exporte e importe configurações por seção: favoritos, prioritários, binds, stake e preferências.",
      },
      { property: "og:title", content: "Presets — GatilhoBR" },
      {
        property: "og:description",
        content: "Compartilhe configurações completas ou parciais por código.",
      },
    ],
  }),
  component: PresetsPage,
});

function PresetsPage() {
  const { actions } = useDashboard();

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Presets"
        description="A importação é parcial: escolha exatamente quais seções serão substituídas."
      />
      <PresetManager
        onExport={(name, sections) => actions.exportPreset(name, sections)}
        onImport={(code, sections) => actions.importPreset(code, sections)}
      />
    </div>
  );
}
