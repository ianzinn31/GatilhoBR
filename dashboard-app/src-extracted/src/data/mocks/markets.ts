import { PLAYERS, TEAMS } from "@/data/mocks/catalog";
import type {
  EventModel,
  HouseId,
  MarketCanonicalKey,
  MarketColumn,
  MarketModel,
  MarketRow,
  MarketStatus,
  Selection,
  SelectionStatus,
} from "@/types/gatilho";

export const MOCK_NOW = "2026-07-30T20:41:00.000Z";

export const MOCK_EVENTS: Record<HouseId, EventModel> = {
  bet365: {
    id: "evt-b365-9931",
    house: "bet365",
    fixtureId: "fx-san-fla-2026-07-30",
    competition: "Brasileirão Série A",
    homeTeamId: "santos",
    awayTeamId: "flamengo",
    minute: 63,
    period: "2º tempo",
    score: [1, 1],
    live: true,
  },
  betfair: {
    id: "evt-bf-4410",
    house: "betfair",
    fixtureId: "fx-san-fla-2026-07-30",
    competition: "Brasileirão Série A",
    homeTeamId: "santos",
    awayTeamId: "flamengo",
    minute: 63,
    period: "2º tempo",
    score: [1, 1],
    live: true,
  },
  betnacional: {
    id: "evt-bn-4410",
    house: "betnacional",
    fixtureId: "fx-san-fla-2026-07-30",
    competition: "BrasileirÃ£o SÃ©rie A",
    homeTeamId: "santos",
    awayTeamId: "flamengo",
    minute: 63,
    period: "2Âº tempo",
    score: [1, 1],
    live: true,
  },
  betmgm: {
    id: "evt-mgm-4410",
    house: "betmgm",
    fixtureId: "fx-san-fla-2026-07-30",
    competition: "Brasileirão Série A",
    homeTeamId: "santos",
    awayTeamId: "flamengo",
    minute: 63,
    period: "2º tempo",
    score: [1, 1],
    live: true,
  },
  superbet: {
    id: "evt-sb-4410",
    house: "superbet",
    fixtureId: "fx-san-fla-2026-07-30",
    competition: "Brasileirão Série A",
    homeTeamId: "santos",
    awayTeamId: "flamengo",
    minute: 63,
    period: "2º tempo",
    score: [1, 1],
    live: true,
  },
};

function team(teamId: string) {
  return TEAMS.find((item) => item.id === teamId)!;
}

function overLines(count: number): MarketColumn[] {
  return Array.from({ length: count }, (_, index) => {
    const value = index + 0.5;
    return { key: `over_${value}`, label: `Mais ${value}`, lineValue: value };
  });
}

function plusLines(values: number[]): MarketColumn[] {
  return values.map((value) => ({
    key: `plus_${value}`,
    label: `${value}+`,
    lineValue: value,
  }));
}

function yesNoLines(labels: string[]): MarketColumn[] {
  return labels.map((label) => ({ key: label.toLowerCase().replace(/\s+/g, "_"), label }));
}

interface PlayerSpec {
  playerId: string;
  /** Quantidade de colunas realmente ofertadas pela casa a este jogador. */
  available: number;
  base: number;
  /** Sobrescreve o status de colunas específicas (índice da coluna). */
  status?: Partial<Record<number, SelectionStatus>>;
  /** Colunas com odd alterada — guarda a odd anterior. */
  changed?: Partial<Record<number, number>>;
}

interface MarketSpec {
  id: string;
  house: HouseId;
  canonicalKey: MarketCanonicalKey;
  displayName: string;
  status?: MarketStatus;
  columns: MarketColumn[];
  players: PlayerSpec[];
}

