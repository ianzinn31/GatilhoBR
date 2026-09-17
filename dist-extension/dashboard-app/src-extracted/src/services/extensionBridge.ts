import {
  MOCK_ACTIVITY,
  MOCK_BINDS,
  MOCK_CONNECTIONS,
  MOCK_EVENTS,
  MOCK_FAVORITE_MARKET_KEYS,
  MOCK_FAVORITE_PLAYER_IDS,
  MOCK_MARKETS,
  MOCK_PREFERENCES,
  MOCK_SESSION,
  MOCK_STAKE,
} from "@/data/mocks";
import {
  registerRuntimeMarket,
  registerRuntimePlayer,
  registerRuntimeTeam,
  resetRuntimeCatalog,
} from "@/lib/runtimeCatalog";
import {
  buildPlayerPriorityRules,
  normalizePriorityPlayerName,
  priorityPlayerIdsFromRules,
  reconcilePriorityPlayerIds,
  sanitizePriorityPlayerIds,
  sanitizePriorityPlayerNotes,
  type PersistedPlayerPriorityRule,
  type PriorityPlayerNote,
} from "@/lib/playerPriorities";
import { consolidateMarketModels } from "@/lib/marketMatrix";
import { panelTargetFromSelection } from "@/lib/selectors";
import { getStoredSession, supabaseRequest } from "@/services/supabaseRest";
import type {
  ActivityRecord,
  Bind,
  BindModifier,
  BindPanelTarget,
  ConnectionStatus,
  EventModel,
  GlobalBindShortcut,
  GlobalBindSlotAssignments,
  GlobalBindSlotId,
  HouseId,
  MarketCanonicalKey,
  MarketModel,
  Preferences,
  Preset,
  PresetPayload,
  PresetSection,
  Selection,
  Session,
  OddsChangePolicy,
  StakeSettings,
  TriggerResult,
} from "@/types/gatilho";

type RawOdd = {
  colHeader?: string;
  name?: string;
  rawName?: string;
  odds?: string | number;
  val?: string | number;
  isClosed?: boolean;
  status?: string;
  outcomeId?: string;
};

type CloudPreferences = {
  favorites?: MarketCanonicalKey[];
  market_priorities?: MarketCanonicalKey[];
  player_priorities?: string[];
  binds?: Bind[];
  presets?: Preset[];
  preferences?: Preferences;
  stake?: number;
  stake_by_house?: Partial<Record<HouseId, number>>;
  one_click_enabled?: boolean;
  updated_at?: string;
};

const CLOUD_PREFERENCES_WRITE_TIMEOUT_MS = 8000;

async function loadCloudPreferences(): Promise<CloudPreferences | null> {
  try {
    const session = await getStoredSession();
    if (!session) return null;
    const rows = await supabaseRequest<CloudPreferences[]>(
      `/rest/v1/user_dashboard_preferences?user_id=eq.${session.userId}&select=*`,
    );
    return rows[0] || null;
  } catch {
    return null;
  }
}

async function saveCloudPreferences(patch: CloudPreferences) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CLOUD_PREFERENCES_WRITE_TIMEOUT_MS);
  try {
    const session = await getStoredSession();
    if (!session) return;
    await supabaseRequest("/rest/v1/user_dashboard_preferences?on_conflict=user_id", {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=minimal",
      signal: controller.signal,
      body: JSON.stringify({
        user_id: session.userId,
        ...patch,
        updated_at: new Date().toISOString(),
      }),
    });
  } catch {
    // A operação local continua válida quando a nuvem está temporariamente indisponível.
  } finally {
    clearTimeout(timeout);
  }
}

// A gravação na nuvem não pode ficar no caminho do clique: cadastrar ou apagar
// uma bind precisa responder na velocidade do storage local. A fila mantém a
// ordem das escritas e o último patch vence, então uma sequência rápida de
// alterações não sobrescreve o estado mais novo com um payload antigo.
let cloudPreferencesQueue: Promise<void> = Promise.resolve();
let pendingCloudPreferences: CloudPreferences | null = null;

function queueCloudPreferences(patch: CloudPreferences) {
  pendingCloudPreferences = { ...(pendingCloudPreferences ?? {}), ...patch };
  cloudPreferencesQueue = cloudPreferencesQueue.then(async () => {
    const next = pendingCloudPreferences;
    pendingCloudPreferences = null;
    if (!next) return;
    await saveCloudPreferences(next);
  });
  return cloudPreferencesQueue;
}

async function loadCloudActivity(): Promise<ActivityRecord[]> {
  try {
    const session = await getStoredSession();
    if (!session) return [];
    const rows = await supabaseRequest<Array<Record<string, any>>>(
      `/rest/v1/user_activity_logs?user_id=eq.${session.userId}&select=*&order=occurred_at.desc&limit=300`,
    );
    return rows.map((row) => ({
      id: row.id,
      at: row.occurred_at,
      event: row.event,
      house: row.house || undefined,
      label: row.label,
      detail: row.detail || undefined,
      result: row.result,
    })) as ActivityRecord[];
  } catch {
    return [];
  }
}

type RawRow = {
  lineLabel?: string;
  colOdds?: RawOdd[];
  odds?: RawOdd[];
};

type RawMarket = {
  title?: string;
  groupKey?: string;
  marketKey?: string;
  stableMarketKey?: string;
  dedupeKey?: string;
  isSuspended?: boolean;
  isPlayerMarket?: boolean;
  headers?: string[];
  tableRows?: RawRow[];
  rows?: RawRow[];
  participants?: RawOdd[];
  selections?: RawOdd[];
};

type RawMarketState = {
  groups?: RawMarket[];
  markets?: RawMarket[];
  eventContext?: { teams?: string[]; eventLabel?: string };
  siteName?: string;
  lastUpdate?: number;
  capturedAt?: number;
  stale?: boolean;
  forced?: boolean;
  syncRequestIds?: string[];
};

export interface MarketSyncResult {
  markets: MarketModel[];
  refreshedHouses: HouseId[];
  pendingHouses: HouseId[];
}

type LegacyBind = {
  id?: string;
  keyCode?: string;
  modifiers?: BindModifier[];
  enabled?: boolean;
  house?: string;
  eventId?: string;
  eventLabel?: string;
  targetType?: string;
  team?: string;
  market?: string;
  player?: string;
  selection?: string;
  rowLabel?: string;
  rowIndex?: number;
  colIndex?: number;
  lineMode?: string;
  line?: string;
  // Identidade do outcome, espelhada no topo do registro porque o motor da
  // casa (`quickExecEngine`) casa por ela antes de qualquer texto ou posição.
  outcomeId?: string;
  panelTarget?: {
    outcomeId?: string;
    selectionId?: string;
    marketId?: string;
    targetName?: string;
    lineName?: string;
    optionLabel?: string;
    marketTitle?: string;
  };
};

export interface Snapshot {
  connections: ConnectionStatus[];
  events: Partial<Record<HouseId, EventModel>>;
  markets: MarketModel[];
  favoriteMarketKeys: MarketCanonicalKey[];
  priorityMarketKeys: MarketCanonicalKey[];
  favoritePlayerIds: string[];
  priorityPlayerNotes: PriorityPlayerNote[];
  binds: Bind[];
  stake: StakeSettings;
  preferences: Preferences;
  session: Session;
  activity: ActivityRecord[];
}

// A bridge usa `unknown` no limite e converte apenas as APIs necessarias.
// Isso evita acoplar o frontend ao pacote @types/chrome durante o prototipo.
const chromeApi = (
  globalThis as typeof globalThis & {
    chrome?: {
      runtime?: {
        id?: string;
        connect?: (options: { name: string }) => {
          postMessage: (message: unknown) => void;
          onMessage: {
            addListener: (listener: (message: Record<string, unknown>) => void) => void;
          };
          onDisconnect: { addListener: (listener: () => void) => void };
        };
      };
      storage?: {
        local?: {
          get: (keys?: unknown) => Promise<Record<string, unknown>>;
          set: (items: Record<string, unknown>) => Promise<void>;
        };
        sync?: {
          get: (keys?: unknown) => Promise<Record<string, unknown>>;
          set: (items: Record<string, unknown>) => Promise<void>;
        };
      };
      tabs?: {
        query: (query: unknown) => Promise<Array<{ id?: number }>>;
        sendMessage: (tabId: number, message: unknown) => Promise<unknown>;
        create?: (properties: { url: string }) => Promise<unknown>;
      };
      commands?: {
        getAll: () => Promise<Array<{ name?: string; shortcut?: string; description?: string }>>;
      };
    };
  }
).chrome;

type LivePort = {
  postMessage: (message: unknown) => void;
  onMessage: { addListener: (listener: (message: Record<string, unknown>) => void) => void };
  onDisconnect: { addListener: (listener: () => void) => void };
};

