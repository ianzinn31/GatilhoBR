import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import type { HouseId, MarketStatus } from "@/types/gatilho";
import { HOUSE_LABEL, MARKET_STATUS_LABEL } from "@/lib/format";

export function KeyCap({ value, className }: { value: string; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-7 min-w-7 items-center justify-center rounded-md border border-primary/20 bg-surface-2 px-2",
        "font-mono text-xs font-semibold text-foreground shadow-[inset_0_-2px_0_0_color-mix(in_srgb,var(--primary)_28%,transparent)]",
        className,
      )}
    >
      {value}
    </kbd>
  );
}

export function HouseBadge({ house, className }: { house: HouseId; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-surface/70 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em]",
        house === "bet365" ? "text-ok" : "text-info",
        className,
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          house === "bet365" ? "bg-ok" : "bg-info",
        )}
        aria-hidden
      />
      {HOUSE_LABEL[house]}
    </span>
  );
}

export function MarketStatusPill({ status }: { status: MarketStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.1em]",
        status === "open" && "border-ok/20 bg-ok/10 text-ok",
        status === "suspended" && "border-odds/25 bg-odds/10 text-odds",
        status === "closed" && "border-danger/25 bg-danger/10 text-danger",
      )}
    >
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {MARKET_STATUS_LABEL[status]}
    </span>
  );
}

export function SectionHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 border-l-2 border-primary pl-3 sm:flex sm:flex-wrap sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-primary/80">
          Central de leitura rápida
        </p>
        <h1 className="truncate text-xl font-bold tracking-[-0.03em] text-foreground sm:text-2xl">
          {title}
        </h1>
        {description ? (
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground sm:text-sm">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: "default" | "ok" | "info" | "odds" | "danger";
}) {
  const toneClass = {
    default: "text-foreground",
    ok: "text-ok",
    info: "text-info",
    odds: "text-odds",
    danger: "text-danger",
  }[tone];

  return (
    <div className="rounded-lg border border-border bg-card p-3 shadow-[inset_0_1px_0_0_color-mix(in_srgb,var(--primary)_5%,transparent)] transition-colors hover:border-primary/30">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        {icon ? <span className="shrink-0 text-muted-foreground">{icon}</span> : null}
      </div>
      <div className={cn("mt-1.5 truncate text-lg font-semibold tabular", toneClass)}>{value}</div>
      {hint ? <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-primary/20 bg-surface/55 px-6 py-10 text-center">
      {icon ? <div className="mb-3 text-muted-foreground">{icon}</div> : null}
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description ? (
        <p className="mt-1 max-w-sm text-xs text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function LiveDot({ live }: { live: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex size-2 rounded-full",
        live ? "bg-danger pulse-live" : "bg-muted-foreground",
      )}
      aria-hidden
    />
  );
}