function buildMarket(spec: MarketSpec): MarketModel {
  const event = MOCK_EVENTS[spec.house];
  const rows: MarketRow[] = spec.players.map((playerSpec, rowIndex) => {
    const player = PLAYERS.find((item) => item.id === playerSpec.playerId)!;
    const playerTeam = team(player.teamId);

    const cells = spec.columns.map((column, columnIndex): Selection | null => {
      // Célula inexistente: a casa não oferta esta linha para este jogador.
      if (columnIndex >= playerSpec.available) return null;

      const status: SelectionStatus = playerSpec.status?.[columnIndex] ?? "open";
      const priceable = status !== "locked" && status !== "unavailable";
      const odds = priceable
        ? Math.round((playerSpec.base + columnIndex * 0.74 + rowIndex * 0.09) * 100) / 100
        : null;

      return {
        id: `${spec.id}:${player.id}:${column.key}`,
        house: spec.house,
        eventId: event.id,
        marketId: spec.id,
        marketCanonicalKey: spec.canonicalKey,
        marketDisplayName: spec.displayName,
        playerId: player.id,
        playerName: player.name,
        teamId: playerTeam.id,
        teamName: playerTeam.name,
        line: column.label,
        lineValue: column.lineValue,
        columnIndex,
        rowIndex,
        odds,
        previousOdds: playerSpec.changed?.[columnIndex],
        status: playerSpec.changed?.[columnIndex] !== undefined ? "odds_changed" : status,
      };
    });

    return { playerId: player.id, cells };
  });

  return {
    id: spec.id,
    house: spec.house,
    eventId: event.id,
    canonicalKey: spec.canonicalKey,
    displayName: spec.displayName,
    status: spec.status ?? "open",
    columns: spec.columns,
    rows,
    updatedAt: MOCK_NOW,
  };
}

/* --------------------------------------------------------------- Bet365 */

const bet365Shots = buildMarket({
  id: "mkt-b365-shots",
  house: "bet365",
  canonicalKey: "player_shots",
  displayName: "Jogador - Chutes",
  columns: overLines(9),
  players: [
    {
      playerId: "pl-neymar",
      available: 9,
      base: 1.28,
      status: { 6: "suspended", 8: "locked" },
      changed: { 2: 2.4 },
    },
    { playerId: "pl-guilherme", available: 6, base: 1.35, status: { 5: "suspended" } },
    { playerId: "pl-tiquinho", available: 7, base: 1.41 },
    { playerId: "pl-joao", available: 3, base: 1.9 },
    { playerId: "pl-otero", available: 5, base: 1.52, changed: { 1: 2.1 } },
    { playerId: "pl-pedro", available: 8, base: 1.3, status: { 7: "locked" } },
    { playerId: "pl-arrascaeta", available: 6, base: 1.44 },
    { playerId: "pl-gerson", available: 4, base: 1.72, status: { 3: "suspended" } },
    { playerId: "pl-bruno", available: 7, base: 1.33 },
    { playerId: "pl-pulgar", available: 2, base: 2.05 },
  ],
});

const bet365ShotsOnTarget = buildMarket({
  id: "mkt-b365-sot",
  house: "bet365",
  canonicalKey: "player_shots_on_target",
  displayName: "Jogador - Chutes ao Gol",
  columns: overLines(5),
  players: [
    { playerId: "pl-neymar", available: 5, base: 1.55, status: { 4: "suspended" } },
    { playerId: "pl-tiquinho", available: 4, base: 1.62 },
    { playerId: "pl-otero", available: 2, base: 2.2 },
    { playerId: "pl-pedro", available: 5, base: 1.48, changed: { 0: 1.4 } },
    { playerId: "pl-bruno", available: 3, base: 1.85 },
    { playerId: "pl-arrascaeta", available: 3, base: 1.94 },
  ],
});

const bet365Fouls = buildMarket({
  id: "mkt-b365-fouls",
  house: "bet365",
  canonicalKey: "player_fouls",
  displayName: "Jogador - Faltas Cometidas",
  status: "suspended",
  columns: plusLines([1, 2, 3]),
  players: [
    { playerId: "pl-joao", available: 3, base: 1.68, status: { 2: "suspended" } },
    { playerId: "pl-pulgar", available: 3, base: 1.6 },
    { playerId: "pl-gerson", available: 2, base: 1.75 },
    { playerId: "pl-neymar", available: 3, base: 1.82 },
  ],
});