const isExtension = Boolean(chromeApi?.runtime?.id && chromeApi.runtime.connect);
const statesByHouse = new Map<HouseId, RawMarketState>();
const subscribers = new Set<(markets: MarketModel[]) => void>();
let livePort: LivePort | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let latestMarkets: MarketModel[] = [];
let connectionFlags = {
  bet365Active: false,
  betfairActive: false,
  betnacionalActive: false,
  betmgmActive: false,
  superbetActive: false,
};
const USER_LOCAL_KEYS = [
  "dynamicPlayerBinds",
  "gbr_global_bind_slots",
  "favoriteMarketsByHouse",
  "playerPriorityRules",
  "gbr_priority_player_notes",
  "gbr_player_priorities_updated_at",
  "gbr_dashboard_preferences",
  "gbr_priority_market_keys",
  "gbr_max_stake",
  "gbr_quick_stakes",
  "gbr_stake_by_house",
  "gbr_stake_updated_at",
  "fastTriggerStakeVal",
  "stakeVal",
  "autoTriggerDirectBool",
  "oneShot",
  "autoTrigger",
  "autoTriggerDirect",
  "gbr_activity_log",
  "fastTriggerHotkey",
  "ftQuickPresets",
] as const;
const USER_SYNC_KEYS = [
  "stakeVal",
  "stakeValByHouse",
  "autoAcceptOddsBool",
  "oddsChangePolicy",
  "triggerKeyStr",
] as const;
const BETTING_TAB_PATTERNS = [
  "*://*.bet365.com/*",
  "*://*.bet365.bet.br/*",
  "*://*.bet365.es/*",
  "*://*.betfair.com/*",
  "*://*.betfair.bet.br/*",
  "*://*.betfair.es/*",
  "*://*.betnacional.com/*",
  "*://*.betnacional.bet.br/*",
  "*://*.betnacional.br/*",
  "*://betmgm.bet.br/*",
  "*://*.betmgm.bet.br/*",
  "*://superbet.bet.br/*",
  "*://*.superbet.bet.br/*",
];
const pendingBindDispatches = new Map<
  string,
  {
    resolve: (result: TriggerResult) => void;
    timeout: ReturnType<typeof setTimeout>;
  }
>();

