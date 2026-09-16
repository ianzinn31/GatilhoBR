import type { MarketCanonicalKey, Player, Team } from "@/types/gatilho";

const runtimePlayers = new Map<string, Player>();
const runtimeTeams = new Map<string, Team>();
const runtimeMarketLabels = new Map<MarketCanonicalKey, string>();

export function resetRuntimeCatalog() {
  runtimePlayers.clear();
  runtimeTeams.clear();
  runtimeMarketLabels.clear();
}

export function registerRuntimeTeam(team: Team) {
  runtimeTeams.set(team.id, team);
}

export function registerRuntimePlayer(player: Player) {
  runtimePlayers.set(player.id, player);
}

export function registerRuntimeMarket(key: MarketCanonicalKey, label: string) {
  if (key && label) runtimeMarketLabels.set(key, label);
}

export function getRuntimePlayer(id: string) {
  return runtimePlayers.get(id);
}

export function getRuntimeTeam(id: string) {
  return runtimeTeams.get(id);
}

export function getRuntimeMarketLabel(key: MarketCanonicalKey) {
  return runtimeMarketLabels.get(key);
}

export function getRuntimePlayers() {
  return [...runtimePlayers.values()];
}

export function getRuntimeTeams() {
  return [...runtimeTeams.values()];
}

export function getRuntimeMarkets() {
  return [...runtimeMarketLabels.entries()].map(([key, label]) => ({ key, label }));
}
