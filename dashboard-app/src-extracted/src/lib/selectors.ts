import { CANONICAL_LABEL, PLAYERS, TEAMS } from "@/data/mocks/catalog";
import {
  getRuntimeMarketLabel,
  getRuntimePlayer,
  getRuntimePlayers,
  getRuntimeTeam,
} from "@/lib/runtimeCatalog";
import type {
  Bind,
  BindAvailability,
  BindPanelTarget,
  BindResolution,
  ConnectionStatus,
  EventModel,
  HouseId,
  MarketCanonicalKey,
  MarketModel,
  Selection,
} from "@/types/gatilho";

/** Seletores puros. Nenhuma regra visual, nenhum acesso a serviços. */

/**
 * Congela a identidade que o painel já usa para clicar na odd. É o mesmo dado
 * enviado em `SELECT_ODDS_ACTION`, então a bind passa a mirar o outcome em vez
 * da posição da linha — que muda quando o mercado sobe ou desce na página.
 */
export function panelTargetFromSelection(selection: Selection): BindPanelTarget {
  return {
    outcomeId: selection.source?.outcomeId || undefined,
    selectionId: selection.id,
    marketId: selection.marketId,
    targetName: selection.source?.targetName || undefined,
    lineName: selection.source?.lineName || undefined,
    optionLabel: selection.source?.optionLabel || selection.line || undefined,
    marketTitle: selection.source?.marketTitle || selection.marketDisplayName || undefined,
  };
}

export function playerName(playerId: string) {
  return (
    getRuntimePlayer(playerId)?.name ??
    PLAYERS.find((player) => player.id === playerId)?.name ??
    playerId
  );
}

export function playerTeamId(playerId: string) {
  return (
    getRuntimePlayer(playerId)?.teamId ??
    PLAYERS.find((player) => player.id === playerId)?.teamId ??
    ""
  );
}

export function teamName(teamId: string) {
  return getRuntimeTeam(teamId)?.name ?? TEAMS.find((team) => team.id === teamId)?.name ?? teamId;
}

/**
 * Nomes dos dois times do confronto. A lista de jogadores prioritários usa isso
 * para descartar linhas que são o time inteiro, não um atleta.
 */
export function eventTeamNames(event?: EventModel | null): string[] {
  if (!event) return [];
  return [teamName(event.homeTeamId), teamName(event.awayTeamId)].filter(Boolean);
}

export function playersByTeam(teamId: string) {
  const livePlayers = getRuntimePlayers().filter((player) => player.teamId === teamId);
  return livePlayers.length > 0
    ? livePlayers
    : PLAYERS.filter((player) => player.teamId === teamId);
}

export function canonicalLabel(key: MarketCanonicalKey) {
  return getRuntimeMarketLabel(key) ?? CANONICAL_LABEL[key] ?? key.replace(/_/g, " ");
}

export function isMarketSelectionBind(bind: Bind) {
  return bind.targetType === "market_selection";
}

export function bindTargetLabel(bind: Bind) {
  return isMarketSelectionBind(bind)
    ? bind.selectionName || bind.line || canonicalLabel(bind.marketCanonicalKey)
    : playerName(bind.playerId);
}

export function marketsByHouse(markets: MarketModel[], house: HouseId) {
  return markets.filter((market) => market.house === house);
}

export function findMarket(
  markets: MarketModel[],
  house: HouseId,
  key: MarketCanonicalKey,
): MarketModel | undefined {
  return markets.find((market) => market.house === house && market.canonicalKey === key);
}

export function availableCanonicalKeys(markets: MarketModel[], house?: HouseId) {
  const keys = new Set<MarketCanonicalKey>();
  for (const market of markets) {
    if (house && market.house !== house) continue;
    keys.add(market.canonicalKey);
  }
  return [...keys];
}

export function rowSelections(market: MarketModel, playerId: string): Array<Selection | null> {
  return market.rows.find((row) => row.playerId === playerId)?.cells ?? [];
}

export function openSelections(market: MarketModel, playerId: string): Selection[] {
  return rowSelections(market, playerId).filter(
    (cell): cell is Selection =>
      cell !== null && cell.status !== "locked" && cell.status !== "unavailable",
  );
}

export function countOpenSelections(market: MarketModel) {
  return market.rows.reduce(
    (total, row) =>
      total +
      row.cells.filter((cell) => cell && (cell.status === "open" || cell.status === "odds_changed"))
        .length,
    0,
  );
}

export interface MarketFilterState {
  query: string;
  canonicalKey: MarketCanonicalKey | "all";
  teamId: string | "all";
  onlyFavorites: boolean;
  onlyOpen: boolean;
  favoritesFirst: boolean;
}