function slug(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function parseNumber(value: unknown) {
  const match = String(value ?? "")
    .replace(",", ".")
    .match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function normalizeOddsChangePolicy(value: unknown, legacyValue?: unknown): OddsChangePolicy {
  if (value === "reject_changes" || value === "accept_higher_only" || value === "accept_any") {
    return value;
  }
  return legacyValue === false ? "reject_changes" : "accept_any";
}

function normalizeStakeByHouse(value: unknown): Partial<Record<HouseId, number>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const source = value as Record<string, unknown>;
  const result: Partial<Record<HouseId, number>> = {};
  for (const house of ["bet365", "betfair", "betnacional", "betmgm", "superbet"] as HouseId[]) {
    const parsed = parseNumber(source[house]);
    if (parsed !== null && Number.isFinite(parsed) && parsed > 0) result[house] = parsed;
  }
  return result;
}

function stateHouse(state: RawMarketState): HouseId {
  const site = String(state.siteName ?? "").toLowerCase();
  if (site.includes("betfair")) return "betfair";
  if (site.includes("betnacional")) return "betnacional";
  if (site.includes("betmgm")) return "betmgm";
  if (site.includes("superbet")) return "superbet";
  return "bet365";
}

function canonicalMarket(title: string): MarketCanonicalKey {
  const key = slug(title);
  if (
    /chutes?-ao-gol|remates?-a-baliza|finalizacoes?-no-gol|shots?-on-target|on-target-shots?/.test(
      key,
    )
  )
    return "player_shots_on_target";
  if (/marcar-ou-dar-assistencia|gol-ou-assist|goal-or-assist/.test(key))
    return "player_goal_or_assist";
  if (/marcadores?-de-gol|jogador-a-marcar|goalscorer/.test(key)) return "player_goalscorer";
  if (/faltas?-sofridas|faltas?-recebidas|fouls?-drawn|drawn-fouls?/.test(key))
    return "player_fouls_drawn";
  if (/faltas?|player-fouls?|fouls?-by-player/.test(key)) return "player_fouls";
  if (/cartoes?|player-cards?|cards?-by-player/.test(key)) return "player_cards";
  if (
    /jogador.*chutes|chutes.*jogador|finalizacoes.*jogador|player-shots?|shots?-by-player/.test(key)
  )
    return "player_shots";
  return `market:${key || "unknown"}`;
}

function selectionStatus(item: RawOdd | undefined, suspended: boolean) {
  if (!item) return "unavailable" as const;
  if (suspended) return "suspended" as const;
  const text = String(item.status ?? item.odds ?? item.val ?? "");
  if (item.isClosed || /closed|locked|suspended|fechado/i.test(text)) return "locked" as const;
  return "open" as const;
}

function normalizeState(state: RawMarketState) {
  const house = stateHouse(state);
  const teams = (state.eventContext?.teams ?? []).filter(Boolean);
  const eventKey = slug(state.eventContext?.eventLabel || teams.join("-x-") || "current-event");
  const eventId = `${house}:${eventKey}`;
  const updatedAt = new Date(state.lastUpdate || Date.now()).toISOString();

  teams.forEach((name) =>
    registerRuntimeTeam({
      id: `team:${slug(name)}`,
      name,
      shortName: name.slice(0, 3).toUpperCase(),
    }),
  );
  registerRuntimeTeam({ id: "team:unknown", name: "Time não identificado", shortName: "—" });

  const normalizedMarkets = (state.groups ?? state.markets ?? [])
    .map((rawMarket, marketIndex): MarketModel | null => {
      const displayName = String(rawMarket.title || `Mercado ${marketIndex + 1}`).trim();
      const canonicalKey = canonicalMarket(displayName);
      const isPlayerMarket =
        rawMarket.isPlayerMarket === true || canonicalKey.startsWith("player_");
      const requiresPlayerIdentity = isPlayerMarket;
      registerRuntimeMarket(canonicalKey, displayName);

      const sourceRows = rawMarket.tableRows ?? rawMarket.rows ?? [];
      const rows =
        sourceRows.length > 0
          ? sourceRows
          : [
              {
                lineLabel: displayName,
                colOdds: rawMarket.participants ?? rawMarket.selections ?? [],
              },
            ];
      const columnCount = rows.reduce(
        (max, row) => Math.max(max, (row.colOdds ?? row.odds ?? []).length),
        0,
      );
      if (columnCount === 0) return null;

      const headerOffset = (rawMarket.headers?.length ?? 0) > columnCount ? 1 : 0;
      const columnKeyOccurrences = new Map<string, number>();
      const columns = Array.from({ length: columnCount }, (_, columnIndex) => {
        const itemHeader = rows
          .map((row) => {
            const item = (row.colOdds ?? row.odds ?? [])[columnIndex];
            return item?.colHeader || item?.name;
          })
          .find(Boolean);
        const label =
          String(
            itemHeader || rawMarket.headers?.[columnIndex + headerOffset] || `${columnIndex + 1}`,
          ).trim() || `${columnIndex + 1}`;
        const semanticKey = slug(label) || String(columnIndex);
        const occurrence = columnKeyOccurrences.get(semanticKey) || 0;
        columnKeyOccurrences.set(semanticKey, occurrence + 1);
        return {
          key: `${canonicalKey}:${semanticKey}${occurrence > 0 ? `:${occurrence}` : ""}`,
          label,
          lineValue: parseNumber(label) ?? undefined,
        };
      });

      const betfairMarketIdentity = slug(
        rawMarket.dedupeKey || rawMarket.stableMarketKey || rawMarket.groupKey || canonicalKey,
      );
      const marketId =
        house === "betfair"
          ? `${house}:${eventKey}:${betfairMarketIdentity || canonicalKey}`
          : `${house}:${eventKey}:${canonicalKey}:${marketIndex}`;
      const normalizedRows = rows.map((rawRow, rowIndex) => {
        const rawPlayerName = String(rawRow.lineLabel || `Opção ${rowIndex + 1}`).trim();
        // Em mercados comuns com uma única linha, alguns scrapers devolvem o
        // texto agregado de todas as opções como rótulo da linha. Isso não faz
        // parte da identidade da seleção e deixava o card visualmente poluído.
        const playerName = requiresPlayerIdentity
          ? normalizePriorityPlayerName(rawPlayerName)
          : rows.length === 1
            ? displayName
            : rawPlayerName;
        const playerId = `${house}:player:${slug(playerName) || rowIndex}`;
        // O nome do atleta não permite inferir o clube. Associar toda linha
        // ao primeiro time do evento fazia Mbappé aparecer como Espanyol e
        // contaminava o roteamento da bind. Sem evidência explícita, a
        // identidade do evento é mais segura que um time inventado.
        const teamName = teams.find((team) => slug(playerName).includes(slug(team))) ?? "";
        const teamId = teamName ? `team:${slug(teamName)}` : "team:unknown";
        registerRuntimePlayer({ id: playerId, name: playerName, teamId });
        const odds = rawRow.colOdds ?? rawRow.odds ?? [];

        const cells = columns.map((column, columnIndex): Selection | null => {
          const raw = odds[columnIndex];
          if (!raw) return null;
          // `??` não atravessa string vazia: mercados de jogador da Betfair
          // chegam com `colHeader: ""` e o rótulo terminava vazio, o que
          // impedia salvar a bind (linha exata sem valor) e quebrava o
          // dropdown do editor. O rótulo precisa ser sempre preenchido.
          const optionLabel = String(
            raw.colHeader || raw.name || column.label || `${columnIndex + 1}`,
          ).trim() || `${columnIndex + 1}`;
          const odd = parseNumber(raw.val ?? raw.odds);
          return {
            id: `${marketId}:${playerId}:${columnIndex}`,
            house,
            eventId,
            marketId,
            marketCanonicalKey: canonicalKey,
            marketDisplayName: displayName,
            playerId,
            playerName,
            teamId,
            teamName,
            line: optionLabel,
            lineValue: parseNumber(optionLabel) ?? undefined,
            columnIndex,
            rowIndex,
            odds: odd,
            status: selectionStatus(raw, rawMarket.isSuspended === true),
            source: {
              targetName: String(raw.name || `${playerName} ${optionLabel}`).trim(),
              // Na Bet365, `lineName` aciona a proteção rígida de mercados de
              // jogador. Mercados comuns usam uma linha visual no dashboard,
              // mas essa linha não representa um atleta no DOM da casa.
              lineName: requiresPlayerIdentity ? playerName : "",
              optionLabel,
              marketTitle: displayName,
              originalOdds: String(raw.val ?? raw.odds ?? ""),
              outcomeId: raw.outcomeId ? String(raw.outcomeId) : undefined,
            },
          };
        });

        return { playerId, playerName, teamId, teamName, cells };
      });

      const rowSignatures = new Set<string>();
      const uniqueRows = normalizedRows.filter((row) => {
        const signature = [
          slug(row.playerName || row.playerId),
          ...row.cells.map((cell) =>
            cell
              ? `${cell.source?.outcomeId || cell.source?.targetName || cell.line}:${cell.source?.originalOdds || cell.odds}`
              : "empty",
          ),
        ].join("|");
        if (rowSignatures.has(signature)) return false;
        rowSignatures.add(signature);
        return true;
      });

      return {
        id: marketId,
        house,
        eventId,
        canonicalKey,
        displayName,
        isPlayerMarket,
        status: rawMarket.isSuspended ? "suspended" : "open",
        columns,
        rows: uniqueRows,
        updatedAt,
      };
    })
    .filter((market): market is MarketModel => market !== null);

  const markets = consolidateMarketModels(normalizedMarkets);

  const event: EventModel | undefined =
    teams.length >= 2
      ? {
          id: eventId,
          house,
          fixtureId: eventKey,
          competition: "",
          homeTeamId: `team:${slug(teams[0])}`,
          awayTeamId: `team:${slug(teams[1])}`,
          minute: 0,
          period: "",
          score: [0, 0],
          live: true,
        }
      : undefined;

  return { markets, event };
}

function rebuildMarkets() {
  rebuildScheduled = false;
  resetRuntimeCatalog();
  latestMarkets = [...statesByHouse.values()].flatMap((state) => normalizeState(state).markets);
  subscribers.forEach((subscriber) => subscriber(latestMarkets));
}

// A aba "Todos os mercados" da Betfair publica dezenas de mercados por rodada.
// Normalizar tudo e reenviar ao React de forma sincrônica dentro do handler da
// porta fazia cada mensagem competir com o clique do usuário no painel — era o
// que deixava cadastrar e apagar bind lento. O rebuild passa a ser agendado no
// tempo ocioso, com teto para não atrasar indefinidamente.
const MARKET_REBUILD_IDLE_TIMEOUT_MS = 400;
let rebuildScheduled = false;

function scheduleMarketsRebuild() {
  if (rebuildScheduled) return;
  rebuildScheduled = true;
  const idle = (
    globalThis as {
      requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number;
    }
  ).requestIdleCallback;
  if (typeof idle === "function") {
    idle(() => rebuildMarkets(), { timeout: MARKET_REBUILD_IDLE_TIMEOUT_MS });
    return;
  }
  setTimeout(() => rebuildMarkets(), 120);
}

// Assinatura barata do payload por casa: enquanto o carimbo de captura e o
// tamanho não mudam, não há nada novo para normalizar.
function rawStateSignature(state: RawMarketState) {
  const groups = Array.isArray((state as { groups?: unknown[] }).groups)
    ? ((state as { groups?: unknown[] }).groups as unknown[])
    : [];
  return [
    Number((state as { capturedAt?: number }).capturedAt) || 0,
    Number((state as { lastUpdate?: number }).lastUpdate) || 0,
    groups.length,
    String((state as { betslip?: string }).betslip || "").length,
    state.stale === true ? 1 : 0,
    Array.isArray(state.syncRequestIds) ? state.syncRequestIds.join(",") : "",
  ].join(":");
}

const stateSignatures = new Map<HouseId, string>();

function handlePortMessage(message: Record<string, unknown>) {
  if (message.type === "DYNAMIC_BIND_DISPATCH_RESULT") {
    const actionId = String(message.actionId || "");
    const pending = pendingBindDispatches.get(actionId);
    if (pending && message.pending !== true) {
      clearTimeout(pending.timeout);
      pendingBindDispatches.delete(actionId);
      const success = message.success === true;
      const clickAttempted = message.clickAttempted === true;
      // Algumas casas processam o clique final, mas não devolvem a mudança
      // visual do cupom antes do timeout do fluxo. Nesse caso a operação já
      // foi entregue e não deve aparecer como erro no painel.
      const deliveredWithoutReceipt = !success && clickAttempted;
      pending.resolve({
        ok: success || deliveredWithoutReceipt,
        message: success
          ? "Bind executada na casa."
          : deliveredWithoutReceipt
            ? "Bind entregue à casa."
            : String(message.reason || "A bind não pôde ser executada."),
        clickAttempted,
      });
    }
  }

  const flags = message.connectionStatus as typeof connectionFlags | undefined;
  if (flags) {
    connectionFlags = {
      bet365Active: Boolean(flags.bet365Active),
      betfairActive: Boolean(flags.betfairActive),
      betnacionalActive: Boolean(flags.betnacionalActive),
      betmgmActive: Boolean(flags.betmgmActive),
      superbetActive: Boolean(flags.superbetActive),
    };
  }
  if (message.type === "SYNC_DASHBOARD" && message.payload) {
    const state = message.payload as RawMarketState;
    const house = stateHouse(state);
    const signature = rawStateSignature(state);
    if (stateSignatures.get(house) === signature) return;
    stateSignatures.set(house, signature);
    statesByHouse.set(house, state);
    scheduleMarketsRebuild();
  }
}

function ensurePort() {
  if (!isExtension || livePort || !chromeApi?.runtime?.connect) return;
  livePort = chromeApi.runtime.connect({ name: "dashboard_react_live_stream" });
  livePort.onMessage.addListener(handlePortMessage);
  livePort.onDisconnect.addListener(() => {
    livePort = null;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(ensurePort, 1000);
  });
  livePort.postMessage({ type: "REQUEST_MARKETS", house: "bet365" });
  livePort.postMessage({ type: "REQUEST_MARKETS", house: "betfair" });
  livePort.postMessage({ type: "REQUEST_MARKETS", house: "betnacional" });
  livePort.postMessage({ type: "REQUEST_MARKETS", house: "betmgm" });
  livePort.postMessage({ type: "REQUEST_MARKETS", house: "superbet" });
}

async function waitForMarkets() {
  if (!isExtension) return;
  ensurePort();
  if (statesByHouse.size > 0) return;
  await new Promise((resolve) => setTimeout(resolve, 800));
}

function houseIsReportedConnected(house: HouseId) {
  if (house === "bet365") return connectionFlags.bet365Active;
  if (house === "betfair") return connectionFlags.betfairActive;
  if (house === "betnacional") return connectionFlags.betnacionalActive;
  if (house === "betmgm") return connectionFlags.betmgmActive;
  return connectionFlags.superbetActive;
}

async function requestFreshMarkets(houses: HouseId[]) {
  if (!isExtension) return { refreshedHouses: houses, pendingHouses: [] };
  ensurePort();
  if (!livePort) return { refreshedHouses: [], pendingHouses: houses };

  const requestIds = new Map(
    houses.map((house) => [house, `dashboard-sync-${house}-${Date.now()}-${crypto.randomUUID()}`]),
  );
  const connectedTargets = houses.filter(houseIsReportedConnected);
  // Quando o status da conexão também está travado, não sabemos de antemão
  // qual aba existe. Nesse modo, a primeira confirmação real recupera o
  // painel; o background consulta as abas diretamente para achar a casa.
  const expectedTargets = connectedTargets.length > 0 ? connectedTargets : [];

  const postRequests = () => {
    houses.forEach((house) => {
      try {
        livePort?.postMessage({
          type: "REQUEST_MARKETS",
          house,
          force: true,
          requestId: requestIds.get(house),
        });
      } catch {
        livePort = null;
        ensurePort();
      }
    });
  };

  const refreshedHouses = await new Promise<HouseId[]>((resolve) => {
    let finished = false;
    const finish = (refreshed: HouseId[]) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      retryTimers.forEach(clearTimeout);
      subscribers.delete(onUpdate);
      resolve(refreshed);
    };
    const acknowledgedHouses = () =>
      houses.filter((house) => {
        const requestId = requestIds.get(house);
        return Boolean(
          requestId &&
          statesByHouse.get(house)?.stale !== true &&
          statesByHouse.get(house)?.syncRequestIds?.includes(requestId),
        );
      });
    const onUpdate = () => {
      const refreshed = acknowledgedHouses();
      if (expectedTargets.length > 0) {
        if (expectedTargets.every((house) => refreshed.includes(house))) finish(refreshed);
      } else if (refreshed.length > 0) {
        finish(refreshed);
      }
    };
    const timeout = setTimeout(() => finish(acknowledgedHouses()), 4000);
    const retryTimers = [setTimeout(postRequests, 350), setTimeout(postRequests, 1100)];

    subscribers.add(onUpdate);
    postRequests();
  });

  return {
    refreshedHouses,
    pendingHouses:
      expectedTargets.length > 0
        ? expectedTargets.filter((house) => !refreshedHouses.includes(house))
        : refreshedHouses.length > 0
          ? []
          : houses,
  };
}

