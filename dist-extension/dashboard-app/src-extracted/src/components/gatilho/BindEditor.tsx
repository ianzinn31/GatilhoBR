import { useEffect, useMemo, useState } from "react";
import { Crosshair, ListChecks } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { LINE_STRATEGY_LABEL } from "@/components/gatilho/BindCard";
import { KeyCap } from "@/components/gatilho/primitives";
import { HOUSES, TEAMS } from "@/data/mocks/catalog";
import { formatOdd } from "@/lib/format";
import { getRuntimeTeams } from "@/lib/runtimeCatalog";
import {
  availableCanonicalKeys,
  bindShortcut,
  canonicalLabel,
  findMarket,
  panelTargetFromSelection,
  playerTeamId,
  playersByTeam,
  resolveBind,
  rowSelections,
} from "@/lib/selectors";
import type {
  Bind,
  BindLineStrategy,
  BindModifier,
  ConnectionStatus,
  HouseId,
  MarketCanonicalKey,
  MarketModel,
  Selection,
} from "@/types/gatilho";

type Draft = Omit<Bind, "id"> & { id?: string };

const STRATEGIES: BindLineStrategy[] = ["exact", "first_available", "next_available", "max_line"];
const MODIFIERS: BindModifier[] = ["ctrl", "alt", "shift"];

function marketSelections(market?: MarketModel) {
  return (
    market?.rows.flatMap((row) => row.cells.filter((cell): cell is Selection => cell !== null)) ??
    []
  );
}

function isPlayerMarket(market?: MarketModel) {
  return market?.isPlayerMarket === true || market?.canonicalKey.startsWith("player_") === true;
}

function selectionLabel(selection: Selection, market?: MarketModel) {
  const option = selection.source?.targetName || selection.line;
  const showRow =
    Boolean(selection.playerName) &&
    selection.playerName !== market?.displayName &&
    (market?.rows.length ?? 0) > 1;
  return `${showRow ? `${selection.playerName} · ` : ""}${option}`;
}

/** Toda escolha de célula no editor congela o alvo que o painel usa para clicar. */
function targetPatch(cell?: Selection | null): Partial<Draft> {
  return {
    rowLabel: cell?.playerName,
    rowIndex: cell?.rowIndex,
    columnIndex: cell?.columnIndex,
    panelTarget: cell ? panelTargetFromSelection(cell) : undefined,
  };
}

function draftForMarket(house: HouseId, market?: MarketModel): Draft {
  const fallbackTeam = TEAMS[0]?.id || "";
  const row = market?.rows[0];
  const selection = marketSelections(market)[0];
  const playerTarget = isPlayerMarket(market);
  const teamId = row?.teamId || (row ? playerTeamId(row.playerId) : fallbackTeam);

  return {
    key: "",
    modifiers: [],
    houseId: house,
    eventId: market?.eventId,
    targetType: playerTarget ? "player_line" : "market_selection",
    teamId,
    playerId: row?.playerId || playersByTeam(teamId)[0]?.id || "",
    marketCanonicalKey: market?.canonicalKey || "player_shots",
    lineStrategy: playerTarget ? "first_available" : "exact",
    line: playerTarget ? undefined : selection?.line,
    selectionName: playerTarget ? undefined : selection?.source?.targetName || selection?.line,
    rowLabel: playerTarget ? undefined : selection?.playerName,
    rowIndex: playerTarget ? undefined : selection?.rowIndex,
    columnIndex: playerTarget ? undefined : selection?.columnIndex,
    panelTarget: playerTarget || !selection ? undefined : panelTargetFromSelection(selection),
    enabled: true,
  };
}

function emptyDraft(house: HouseId, markets: MarketModel[] = []) {
  return draftForMarket(
    house,
    markets.find((market) => market.house === house && market.rows.length > 0),
  );
}

function draftFromSelection(selection: Selection, market?: MarketModel): Draft {
  const base = draftForMarket(selection.house, market);
  const playerTarget = isPlayerMarket(market);
  return {
    ...base,
    targetType: playerTarget ? "player_line" : "market_selection",
    eventId: selection.eventId,
    teamId: selection.teamId,
    playerId: selection.playerId,
    marketCanonicalKey: selection.marketCanonicalKey,
    lineStrategy: "exact",
    line: selection.line,
    selectionName: playerTarget ? undefined : selection.source?.targetName || selection.line,
    ...targetPatch(selection),
  };
}

