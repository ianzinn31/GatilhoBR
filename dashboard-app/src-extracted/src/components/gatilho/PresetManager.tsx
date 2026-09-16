import { useState } from "react";
import { Check, Copy, Download, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { statusToast } from "@/components/gatilho/StatusToast";
import { cn } from "@/lib/utils";
import type { PresetSection } from "@/types/gatilho";

const SECTIONS: Array<{ key: PresetSection; label: string }> = [
  { key: "favoriteMarketKeys", label: "Mercados favoritos" },
  { key: "priorityMarketKeys", label: "Mercados prioritários" },
  { key: "favoritePlayerIds", label: "Jogadores prioritários" },
  { key: "binds", label: "Binds" },
  { key: "stake", label: "Stake" },
  { key: "preferences", label: "Preferências" },
];

export function PresetManager({
  onExport,
  onImport,
}: {
  onExport: (name: string, sections: PresetSection[]) => Promise<string>;
  onImport: (code: string, sections: PresetSection[]) => Promise<unknown>;
}) {
  const [name, setName] = useState("Meu preset ao vivo");
  const [exportSections, setExportSections] = useState<PresetSection[]>(
    SECTIONS.map((section) => section.key),
  );
  const [code, setCode] = useState("");
  const [importCode, setImportCode] = useState("");
  const [importSections, setImportSections] = useState<PresetSection[]>(
    SECTIONS.map((section) => section.key),
  );

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <section className="rounded-lg border border-border bg-card p-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Exportar
        </h2>

        <Label className="mb-1 mt-3 block text-[11px] text-muted-foreground">Nome do preset</Label>
        <Input value={name} onChange={(event) => setName(event.target.value)} className="h-9" />

        <SectionPicker
          className="mt-3"
          selected={exportSections}
          onChange={setExportSections}
        />

        <Button
          className="mt-3 w-full gap-1.5"
          disabled={exportSections.length === 0}
          onClick={async () => {
            const result = await onExport(name, exportSections);
            setCode(result);
            statusToast.success("Preset gerado", "Copie o código abaixo para compartilhar.");
          }}
        >
          <Download className="size-4" />
          Gerar código
        </Button>

        {code ? (
          <div className="mt-3">
            <Textarea readOnly value={code} className="h-24 font-mono text-[11px]" />
            <Button
              variant="outline"
              size="sm"
              className="mt-2 gap-1.5"
              onClick={() => {
                void navigator.clipboard.writeText(code);
                statusToast.success("Código copiado");
              }}
            >
              <Copy className="size-3.5" />
              Copiar código
            </Button>
          </div>
        ) : null}
      </section>

      <section className="rounded-lg border border-border bg-card p-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Importar
        </h2>

        <Label className="mb-1 mt-3 block text-[11px] text-muted-foreground">
          Cole o código recebido
        </Label>
        <Textarea
          value={importCode}
          onChange={(event) => setImportCode(event.target.value)}
          placeholder="GBR1...."
          className="h-24 font-mono text-[11px]"
        />

        <SectionPicker
          className="mt-3"
          selected={importSections}
          onChange={setImportSections}
          hint="Importação parcial: escolha apenas o que deseja substituir."
        />

        <Button
          className="mt-3 w-full gap-1.5"
          disabled={!importCode.trim() || importSections.length === 0}
          onClick={async () => {
            try {
              await onImport(importCode, importSections);
              statusToast.success("Preset importado", "As seções escolhidas foram aplicadas.");
              setImportCode("");
            } catch (error) {
              statusToast.error(
                "Não foi possível importar",
                error instanceof Error ? error.message : undefined,
              );
            }
          }}
        >
          <Upload className="size-4" />
          Importar seções escolhidas
        </Button>
      </section>
    </div>
  );
}

function SectionPicker({
  selected,
  onChange,
  hint,
  className,
}: {
  selected: PresetSection[];
  onChange: (next: PresetSection[]) => void;
  hint?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <p className="mb-1.5 text-[11px] text-muted-foreground">{hint ?? "Seções incluídas"}</p>
      <div className="flex flex-wrap gap-1.5">
        {SECTIONS.map((section) => {
          const active = selected.includes(section.key);
          return (
            <button
              key={section.key}
              type="button"
              onClick={() =>
                onChange(
                  active
                    ? selected.filter((item) => item !== section.key)
                    : [...selected, section.key],
                )
              }
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors",
                active
                  ? "border-primary/50 bg-primary/10 text-primary"
                  : "border-border bg-surface text-muted-foreground hover:text-foreground",
              )}
            >
              {active ? <Check className="size-3" /> : null}
              {section.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