function scopedStorageKey(userId: string, key: string) {
  return `gbr_user_${userId}_${key}`;
}

function requestedStorageKeys(keys: unknown, defaults: readonly string[]) {
  if (Array.isArray(keys)) return keys.map(String);
  if (keys && typeof keys === "object") return Object.keys(keys);
  return [...defaults];
}

function storageDefaults(keys: unknown) {
  return keys && typeof keys === "object" && !Array.isArray(keys)
    ? (keys as Record<string, unknown>)
    : {};
}

async function storageUserId() {
  const stored =
    (await chromeApi?.storage?.local?.get(["gbr_user_id"])) ?? ({} as Record<string, unknown>);
  const userId = String(stored.gbr_user_id ?? "").trim();
  return userId || null;
}

async function scopedGet(
  areaName: "local" | "sync",
  keys: unknown,
): Promise<Record<string, unknown>> {
  const area = areaName === "local" ? chromeApi?.storage?.local : chromeApi?.storage?.sync;
  // Ler configuração local não deve renovar token nem tocar na rede. O ID já
  // persistido serve apenas para isolar as chaves entre contas.
  const userId = await storageUserId();
  const defaults = storageDefaults(keys);
  if (!area || !userId) return { ...defaults };

  const logicalKeys = requestedStorageKeys(
    keys,
    areaName === "local" ? USER_LOCAL_KEYS : USER_SYNC_KEYS,
  );
  const scopedKeys = logicalKeys.map((key) => scopedStorageKey(userId, key));
  const stored = await area.get(scopedKeys);
  return Object.fromEntries(
    logicalKeys.map((key) => [key, stored?.[scopedStorageKey(userId, key)] ?? defaults[key]]),
  );
}

async function scopedSet(areaName: "local" | "sync", values: Record<string, unknown>) {
  const area = areaName === "local" ? chromeApi?.storage?.local : chromeApi?.storage?.sync;
  // A confirmação do save precisa depender somente de chrome.storage. Refresh
  // de sessão pertence exclusivamente à réplica remota em segundo plano.
  const userId = await storageUserId();
  if (!area || !userId) return;
  await area.set(
    Object.fromEntries(
      Object.entries(values).map(([key, value]) => [scopedStorageKey(userId, key), value]),
    ),
  );
}

async function localGet(keys: unknown = null): Promise<Record<string, unknown>> {
  return scopedGet("local", keys);
}

async function syncGet(keys: unknown = null): Promise<Record<string, unknown>> {
  return scopedGet("sync", keys);
}

async function localSet(values: Record<string, unknown>) {
  await scopedSet("local", values);
}

async function syncSet(values: Record<string, unknown>) {
  await scopedSet("sync", values);
}

async function authStorage(): Promise<Record<string, unknown>> {
  return (
    chromeApi?.storage?.local?.get([
      "gbr_auth_token",
      "gbr_user_id",
      "gbr_user_email",
      "gbr_user_profile",
      "gbr_license_status",
    ]) ?? {}
  );
}

const DIRECT_ORDER_PREFS_KEY = "gbr_direct_order_prefs";
const DIRECT_ORDER_EXPERIMENT_KEY = "gbr_direct_order_experiment";
const DIRECT_ORDER_SETTINGS_KEY = "gbr_direct_order_settings";
const DIRECT_ORDER_REQUEST_KEY = "gbr_direct_order_request";
const DIRECT_ORDER_AUTO_STATUS_KEY = "gbr_direct_order_auto_status";

async function directOrderStorage(): Promise<Record<string, unknown>> {
  return (
    (await chromeApi?.storage?.local?.get([
      DIRECT_ORDER_PREFS_KEY,
      DIRECT_ORDER_EXPERIMENT_KEY,
      DIRECT_ORDER_SETTINGS_KEY,
      DIRECT_ORDER_REQUEST_KEY,
      DIRECT_ORDER_AUTO_STATUS_KEY,
    ])) ?? {}
  );
}

async function persistDirectOrderSettings(stake: StakeSettings) {
  const area = chromeApi?.storage?.local;
  if (!area) return;
  const stored = await directOrderStorage();
  const enabled = stake.executionMode === "DIRECT_NETWORK";
  const settingsRaw = stored[DIRECT_ORDER_SETTINGS_KEY];
  const settings = settingsRaw && typeof settingsRaw === "object" && !Array.isArray(settingsRaw)
    ? (settingsRaw as Record<string, unknown>)
    : {};
  const existingStatus = stored[DIRECT_ORDER_AUTO_STATUS_KEY];
  const statusBase = existingStatus && typeof existingStatus === "object"
    ? (existingStatus as Record<string, unknown>)
    : {};
  const hasTemplate = Boolean(stored[DIRECT_ORDER_REQUEST_KEY]);

  await area.set({
    [DIRECT_ORDER_PREFS_KEY]: {
      schemaVersion: 1,
      executionMode: stake.executionMode,
      directOrderAutoSelection: stake.directOrderAutoSelection !== false,
      maxStake: stake.maxStake,
    },
    [DIRECT_ORDER_EXPERIMENT_KEY]: enabled,
    [DIRECT_ORDER_SETTINGS_KEY]: {
      ...settings,
      maxStake: stake.maxStake,
      publishResults: true,
      ...(enabled ? { dryRun: false } : {}),
    },
    [DIRECT_ORDER_AUTO_STATUS_KEY]: {
      ...statusBase,
      schemaVersion: 1,
      state: enabled ? (hasTemplate ? "ready" : "learning") : "disabled",
      updatedAt: Date.now(),
    },
  });
}

async function broadcastCurrentAccountStake(
  stake: number,
  stakeByHouse: Partial<Record<HouseId, number>> = {},
  oneShot = false,
  oddsChangePolicy: OddsChangePolicy = "accept_any",
  executionMode: "DOM_UI" | "DIRECT_NETWORK" = "DIRECT_NETWORK",
  directOrderAutoSelection = true,
  directOrderMaxStake = 500,
) {
  const tabs = (await chromeApi?.tabs?.query({ url: BETTING_TAB_PATTERNS })) ?? [];
  const value = stake.toFixed(2);
  const message = {
    action: "UPDATE_CONFIG",
    config: {
      stakeVal: value,
      stakeValByHouse: stakeByHouse,
      oneShot,
      oneClick: oneShot,
      oddsChangePolicy,
      executionMode,
      directOrderAutoSelection,
      directOrderMaxStake,
      // Compatibilidade com versões antigas do content script.
      autoAcceptOddsBool: oddsChangePolicy !== "reject_changes",
    },
  };
  try {
    post(message);
  } catch (_) {}
  try {
    if (chromeApi?.runtime?.sendMessage) {
      chromeApi.runtime.sendMessage(message).catch(() => {});
    }
  } catch (_) {}
  try {
    const electronApi = (window as unknown as { __gbrElectronApi?: { send?: (ch: string, data: unknown) => void } })?.__gbrElectronApi;
    if (typeof electronApi?.send === "function") {
      electronApi.send("gbr:update-config", message);
    }
  } catch (_) {}
  await Promise.allSettled(
    tabs
      .filter((tab) => tab.id != null && chromeApi?.tabs?.sendMessage)
      .map((tab) => chromeApi!.tabs!.sendMessage!(tab.id!, message)),
  );
}

function connections(): ConnectionStatus[] {
  const updatedAt = new Date().toISOString();
  return (["bet365", "betfair", "betnacional", "betmgm", "superbet"] as HouseId[]).map((house) => ({
    house,
    state: houseIsReportedConnected(house) ? "connected" : "disconnected",
    lastSyncAt: statesByHouse.has(house) ? updatedAt : undefined,
  }));
}

function events() {
  const result: Partial<Record<HouseId, EventModel>> = {};
  statesByHouse.forEach((state, house) => {
    const event = normalizeState(state).event;
    if (event) result[house] = event;
  });
  return result;
}

function keyCodeToKey(code: string) {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  return code.replace(/^Numpad/, "");
}

function keyToCode(key: string) {
  const upper = key.toUpperCase();
  if (/^[A-Z]$/.test(upper)) return `Key${upper}`;
  if (/^\d$/.test(upper)) return `Digit${upper}`;
  return upper;
}