const bet365Cards = buildMarket({
  id: "mkt-b365-cards",
  house: "bet365",
  canonicalKey: "player_cards",
  displayName: "Jogador - Cartão",
  columns: yesNoLines(["Receber cartão", "Cartão vermelho"]),
  players: [
    { playerId: "pl-pulgar", available: 2, base: 3.1 },
    { playerId: "pl-joao", available: 2, base: 3.45 },
    { playerId: "pl-gerson", available: 1, base: 3.8 },
    { playerId: "pl-neymar", available: 2, base: 4.2, status: { 1: "locked" } },
    { playerId: "pl-bruno", available: 1, base: 4.6 },
  ],
});

/* -------------------------------------------------------------- Betfair */

const betfairShots = buildMarket({
  id: "mkt-bf-shots",
  house: "betfair",
  canonicalKey: "player_shots",
  displayName: "Chutes por Jogador",
  columns: plusLines([1, 2, 3, 4, 5]),
  players: [
    { playerId: "pl-neymar", available: 5, base: 1.31, changed: { 3: 5.5 } },
    { playerId: "pl-pedro", available: 5, base: 1.34, status: { 4: "suspended" } },
    { playerId: "pl-guilherme", available: 4, base: 1.4 },
    { playerId: "pl-tiquinho", available: 3, base: 1.46 },
    { playerId: "pl-bruno", available: 5, base: 1.37 },
    { playerId: "pl-arrascaeta", available: 2, base: 1.66 },
    { playerId: "pl-otero", available: 3, base: 1.58 },
  ],
});

const betfairShotsOnTarget = buildMarket({
  id: "mkt-bf-sot",
  house: "betfair",
  canonicalKey: "player_shots_on_target",
  displayName: "Chutes no Gol por Jogador",
  columns: plusLines([1, 2, 3]),
  players: [
    { playerId: "pl-neymar", available: 3, base: 1.6 },
    { playerId: "pl-pedro", available: 3, base: 1.52, status: { 2: "suspended" } },
    { playerId: "pl-tiquinho", available: 2, base: 1.78 },
    { playerId: "pl-bruno", available: 2, base: 1.83 },
  ],
});

const betfairGoalOrAssist = buildMarket({
  id: "mkt-bf-goal-assist",
  house: "betfair",
  canonicalKey: "player_goal_or_assist",
  displayName: "Marcar ou Assistir",
  columns: yesNoLines(["Sim", "Não"]),
  players: [
    { playerId: "pl-neymar", available: 2, base: 2.15, changed: { 0: 2.4 } },
    { playerId: "pl-pedro", available: 2, base: 2.05 },
    { playerId: "pl-arrascaeta", available: 2, base: 2.6 },
    { playerId: "pl-guilherme", available: 1, base: 3.1 },
    { playerId: "pl-gerson", available: 2, base: 3.4, status: { 1: "suspended" } },
  ],
});

const betfairFoulsDrawn = buildMarket({
  id: "mkt-bf-fouls-drawn",
  house: "betfair",
  canonicalKey: "player_fouls_drawn",
  displayName: "Faltas Sofridas por Jogador",
  columns: plusLines([1, 2, 3]),
  players: [
    { playerId: "pl-neymar", available: 3, base: 1.44 },
    { playerId: "pl-arrascaeta", available: 3, base: 1.7 },
    { playerId: "pl-otero", available: 2, base: 1.88 },
    { playerId: "pl-guilherme", available: 1, base: 2.05 },
  ],
});

const betfairGoalscorer = buildMarket({
  id: "mkt-bf-goalscorer",
  house: "betfair",
  canonicalKey: "player_goalscorer",
  displayName: "Marcador de Gol",
  status: "closed",
  columns: yesNoLines(["A qualquer momento", "Próximo gol", "Último"]),
  players: [
    { playerId: "pl-pedro", available: 3, base: 2.9, status: { 1: "locked", 2: "locked" } },
    { playerId: "pl-neymar", available: 3, base: 3.05, status: { 1: "locked" } },
    { playerId: "pl-tiquinho", available: 2, base: 3.6, status: { 1: "locked" } },
  ],
});

export const MOCK_MARKETS: MarketModel[] = [
  bet365Shots,
  bet365ShotsOnTarget,
  bet365Fouls,
  bet365Cards,
  betfairShots,
  betfairShotsOnTarget,
  betfairGoalOrAssist,
  betfairFoulsDrawn,
  betfairGoalscorer,
];
