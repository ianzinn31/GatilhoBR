import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { FileText, RefreshCw, ShieldCheck } from "lucide-react";

import { LegalDocumentDialog } from "@/components/auth/LegalDocumentDialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { SectionHeader } from "@/components/gatilho/primitives";
import { statusToast } from "@/components/gatilho/StatusToast";
import { HOUSES } from "@/data/mocks/catalog";
import { formatDateTime } from "@/lib/format";
import { useDashboard } from "@/store/dashboard";
import type { Density, HouseId } from "@/types/gatilho";
import type { LegalDocumentKind } from "@/content/legal";

export const Route = createFileRoute("/configuracoes")({
  head: () => ({
    meta: [
      { title: "Configurações — GatilhoBR" },
      {
        name: "description",
        content:
          "Densidade da interface, casa padrão, ordenação de favoritos e estado da licença do GatilhoBR.",
      },
      { property: "og:title", content: "Configurações — GatilhoBR" },
      {
        property: "og:description",
        content: "Ajuste a interface do painel e verifique sua licença.",
      },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const { preferences, session, lastSync, actions } = useDashboard();
  const [openLegalDocument, setOpenLegalDocument] = useState<LegalDocumentKind | null>(null);
  const patch = (partial: Partial<typeof preferences>) =>
    void actions.updatePreferences({ ...preferences, ...partial });

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Configurações"
        description="Preferências de exibição e informações da conta."
        actions={
          <Button
            size="sm"
            variant="outline"
            className="h-9 gap-1.5"
            onClick={() => {
              void actions.sync();
              statusToast.info("Sincronizando com as abas abertas…");
            }}
          >
            <RefreshCw className="size-3.5" />
            Sincronizar
          </Button>
        }
      />

      <section className="rounded-lg border border-border bg-card p-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Interface
        </h2>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <Label className="mb-1 block text-[11px] text-muted-foreground">Densidade</Label>
            <Select
              value={preferences.density}
              onValueChange={(value) => patch({ density: value as Density })}
            >
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="compact">Compacta</SelectItem>
                <SelectItem value="comfortable">Confortável</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="mb-1 block text-[11px] text-muted-foreground">Casa padrão</Label>
            <Select
              value={preferences.defaultHouse}
              onValueChange={(value) => patch({ defaultHouse: value as HouseId })}
            >
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {HOUSES.map((house) => (
                  <SelectItem key={house.id} value={house.id}>
                    {house.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="mt-3 space-y-3">
          <ToggleRow
            id="pref-favorites"
            label="Favoritos no topo"
            checked={preferences.favoritesFirst}
            onChange={(checked) => patch({ favoritesFirst: checked })}
          />
          <ToggleRow
            id="pref-priorities"
            label="Jogadores prioritários no topo"
            checked={preferences.prioritiesFirst}
            onChange={(checked) => patch({ prioritiesFirst: checked })}
          />
          <ToggleRow
            id="pref-suspended"
            label="Mostrar linhas suspensas"
            checked={preferences.showSuspended}
            onChange={(checked) => patch({ showSuspended: checked })}
          />
          <ToggleRow
            id="pref-odds"
            label="Destacar mudanças de odd"
            checked={preferences.highlightOddsChange}
            onChange={(checked) => patch({ highlightOddsChange: checked })}
          />
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Conta e licença
        </h2>
        <div className="mt-2 grid gap-1 text-[13px]">
          <p className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-ok" />
            <span className="font-medium">{session.license.plan}</span>
            <span className="text-[11px] text-muted-foreground">
              renova em {session.license.renewsAt}
            </span>
          </p>
          <p className="text-[11px] text-muted-foreground">
            {session.user?.email ?? "sessão local"} · última sincronização{" "}
            {lastSync ? formatDateTime(lastSync) : "—"}
          </p>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Documentos legais
        </h2>
        <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
          Consulte a qualquer momento os documentos aceitos no cadastro.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setOpenLegalDocument("terms")}>
            <FileText className="size-3.5" />
            Termos de Uso
          </Button>
          <Button size="sm" variant="outline" onClick={() => setOpenLegalDocument("privacy")}>
            <ShieldCheck className="size-3.5" />
            Política de Privacidade
          </Button>
        </div>
      </section>

      <LegalDocumentDialog
        document={openLegalDocument}
        onOpenChange={(open) => {
          if (!open) setOpenLegalDocument(null);
        }}
      />
    </div>
  );
}

function ToggleRow({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
      <Label htmlFor={id} className="min-w-0 truncate text-[13px] font-medium">
        {label}
      </Label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} className="shrink-0" />
    </div>
  );
}