/** Editor adaptativo: mercados de jogador usam linha dinâmica; os demais, opção exata. */
export function BindEditor({
  open,
  onOpenChange,
  markets,
  connections,
  binds,
  initial,
  initialSelection,
  defaultHouse,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  markets: MarketModel[];
  connections: ConnectionStatus[];
  binds: Bind[];
  initial?: Bind | null;
  initialSelection?: Selection | null;
  defaultHouse: HouseId;
  onSave: (draft: Draft) => Promise<unknown> | unknown;
}) {
  const [draft, setDraft] = useState<Draft>(
    initial ??
      (initialSelection
        ? draftFromSelection(
            initialSelection,
            findMarket(markets, initialSelection.house, initialSelection.marketCanonicalKey),
          )
        : emptyDraft(defaultHouse, markets)),
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setSaving(false);
      setDraft(
        initial
          ? { ...initial, targetType: initial.targetType || "player_line" }
          : initialSelection
            ? draftFromSelection(
                initialSelection,
                findMarket(markets, initialSelection.house, initialSelection.marketCanonicalKey),
              )
            : emptyDraft(defaultHouse, markets),
      );
    }
  }, [open, initial, initialSelection, defaultHouse]);

  const patch = (partial: Partial<Draft>) => setDraft((previous) => ({ ...previous, ...partial }));
  const keys = useMemo(
    () => availableCanonicalKeys(markets, draft.houseId),
    [markets, draft.houseId],
  );
  const runtimeTeams = getRuntimeTeams();
  const teams = runtimeTeams.length ? runtimeTeams : TEAMS;
  const market = findMarket(markets, draft.houseId, draft.marketCanonicalKey);
  const playerTarget = draft.targetType !== "market_selection";
  const offeredRows = market?.rows ?? [];
  const offeredPlayers = offeredRows.filter(
    (row) => !draft.teamId || (row.teamId || playerTeamId(row.playerId)) === draft.teamId,
  );
  const fallbackPlayers = playersByTeam(draft.teamId);
  const playerOptions =
    offeredPlayers.length > 0
      ? offeredPlayers.map((row) => ({ id: row.playerId, name: row.playerName || row.playerId }))
      : fallbackPlayers;
  const lines =
    playerTarget && market
      ? rowSelections(market, draft.playerId).filter(
          (cell): cell is Selection => cell !== null && cell.line.trim() !== "",
        )
      : [];
  const simpleOptions = playerTarget ? [] : marketSelections(market);
  const selectedSimpleOption =
    simpleOptions.find((selection) => selection.id === draft.panelTarget?.selectionId) ??
    simpleOptions.find(
      (selection) =>
        selection.rowIndex === draft.rowIndex && selection.columnIndex === draft.columnIndex,
    );

  const preview = useMemo(
    () => resolveBind({ ...draft, id: draft.id ?? "preview" }, markets, connections),
    [draft, markets, connections],
  );
  const shortcut = bindShortcut({ ...draft, id: "preview" });
  const replacingShortcut = binds.some(
    (bind) =>
      bind.id !== draft.id &&
      bind.houseId === draft.houseId &&
      bind.key.trim().toUpperCase() === draft.key.trim().toUpperCase() &&
      [...(bind.modifiers ?? [])].sort().join("+") ===
        [...(draft.modifiers ?? [])].sort().join("+") &&
      draft.key !== "",
  );
  // A casa às vezes devolve a coluna sem rótulo. Nesse caso o alvo do painel
  // (outcome/seleção) já identifica a aposta, então exigir o texto da linha só
  // travava o cadastro em mercados de jogador.
  const pinnedTarget = Boolean(
    draft.panelTarget?.outcomeId ||
      draft.panelTarget?.selectionId ||
      draft.panelTarget?.targetName,
  );
  const valid =
    draft.key.trim() !== "" &&
    Boolean(market) &&
    (playerTarget
      ? Boolean(draft.playerId) &&
        (draft.lineStrategy !== "exact" ||
          Boolean(draft.line) ||
          pinnedTarget ||
          draft.columnIndex !== undefined)
      : Boolean(draft.selectionName || selectedSimpleOption || pinnedTarget));

  const changeHouse = (house: HouseId) => {
    const next = emptyDraft(house, markets);
    setDraft({
      ...next,
      key: draft.key,
      modifiers: draft.modifiers,
      stake: draft.stake,
      enabled: draft.enabled,
    });
  };

  const changeMarket = (key: MarketCanonicalKey) => {
    const nextMarket = findMarket(markets, draft.houseId, key);
    const next = draftForMarket(draft.houseId, nextMarket);
    setDraft({
      ...next,
      id: draft.id,
      key: draft.key,
      modifiers: draft.modifiers,
      stake: draft.stake,
      enabled: draft.enabled,
    });
  };

  const chooseSimpleOption = (selectionId: string) => {
    const selection = simpleOptions.find((item) => item.id === selectionId);
    if (!selection) return;
    patch({
      playerId: selection.playerId,
      teamId: selection.teamId,
      lineStrategy: "exact",
      line: selection.line,
      selectionName: selection.source?.targetName || selection.line,
      ...targetPatch(selection),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto scroll-slim sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial ? "Editar bind" : "Nova bind"}</DialogTitle>
          <DialogDescription>
            Escolha um mercado aberto. O painel adapta o alvo automaticamente e não dispara apostas
            nesta tela.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Step number={1} title="Casa e mercado">
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="Casa">
                <Select
                  value={draft.houseId}
                  onValueChange={(value) => changeHouse(value as HouseId)}
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
              </Field>

              <Field label="Mercado">
                <Select
                  value={draft.marketCanonicalKey}
                  onValueChange={(value) => changeMarket(value as MarketCanonicalKey)}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {keys.map((key) => (
                      <SelectItem key={key} value={key}>
                        {canonicalLabel(key)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <div className="mt-2 flex items-start gap-2 rounded-lg border border-primary/25 bg-primary/5 p-2.5">
              {playerTarget ? (
                <Crosshair className="mt-0.5 size-4 shrink-0 text-primary" />
              ) : (
                <ListChecks className="mt-0.5 size-4 shrink-0 text-primary" />
              )}
              <div>
                <p className="text-xs font-semibold">
                  {playerTarget ? "Jogador e linha dinâmica" : "Opção exata do mercado"}
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {playerTarget
                    ? "A bind localiza o atleta e aplica a estratégia escolhida às linhas abertas."
                    : "A bind localiza a mesma opção; se o texto mudar, usa a posição estrutural como apoio."}
                </p>
              </div>
            </div>
          </Step>

          <Step number={2} title={playerTarget ? "Jogador e linha" : "Seleção da aposta"}>
            {playerTarget ? (
              <div className="grid gap-2 sm:grid-cols-2">
                <Field label="Time">
                  <Select
                    value={draft.teamId}
                    onValueChange={(value) => {
                      const first = offeredRows.find(
                        (row) => (row.teamId || playerTeamId(row.playerId)) === value,
                      );
                      const firstCell = first?.cells.find(
                        (cell): cell is Selection => cell !== null,
                      );
                      patch({
                        teamId: value,
                        playerId: first?.playerId || playersByTeam(value)[0]?.id || "",
                        line: undefined,
                        ...targetPatch(firstCell),
                      });
                    }}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {teams.map((team) => (
                        <SelectItem key={team.id} value={team.id}>
                          {team.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>

                <Field label="Jogador">
                  <Select
                    value={draft.playerId}
                    onValueChange={(value) => {
                      const firstCell = market
                        ? rowSelections(market, value).find(
                            (cell): cell is Selection => cell !== null,
                          )
                        : undefined;
                      patch({
                        playerId: value,
                        line: undefined,
                        ...targetPatch(firstCell),
                      });
                    }}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {playerOptions.map((player) => (
                        <SelectItem key={player.id} value={player.id}>
                          {player.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>

                <Field label="Estratégia de linha" className="sm:col-span-2">
                  <Select
                    value={draft.lineStrategy}
                    onValueChange={(value) =>
                      patch({ lineStrategy: value as BindLineStrategy, line: undefined })
                    }
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STRATEGIES.map((strategy) => (
                        <SelectItem key={strategy} value={strategy}>
                          {LINE_STRATEGY_LABEL[strategy]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>

                {draft.lineStrategy === "exact" ? (
                  <Field label="Linha exata" className="sm:col-span-2">
                    <Select
                      value={draft.line ?? ""}
                      onValueChange={(value) => {
                        const cell = lines.find((item) => item.line === value);
                        patch({
                          line: value,
                          ...targetPatch(cell),
                        });
                      }}
                    >
                      <SelectTrigger className="h-9">
                        <SelectValue placeholder="Escolha uma linha ofertada" />
                      </SelectTrigger>
                      <SelectContent>
                        {lines.map((cell) => (
                          <SelectItem key={cell.id} value={cell.line}>
                            {cell.line} · {formatOdd(cell.odds)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                ) : null}
              </div>
            ) : (
              <Field label="Opção">
                <Select value={selectedSimpleOption?.id ?? ""} onValueChange={chooseSimpleOption}>
                  <SelectTrigger className="h-10">
                    <SelectValue placeholder="Escolha uma opção ofertada pela casa" />
                  </SelectTrigger>
                  <SelectContent>
                    {simpleOptions.map((selection) => (
                      <SelectItem key={selection.id} value={selection.id}>
                        {selectionLabel(selection, market)} · {formatOdd(selection.odds)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
          </Step>

          <Step number={3} title="Atalho e execução">
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="Tecla">
                <Input
                  value={draft.key}
                  maxLength={1}
                  placeholder="Ex.: N"
                  className="h-9 uppercase"
                  onChange={(event) => patch({ key: event.target.value.toUpperCase() })}
                />
              </Field>

              <Field label="Modificadores">
                <div className="flex h-9 items-center gap-1.5">
                  {MODIFIERS.map((modifier) => {
                    const active = draft.modifiers.includes(modifier);
                    return (
                      <Button
                        key={modifier}
                        type="button"
                        size="sm"
                        variant={active ? "secondary" : "outline"}
                        className="h-8 px-2 text-[11px] uppercase"
                        onClick={() =>
                          patch({
                            modifiers: active
                              ? draft.modifiers.filter((item) => item !== modifier)
                              : [...draft.modifiers, modifier],
                          })
                        }
                      >
                        {modifier}
                      </Button>
                    );
                  })}
                </div>
              </Field>

              <Field label="Stake específica (opcional)">
                <Input
                  type="number"
                  min={0}
                  value={draft.stake ?? ""}
                  className="h-9"
                  onChange={(event) =>
                    patch({ stake: event.target.value ? Number(event.target.value) : undefined })
                  }
                />
              </Field>

              <div className="flex items-end gap-2 pb-1">
                <Switch
                  id="bind-enabled"
                  checked={draft.enabled}
                  onCheckedChange={(checked) => patch({ enabled: checked })}
                />
                <Label htmlFor="bind-enabled" className="text-xs text-muted-foreground">
                  Bind ativa
                </Label>
              </div>
            </div>
          </Step>

          <div className="rounded-lg border border-border bg-surface p-3">
            <div className="flex flex-wrap items-center gap-2">
              <KeyCap value={shortcut || "—"} />
              <span className="text-xs text-muted-foreground">
                {preview.selection
                  ? `Alvo agora: ${preview.selection.source?.targetName || preview.selection.line} @ ${formatOdd(preview.selection.odds)}`
                  : preview.reason}
              </span>
            </div>
            {replacingShortcut ? (
              <p className="mt-2 text-[11px] font-medium text-primary">
                Ao salvar, a bind atual desta tecla nesta casa será substituída.
              </p>
            ) : null}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            disabled={!valid || saving}
            onClick={async () => {
              setSaving(true);
              try {
                await onSave(draft);
                onOpenChange(false);
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? "Salvando…" : initial ? "Salvar alterações" : "Criar bind"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Step({
  number,
  title,
  children,
}: {
  number: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <span className="grid size-5 place-items-center rounded-full bg-surface-2 text-[10px] text-foreground">
          {number}
        </span>
        {title}
      </h3>
      {children}
    </section>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label className="mb-1 block text-[11px] text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