const GLOBAL_BIND_SLOT_IDS: GlobalBindSlotId[] = ["1", "2", "3", "4"];

function globalBindCommandName(slot: GlobalBindSlotId) {
  return `dynamic-bind-slot-${slot}`;
}

function sanitizeGlobalBindSlotAssignments(raw: unknown): GlobalBindSlotAssignments {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return Object.fromEntries(
    GLOBAL_BIND_SLOT_IDS.flatMap((slot) => {
      const bindId = String((raw as Record<string, unknown>)[slot] || "").trim();
      return bindId ? [[slot, bindId]] : [];
    }),
  ) as GlobalBindSlotAssignments;
}

function reassignGlobalBindSlots(
  assignments: GlobalBindSlotAssignments,
  staleBindIds: string[],
  replacementId?: string,
) {
  const stale = new Set(staleBindIds);
  return Object.fromEntries(
    GLOBAL_BIND_SLOT_IDS.flatMap((slot) => {
      const current = assignments[slot];
      if (!current) return [];
      if (!stale.has(current)) return [[slot, current]];
      return replacementId ? [[slot, replacementId]] : [];
    }),
  ) as GlobalBindSlotAssignments;
}

// A bind guiada pelo painel guarda a identidade do outcome. Registros antigos
// não têm o campo, e nesse caso a resolução por texto/posição continua valendo.
function readPanelTarget(legacy: LegacyBind): BindPanelTarget | undefined {
  const stored = legacy.panelTarget;
  const outcomeId = String(stored?.outcomeId || legacy.outcomeId || "").trim();
  const target: BindPanelTarget = {
    outcomeId: outcomeId || undefined,
    selectionId: stored?.selectionId || undefined,
    marketId: stored?.marketId || undefined,
    targetName: stored?.targetName || undefined,
    lineName: stored?.lineName || undefined,
    optionLabel: stored?.optionLabel || undefined,
    marketTitle: stored?.marketTitle || undefined,
  };
  return Object.values(target).some(Boolean) ? target : undefined;
}

function readBinds(raw: unknown): Bind[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  return Object.entries(raw as Record<string, LegacyBind | LegacyBind[]>).flatMap(
    ([storageId, rawEntry]) => {
      const entries = (Array.isArray(rawEntry) ? rawEntry : [rawEntry]).filter(
        (entry): entry is LegacyBind => Boolean(entry && typeof entry === "object"),
      );
      return entries.map((legacy, index) => {
        const id = legacy.id || (entries.length > 1 ? `${storageId}:${index}` : storageId);
        const houseId: HouseId =
          legacy.house === "betfair"
            ? "betfair"
            : legacy.house === "betnacional"
              ? "betnacional"
              : legacy.house === "betmgm"
                ? "betmgm"
                : legacy.house === "superbet"
                  ? "superbet"
                  : "bet365";
        const targetType =
          legacy.targetType === "market_selection" ? "market_selection" : "player_line";
        const teamName = String(legacy.team || "Time não identificado");
        const playerName = String(
          legacy.player ||
            legacy.rowLabel ||
            (targetType === "market_selection" ? "Seleção" : "Jogador"),
        );
        const marketName = String(legacy.market || "Mercado");
        const teamId = `team:${slug(teamName)}`;
        const playerId = `${houseId}:player:${slug(playerName)}`;
        registerRuntimeTeam({
          id: teamId,
          name: teamName,
          shortName: teamName.slice(0, 3).toUpperCase(),
        });
        registerRuntimePlayer({ id: playerId, name: playerName, teamId });
        registerRuntimeMarket(canonicalMarket(marketName), marketName);
        return {
          id,
          key: keyCodeToKey(legacy.keyCode || id.split(":").pop() || ""),
          modifiers: Array.isArray(legacy.modifiers)
            ? legacy.modifiers.filter(
                (modifier): modifier is BindModifier =>
                  modifier === "ctrl" || modifier === "alt" || modifier === "shift",
              )
            : [],
          houseId,
          eventId: legacy.eventId || undefined,
          eventLabel: legacy.eventLabel || undefined,
          targetType,
          teamId,
          playerId,
          marketCanonicalKey: canonicalMarket(marketName),
          lineStrategy:
            targetType === "market_selection" || legacy.lineMode === "exact"
              ? "exact"
              : "first_available",
          line: legacy.line || undefined,
          selectionName: legacy.selection || undefined,
          rowLabel: legacy.rowLabel || undefined,
          rowIndex: legacy.rowIndex,
          columnIndex: legacy.colIndex,
          panelTarget: readPanelTarget(legacy),
          enabled: legacy.enabled !== false,
        };
      });
    },
  );
}

function writeBinds(binds: Bind[]) {
  const serialized = binds.map((bind) => {
    const keyCode = keyToCode(bind.key);
    const id = `${bind.houseId}:${keyCode}`;
    const market = latestMarkets.find(
      (item) => item.house === bind.houseId && item.canonicalKey === bind.marketCanonicalKey,
    );
    const row = market?.rows.find((item) => item.playerId === bind.playerId);
    const cells = market?.rows.flatMap((item) => item.cells) ?? [];
    // O alvo do painel é a referência primária. Quando a bind já traz um
    // outcome, ele reaponta a célula atual mesmo que o mercado tenha mudado de
    // posição; só então caímos para o par linha/coluna salvo.
    const selection =
      (bind.panelTarget?.outcomeId
        ? cells.find((item) => item?.source?.outcomeId === bind.panelTarget?.outcomeId)
        : undefined) ??
      (bind.panelTarget?.selectionId
        ? cells.find((item) => item?.id === bind.panelTarget?.selectionId)
        : undefined) ??
      cells.find(
        (item) => item?.rowIndex === bind.rowIndex && item?.columnIndex === bind.columnIndex,
      );
    const panelTarget =
      bind.panelTarget ?? (selection ? panelTargetFromSelection(selection) : undefined);
    return [
      id,
      {
        id: bind.id,
        keyCode,
        modifiers: bind.modifiers,
        enabled: bind.enabled !== false,
        house: bind.houseId,
        eventId: bind.eventId,
        eventLabel: bind.eventLabel,
        targetType: bind.targetType || "player_line",
        team: row?.teamName || bind.teamId.replace(/^team:/, "").replace(/-/g, " "),
        market: market?.displayName || bind.marketCanonicalKey,
        player:
          bind.targetType === "market_selection"
            ? ""
            : row?.playerName || bind.playerId.split(":").pop()?.replace(/-/g, " "),
        selection: bind.selectionName || selection?.source?.targetName || "",
        rowLabel: bind.rowLabel || selection?.playerName || "",
        rowIndex: bind.rowIndex ?? selection?.rowIndex,
        colIndex: bind.columnIndex ?? selection?.columnIndex,
        lineMode: bind.lineStrategy === "exact" ? "exact" : "first_available",
        line: bind.lineStrategy === "exact" ? bind.line || "" : "",
        outcomeId: panelTarget?.outcomeId || "",
        panelTarget,
        source: "guided",
        createdAt: Date.now(),
      } as LegacyBind,
    ] as const;
  });
  const grouped = new Map<string, LegacyBind[]>();
  serialized.forEach(([id, entry]) => {
    grouped.set(id, [...(grouped.get(id) || []), entry]);
  });
  return Object.fromEntries(
    [...grouped.entries()].map(([id, entries]) => [
      id,
      entries.length === 1 ? entries[0] : entries,
    ]),
  );
}

function writeBindPayload(bind: Bind): LegacyBind[] {
  const keyCode = keyToCode(bind.key);
  const stored = writeBinds([bind])[`${bind.houseId}:${keyCode}`];
  return (Array.isArray(stored) ? stored : stored ? [stored] : []).filter(Boolean);
}

// Lista autoritativa em memória. As mutações (cadastrar, atualizar, apagar) não
// podem depender de rede: antes disso cada operação fazia um GET no Supabase só
// para descobrir a lista atual, e depois um POST, com o painel travado no meio.
let persistedBindsCache: Bind[] | null = null;

function rememberPersistedBinds(binds: Bind[]) {
  persistedBindsCache = binds;
  return binds;
}

// Carga: a nuvem vence, então o storage local precisa refletir isso antes da
// próxima mutação — que passa a ler só o local.
function adoptLoadedBinds(cloudBinds: unknown, localRaw: unknown) {
  if (Array.isArray(cloudBinds)) {
    const binds = cloudBinds as Bind[];
    void localSet({ dynamicPlayerBinds: writeBinds(binds) });
    return rememberPersistedBinds(binds);
  }
  return rememberPersistedBinds(readBinds(localRaw));
}

// Base de uma mutação: cache em memória, senão o storage local. Nunca rede.
async function loadBindsForMutation(): Promise<Bind[]> {
  if (persistedBindsCache) return persistedBindsCache;
  const local = await localGet({ dynamicPlayerBinds: {} });
  return rememberPersistedBinds(readBinds(local.dynamicPlayerBinds));
}

