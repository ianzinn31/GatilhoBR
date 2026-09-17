import type {
  ActivityRecord,
  Bind,
  ConnectionStatus,
  MarketCanonicalKey,
  Preferences,
  Session,
  StakeSettings,
} from "@/types/gatilho";

/** Cenário padrão: Bet365 conectada, Betfair com sessão expirada. */
export const MOCK_CONNECTIONS: ConnectionStatus[] = [
  {
    house: "bet365",
    state: "connected",
    balance: 1284.35,
    lastSyncAt: "2026-07-30T20:41:00.000Z",
    detail: "Página de evento ao vivo detectada",
  },
  {
    house: "betfair",
    state: "connected",
    balance: 612.9,
    lastSyncAt: "2026-07-30T20:40:44.000Z",
    detail: "Sportsbook em partida ao vivo",
  },
  {
    house: "betnacional",
    state: "connected",
    balance: 450.0,
    lastSyncAt: "2026-07-30T20:40:00.000Z",
    detail: "Página de evento ao vivo detectada",
  },
  {
    house: "betmgm",
    state: "connected",
    balance: 320.0,
    lastSyncAt: "2026-07-30T20:39:40.000Z",
    detail: "Tiger Sportsbook detectado",
  },
  {
    house: "superbet",
    state: "connected",
    balance: 275.0,
    lastSyncAt: "2026-07-30T20:39:20.000Z",
    detail: "Página de evento ao vivo detectada",
  },
];

/** Cenário alternativo usado no botão "simular desconexão". */
export const MOCK_CONNECTIONS_DEGRADED: ConnectionStatus[] = [
  {
    house: "bet365",
    state: "connected",
    balance: 1284.35,
    lastSyncAt: "2026-07-30T20:41:00.000Z",
    detail: "Página de evento ao vivo detectada",
  },
  {
    house: "betfair",
    state: "expired",
    lastSyncAt: "2026-07-30T20:12:10.000Z",
    detail: "Sessão expirada — faça login novamente na aba da casa",
  },
  {
    house: "betnacional",
    state: "disconnected",
    detail: "Aba não aberta",
  },
  {
    house: "betmgm",
    state: "disconnected",
    detail: "Aba não aberta",
  },
  {
    house: "superbet",
    state: "disconnected",
    detail: "Aba não aberta",
  },
];

export const MOCK_FAVORITE_MARKET_KEYS: MarketCanonicalKey[] = [
  "player_shots",
  "player_shots_on_target",
];

export const MOCK_PRIORITY_MARKET_KEYS: MarketCanonicalKey[] = ["player_shots"];

export const MOCK_FAVORITE_PLAYER_IDS: string[] = ["pl-neymar", "pl-pedro"];

export const MOCK_BINDS: Bind[] = [
  {
    id: "bind-1",
    key: "N",
    modifiers: [],
    houseId: "bet365",
    teamId: "santos",
    playerId: "pl-neymar",
    marketCanonicalKey: "player_shots",
    lineStrategy: "first_available",
    stake: 50,
    enabled: true,
    notes: "Chutes do Neymar na primeira linha aberta",
  },
  {
    id: "bind-2",
    key: "P",
    modifiers: [],
    houseId: "bet365",
    teamId: "flamengo",
    playerId: "pl-pedro",
    marketCanonicalKey: "player_shots_on_target",
    lineStrategy: "exact",
    line: "Mais 1.5",
    stake: 30,
    enabled: true,
  },
  {
    id: "bind-3",
    key: "G",
    modifiers: ["shift"],
    houseId: "betfair",
    teamId: "santos",
    playerId: "pl-otero",
    marketCanonicalKey: "player_fouls_drawn",
    lineStrategy: "max_line",
    enabled: true,
  },
  {
    id: "bind-4",
    key: "J",
    modifiers: [],
    houseId: "betfair",
    teamId: "flamengo",
    playerId: "pl-gerson",
    marketCanonicalKey: "player_goalscorer",
    lineStrategy: "next_available",
    enabled: false,
    notes: "Mercado fecha com frequência no 2º tempo",
  },
];

export const MOCK_STAKE: StakeSettings = {
  stake: 50,
  stakeByHouse: {},
  maxStake: 500,
  quickValues: [10, 25, 50, 100, 250],
  oneClick: false,
  autoFill: true,
  oddsChangePolicy: "reject_changes",
  acceptOddsChange: false,
  executionMode: "DIRECT_NETWORK",
  directOrderAutoSelection: true,
  triggerKey: "Space",
};

export const MOCK_PREFERENCES: Preferences = {
  density: "compact",
  defaultHouse: "bet365",
  favoritesFirst: true,
  prioritiesFirst: true,
  showSuspended: true,
  highlightOddsChange: true,
};

export const MOCK_SESSION: Session = {
  authenticated: true,
  user: { id: "usr-1", name: "Operador GatilhoBR", email: "operador@gatilhobr.app" },
  license: { status: "valid", plan: "Pro mensal", renewsAt: "2026-08-24" },
};

export const MOCK_ACTIVITY: ActivityRecord[] = [
  {
    id: "act-1",
    at: "2026-07-30T20:40:12.000Z",
    event: "bet:triggered",
    house: "bet365",
    label: "Disparo executado · tecla N",
    detail: "Neymar Jr. · Jogador - Chutes · Mais 2.5 @ 2.76 · R$ 50,00",
    result: "success",
  },
  {
    id: "act-2",
    at: "2026-07-30T20:38:57.000Z",
    event: "bet:triggered",
    house: "betfair",
    label: "Disparo bloqueado · tecla ⇧+G",
    detail: "Otero Vidal · Faltas Sofridas por Jogador · linha suspensa",
    result: "blocked",
  },
  {
    id: "act-3",
    at: "2026-07-30T20:36:04.000Z",
    event: "stake:updated",
    label: "Stake alterada para R$ 50,00",
    result: "info",
  },
  {
    id: "act-4",
    at: "2026-07-30T20:31:41.000Z",
    event: "bet:triggered",
    house: "betfair",
    label: "Disparo falhou · tecla J",
    detail: "Gerson Duarte · Marcador de Gol · a página da casa não respondeu",
    result: "error",
  },
  {
    id: "act-5",
    at: "2026-07-30T20:22:19.000Z",
    event: "bind:tested",
    house: "bet365",
    label: "Teste seguro da bind P",
    detail: "Pedro Rocha · Chutes ao Gol · Mais 1.5 — nenhuma aposta enviada",
    result: "info",
  },
];
