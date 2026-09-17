import { createFileRoute } from "@tanstack/react-router";
import { Activity, Gauge, Keyboard, Star, TrendingUp, Wifi } from "lucide-react";
import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import { ActivityLog } from "@/components/gatilho/ActivityLog";
import { ConnectionStatus } from "@/components/gatilho/ConnectionStatus";
import { LiveMatchHeader } from "@/components/gatilho/LiveMatchHeader";
import { EmptyState, KeyCap, SectionHeader, StatCard } from "@/components/gatilho/primitives";
import { statusToast } from "@/components/gatilho/StatusToast";
import { CANONICAL_LABEL } from "@/data/mocks/catalog";
import { formatCurrency } from "@/lib/format";
import { bindShortcut, bindTargetLabel, countOpenSelections, resolveBinds } from "@/lib/selectors";
import { useDashboard } from "@/store/dashboard";
import { Link } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Visão geral ao vivo — GatilhoBR" },
      {
        name: "description",
        content:
          "Painel ao vivo do GatilhoBR: conexões das casas, mercados abertos, binds prontas e stake configurada em uma só tela.",
      },
      { property: "og:title", content: "Visão geral ao vivo — GatilhoBR" },
      {
        property: "og:description",
        content: "Acompanhe conexões, mercados e binds da partida em tempo real.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: OverviewPage,
});

function OverviewPage() {
  const {
    connections,
    events,
    markets,
    binds,
    stake,
    activity,
    favoriteMarketKeys,
    favoritePlayerIds,
    actions,
  } = useDashboard();

  const event =
    events.bet365 ?? events.betfair ?? events.betnacional ?? events.betmgm ?? events.superbet;
  const resolutions = useMemo(
    () => resolveBinds(binds, markets, connections),
    [binds, markets, connections],
  );
  const ready = resolutions.filter((item) => item.availability === "available");
  const openSelections = markets.reduce((total, market) => total + countOpenSelections(market), 0);
  const balance = connections.reduce((sum, item) => sum + (item.balance ?? 0), 0);

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Visão geral"
        description="Estado das casas, volume de linhas abertas e atalhos prontos para a partida."
        actions={
          <Button size="sm" className="h-9" onClick={() => void actions.sync()}>
            Sincronizar
          </Button>
        }
      />

      {event ? <LiveMatchHeader event={event} /> : null}

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Saldo somado"
          value={formatCurrency(balance)}
          hint={`${connections.length} casas monitoradas`}
          icon={<Wifi className="size-4" />}
          tone="ok"
        />
        <StatCard
          label="Seleções abertas"
          value={openSelections}
          hint={`${markets.length} mercados carregados`}
          icon={<Activity className="size-4" />}
          tone="info"
        />
        <StatCard
          label="Binds prontas"
          value={`${ready.length}/${binds.length}`}
          hint="Resolvidas contra as linhas atuais"
          icon={<Keyboard className="size-4" />}
          tone={ready.length === binds.length ? "ok" : "odds"}
        />
        <StatCard
          label="Stake padrão"
          value={formatCurrency(stake.stake)}
          hint={`Limite ${formatCurrency(stake.maxStake)}`}
          icon={<Gauge className="size-4" />}
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-3">
          <section className="rounded-lg border border-border bg-card p-3">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Conexões
            </h2>
            <div className="mt-2 flex flex-wrap gap-2">
              {connections.map((connection) => (
                <ConnectionStatus key={connection.house} status={connection} showBalance />
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-border bg-card p-3">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
              <h2 className="truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Binds prontas para disparo
              </h2>
              <Button variant="ghost" size="sm" className="h-8 shrink-0" asChild>
                <Link to="/binds">Ver central</Link>
              </Button>
            </div>

            {ready.length === 0 ? (
              <EmptyState
                icon={<Keyboard className="size-5" />}
                title="Nenhuma bind disponível agora"
                description="Os mercados alvo estão fechados ou a casa perdeu a conexão."
              />
            ) : (
              <ul className="mt-2 space-y-1.5">
                {ready.slice(0, 5).map(({ bind, selection }) => (
                  <li
                    key={bind.id}
                    className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-2"
                  >
                    <KeyCap value={bindShortcut(bind)} />
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-medium">
                        {bindTargetLabel(bind)}
                      </span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {CANONICAL_LABEL[bind.marketCanonicalKey]} · {selection?.line}
                      </span>
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 shrink-0"
                      onClick={async () => {
                        const result = await actions.testBind(bind);
                        if (result.ok) statusToast.success("Prévia destacada", result.message);
                        else statusToast.blocked(result.message);
                      }}
                    >
                      Testar
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="space-y-3">
          <section className="rounded-lg border border-border bg-card p-3">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Atalhos rápidos
            </h2>
            <div className="mt-2 grid gap-1.5">
              <QuickLink to="/mercados" icon={<Activity className="size-4" />} label="Mercados ao vivo" />
              <QuickLink to="/favoritos" icon={<Star className="size-4" />} label={`Favoritos (${favoriteMarketKeys.length})`} />
              <QuickLink to="/jogadores" icon={<TrendingUp className="size-4" />} label={`Prioritários (${favoritePlayerIds.length})`} />
              <QuickLink to="/stake" icon={<Gauge className="size-4" />} label="Stake e execução" />
            </div>
          </section>
        </div>
      </div>

      <section className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Últimas ações
        </h2>
        <ActivityLog records={activity.slice(0, 8)} />
      </section>
    </div>
  );
}

function QuickLink({
  to,
  icon,
  label,
}: {
  to: string;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <Button variant="outline" size="sm" className="h-9 justify-start gap-2" asChild>
      <Link to={to}>
        {icon}
        <span className="truncate">{label}</span>
      </Link>
    </Button>
  );
}