function sessionFromStorage(local: Record<string, unknown>): Session {
  const profile =
    local.gbr_user_profile && typeof local.gbr_user_profile === "object"
      ? (local.gbr_user_profile as Record<string, unknown>)
      : {};
  const authenticated = Boolean(local.gbr_auth_token && local.gbr_user_id);
  const status = String(profile.status ?? local.gbr_license_status ?? "trial");
  const licenseStatus = /active|valid/.test(status)
    ? "valid"
    : /trial/.test(status)
      ? "trial"
      : "expired";
  return {
    authenticated,
    user: authenticated
      ? {
          id: String(local.gbr_user_id ?? ""),
          name: String(profile.name ?? profile.email ?? local.gbr_user_email ?? "Usuário"),
          email: String(profile.email ?? local.gbr_user_email ?? ""),
        }
      : undefined,
    license: {
      status: licenseStatus,
      plan: String(profile.plan ?? (licenseStatus === "trial" ? "Teste" : "GatilhoBR")),
      renewsAt: String(profile.subscription_ends_at ?? profile.trial_ends_at ?? "—"),
    },
  };
}

function intent(type: "select_odds" | "trigger_bet" | "dynamic_bind") {
  return {
    actionId: `${Date.now()}-${crypto.randomUUID()}`,
    issuedAt: Date.now(),
    intentSource: "dashboard_user",
    intentType: type,
  };
}

function post(message: unknown) {
  ensurePort();
  if (!livePort) throw new Error("A conexão com as casas ainda não está pronta.");
  livePort.postMessage(message);
}

function demoSnapshot(): Snapshot {
  return {
    connections: MOCK_CONNECTIONS,
    events: MOCK_EVENTS,
    markets: MOCK_MARKETS,
    favoriteMarketKeys: MOCK_FAVORITE_MARKET_KEYS,
    priorityMarketKeys: [],
    favoritePlayerIds: MOCK_FAVORITE_PLAYER_IDS,
    priorityPlayerNotes: [],
    binds: MOCK_BINDS,
    stake: MOCK_STAKE,
    preferences: MOCK_PREFERENCES,
    session: MOCK_SESSION,
    activity: MOCK_ACTIVITY,
  };
}

