import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Keyboard, LoaderCircle, Plus, Radio } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BindCard } from "@/components/gatilho/BindCard";
import { BindEditor } from "@/components/gatilho/BindEditor";
import { EmptyState } from "@/components/gatilho/primitives";
import { statusToast } from "@/components/gatilho/StatusToast";
import { HOUSES } from "@/data/mocks/catalog";
import {
  bindConflicts,
  bindShortcut,
  bindTargetLabel,
  canonicalLabel,
  resolveBinds,
} from "@/lib/selectors";
import { useDashboard } from "@/store/dashboard";
import { extensionBridge } from "@/services/extensionBridge";
import type {
  Bind,
  GlobalBindShortcut,
  GlobalBindSlotAssignments,
  GlobalBindSlotId,
  HouseId,
} from "@/types/gatilho";

const GLOBAL_BIND_SLOTS: GlobalBindSlotId[] = ["1", "2", "3", "4"];

export function BindCenter() {
  const { binds, markets, connections, preferences, actions } = useDashboard();
  const [query, setQuery] = useState("");
  const [house, setHouse] = useState<HouseId | "all">("all");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Bind | null>(null);
  const [globalSlots, setGlobalSlots] = useState<GlobalBindSlotAssignments>({});
  const [globalShortcuts, setGlobalShortcuts] = useState<GlobalBindShortcut[]>([]);
  const [loadingGlobalSlots, setLoadingGlobalSlots] = useState(true);
  const [savingGlobalSlot, setSavingGlobalSlot] = useState<GlobalBindSlotId | null>(null);

  useEffect(() => {
    let active = true;
    const loadGlobalSlots = async () => {
      try {
        const result = await extensionBridge.getGlobalBindSlots();
        if (!active) return;
        setGlobalSlots(result.assignments);
        setGlobalShortcuts(result.shortcuts);
      } finally {
        if (active) setLoadingGlobalSlots(false);
      }
    };
    void loadGlobalSlots();
    window.addEventListener("focus", loadGlobalSlots);
    return () => {
      active = false;
      window.removeEventListener("focus", loadGlobalSlots);
    };
  }, []);

  const conflicts = useMemo(() => bindConflicts(binds), [binds]);
  const conflictingIds = useMemo(() => new Set(Object.values(conflicts).flat()), [conflicts]);

  const resolutions = useMemo(
    () => resolveBinds(binds, markets, connections),
    [binds, markets, connections],
  );

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    return resolutions
      .filter((resolution) => (house === "all" ? true : resolution.bind.houseId === house))
      .filter((resolution) =>
        !term
          ? true
          : `${bindTargetLabel(resolution.bind)} ${canonicalLabel(resolution.bind.marketCanonicalKey)} ${bindShortcut(resolution.bind)}`
              .toLowerCase()
              .includes(term),
      );
  }, [resolutions, house, query]);

  const unavailable = resolutions.filter((item) => item.availability !== "available").length;
  const bindById = useMemo(() => new Map(binds.map((bind) => [bind.id, bind])), [binds]);
  const assignableBinds = useMemo(
    () =>
      [...binds].sort((left, right) =>
        `${left.houseId}:${bindTargetLabel(left)}`.localeCompare(
          `${right.houseId}:${bindTargetLabel(right)}`,
          "pt-BR",
        ),
      ),
    [binds],
  );

  const shortcutForSlot = (slot: GlobalBindSlotId) =>
    globalShortcuts.find((shortcut) => shortcut.slot === slot)?.shortcut || "";

  const assignGlobalSlot = async (slot: GlobalBindSlotId, bindId: string) => {
    setSavingGlobalSlot(slot);
    try {
      const next = await extensionBridge.updateGlobalBindSlot(
        slot,
        bindId === "unassigned" ? null : bindId,
      );
      setGlobalSlots(next);
      statusToast.success(
        bindId === "unassigned"
          ? `Slot global ${slot} liberado`
          : `Slot global ${slot} configurado`,
        bindId === "unassigned"
          ? "Nenhuma bind será disparada por esse atalho."
          : "O atalho agora funciona mesmo sem foco na extensão.",
      );
    } catch {
      statusToast.blocked("Não foi possível salvar o slot global.");
    } finally {
      setSavingGlobalSlot(null);
    }
  };

  return (
    <div className="space-y-3">
      <section className="overflow-hidden rounded-xl border border-primary/30 bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.11),transparent_42%),hsl(var(--card))] shadow-[0_0_0_1px_hsl(var(--primary)/0.04)]">
        <div className="flex flex-col gap-3 border-b border-border/80 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-2.5">
            <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg border border-primary/35 bg-primary/10 text-primary">
              <Radio className="size-4" />
            </span>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold tracking-tight text-foreground">
                Binds globais
              </h2>
              <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
                Quatro atalhos físicos do Chrome. Funcionam com outra janela ou aplicativo em foco.
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 shrink-0 gap-1.5 border-primary/25 bg-background/70 text-[11px] hover:border-primary/50 hover:text-primary"
            onClick={async () => {
              const opened = await extensionBridge.openGlobalBindShortcutSettings();
              if (!opened) statusToast.blocked("Abra chrome://extensions/shortcuts no Chrome.");
            }}
          >
            Teclas do Chrome
            <ExternalLink className="size-3" />
          </Button>
        </div>

        <div className="grid gap-px bg-border/70 sm:grid-cols-2 xl:grid-cols-4">
          {GLOBAL_BIND_SLOTS.map((slot) => {
            const assignedId = globalSlots[slot];
            const assignedBind = assignedId ? bindById.get(assignedId) : undefined;
            const shortcut = shortcutForSlot(slot);
            const isSaving = savingGlobalSlot === slot;
            return (
              <article key={slot} className="relative min-w-0 bg-card/95 px-3 py-3">
                <span className="absolute inset-y-0 left-0 w-0.5 bg-primary/80" />
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-[9px] font-bold uppercase tracking-[0.18em] text-primary">
                    Global 0{slot}
                  </span>
                  <kbd
                    className={`rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold ${
                      shortcut
                        ? "border-primary/30 bg-primary/10 text-primary"
                        : "border-amber-500/30 bg-amber-500/10 text-amber-300"
                    }`}
                  >
                    {shortcut || "Sem tecla"}
                  </kbd>
                </div>

                <Select
                  value={assignedBind ? assignedBind.id : "unassigned"}
                  disabled={loadingGlobalSlots || savingGlobalSlot !== null}
                  onValueChange={(value) => void assignGlobalSlot(slot, value)}
                >
                  <SelectTrigger className="h-9 w-full border-border/90 bg-background/65 text-xs">
                    {isSaving ? (
                      <span className="flex items-center gap-1.5 text-muted-foreground">
                        <LoaderCircle className="size-3 animate-spin" /> Salvando
                      </span>
                    ) : (
                      <SelectValue placeholder="Escolher bind" />
                    )}
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unassigned">Não configurado</SelectItem>
                    {assignableBinds.map((bind) => (
                      <SelectItem key={bind.id} value={bind.id} disabled={!bind.enabled}>
                        {bind.houseId.toUpperCase()} · {bindTargetLabel(bind)} ·{" "}
                        {canonicalLabel(bind.marketCanonicalKey)}
                        {!bind.enabled ? " · DESATIVADA" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <p className="mt-2 truncate text-[10px] text-muted-foreground">
                  {assignedBind
                    ? assignedBind.enabled
                      ? `${assignedBind.houseId.toUpperCase()} · ${canonicalLabel(assignedBind.marketCanonicalKey)}`
                      : "Bind desativada — atalho bloqueado"
                    : assignedId
                      ? "Bind removida — escolha outra"
                      : "Livre para atribuição"}
                </p>
              </article>
            );
          })}
        </div>
      </section>

      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-lg border border-border bg-card p-3 sm:flex sm:flex-wrap">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar por tecla, jogador ou opção"
          className="h-9 min-w-0 sm:max-w-xs"
        />
        <Select value={house} onValueChange={(value) => setHouse(value as HouseId | "all")}>
          <SelectTrigger className="h-9 w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as casas</SelectItem>
            {HOUSES.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {item.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <span className="hidden text-[11px] tabular text-muted-foreground md:inline">
            {binds.length} binds · {unavailable} indisponíveis · {Object.keys(conflicts).length}{" "}
            conflitos
          </span>
          <Button
            size="sm"
            className="h-9 gap-1.5"
            onClick={() => {
              setEditing(null);
              setEditorOpen(true);
            }}
          >
            <Plus className="size-3.5" />
            Nova bind
          </Button>
        </div>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={<Keyboard className="size-5" />}
          title="Nenhuma bind encontrada"
          description="Crie uma bind para disparar uma seleção específica com uma tecla."
        />
      ) : (
        <ul className="space-y-2">
          {visible.map((resolution) => (
            <BindCard
              key={resolution.bind.id}
              resolution={resolution}
              conflicting={conflictingIds.has(resolution.bind.id)}
              onEdit={() => {
                setEditing(resolution.bind);
                setEditorOpen(true);
              }}
              onDuplicate={() => {
                void actions.duplicateBind(resolution.bind);
                statusToast.info("Bind duplicada", "Defina uma tecla para ativá-la.");
              }}
              onDelete={() => void actions.deleteBind(resolution.bind)}
              onToggleEnabled={() => void actions.toggleBindEnabled(resolution.bind)}
              onExecute={async () => {
                statusToast.info("Bind acionada", "Localizando a seleção na casa…");
                const result = await actions.executeBind(resolution.bind);
                if (result.ok) statusToast.success("Bind executada", result.message);
                else statusToast.blocked(result.message);
              }}
              onTest={async () => {
                const result = await actions.testBind(resolution.bind);
                if (result.ok) statusToast.success("Prévia destacada", result.message);
                else statusToast.blocked(result.message);
              }}
            />
          ))}
        </ul>
      )}

      <BindEditor
        open={editorOpen}
        onOpenChange={setEditorOpen}
        markets={markets}
        connections={connections}
        binds={binds}
        initial={editing}
        defaultHouse={preferences.defaultHouse}
        onSave={(draft) => {
          return actions
            .saveBind(draft)
            .then((result) => {
              statusToast.success(
                result.replaced > 0
                  ? "Bind substituída"
                  : editing
                    ? "Bind atualizada"
                    : "Bind criada",
                bindTargetLabel({ ...result.bind, id: result.bind.id }),
              );
            })
            .catch((error) => {
              statusToast.blocked("Não foi possível salvar a bind.");
              throw error;
            });
        }}
      />
    </div>
  );
}