export const DEFAULT_MARKET_FILTERS: MarketFilterState = {
  query: "",
  canonicalKey: "all",
  teamId: "all",
  onlyFavorites: false,
  onlyOpen: false,
  favoritesFirst: true,
};

export function filterMarkets(
  markets: MarketModel[],
  filters: MarketFilterState,
  favoriteMarketKeys: MarketCanonicalKey[],
): MarketModel[] {
  const term = filters.query.trim().toLowerCase();

  const list = markets
    .filter((market) =>
      filters.canonicalKey === "all" ? true : market.canonicalKey === filters.canonicalKey,
    )
    .filter((market) =>
      filters.onlyFavorites ? favoriteMarketKeys.includes(market.canonicalKey) : true,
    )
    .filter((market) => (filters.onlyOpen ? market.status === "open" : true))
    .map((market) => {
      if (filters.teamId === "all" && !term) return market;
      const rows = market.rows.filter((row) => {
        const matchesTeam =
          filters.teamId === "all" ||
          !market.isPlayerMarket ||
          playerTeamId(row.playerId) === filters.teamId;
        const matchesTerm =
          !term ||
          playerName(row.playerId).toLowerCase().includes(term) ||
          market.displayName.toLowerCase().includes(term);
        return matchesTeam && matchesTerm;
      });
      return { ...market, rows };
    })
    .filter((market) => market.rows.length > 0);

  if (!filters.favoritesFirst) return list;
  return [...list].sort(
    (a, b) =>
      Number(favoriteMarketKeys.includes(b.canonicalKey)) -
      Number(favoriteMarketKeys.includes(a.canonicalKey)),
  );
}

export function sortRows(
  market: MarketModel,
  favoritePlayerIds: string[],
  prioritiesFirst: boolean,
) {
  if (!prioritiesFirst) return market.rows;
  return [...market.rows].sort(
    (a, b) =>
      Number(favoritePlayerIds.includes(b.playerId)) -
      Number(favoritePlayerIds.includes(a.playerId)),
  );
}

/* ------------------------------------------------------------------ binds */

export function bindShortcut(bind: Bind) {
  const map = { ctrl: "Ctrl", alt: "Alt", shift: "⇧" } as const;
  return [...bind.modifiers.map((modifier) => map[modifier]), bind.key.toUpperCase()].join("+");
}

export function bindConflictKey(bind: Bind) {
  const normalize = (value: unknown) =>
    String(value ?? "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

  // A mesma tecla pode apontar para alvos diferentes. Conflito real é apenas
  // a repetição do atalho para o mesmo alvo no mesmo jogo.
  const shortcut = [...(bind.modifiers ?? []).sort(), bind.key.toUpperCase()].join("+");
  return [
    bind.houseId,
    shortcut,
    bind.eventId || bind.eventLabel || "event:unknown",
    bind.targetType || "player_line",
    bind.teamId || "team:unknown",
    bind.marketCanonicalKey,
    bind.playerId,
    bind.selectionName,
    bind.line,
    bind.rowLabel,
    bind.rowIndex,
    bind.columnIndex,
  ]
    .map(normalize)
    .join(":");
}

export function bindConflicts(binds: Bind[]): Record<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const bind of binds) {
    const conflictKey = bindConflictKey(bind);
    groups.set(conflictKey, [...(groups.get(conflictKey) ?? []), bind.id]);
  }
  const conflicts: Record<string, string[]> = {};
  for (const [conflictKey, ids] of groups) {
    if (ids.length > 1) conflicts[conflictKey] = ids;
  }
  return conflicts;
}

const AVAILABILITY_REASON: Record<BindAvailability, string> = {
  available: "Pronta para disparar",
  house_disconnected: "Casa desconectada ou sessão expirada",
  market_unavailable: "Mercado não está aberto nesta casa agora",
  player_unavailable: "Jogador sem linhas neste mercado",
  selection_unavailable: "A opção configurada não está aberta neste mercado",
  line_unavailable: "Nenhuma linha compatível com a estratégia",
};