export const extensionBridge = {
  async getSnapshot(options: { remote?: boolean } = {}): Promise<Snapshot> {
    if (!isExtension) return demoSnapshot();
    // O stream de mercados deve iniciar sem bloquear a pintura das
    // configurações. Os mercados chegam depois por subscribeToMarketUpdates.
    ensurePort();
    const [local, sync, authLocal, directLocal] = await Promise.all([
      localGet(),
      syncGet(),
      authStorage(),
      directOrderStorage(),
    ]);
    let cloud: CloudPreferences | null = null;
    let cloudActivity: ActivityRecord[] = [];
    if (options.remote !== false) {
      [cloud, cloudActivity] = await Promise.all([loadCloudPreferences(), loadCloudActivity()]);
    }
    const favoriteRecords = local.favoriteMarketsByHouse as
      Record<string, Array<{ key?: string }>> | undefined;
    const localFavoriteMarketKeys = [
      ...(favoriteRecords?.bet365 ?? []),
      ...(favoriteRecords?.betfair ?? []),
      ...(favoriteRecords?.betnacional ?? []),
      ...(favoriteRecords?.betmgm ?? []),
      ...(favoriteRecords?.superbet ?? []),
    ]
      .map((item) => String(item.key || ""))
      .filter(Boolean);
    const favoriteMarketKeys = Array.isArray(cloud?.favorites)
      ? cloud.favorites
      : localFavoriteMarketKeys;
    const priorityRules = Array.isArray(local.playerPriorityRules)
      ? (local.playerPriorityRules as PersistedPlayerPriorityRule[])
      : [];
    const localPriorityPlayerIds = priorityPlayerIdsFromRules(priorityRules);
    // Os jogadores anotados pelo usuário vivem só no armazenamento local: a
    // coluna da nuvem guarda ids sanitizados e uma coluna desconhecida faria o
    // patch inteiro ser descartado por `saveCloudPreferences`.
    const priorityPlayerNotes = sanitizePriorityPlayerNotes(local.gbr_priority_player_notes);
    const localPlayerPrioritiesUpdatedAt = Number(local.gbr_player_priorities_updated_at) || 0;
    const cloudPreferencesUpdatedAt = Date.parse(String(cloud?.updated_at || "")) || 0;
    const useCloudPlayerPriorities =
      Array.isArray(cloud?.player_priorities) &&
      cloudPreferencesUpdatedAt >= localPlayerPrioritiesUpdatedAt;
    const stake = parseNumber(local.fastTriggerStakeVal ?? local.stakeVal ?? sync.stakeVal) ?? 0.5;
    const localStakeUpdatedAt = Number(local.gbr_stake_updated_at) || 0;
    const cloudStakeUpdatedAt = Date.parse(String(cloud?.updated_at || "")) || 0;
    // Uma leitura remota iniciada antes do clique em Salvar pode terminar
    // depois e trazer a configuração anterior. A cópia local mais recente
    // deve vencer até que a gravação na nuvem apareça com timestamp novo.
    const useCloudStake = Boolean(cloud) && cloudStakeUpdatedAt >= localStakeUpdatedAt;
    const effectiveStake = useCloudStake ? (parseNumber(cloud?.stake) ?? stake) : stake;
    const localStakeByHouse = normalizeStakeByHouse(
      local.gbr_stake_by_house ?? sync.stakeValByHouse,
    );
    const cloudStakeByHouse =
      useCloudStake && cloud && Object.prototype.hasOwnProperty.call(cloud, "stake_by_house")
        ? normalizeStakeByHouse(cloud.stake_by_house)
        : null;
    const stakeByHouse = cloudStakeByHouse ?? localStakeByHouse;
    const localOneShot = Boolean(local.autoTriggerDirectBool ?? local.oneShot ?? local.autoTrigger);
    const effectiveOneShot = useCloudStake
      ? (cloud?.one_click_enabled ?? localOneShot)
      : localOneShot;
    // Atualizar as abas é importante para a próxima execução, mas não precisa
    // bloquear a primeira pintura do painel. O envio já é filtrado para as
    // casas e ocorre em paralelo.
    const oddsChangePolicy = normalizeOddsChangePolicy(
      sync.oddsChangePolicy,
      sync.autoAcceptOddsBool,
    );
    const directPrefsRaw = directLocal[DIRECT_ORDER_PREFS_KEY];
    const directPrefs = directPrefsRaw && typeof directPrefsRaw === "object"
      ? (directPrefsRaw as Record<string, unknown>)
      : {};
    const executionMode = directPrefs.executionMode === "DOM_UI"
      ? "DOM_UI"
      : "DIRECT_NETWORK";
    const directOrderAutoSelection = directPrefs.directOrderAutoSelection !== false;
    const maxStake = parseNumber(local.gbr_max_stake) ?? Math.max(stake, 500);
    void broadcastCurrentAccountStake(
      effectiveStake,
      stakeByHouse,
      effectiveOneShot,
      oddsChangePolicy,
      executionMode,
      directOrderAutoSelection,
      maxStake,
    ).catch(() => undefined);

    return {
      connections: connections(),
      events: events(),
      markets: latestMarkets,
      favoriteMarketKeys,
      priorityMarketKeys: Array.isArray(cloud?.market_priorities)
        ? cloud.market_priorities
        : Array.isArray(local.gbr_priority_market_keys)
          ? (local.gbr_priority_market_keys as string[])
          : [],
      favoritePlayerIds: sanitizePriorityPlayerIds([
        ...reconcilePriorityPlayerIds(
          useCloudPlayerPriorities
            ? sanitizePriorityPlayerIds(cloud?.player_priorities)
            : localPriorityPlayerIds,
          latestMarkets,
        ),
        // Um jogador anotado continua prioritário mesmo sem regra salva: é a
        // única lista que sobrevive quando o evento aberto não tem o atleta.
        ...priorityPlayerNotes.map((note) => note.id),
      ]),
      priorityPlayerNotes,
      binds: adoptLoadedBinds(cloud?.binds, local.dynamicPlayerBinds),
      stake: {
        stake: effectiveStake,
        stakeByHouse,
        maxStake,
        quickValues: Array.isArray(local.gbr_quick_stakes)
          ? (local.gbr_quick_stakes as number[])
          : [0.5, 10, 50, 100, 200, 500],
        oneClick: effectiveOneShot,
        autoFill: true,
        oddsChangePolicy,
        acceptOddsChange: oddsChangePolicy !== "reject_changes",
        executionMode,
        directOrderAutoSelection,
        triggerKey: String(sync.triggerKeyStr ?? "Space"),
      },
      preferences: {
        ...MOCK_PREFERENCES,
        ...(local.gbr_dashboard_preferences as Partial<Preferences> | undefined),
        ...(cloud?.preferences || {}),
      },
      session: sessionFromStorage({ ...authLocal, ...local }),
      activity: cloudActivity.length
        ? cloudActivity
        : Array.isArray(local.gbr_activity_log)
          ? (local.gbr_activity_log as ActivityRecord[])
          : [],
    };
  },

  async getConnections() {
    return isExtension ? connections() : MOCK_CONNECTIONS;
  },

  async getMarkets(house?: HouseId) {
    const houses: HouseId[] = house
      ? [house]
      : ["bet365", "betfair", "betnacional", "betmgm", "superbet"];
    await requestFreshMarkets(houses);
    await waitForMarkets();
    return house ? latestMarkets.filter((market) => market.house === house) : latestMarkets;
  },

  async syncMarkets(house?: HouseId): Promise<MarketSyncResult> {
    const houses: HouseId[] = house
      ? [house]
      : ["bet365", "betfair", "betnacional", "betmgm", "superbet"];
    if (!isExtension) {
      return { markets: MOCK_MARKETS, refreshedHouses: houses, pendingHouses: [] };
    }
    const result = await requestFreshMarkets(houses);
    await waitForMarkets();
    return {
      markets: house ? latestMarkets.filter((market) => market.house === house) : latestMarkets,
      ...result,
    };
  },

  async getGlobalBindSlots(): Promise<{
    assignments: GlobalBindSlotAssignments;
    shortcuts: GlobalBindShortcut[];
  }> {
    const fallbackShortcuts = GLOBAL_BIND_SLOT_IDS.map((slot) => ({
      slot,
      command: globalBindCommandName(slot),
      shortcut: `Ctrl+Shift+${slot}`,
    }));
    if (!isExtension) return { assignments: {}, shortcuts: fallbackShortcuts };

    const commandsPromise = chromeApi?.commands?.getAll
      ? chromeApi.commands.getAll().catch(() => [])
      : Promise.resolve([]);
    const [local, commands] = await Promise.all([
      localGet({ gbr_global_bind_slots: {} }),
      commandsPromise,
    ]);
    const commandByName = new Map(
      commands.map((command) => [String(command.name || ""), String(command.shortcut || "")]),
    );
    return {
      assignments: sanitizeGlobalBindSlotAssignments(local.gbr_global_bind_slots),
      shortcuts: GLOBAL_BIND_SLOT_IDS.map((slot) => ({
        slot,
        command: globalBindCommandName(slot),
        shortcut: commandByName.get(globalBindCommandName(slot)) || "",
      })),
    };
  },

  async updateGlobalBindSlot(slot: GlobalBindSlotId, bindId: string | null) {
    if (!GLOBAL_BIND_SLOT_IDS.includes(slot)) {
      throw new Error("Slot global inválido.");
    }
    const local = await localGet({ gbr_global_bind_slots: {} });
    const next = sanitizeGlobalBindSlotAssignments(local.gbr_global_bind_slots);
    const normalizedBindId = String(bindId || "").trim();

    // Uma bind ocupa um único botão físico. Reatribuir move a bind para o slot
    // escolhido e evita dois atalhos globais disparando exatamente o mesmo alvo.
    GLOBAL_BIND_SLOT_IDS.forEach((candidate) => {
      if (next[candidate] === normalizedBindId) delete next[candidate];
    });
    if (normalizedBindId) next[slot] = normalizedBindId;
    else delete next[slot];

    await localSet({ gbr_global_bind_slots: next });
    return next;
  },

  async openGlobalBindShortcutSettings() {
    if (!isExtension || !chromeApi?.tabs?.create) return false;
    await chromeApi.tabs.create({ url: "chrome://extensions/shortcuts" });
    return true;
  },

  async triggerBet(selection: Selection, stake: number): Promise<TriggerResult> {
    if (!isExtension)
      return { ok: true, message: "Disparo simulado.", selectionId: selection.id, stake };
    if (!selection.source) return { ok: false, message: "Seleção sem referência da casa." };
    const currentState = statesByHouse.get(selection.house);
    const capturedAt = Number(currentState?.capturedAt || 0);
    const snapshotIsStale =
      !currentState ||
      currentState.stale === true ||
      (capturedAt > 0 && Date.now() - capturedAt > 5 * 60 * 1000);
    if (snapshotIsStale) {
      return {
        ok: false,
        message: "Os mercados exibidos ainda estão desatualizados. Sincronize antes de selecionar.",
      };
    }
    if (
      !["open", "odds_changed", "selected"].includes(selection.status) ||
      selection.odds === null
    ) {
      return { ok: false, message: "A seleção está suspensa ou indisponível." };
    }
    try {
      const stakeNumber = typeof stake === "number" && !isNaN(stake) && stake > 0 ? stake : undefined;
      const stakeString = stakeNumber !== undefined ? stakeNumber.toFixed(2) : undefined;
      post({
        type: "SELECT_ODDS_ACTION",
        house: selection.house,
        // A seleção nasceu de um clique explícito no painel. O content
        // script pode pular a hesitação de humanização sem relaxar a
        // validação de intenção, licença ou rate limit.
        fastMode: true,
        stake: stakeNumber,
        stakeVal: stakeString,
        ...intent("select_odds"),
        payload: {
          house: selection.house,
          eventId: selection.eventId,
          name: selection.source.targetName,
          lineName: selection.source.lineName,
          optionLabel: selection.source.optionLabel,
          odds: selection.source.originalOdds || String(selection.odds),
          marketTitle: selection.source.marketTitle,
          colIndex: selection.columnIndex,
          rowIndex: selection.rowIndex,
          outcomeId: selection.source.outcomeId,
          stake: stakeNumber,
          stakeVal: stakeString,
        },
      });
      return {
        ok: true,
        message: "Seleção encaminhada para a aba da casa.",
        selectionId: selection.id,
        stake,
      };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : "Falha no envio." };
    }
  },

  async executeBind(bind: Bind): Promise<TriggerResult> {
    if (!isExtension) return { ok: true, message: "Execução simulada." };
    const action = intent("dynamic_bind");
    const keyCode = keyToCode(bind.key);
    const bindStake = typeof bind.stake === "number" && bind.stake > 0 ? bind.stake : undefined;
    const bindStakeVal = bindStake !== undefined ? bindStake.toFixed(2) : undefined;

    return new Promise<TriggerResult>((resolve) => {
      const timeout = setTimeout(() => {
        pendingBindDispatches.delete(action.actionId);
        resolve({
          ok: false,
          message: "A casa não confirmou a execução da bind dentro do tempo esperado.",
        });
      }, 30_000);

      pendingBindDispatches.set(action.actionId, { resolve, timeout });
      try {
        post({
          type: "DYNAMIC_BIND_ACTION",
          house: bind.houseId,
          keyCode,
          stake: bindStake,
          stakeVal: bindStakeVal,
          binds: writeBindPayload(bind),
          ...action,
        });
      } catch (error) {
        clearTimeout(timeout);
        pendingBindDispatches.delete(action.actionId);
        resolve({
          ok: false,
          message: error instanceof Error ? error.message : "Falha ao encaminhar a bind.",
        });
      }
    });
  },

  async executeBindBatch(binds: Bind[]): Promise<TriggerResult[]> {
    if (!isExtension) {
      return binds.map(() => ({ ok: true, message: "Execução simulada." }));
    }
    if (binds.length === 0) return [];

    const entries = binds.map((bind) => {
      const bindStake = typeof bind.stake === "number" && bind.stake > 0 ? bind.stake : undefined;
      const bindStakeVal = bindStake !== undefined ? bindStake.toFixed(2) : undefined;
      return {
        bind,
        action: intent("dynamic_bind"),
        keyCode: keyToCode(bind.key),
        stake: bindStake,
        stakeVal: bindStakeVal,
      };
    });
    const results = entries.map(
      ({ action }) =>
        new Promise<TriggerResult>((resolve) => {
          const timeout = setTimeout(() => {
            pendingBindDispatches.delete(action.actionId);
            resolve({
              ok: false,
              message: "A casa não confirmou a execução da bind dentro do tempo esperado.",
            });
          }, 30_000);
          pendingBindDispatches.set(action.actionId, { resolve, timeout });
        }),
    );

    try {
      post({
        type: "DYNAMIC_BIND_ACTION_BATCH",
        actions: entries.map(({ bind, action, keyCode, stake, stakeVal }) => ({
          house: bind.houseId,
          keyCode,
          stake,
          stakeVal,
          binds: writeBindPayload(bind),
          ...action,
        })),
      });
    } catch (error) {
      entries.forEach(({ action }) => {
        const pending = pendingBindDispatches.get(action.actionId);
        if (!pending) return;
        clearTimeout(pending.timeout);
        pendingBindDispatches.delete(action.actionId);
        pending.resolve({
          ok: false,
          message: error instanceof Error ? error.message : "Falha ao encaminhar as binds.",
        });
      });
    }

    return Promise.all(results);
  },

  async testBind(selection: Selection | null): Promise<TriggerResult> {
    return selection
      ? {
          ok: true,
          message: "Seleção localizada. Nenhuma aposta foi enviada.",
          selectionId: selection.id,
        }
      : { ok: false, message: "Nenhuma seleção corresponde a esta bind agora." };
  },

  async saveBind(bind: Bind, replaceShortcut = false) {
    const shortcutIdentity = (item: Bind) =>
      [item.houseId, keyToCode(item.key), [...(item.modifiers ?? [])].sort().join("+")].join(":");
    const targetShortcut = shortcutIdentity(bind);
    const persisted = await loadBindsForMutation();
    const replacedIds = persisted
      .filter(
        (item) =>
          item.id !== bind.id && replaceShortcut && shortcutIdentity(item) === targetShortcut,
      )
      .map((item) => item.id);
    const binds = persisted.filter(
      (item) =>
        item.id !== bind.id && (!replaceShortcut || shortcutIdentity(item) !== targetShortcut),
    );
    const next = [...binds, bind];
    rememberPersistedBinds(next);
    await localSet({ dynamicPlayerBinds: writeBinds(next) });
    void queueCloudPreferences({ binds: next });
    const local = await localGet({ gbr_global_bind_slots: {} });
    const globalSlots = reassignGlobalBindSlots(
      sanitizeGlobalBindSlotAssignments(local.gbr_global_bind_slots),
      replacedIds,
      bind.id,
    );
    await localSet({ gbr_global_bind_slots: globalSlots });
    return bind;
  },

  async updateBind(bind: Bind) {
    const persisted = await loadBindsForMutation();
    const found = persisted.some((item) => item.id === bind.id);
    const binds = found
      ? persisted.map((item) => (item.id === bind.id ? bind : item))
      : [...persisted, bind];
    rememberPersistedBinds(binds);
    await localSet({ dynamicPlayerBinds: writeBinds(binds) });
    void queueCloudPreferences({ binds });
    return bind;
  },

  async deleteBind(id: string) {
    const next = (await loadBindsForMutation()).filter((item) => item.id !== id);
    rememberPersistedBinds(next);
    await localSet({ dynamicPlayerBinds: writeBinds(next) });
    const local = await localGet({ gbr_global_bind_slots: {} });
    const globalSlots = reassignGlobalBindSlots(
      sanitizeGlobalBindSlotAssignments(local.gbr_global_bind_slots),
      [id],
    );
    await localSet({ gbr_global_bind_slots: globalSlots });
    void queueCloudPreferences({ binds: next });
  },

  async updateStake(stake: StakeSettings) {
    const value = stake.stake.toFixed(2);
    const updatedAt = Date.now();
    const stakeByHouse = normalizeStakeByHouse(stake.stakeByHouse);
    const oddsChangePolicy = normalizeOddsChangePolicy(
      stake.oddsChangePolicy,
      stake.acceptOddsChange,
    );
    // O storage local é a confirmação do clique: ele é a fonte lida pela
    // dashboard e sobrevive ao fechamento imediato da janela. Sync, abas e
    // nuvem são réplicas e não podem manter o botão em "Salvando…".
    await Promise.all([
      localSet({
        fastTriggerStakeVal: value,
        stakeVal: value,
        gbr_stake_by_house: stakeByHouse,
        gbr_stake_updated_at: updatedAt,
        gbr_max_stake: stake.maxStake,
        gbr_quick_stakes: stake.quickValues,
        autoTriggerDirectBool: stake.oneClick,
        oneShot: stake.oneClick,
        autoTrigger: stake.oneClick,
        autoTriggerDirect: stake.oneClick,
      }),
      persistDirectOrderSettings(stake),
    ]);
    void syncSet({
      stakeVal: value,
      stakeValByHouse: stakeByHouse,
      oddsChangePolicy,
      autoAcceptOddsBool: oddsChangePolicy !== "reject_changes",
      triggerKeyStr: stake.triggerKey,
    }).catch(() => undefined);
    void broadcastCurrentAccountStake(
      stake.stake,
      stakeByHouse,
      stake.oneClick,
      oddsChangePolicy,
      stake.executionMode,
      stake.directOrderAutoSelection,
      stake.maxStake,
    ).catch(() => undefined);
    void queueCloudPreferences({
      stake: stake.stake,
      stake_by_house: stakeByHouse,
      one_click_enabled: stake.oneClick,
    });
    return {
      ...stake,
      stakeByHouse,
      oddsChangePolicy,
      acceptOddsChange: oddsChangePolicy !== "reject_changes",
    };
  },

  async updatePreferences(preferences: Preferences) {
    await localSet({ gbr_dashboard_preferences: preferences });
    void queueCloudPreferences({ preferences });
    return preferences;
  },

  async updateFavoriteMarkets(keys: MarketCanonicalKey[]) {
    const build = (house: HouseId) =>
      keys
        .filter((key) =>
          latestMarkets.some((market) => market.house === house && market.canonicalKey === key),
        )
        .map((key) => ({
          key,
          title:
            latestMarkets.find((market) => market.house === house && market.canonicalKey === key)
              ?.displayName ?? key,
        }));
    await Promise.all([
      localSet({
        favoriteMarketsByHouse: {
          bet365: build("bet365"),
          betfair: build("betfair"),
          betnacional: build("betnacional"),
          betmgm: build("betmgm"),
          superbet: build("superbet"),
        },
      }),
      saveCloudPreferences({ favorites: keys }),
    ]);
  },

  async updatePriorityMarkets(keys: MarketCanonicalKey[]) {
    await Promise.all([
      localSet({ gbr_priority_market_keys: keys }),
      saveCloudPreferences({ market_priorities: keys }),
    ]);
  },

  async updateFavoritePlayers(playerIds: string[]) {
    const normalizedIds = sanitizePriorityPlayerIds(playerIds);
    const local = await localGet({ playerPriorityRules: [] });
    const existingRules = Array.isArray(local.playerPriorityRules)
      ? (local.playerPriorityRules as PersistedPlayerPriorityRule[])
      : [];
    const rules = buildPlayerPriorityRules(normalizedIds, latestMarkets, existingRules);
    const updatedAt = Date.now();
    await Promise.all([
      localSet({
        playerPriorityRules: rules,
        gbr_player_priorities_updated_at: updatedAt,
      }),
      saveCloudPreferences({ player_priorities: normalizedIds }),
    ]);
  },

  /**
   * Anotações do usuário. Ficam apenas no armazenamento local da extensão
   * porque `user_dashboard_preferences` não tem coluna para elas e um patch com
   * coluna desconhecida é descartado inteiro pelo Supabase.
   */
  async updatePriorityPlayerNotes(notes: PriorityPlayerNote[]) {
    await localSet({
      gbr_priority_player_notes: sanitizePriorityPlayerNotes(notes),
      gbr_player_priorities_updated_at: Date.now(),
    });
  },

  async appendActivity(record: ActivityRecord) {
    const local = await localGet({ gbr_activity_log: [] });
    const history = Array.isArray(local.gbr_activity_log)
      ? (local.gbr_activity_log as ActivityRecord[])
      : [];
    await localSet({
      gbr_activity_log: [record, ...history.filter((item) => item.id !== record.id)].slice(0, 300),
    });
    try {
      const session = await getStoredSession();
      if (!session) return;
      await supabaseRequest("/rest/v1/user_activity_logs?on_conflict=id", {
        method: "POST",
        prefer: "resolution=merge-duplicates,return=minimal",
        body: JSON.stringify({
          id: record.id,
          user_id: session.userId,
          occurred_at: record.at,
          event: record.event,
          house: record.house || null,
          label: record.label,
          detail: record.detail || null,
          result: record.result,
        }),
      });
    } catch {
      // O histórico local não depende da disponibilidade do backend.
    }
  },

  async exportPreset(preset: Preset) {
    const cloud = await loadCloudPreferences();
    const presets = [
      preset,
      ...(cloud?.presets || []).filter((item) => item.name !== preset.name),
    ].slice(0, 50);
    await saveCloudPreferences({ presets });
    return `GBR1.${btoa(unescape(encodeURIComponent(JSON.stringify(preset))))}`;
  },

  async importPreset(code: string, sections: PresetSection[]): Promise<Partial<PresetPayload>> {
    if (!code.trim().startsWith("GBR1.")) throw new Error("Código inválido.");
    const preset = JSON.parse(decodeURIComponent(escape(atob(code.trim().slice(5))))) as Preset;
    const partial: Partial<PresetPayload> = {};
    sections.forEach((section) => {
      if (preset.payload?.[section] !== undefined) {
        Object.assign(partial, { [section]: preset.payload[section] });
      }
    });
    return partial;
  },

  async applyPreset(partial: Partial<PresetPayload>) {
    if (partial.favoriteMarketKeys) await this.updateFavoriteMarkets(partial.favoriteMarketKeys);
    if (partial.priorityMarketKeys) await this.updatePriorityMarkets(partial.priorityMarketKeys);
    if (partial.favoritePlayerIds) await this.updateFavoritePlayers(partial.favoritePlayerIds);
    if (partial.binds) {
      await localSet({ dynamicPlayerBinds: writeBinds(partial.binds) });
      await saveCloudPreferences({ binds: partial.binds });
    }
    if (partial.stake) await this.updateStake(partial.stake);
    if (partial.preferences) await this.updatePreferences(partial.preferences);
  },

  subscribeToMarketUpdates(callback: (markets: MarketModel[]) => void) {
    if (!isExtension) {
      callback(MOCK_MARKETS);
      return () => undefined;
    }
    subscribers.add(callback);
    ensurePort();
    if (latestMarkets.length > 0) callback(latestMarkets);
    return () => {
      subscribers.delete(callback);
    };
  },
};

export type ExtensionBridge = typeof extensionBridge;
