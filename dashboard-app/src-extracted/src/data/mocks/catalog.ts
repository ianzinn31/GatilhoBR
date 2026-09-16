import type { House, MarketCanonicalKey, Player, Team } from "@/types/gatilho";

export const HOUSES: House[] = [
  { id: "bet365", name: "Bet365", shortName: "B365", logoUrl: "./bet365-logo.png" },
  { id: "betfair", name: "Betfair", shortName: "BF", logoUrl: "./betfair-logo.png" },
  { id: "betnacional", name: "Betnacional", shortName: "BN", logoUrl: "./betnacional-logo.png" },
  { id: "betmgm", name: "BetMGM", shortName: "MGM", logoUrl: "./betmgm-logo.png" },
  { id: "superbet", name: "Superbet", shortName: "SB", logoUrl: "./superbet-logo.png" },
];

export const TEAMS: Team[] = [
  { id: "santos", name: "Santos", shortName: "SAN" },
  { id: "flamengo", name: "Flamengo", shortName: "FLA" },
];

export const PLAYERS: Player[] = [
  { id: "pl-neymar", name: "Neymar Jr.", teamId: "santos", position: "ATA", number: 10 },
  { id: "pl-guilherme", name: "Guilherme Alves", teamId: "santos", position: "PON", number: 11 },
  { id: "pl-tiquinho", name: "Tiquinho Régis", teamId: "santos", position: "CA", number: 9 },
  { id: "pl-joao", name: "João Schmidt", teamId: "santos", position: "VOL", number: 5 },
  { id: "pl-otero", name: "Otero Vidal", teamId: "santos", position: "MEI", number: 8 },
  { id: "pl-pedro", name: "Pedro Rocha", teamId: "flamengo", position: "CA", number: 9 },
  { id: "pl-arrascaeta", name: "Arrascaeta Lima", teamId: "flamengo", position: "MEI", number: 14 },
  { id: "pl-gerson", name: "Gerson Duarte", teamId: "flamengo", position: "VOL", number: 8 },
  { id: "pl-bruno", name: "Bruno Henrique C.", teamId: "flamengo", position: "PON", number: 27 },
  { id: "pl-pulgar", name: "Pulgar Ortiz", teamId: "flamengo", position: "VOL", number: 5 },
];

/** Rótulo neutro da chave canônica, usado quando não há casa em contexto. */
export const CANONICAL_LABEL: Record<string, string> = {
  player_shots: "Chutes do jogador",
  player_shots_on_target: "Chutes ao gol do jogador",
  player_goal_or_assist: "Gol ou assistência",
  player_goalscorer: "Marcador de gol",
  player_fouls: "Faltas cometidas",
  player_fouls_drawn: "Faltas sofridas",
  player_cards: "Cartões",
};

export const CANONICAL_KEYS = Object.keys(CANONICAL_LABEL) as MarketCanonicalKey[];