/** Resolve a seleção alvo de uma bind conforme a estratégia de linha. */
function normalizedSelectionText(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Reaponta o alvo do painel na fotografia atual. A ordem é deliberada: o
 * outcome da casa é imune a reordenação; o id da seleção sobrevive a mudanças
 * de preço; o nome só entra por último, e nunca a posição.
 */
function matchPanelTarget(
  target: BindPanelTarget | undefined,
  usable: Selection[],
): Selection | undefined {
  if (!target) return undefined;
  return (
    (target.outcomeId
      ? usable.find((cell) => cell.source?.outcomeId === target.outcomeId)
      : undefined) ??
    (target.selectionId ? usable.find((cell) => cell.id === target.selectionId) : undefined) ??
    (target.targetName
      ? usable.find((cell) => {
          const sameName =
            normalizedSelectionText(cell.source?.targetName) ===
            normalizedSelectionText(target.targetName);
          const sameRow =
            !target.lineName ||
            normalizedSelectionText(cell.playerName) === normalizedSelectionText(target.lineName);
          return sameName && sameRow;
        })
      : undefined)
  );
}

export function resolveBind(
  bind: Bind,
  markets: MarketModel[],
  connections: ConnectionStatus[],
): BindResolution {
  const connection = connections.find((item) => item.house === bind.houseId);
  const fail = (availability: BindAvailability): BindResolution => ({
    bind,
    availability,
    selection: null,
    reason: AVAILABILITY_REASON[availability],
  });

  if (!connection || connection.state !== "connected") return fail("house_disconnected");

  const market = findMarket(markets, bind.houseId, bind.marketCanonicalKey);
  if (!market || market.status === "closed") return fail("market_unavailable");

  if (isMarketSelectionBind(bind)) {
    const cells = market.rows.flatMap((row) =>
      row.cells.filter((cell): cell is Selection => cell !== null),
    );
    const usable = cells.filter(
      (cell) =>
        cell.odds !== null &&
        cell.status !== "locked" &&
        cell.status !== "suspended" &&
        cell.status !== "unavailable",
    );
    const requestedName = normalizedSelectionText(bind.selectionName);
    const requestedRow = normalizedSelectionText(bind.rowLabel);
    const requestedLine = normalizedSelectionText(bind.line);

    const selection =
      matchPanelTarget(bind.panelTarget, usable) ??
      usable.find((cell) => {
        const currentName = normalizedSelectionText(cell.source?.targetName);
        const currentRow = normalizedSelectionText(cell.playerName);
        return (
          requestedName &&
          currentName === requestedName &&
          (!requestedRow || currentRow === requestedRow)
        );
      }) ??
      usable.find(
        (cell) => cell.rowIndex === bind.rowIndex && cell.columnIndex === bind.columnIndex,
      ) ??
      usable.find(
        (cell) =>
          requestedLine &&
          normalizedSelectionText(cell.line) === requestedLine &&
          (!requestedRow || normalizedSelectionText(cell.playerName) === requestedRow),
      );

    if (!selection) return fail("selection_unavailable");
    return { bind, availability: "available", selection, reason: AVAILABILITY_REASON.available };
  }

  // Mercados de jogador com linha exata também miram o outcome salvo. Isso
  // funciona mesmo quando a linha do atleta trocou de posição ou de rótulo —
  // as estratégias dinâmicas continuam seguindo a oferta ao vivo.
  if (bind.lineStrategy === "exact") {
    const pinned = matchPanelTarget(
      bind.panelTarget,
      market.rows
        .flatMap((row) => row.cells)
        .filter(
          (cell): cell is Selection =>
            cell !== null && cell.odds !== null && cell.status !== "locked",
        ),
    );
    if (pinned) {
      return { bind, availability: "available", selection: pinned, reason: AVAILABILITY_REASON.available };
    }
  }

  const cells = rowSelections(market, bind.playerId);
  if (cells.length === 0) return fail("player_unavailable");

  const usable = cells.filter(
    (cell): cell is Selection => cell !== null && cell.odds !== null && cell.status !== "locked",
  );
  if (usable.length === 0) return fail("line_unavailable");

  let selection: Selection | undefined;
  switch (bind.lineStrategy) {
    case "exact":
      // Binds antigas foram salvas sem rótulo porque a casa devolveu o cabeçalho
      // vazio. Sem rótulo pedido, a coluna guardada é a única referência.
      selection = bind.line
        ? (usable.find((cell) => cell.line === bind.line) ??
          usable.find(
            (cell) => normalizedSelectionText(cell.line) === normalizedSelectionText(bind.line),
          ))
        : usable.find((cell) => cell.columnIndex === bind.columnIndex);
      break;
    case "first_available":
      selection = usable.find((cell) => cell.status !== "suspended");
      break;
    case "next_available": {
      const openOnes = usable.filter((cell) => cell.status !== "suspended");
      selection = openOnes[1] ?? openOnes[0];
      break;
    }
    case "max_line":
      selection = [...usable]
        .filter((cell) => cell.status !== "suspended")
        .sort((a, b) => (b.lineValue ?? b.columnIndex) - (a.lineValue ?? a.columnIndex))[0];
      break;
  }

  if (!selection) return fail("line_unavailable");
  return { bind, availability: "available", selection, reason: AVAILABILITY_REASON.available };
}

export function resolveBinds(
  binds: Bind[],
  markets: MarketModel[],
  connections: ConnectionStatus[],
) {
  return binds.map((bind) => resolveBind(bind, markets, connections));
}
