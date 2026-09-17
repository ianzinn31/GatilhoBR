import { useState, type ReactNode } from "react";
import { Check, Copy, FlaskConical, Share2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { affiliateBridge, copyText } from "@/services/affiliateBridge";

export type Tone = "default" | "ok" | "info" | "odds" | "danger";

const TONE_CLASS: Record<Tone, string> = {
  default: "bg-muted/40 text-muted-foreground",
  ok: "bg-ok/12 text-ok",
  info: "bg-info/12 text-info",
  odds: "bg-odds/12 text-odds",
  danger: "bg-danger/12 text-danger",
};

export function StatusPill({
  label,
  tone = "default",
  className,
}: {
  label: string;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-semibold",
        TONE_CLASS[tone],
        className,
      )}
    >
      {label}
    </span>
  );
}

/** Aviso obrigatório: nada aqui é métrica real. */
export function DemoDataBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border border-dashed border-odds/50 bg-odds/10 px-2 py-0.5 text-[11px] font-semibold text-odds",
        className,
      )}
    >
      <FlaskConical className="size-3" aria-hidden />
      Dados de demonstração
    </span>
  );
}

/** QR ilustrativo. A geração real virá do backend junto com o link assinado. */
export function PseudoQrCode({ value, size = 132 }: { value: string; size?: number }) {
  const cells = 21;
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) % 100000;
  }
  return (
    <div
      role="img"
      aria-label={`QR Code de demonstração para ${value}`}
      className="grid gap-px rounded-md bg-foreground p-2"
      style={{
        width: size,
        height: size,
        gridTemplateColumns: `repeat(${cells}, minmax(0, 1fr))`,
      }}
    >
      {Array.from({ length: cells * cells }).map((_, i) => {
        const row = Math.floor(i / cells);
        const col = i % cells;
        const isFinder =
          ((row < 7 && col < 7) || (row < 7 && col > cells - 8) || (row > cells - 8 && col < 7)) &&
          !(
            (row > 1 && row < 5 && col > 1 && col < 5) ||
            (row > 1 && row < 5 && col > cells - 6 && col < cells - 2) ||
            (row > cells - 6 && row < cells - 2 && col > 1 && col < 5)
          ) &&
          !(
            (row === 5 && col < 7) ||
            (col === 5 && row < 7) ||
            (row === 5 && col > cells - 8) ||
            (col === cells - 6 && row < 7) ||
            (row === cells - 6 && col < 7) ||
            (col === 5 && row > cells - 8)
          );
        const on = isFinder || (hash + row * 7 + col * 13 + row * col) % 3 === 0;
        return (
          <span key={i} className={cn("rounded-[0.5px]", on ? "bg-foreground" : "bg-background")} />
        );
      })}
    </div>
  );
}

export function CopyButton({
  value,
  label = "Copiar link",
  size = "sm",
  variant = "outline",
  className,
  iconOnly,
}: {
  value: string;
  label?: string;
  size?: "sm" | "default" | "icon";
  variant?: "outline" | "default" | "ghost" | "secondary";
  className?: string;
  iconOnly?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    const ok = await copyText(value);
    if (!ok) {
      toast.error("Não foi possível copiar", {
        description: "Selecione o texto e copie manualmente.",
      });
      return;
    }
    setCopied(true);
    toast.success("Copiado para a área de transferência");
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Button
      type="button"
      size={iconOnly ? "icon" : size}
      variant={variant}
      className={className}
      onClick={() => void handleCopy()}
      aria-label={iconOnly ? label : undefined}
    >
      {copied ? <Check className="size-4 text-ok" /> : <Copy className="size-4" />}
      {iconOnly ? null : <span>{copied ? "Copiado!" : label}</span>}
    </Button>
  );
}

const SHARE_CHANNELS = [
  { key: "whatsapp", label: "WhatsApp" },
  { key: "telegram", label: "Telegram" },
  { key: "x", label: "X" },
  { key: "facebook", label: "Facebook" },
] as const;

export function ShareMenu({
  linkId,
  url,
  message,
  trigger,
}: {
  linkId: string;
  url: string;
  message: string;
  trigger?: ReactNode;
}) {
  async function share(channel: "native" | "copy" | (typeof SHARE_CHANNELS)[number]["key"]) {
    const result = await affiliateBridge.shareReferralLink(linkId, channel, message);
    if (channel === "copy") {
      toast[result.shared ? "success" : "error"](
        result.shared ? "Mensagem copiada" : "Não foi possível copiar",
      );
      return;
    }
    if (!result.shared && result.fallbackUrl) {
      const ok = await copyText(result.fallbackUrl);
      toast.info("Compartilhamento nativo indisponível", {
        description: ok ? "O link foi copiado como alternativa." : result.fallbackUrl,
      });
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {trigger ?? (
          <Button type="button" size="sm" variant="outline">
            <Share2 className="size-4" />
            Compartilhar
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-xs">Compartilhar link</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => void share("native")}>
          Compartilhar pelo dispositivo
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {SHARE_CHANNELS.map((channel) => (
          <DropdownMenuItem key={channel.key} onSelect={() => void share(channel.key)}>
            {channel.label}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() =>
            void copyText(url).then((ok) =>
              toast[ok ? "success" : "error"](ok ? "Link copiado" : "Não foi possível copiar"),
            )
          }
        >
          Copiar link
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void share("copy")}>
          Copiar mensagem completa
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function PanelCard({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-xl border border-border bg-card p-4", className)}>
      <header className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          {description ? (
            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
      </header>
      {children}
    </section>
  );
}

export function LoadingRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-busy>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-10 animate-pulse rounded-md bg-surface-2/70" />
      ))}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-lg border border-danger/40 bg-danger/8 p-4 text-center">
      <p className="text-sm font-medium text-danger">{message}</p>
      {onRetry ? (
        <Button className="mt-3" size="sm" variant="outline" onClick={onRetry}>
          Tentar novamente
        </Button>
      ) : null}
    </div>
  );
}
