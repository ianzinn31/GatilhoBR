import { AlertTriangle, Loader2, PlugZap, ShieldAlert, Wifi, WifiOff } from "lucide-react";

import { cn } from "@/lib/utils";
import { CONNECTION_LABEL, HOUSE_LABEL, formatCurrency } from "@/lib/format";
import type { ConnectionStatus as ConnectionStatusType } from "@/types/gatilho";

const ICONS = {
  connected: Wifi,
  disconnected: WifiOff,
  loading: Loader2,
  incompatible: AlertTriangle,
  expired: ShieldAlert,
} as const;

const TONE = {
  connected: "text-ok border-ok/30 bg-ok/10",
  disconnected: "text-muted-foreground border-border bg-surface",
  loading: "text-info border-info/30 bg-info/10",
  incompatible: "text-odds border-odds/30 bg-odds/10",
  expired: "text-danger border-danger/30 bg-danger/10",
} as const;

export function ConnectionStatus({
  status,
  compact = false,
  showBalance = false,
}: {
  status: ConnectionStatusType;
  compact?: boolean;
  showBalance?: boolean;
}) {
  const Icon = ICONS[status.state] ?? PlugZap;

  return (
    <div
      className={cn(
        "inline-flex min-w-0 items-center gap-2 rounded-md border px-2 py-1",
        TONE[status.state],
      )}
      title={status.detail}
    >
      <Icon className={cn("size-3.5 shrink-0", status.state === "loading" && "animate-spin")} />
      <span className="truncate text-xs font-semibold">{HOUSE_LABEL[status.house]}</span>
      {!compact ? (
        <span className="truncate text-[11px] opacity-80">{CONNECTION_LABEL[status.state]}</span>
      ) : null}
      {showBalance && status.balance !== undefined ? (
        <span className="shrink-0 border-l border-current/20 pl-2 text-[11px] tabular opacity-90">
          {formatCurrency(status.balance)}
        </span>
      ) : null}
    </div>
  );
}
