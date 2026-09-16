import type {
  HouseId,
  MarketCanonicalKey,
  MarketModel,
  MarketRow,
  Selection,
} from "@/types/gatilho";

export const PLAYER_PRIORITY_HOUSES = ["bet365", "betfair"] as const;
export type PlayerPriorityHouse = (typeof PLAYER_PRIORITY_HOUSES)[number];

export interface PriorityPlayerCandidate {
  id: string;
  house: PlayerPriorityHouse;
  name: string;
  teamName: string;
  marketKeys: MarketCanonicalKey[];
  marketNames: string[];
  openSelectionCount: number;
}

/** Jogador que o usuário salvou por conta própria, com o nome que ele digitou. */
export interface PriorityPlayerNote {
  id: string;
  house: PlayerPriorityHouse;
  name: string;
  createdAt: string;
}

/** Mercado ao vivo de um jogador salvo, pronto para disparo direto. */
export interface PriorityPlayerShot {
  marketId: string;
  marketName: string;
  canonicalKey: MarketCanonicalKey;
  cells: Array<Selection | null>;
}

export interface PriorityPlayerScanOptions {
  /** Nomes dos times do evento. Uma linha com o nome do time não é atleta. */
  teamNames?: string[];
}

export interface PersistedPlayerPriorityRule {
  id?: string;
  house?: string;
  team?: string;
  market?: string;
  canonicalMarket?: string;
  player?: string;
  playerKey?: string;
  eventId?: string;
}

