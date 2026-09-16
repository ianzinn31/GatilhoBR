import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, Info, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState, HouseBadge } from "@/components/gatilho/primitives";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ActivityRecord, ActivityResult } from "@/types/gatilho";

const RESULT_META: Record<
  ActivityResult,
  { label: string; className: string; icon: typeof CheckCircle2 }
> = {
  success: { label: "Sucesso", className: "text-ok", icon: CheckCircle2 },
  blocked: { label: "Bloqueado", className: "text-odds", icon: AlertTriangle },
  error: { label: "Erro", className: "text-danger", icon: XCircle },
  info: { label: "Info", className: "text-info", icon: Info },
};

function toCsv(records: ActivityRecord[]) {
  const header = "data,evento,casa,titulo,detalhe,resultado";
  const rows = records.map((record) =>
    [
      record.at,
      record.event,
      record.house ?? "",
      record.label,
      record.detail ?? "",
      record.result,
    ]
      .map((value) => `"${String(value).replace(/"/g, '""')}"`)
      .join(","),
  );
  return [header, ...rows].join("\n");
}

export function ActivityLog({ records }: { records: ActivityRecord[] }) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<ActivityResult | "all">("all");

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    return records
      .filter((record) => (result === "all" ? true : record.result === result))
      .filter((record) =>
        !term
          ? true
          : `${record.label} ${record.detail ?? ""} ${record.event}`.toLowerCase().includes(term),
      );
  }, [records, query, result]);

  function download() {
    const blob = new Blob([toCsv(visible)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "gatilhobr-historico.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 sm:flex sm:flex-wrap">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar por ação, jogador ou mercado"
          className="h-9 min-w-0 sm:max-w-xs"
        />
        <div className="flex shrink-0 items-center gap-2">
          <Select value={result} onValueChange={(value) => setResult(value as ActivityResult | "all")}>
            <SelectTrigger className="h-9 w-[140px]">
              <SelectValue placeholder="Resultado" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="success">Sucesso</SelectItem>
              <SelectItem value="blocked">Bloqueado</SelectItem>
              <SelectItem value="error">Erro</SelectItem>
              <SelectItem value="info">Info</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={download}>
            <Download className="size-3.5" />
            CSV
          </Button>
        </div>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          title="Nenhum registro encontrado"
          description="Ajuste a busca ou o filtro de resultado para ver o histórico."
        />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
          {visible.map((record) => {
            const meta = RESULT_META[record.result];
            const Icon = meta.icon;
            return (
              <li key={record.id} className="flex min-w-0 items-start gap-3 px-3 py-2.5">
                <Icon className={cn("mt-0.5 size-4 shrink-0", meta.className)} />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="truncate text-[13px] font-medium">{record.label}</span>
                    {record.house ? <HouseBadge house={record.house} /> : null}
                  </div>
                  {record.detail ? (
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{record.detail}</p>
                  ) : null}
                </div>
                <span className="shrink-0 text-[11px] tabular text-muted-foreground">
                  {formatDateTime(record.at)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
