import { ConnectionStatus } from "@/components/gatilho/ConnectionStatus";
import { LiveDot } from "@/components/gatilho/primitives";
import { teamName } from "@/lib/selectors";
import { cn } from "@/lib/utils";
import type { ConnectionStatus as ConnectionStatusModel, EventModel } from "@/types/gatilho";

export function LiveMatchHeader({
  event,
  connection,
  className,
}: {
  event: EventModel;
  connection?: ConnectionStatusModel;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "live-match-panel relative overflow-hidden rounded-xl border border-primary/25 bg-card shadow-[0_18px_45px_-36px_color-mix(in_srgb,var(--primary)_75%,transparent)]",
        className,
      )}
    >
      <div className="absolute inset-y-0 left-0 w-1 bg-primary" aria-hidden />

      <div className="relative grid gap-4 px-4 py-3.5 sm:px-5 sm:py-4 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,0.75fr)] lg:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-ok/30 bg-ok/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-ok">
              <LiveDot live={event.live} />
              {event.live ? "Ao vivo" : "Pré-jogo"}
            </span>
            <span className="truncate text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              {event.competition}
            </span>
            <span className="text-[11px] text-muted-foreground">{event.period}</span>
          </div>

          <div className="mt-3 flex min-w-0 items-center gap-3 sm:gap-5">
            <span className="min-w-0 flex-1 truncate text-right text-sm font-semibold sm:text-base">
              {teamName(event.homeTeamId)}
            </span>
            <div className="flex shrink-0 items-center gap-1.5">
              <span className="grid size-9 place-items-center rounded-lg border border-primary/20 bg-surface-2 text-lg font-bold tabular text-primary">
                {event.score[0]}
              </span>
              <span className="text-xs font-bold text-muted-foreground">×</span>
              <span className="grid size-9 place-items-center rounded-lg border border-primary/20 bg-surface-2 text-lg font-bold tabular text-primary">
                {event.score[1]}
              </span>
            </div>
            <span className="min-w-0 flex-1 truncate text-sm font-semibold sm:text-base">
              {teamName(event.awayTeamId)}
            </span>
          </div>
        </div>

        <div className="hidden border-x border-primary/10 px-6 text-center lg:block">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Jogo em andamento
          </p>
          <p className="mt-1 text-xl font-bold tabular text-foreground">
            {event.minute}&apos;
          </p>
        </div>

        <div className="flex items-center justify-between gap-3 lg:justify-end">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Conexão
            </p>
            {connection ? (
              <ConnectionStatus status={connection} compact />
            ) : (
              <span className="mt-1 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="size-1.5 rounded-full bg-muted-foreground" />
                Aguardando casa
              </span>
            )}
          </div>
          <div className="text-right">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Período
            </p>
            <p className="mt-1 text-xs font-semibold text-foreground">{event.period}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
