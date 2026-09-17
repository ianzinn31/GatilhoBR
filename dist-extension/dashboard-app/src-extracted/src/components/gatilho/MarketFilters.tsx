import { Filter, RefreshCw, Search, Star } from "lucide-react";

import { Button } from "@/components/ui/button";
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
import { TEAMS } from "@/data/mocks/catalog";
import { getRuntimeTeams } from "@/lib/runtimeCatalog";
import { relativeFromNow } from "@/lib/format";
import { canonicalLabel, type MarketFilterState } from "@/lib/selectors";
import type { MarketCanonicalKey } from "@/types/gatilho";

export type { MarketFilterState };
export { DEFAULT_MARKET_FILTERS } from "@/lib/selectors";

export function MarketFilters({
  value,
  onChange,
  availableKeys,
  count,
  lastSync,
  onRefresh,
  refreshing = false,
}: {
  value: MarketFilterState;
  onChange: (next: MarketFilterState) => void;
  availableKeys: MarketCanonicalKey[];
  count: number;
  lastSync: string | null;
  onRefresh: () => void;
  refreshing?: boolean;
}) {
  const patch = (partial: Partial<MarketFilterState>) => onChange({ ...value, ...partial });
  const liveTeams = getRuntimeTeams();
  const teams = liveTeams.length ? liveTeams : TEAMS;

  return (
    <div className="rounded-xl border border-border/80 bg-card/95 p-3 shadow-[0_16px_38px_-34px_color-mix(in_srgb,var(--primary)_55%,transparent)] sm:p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary/80">
            Controles de mercado
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Filtre a grade sem perder a leitura das odds reais.
          </p>
        </div>
        <span className="hidden rounded-full border border-border bg-surface-2/70 px-2.5 py-1 text-[10px] font-semibold tabular text-muted-foreground sm:inline-flex">
          {count} {count === 1 ? "mercado" : "mercados"}
        </span>
      </div>

      <div className="grid gap-2 xl:grid-cols-[minmax(240px,1.4fr)_190px_150px_auto]">
        <div className="relative min-w-0">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={value.query}
            onChange={(event) => patch({ query: event.target.value })}
            placeholder="Buscar jogador ou mercado"
            className="h-10 rounded-lg border-border/80 bg-surface/75 pl-8 text-sm placeholder:text-muted-foreground/70 focus-visible:border-primary/60"
          />
        </div>

        <Select
          value={value.canonicalKey}
          onValueChange={(next) => patch({ canonicalKey: next as MarketCanonicalKey | "all" })}
        >
          <SelectTrigger className="h-10 w-full rounded-lg border-border/80 bg-surface/75">
            <SelectValue placeholder="Mercado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os mercados</SelectItem>
            {availableKeys.map((key) => (
              <SelectItem key={key} value={key}>
                {canonicalLabel(key)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={value.teamId} onValueChange={(next) => patch({ teamId: next })}>
          <SelectTrigger className="h-10 w-full rounded-lg border-border/80 bg-surface/75">
            <SelectValue placeholder="Time" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Os dois times</SelectItem>
            {teams.map((team) => (
              <SelectItem key={team.id} value={team.id}>
                {team.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex min-w-0 items-center justify-end gap-2 rounded-lg border border-border/60 bg-surface/45 px-2.5">
          <span className="hidden truncate text-[11px] tabular text-muted-foreground 2xl:inline">
            Sync {relativeFromNow(lastSync)}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5 rounded-lg border-primary/30 bg-primary/5 px-3 font-semibold text-primary hover:bg-primary/10"
            onClick={onRefresh}
            disabled={refreshing}
            aria-busy={refreshing}
          >
            <RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} />
            {refreshing ? "Sincronizando…" : "Sincronizar"}
          </Button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border/70 pt-3">
        <span className="mr-1 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground/80">
          Visualização
        </span>
        <ToggleField
          id="only-favorites"
          icon={<Star className="size-3.5" />}
          label="Só favoritos"
          checked={value.onlyFavorites}
          onChange={(checked) => patch({ onlyFavorites: checked })}
        />
        <ToggleField
          id="only-open"
          icon={<Filter className="size-3.5" />}
          label="Só mercados abertos"
          checked={value.onlyOpen}
          onChange={(checked) => patch({ onlyOpen: checked })}
        />
        <ToggleField
          id="favorites-first"
          label="Favoritos no topo"
          checked={value.favoritesFirst}
          onChange={(checked) => patch({ favoritesFirst: checked })}
        />
      </div>
    </div>
  );
}

function ToggleField({
  id,
  label,
  icon,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  icon?: React.ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
      <Label htmlFor={id} className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        {label}
      </Label>
    </div>
  );
}
