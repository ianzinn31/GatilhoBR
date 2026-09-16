import type { PriorityPlayerNote } from "@/lib/playerPriorities";
import type { Snapshot } from "@/services/extensionBridge";
import type {
  ActivityRecord,
  Bind,
  ConnectionStatus,
  EventModel,
  HouseId,
  MarketCanonicalKey,
  MarketModel,
  Preferences,
  Session,
  StakeSettings,
} from "@/types/gatilho";

export interface AppState {
  loading: boolean;
  error: string | null;
  lastSync: string | null;
  selectedHouse: HouseId;
  selectedSelectionId: string | null;
  connections: ConnectionStatus[];
  events: Partial<Record<HouseId, EventModel>>;
  markets: MarketModel[];
  favoriteMarketKeys: MarketCanonicalKey[];
  priorityMarketKeys: MarketCanonicalKey[];
  favoritePlayerIds: string[];
  /** Jogadores que o usuário anotou, com o nome exatamente como ele digitou. */
  priorityPlayerNotes: PriorityPlayerNote[];
  binds: Bind[];
  stake: StakeSettings;
  preferences: Preferences;
  session: Session;
  activity: ActivityRecord[];
}

export const INITIAL_STATE: AppState = {
  loading: true,
  error: null,
  lastSync: null,
  selectedHouse: "bet365",
  selectedSelectionId: null,
  connections: [],
  events: {},
  markets: [],
  favoriteMarketKeys: [],
  priorityMarketKeys: [],
  favoritePlayerIds: [],
  priorityPlayerNotes: [],
  binds: [],
  stake: {
    stake: 0,
    stakeByHouse: {},
    maxStake: 0,
    quickValues: [],
    oneClick: false,
    autoFill: false,
    oddsChangePolicy: "reject_changes",
    acceptOddsChange: false,
    executionMode: "DIRECT_NETWORK",
    directOrderAutoSelection: true,
    triggerKey: "Space",
  },
  preferences: {
    density: "compact",
    defaultHouse: "bet365",
    favoritesFirst: true,
    prioritiesFirst: true,
    showSuspended: true,
    highlightOddsChange: true,
  },
  session: { authenticated: false, license: { status: "trial", plan: "—", renewsAt: "—" } },
  activity: [],
};

export type AppAction =
  | { type: "load:start" }
  | { type: "load:success"; snapshot: Snapshot }
  | { type: "load:error"; message: string }
  | { type: "markets:updated"; markets: MarketModel[] }
  | { type: "house:selected"; house: HouseId }
  | { type: "selection:selected"; selectionId: string | null }
  | { type: "favoriteMarket:toggled"; key: MarketCanonicalKey }
  | { type: "priorityMarket:toggled"; key: MarketCanonicalKey }
  | { type: "favoritePlayers:set"; playerIds: string[] }
  | { type: "playerNotes:set"; notes: PriorityPlayerNote[] }
  | { type: "bind:added"; bind: Bind }
  | { type: "bind:updated"; bind: Bind }
  | { type: "bind:deleted"; id: string }
  | { type: "stake:updated"; stake: StakeSettings }
  | { type: "preferences:updated"; preferences: Preferences }
  | { type: "preset:applied"; patch: Partial<AppState> }
  | { type: "activity:pushed"; record: ActivityRecord };

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "load:start":
      return { ...state, loading: true, error: null };
    case "load:success":
      return {
        ...state,
        loading: false,
        error: null,
        lastSync: new Date().toISOString(),
        ...action.snapshot,
        selectedHouse: action.snapshot.preferences.defaultHouse,
      };
    case "load:error":
      return { ...state, loading: false, error: action.message };
    case "markets:updated":
      return { ...state, markets: action.markets, lastSync: new Date().toISOString() };
    case "house:selected":
      return { ...state, selectedHouse: action.house };
    case "selection:selected":
      return { ...state, selectedSelectionId: action.selectionId };
    case "favoriteMarket:toggled":
      return { ...state, favoriteMarketKeys: toggle(state.favoriteMarketKeys, action.key) };
    case "priorityMarket:toggled":
      return { ...state, priorityMarketKeys: toggle(state.priorityMarketKeys, action.key) };
    case "favoritePlayers:set":
      return { ...state, favoritePlayerIds: action.playerIds };
    case "playerNotes:set":
      return { ...state, priorityPlayerNotes: action.notes };
    case "bind:added":
      return { ...state, binds: [...state.binds, action.bind] };
    case "bind:updated":
      return {
        ...state,
        binds: state.binds.map((bind) => (bind.id === action.bind.id ? action.bind : bind)),
      };
    case "bind:deleted":
      return { ...state, binds: state.binds.filter((bind) => bind.id !== action.id) };
    case "stake:updated":
      return { ...state, stake: action.stake };
    case "preferences:updated":
      return { ...state, preferences: action.preferences };
    case "preset:applied":
      return { ...state, ...action.patch };
    case "activity:pushed":
      return { ...state, activity: [action.record, ...state.activity].slice(0, 200) };
    default:
      return state;
  }
}
