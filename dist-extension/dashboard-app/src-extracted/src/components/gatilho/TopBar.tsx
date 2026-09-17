import { Link } from "@tanstack/react-router";
import { Bell, ChevronDown, PanelLeft, RefreshCw, Settings, UserRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConnectionStatus } from "@/components/gatilho/ConnectionStatus";
import { LiveDot } from "@/components/gatilho/primitives";
import { formatCurrency, relativeFromNow } from "@/lib/format";
import { teamName } from "@/lib/selectors";
import { useDashboard } from "@/store/dashboard";
import { useAuth } from "@/components/auth/AuthProvider";

export function TopBar({ onToggleSidebar }: { onToggleSidebar: () => void }) {
  const { connections, events, lastSync, loading, actions } = useDashboard();
  const { account, logout } = useAuth();
  const event =
    events.bet365 ?? events.betfair ?? events.betnacional ?? events.betmgm ?? events.superbet;
  const totalBalance = connections.reduce((sum, c) => sum + (c.balance ?? 0), 0);

  return (
    <header className="sticky top-0 z-30 border-b border-primary/15 bg-background/92 shadow-[0_10px_30px_-28px_var(--primary)] backdrop-blur-xl">
      <div className="flex min-w-0 items-center gap-2 px-2 py-2 sm:px-3">
        <Button
          variant="ghost"
          size="icon"
          className="size-8 shrink-0"
          onClick={onToggleSidebar}
          aria-label="Recolher ou expandir a navegação"
        >
          <PanelLeft className="size-4" />
        </Button>

        <div className="flex min-w-0 items-center gap-2">
          <img
            src="./logo-gatilho.png"
            alt="Logo GatilhoBR"
            width={78}
            height={30}
            className="h-[30px] w-[78px] shrink-0 object-contain"
          />
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-danger/30 bg-danger/10 px-2 py-0.5 text-[11px] font-semibold text-danger">
            <LiveDot live={!!event?.live} />
            Ao vivo
          </span>
        </div>

        <div className="hidden min-w-0 items-center gap-1.5 lg:flex">
          {connections.map((connection) => (
            <ConnectionStatus key={connection.house} status={connection} compact />
          ))}
        </div>

        {event ? (
          <div className="hidden min-w-0 items-center gap-2 rounded-md border border-primary/15 bg-surface/85 px-2 py-1 shadow-[inset_0_1px_0_0_color-mix(in_srgb,var(--primary)_8%,transparent)] md:flex">
            <span className="truncate text-xs font-medium">
              {teamName(event.homeTeamId)} <span className="tabular text-odds">{event.score[0]}</span>
              <span className="mx-1 text-muted-foreground">x</span>
              <span className="tabular text-odds">{event.score[1]}</span> {teamName(event.awayTeamId)}
            </span>
            <span className="shrink-0 text-[11px] tabular text-muted-foreground">
              {event.minute}&apos; · {event.period}
            </span>
          </div>
        ) : null}

        <div className="ml-auto flex shrink-0 items-center gap-1">
          <span className="hidden rounded-md border border-primary/15 bg-surface/85 px-2 py-1 text-xs tabular text-muted-foreground xl:inline">
            Saldo{" "}
            <strong className="ml-1 font-semibold text-foreground">
              {formatCurrency(totalBalance)}
            </strong>
          </span>

          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={() => void actions.sync()}
            aria-label="Sincronizar dados"
            title={`Última sincronização ${relativeFromNow(lastSync)}`}
          >
            <RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} />
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="relative size-8" aria-label="Notificações">
                <Bell className="size-4" />
                <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-odds" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              <DropdownMenuLabel>Notificações</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="flex-col items-start gap-0.5">
                <span className="text-xs font-medium">Mercado suspenso</span>
                <span className="text-[11px] text-muted-foreground">
                  Faltas cometidas ficou suspenso na Bet365.
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem className="flex-col items-start gap-0.5">
                <span className="text-xs font-medium">Bind indisponível</span>
                <span className="text-[11px] text-muted-foreground">
                  A tecla G aponta para um mercado fora do ar.
                </span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button variant="ghost" size="icon" className="size-8" asChild aria-label="Configurações">
            <Link to="/configuracoes">
              <Settings className="size-4" />
            </Link>
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 gap-1 px-1.5">
                <span className="grid size-6 place-items-center rounded-full bg-surface-2">
                  <UserRound className="size-3.5" />
                </span>
                <ChevronDown className="size-3 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel className="flex flex-col gap-0.5">
                <span className="truncate text-xs">{account?.email || "Sessão não identificada"}</span>
                <span className="text-[11px] font-normal text-ok">
                  {account?.profile?.status === "active" ? "Licença ativa" : "Consulte sua assinatura"}
                </span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link to="/configuracoes">Preferências</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/historico">Histórico</Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => {
                  void logout();
                }}
              >
                Sair
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