function slug(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * A Bet365 inclui a contagem atual da estatística no cabeçalho SIP
 * (ex.: "Jogador (2)"). Essa contagem muda durante o jogo e não pertence à
 * identidade do atleta.
 */
export function normalizePriorityPlayerName(value: unknown) {
  return String(value ?? "")
    .replace(/\s*\(\s*\d+\s*\)\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Títulos que só existem em mercado de atleta. Betfair e Bet365 usam o mesmo
 * vocabulário ("Jogador - Chutes ao gol", "Marcador de gol").
 */
const PLAYER_MARKET_TITLE_TOKENS = [
  "jogador",
  "jogadores",
  "player",
  "players",
  "atleta",
  "atletas",
  "marcador",
  "marcadores",
  "goalscorer",
  "goalscorers",
  "artilheiro",
  "assistencia",
  "assistencias",
  "assist",
  "assists",
];

/**
 * Vocabulário de opção de mercado. Nenhum desses termos aparece sozinho no nome
 * de um atleta, e é exatamente o que vazava para a lista de prioritários:
 * "Mais de 2.5", "Ambas marcam - Sim", "Total de cartões", "Empate".
 */
const MARKET_OPTION_TOKENS = [
  "sim", "nao", "yes", "no", "empate", "draw", "tie", "ou", "or",
  "casa", "fora", "visitante", "mandante", "home", "away",
  "ambas", "ambos", "both", "nenhum", "nenhuma", "ninguem", "neither", "none",
  "qualquer", "any", "outro", "outra", "other",
  "mais", "menos", "acima", "abaixo", "over", "under", "exatamente", "exato",
  "total", "soma", "handicap", "linha", "par", "impar", "odd", "even",
  "dupla", "chance", "intervalo", "tempo", "prorrogacao", "penalti", "penaltis",
  "penalty", "gol", "gols", "goal", "goals", "placar", "resultado", "result",
  "vencedor", "winner", "ganhador",
  "escanteio", "escanteios", "corner", "corners", "lateral", "laterais",
  "cartao", "cartoes", "card", "cards", "falta", "faltas", "foul", "fouls",
  "chute", "chutes", "remate", "remates", "finalizacao", "finalizacoes",
  "shot", "shots", "defesa", "defesas", "save", "saves",
  "passe", "passes", "desarme", "desarmes", "impedimento", "impedimentos",
  "time", "times", "equipe", "equipes", "selecao", "clube", "opcao", "option",
  "aposta", "mercado", "primeiro", "primeira", "segundo", "segunda", "terceiro",
  "ultimo", "ultima", "first", "last", "proximo", "next",
];

function tokenPattern(tokens: string[]) {
  return new RegExp(`(?:^|-)(?:${tokens.join("|")})(?:-|$)`);
}

const PLAYER_MARKET_TITLE_PATTERN = tokenPattern(PLAYER_MARKET_TITLE_TOKENS);
const MARKET_OPTION_PATTERN = tokenPattern(MARKET_OPTION_TOKENS);

/** Quantas linhas de atleta um mercado sem título explícito precisa ter. */
const MIN_PLAYER_ROWS_WITHOUT_TITLE = 3;

/**
 * Decide se um rótulo de linha é o nome de um atleta. O teste é feito no slug
 * para não depender de acento nem de caixa, e sempre em token inteiro: "Gabigol"
 * e "Casemiro" passam, "Mais de 2.5" e "Ambas - Sim" não.
 */
export function looksLikePriorityPlayerName(
  value: unknown,
  options: { excludeNames?: string[] } = {},
): boolean {
  const cleaned = normalizePriorityPlayerName(value);
  if (cleaned.length < 3 || cleaned.length > 40) return false;
  // Placar, linha e handicap sempre trazem número. O nome do atleta não: a
  // contagem da Bet365 já foi removida por normalizePriorityPlayerName.
  if (/\d/.test(cleaned)) return false;
  const key = slug(cleaned);
  if (!key || !/[a-z]{3}/.test(key)) return false;
  if (MARKET_OPTION_PATTERN.test(key)) return false;
  return !(options.excludeNames ?? []).some((name) => {
    const other = slug(name);
    return Boolean(other) && (other === key || key.includes(other) || other.includes(key));
  });
}

function marketRowNames(market: MarketModel) {
  return market.rows.map(
    (row) => row.playerName || row.cells.find(Boolean)?.playerName || "",
  );
}

/**
 * Mercado de atleta de verdade. `isPlayerMarket` chega de heurística de título
 * nas casas (`/faltas|cartoes|chutes/` na Betfair, `/gol/` na Bet365), então
 * mercados de time e de placar entravam como jogador. Aqui o título precisa
 * nomear atleta ou as próprias linhas precisam ser nomes de atleta — um grid de
 * time tem duas ou três opções, uma tabela de jogador tem a escalação.
 */
export function isPriorityPlayerMarket(
  market: MarketModel,
  options: PriorityPlayerScanOptions = {},
): boolean {
  if (market.isPlayerMarket !== true) return false;
  const excludeNames = [market.displayName, ...(options.teamNames ?? [])];
  if (PLAYER_MARKET_TITLE_PATTERN.test(slug(market.displayName))) {
    return marketRowNames(market).some((name) =>
      looksLikePriorityPlayerName(name, { excludeNames })
    );
  }
  const playerRows = marketRowNames(market).filter((name) =>
    looksLikePriorityPlayerName(name, { excludeNames })
  );
  return playerRows.length >= MIN_PLAYER_ROWS_WITHOUT_TITLE;
}

/** Linha aproveitável: mercado de atleta, casa correta e nome de atleta. */
export function isPriorityPlayerRow(
  market: MarketModel,
  row: MarketRow,
  house: PlayerPriorityHouse,
  options: PriorityPlayerScanOptions = {},
): boolean {
  if (!row.playerId || priorityHouseFromPlayerId(row.playerId) !== house) return false;
  return looksLikePriorityPlayerName(row.playerName || row.cells.find(Boolean)?.playerName, {
    excludeNames: [market.displayName, ...(options.teamNames ?? [])],
  });
}

export function priorityHouseFromPlayerId(playerId: string): PlayerPriorityHouse | null {
  if (playerId.startsWith("bet365:player:")) return "bet365";
  if (playerId.startsWith("betfair:player:")) return "betfair";
  return null;
}

export function sanitizePriorityPlayerIds(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(
    values
      .map((value) => String(value || "").trim())
      .filter((value) => Boolean(priorityHouseFromPlayerId(value))),
  )].slice(0, 300);
}

export function reconcilePriorityPlayerIds(
  values: unknown,
  markets: MarketModel[],
): string[] {
  const liveIds = new Set(
    markets
      .filter((market) => isPriorityPlayerMarket(market))
      .flatMap((market) =>
        market.rows
          .filter((row) => looksLikePriorityPlayerName(
            row.playerName || row.cells.find(Boolean)?.playerName,
            { excludeNames: [market.displayName] },
          ))
          .map((row) => row.playerId)
      ),
  );

  return sanitizePriorityPlayerIds(values).map((playerId) => {
    if (liveIds.has(playerId)) return playerId;
    const withoutLegacyCount = playerId.replace(/-\d+$/, "");
    return liveIds.has(withoutLegacyCount) ? withoutLegacyCount : playerId;
  }).filter((playerId, index, list) => list.indexOf(playerId) === index);
}

export function priorityPlayerLabelFromId(playerId: string) {
  const raw = playerId.replace(/^(?:bet365|betfair):player:/, "");
  return raw
    .split(/[-_:]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || "Jogador salvo";
}

export function getPriorityPlayerCandidates(
  markets: MarketModel[],
  house: PlayerPriorityHouse,
  options: PriorityPlayerScanOptions = {},
): PriorityPlayerCandidate[] {
  const candidates = new Map<string, PriorityPlayerCandidate>();

  markets
    .filter((market) => market.house === house && isPriorityPlayerMarket(market, options))
    .forEach((market) => {
      market.rows.forEach((row) => {
        if (!isPriorityPlayerRow(market, row, house, options)) return;
        const existing = candidates.get(row.playerId);
        const openSelectionCount = row.cells.filter(
          (cell) => cell && (cell.status === "open" || cell.status === "odds_changed"),
        ).length;
        if (existing) {
          if (!existing.marketKeys.includes(market.canonicalKey)) {
            existing.marketKeys.push(market.canonicalKey);
          }
          if (!existing.marketNames.includes(market.displayName)) {
            existing.marketNames.push(market.displayName);
          }
          existing.openSelectionCount += openSelectionCount;
          return;
        }
        candidates.set(row.playerId, {
          id: row.playerId,
          house,
          name: row.playerName || row.cells.find(Boolean)?.playerName || priorityPlayerLabelFromId(row.playerId),
          // O scraper nem sempre informa o time do atleta. Não exibir o
          // fallback do evento como se fosse um vínculo confirmado.
          teamName: "",
          marketKeys: [market.canonicalKey],
          marketNames: [market.displayName],
          openSelectionCount,
        });
      });
    });

  return [...candidates.values()].sort((left, right) =>
    left.name.localeCompare(right.name, "pt-BR", { sensitivity: "base" })
  );
}

function playerIdForRule(rule: PersistedPlayerPriorityRule) {
  const house = rule.house === "betfair" ? "betfair" : rule.house === "bet365" ? "bet365" : null;
  const player = slug(normalizePriorityPlayerName(rule.playerKey || rule.player));
  return house && player ? `${house}:player:${player}` : "";
}

export function priorityPlayerIdsFromRules(rules: unknown): string[] {
  if (!Array.isArray(rules)) return [];
  return sanitizePriorityPlayerIds(
    rules.map((rule) =>
      rule && typeof rule === "object"
        ? playerIdForRule(rule as PersistedPlayerPriorityRule)
        : "",
    ),
  );
}

export function buildPlayerPriorityRules(
  playerIds: string[],
  markets: MarketModel[],
  existingRules: PersistedPlayerPriorityRule[] = [],
  options: PriorityPlayerScanOptions = {},
): PersistedPlayerPriorityRule[] {
  const selected = sanitizePriorityPlayerIds(playerIds);
  const rules: PersistedPlayerPriorityRule[] = [];

  selected.forEach((playerId) => {
    const house = priorityHouseFromPlayerId(playerId);
    if (!house) return;
    const playerMarkets = markets.filter(
      (market) =>
        market.house === house &&
        isPriorityPlayerMarket(market, options) &&
        market.rows.some(
          (row) => row.playerId === playerId && isPriorityPlayerRow(market, row, house, options),
        ),
    );

    if (playerMarkets.length === 0) {
      existingRules
        .filter((rule) => playerIdForRule(rule) === playerId)
        .forEach((rule) => rules.push({ ...rule }));
      return;
    }

    playerMarkets.forEach((market) => {
      const row = market.rows.find((item) => item.playerId === playerId);
      if (!row) return;
      const playerName = normalizePriorityPlayerName(
        row.playerName || row.cells.find(Boolean)?.playerName || priorityPlayerLabelFromId(playerId),
      );
      rules.push({
        id: `react-priority:${playerId}:${market.canonicalKey}`,
        house,
        team: "",
        market: market.displayName,
        canonicalMarket: market.canonicalKey,
        player: playerName,
        playerKey: slug(playerName),
        eventId: market.eventId,
      });
    });
  });

  const unique = new Map<string, PersistedPlayerPriorityRule>();
  rules.forEach((rule) => {
    const signature = [
      rule.house,
      slug(rule.canonicalMarket || rule.market),
      slug(rule.playerKey || rule.player),
      rule.eventId || "",
    ].join("|");
    if (!unique.has(signature)) unique.set(signature, rule);
  });
  return [...unique.values()].slice(0, 500);
}

export function isPlayerPriorityHouse(house: HouseId): house is PlayerPriorityHouse {
  return house === "bet365" || house === "betfair";
}

/* ------------------------------------------- jogadores salvos pelo usuário */

const MAX_PRIORITY_PLAYER_NOTES = 200;

export function priorityPlayerId(house: PlayerPriorityHouse, name: unknown) {
  const key = slug(normalizePriorityPlayerName(name));
  return key ? `${house}:player:${key}` : "";
}

/**
 * Anotação do usuário. Guardar o nome digitado é o que permite exibir "Vinícius
 * Júnior" no lugar do rótulo derivado do slug quando o jogador não está no
 * evento aberto.
 */
export function createPriorityPlayerNote(
  house: PlayerPriorityHouse,
  name: unknown,
  createdAt = new Date().toISOString(),
): PriorityPlayerNote | null {
  const cleaned = normalizePriorityPlayerName(name);
  const id = priorityPlayerId(house, cleaned);
  if (!id || !looksLikePriorityPlayerName(cleaned)) return null;
  return { id, house, name: cleaned, createdAt };
}

export function sanitizePriorityPlayerNotes(value: unknown): PriorityPlayerNote[] {
  if (!Array.isArray(value)) return [];
  const unique = new Map<string, PriorityPlayerNote>();
  value.forEach((item) => {
    if (!item || typeof item !== "object") return;
    const raw = item as Partial<PriorityPlayerNote>;
    const house = raw.house === "betfair" || raw.house === "bet365" ? raw.house : null;
    if (!house) return;
    const note = createPriorityPlayerNote(
      house,
      raw.name,
      typeof raw.createdAt === "string" ? raw.createdAt : new Date(0).toISOString(),
    );
    // O mesmo atleta pode voltar com outra grafia; a primeira anotação vence
    // para preservar o nome e a data que o usuário realmente salvou.
    if (note && !unique.has(note.id)) unique.set(note.id, note);
  });
  return [...unique.values()].slice(0, MAX_PRIORITY_PLAYER_NOTES);
}

function nameTokens(value: unknown) {
  return slug(normalizePriorityPlayerName(value))
    .split("-")
    .filter((token) => token.length >= 3);
}

/**
 * O usuário digita "Vinicius Jr" e a casa publica "Vinícius Júnior". Comparar
 * apenas o slug perderia o jogador salvo justamente no jogo em que ele está.
 */
export function priorityPlayerNamesMatch(left: unknown, right: unknown) {
  const leftKey = slug(normalizePriorityPlayerName(left));
  const rightKey = slug(normalizePriorityPlayerName(right));
  if (!leftKey || !rightKey) return false;
  if (leftKey === rightKey) return true;
  const leftTokens = nameTokens(left);
  const rightTokens = nameTokens(right);
  if (leftTokens.length === 0 || rightTokens.length === 0) return false;
  const [shorter, longer] =
    leftTokens.length <= rightTokens.length
      ? [leftTokens, rightTokens]
      : [rightTokens, leftTokens];
  return shorter.every((token) =>
    longer.some((other) => other === token || other.startsWith(token) || token.startsWith(other))
  );
}

/** Candidato ao vivo correspondente ao jogador salvo, quando existir. */
export function findPriorityPlayerCandidate(
  playerId: string,
  name: string,
  candidates: PriorityPlayerCandidate[],
): PriorityPlayerCandidate | null {
  return (
    candidates.find((candidate) => candidate.id === playerId) ??
    candidates.find((candidate) => priorityPlayerNamesMatch(candidate.name, name)) ??
    null
  );
}

export function priorityPlayerDisplayName(
  playerId: string,
  notes: PriorityPlayerNote[] = [],
  candidates: PriorityPlayerCandidate[] = [],
) {
  return (
    candidates.find((candidate) => candidate.id === playerId)?.name ||
    notes.find((note) => note.id === playerId)?.name ||
    priorityPlayerLabelFromId(playerId)
  );
}

/**
 * Mercados vivos do jogador salvo com as células como a casa publicou. As
 * suspensas continuam na lista: a interface precisa mostrá-las travadas em vez
 * de esconder que a odd existe.
 */
export function getPriorityPlayerShots(
  markets: MarketModel[],
  playerId: string,
  options: PriorityPlayerScanOptions = {},
): PriorityPlayerShot[] {
  const house = priorityHouseFromPlayerId(playerId);
  if (!house) return [];
  return markets
    .filter((market) => market.house === house && isPriorityPlayerMarket(market, options))
    .flatMap((market) => {
      const row = market.rows.find(
        (item) => item.playerId === playerId && isPriorityPlayerRow(market, item, house, options),
      );
      if (!row || !row.cells.some(Boolean)) return [];
      return [
        {
          marketId: market.id,
          marketName: market.displayName,
          canonicalKey: market.canonicalKey,
          cells: row.cells,
        },
      ];
    });
}
