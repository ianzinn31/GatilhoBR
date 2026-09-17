import { Link, useRouterState } from "@tanstack/react-router";
import {
  Activity,
  CreditCard,
  Gauge,
  Handshake,
  History,
  Keyboard,
  LayoutGrid,
  Settings,
  ShieldCheck,
  Share2,
  Star,
  Users,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { useAuth } from "@/components/auth/AuthProvider";

export const NAV_ITEMS = [
  { to: "/", label: "Visão geral", icon: LayoutGrid },
  { to: "/mercados", label: "Mercados ao vivo", icon: Activity },
  { to: "/favoritos", label: "Favoritos", icon: Star },
  { to: "/jogadores", label: "Jogadores prioritários", icon: Users },
  { to: "/binds", label: "Central de binds", icon: Keyboard },
  { to: "/stake", label: "Stake e execução", icon: Gauge },
  { to: "/presets", label: "Presets", icon: Share2 },
  { to: "/historico", label: "Histórico", icon: History },
  { to: "/afiliados", label: "Afiliados", icon: Handshake },
  { to: "/assinatura", label: "Assinatura", icon: CreditCard },
  { to: "/configuracoes", label: "Configurações", icon: Settings },
] as const;


export function Sidebar({
  collapsed,
  onNavigate,
}: {
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { account } = useAuth();
  const role = String(account?.profile?.role || "");
  const isAdmin = role === "admin" || role === "dev";
  const items = isAdmin
    ? [...NAV_ITEMS, { to: "/admin-afiliados", label: "Admin afiliados", icon: ShieldCheck }]
    : NAV_ITEMS;

  return (
    <nav
      aria-label="Navegação principal"
      className={cn(
        "flex h-full flex-col gap-1 overflow-y-auto scroll-slim border-r border-sidebar-border bg-sidebar/98 p-2 shadow-[10px_0_30px_-28px_var(--primary)]",
        collapsed ? "w-14" : "w-60",
      )}
    >
      <div
        className={cn(
          "mb-1 flex items-center gap-2 px-1 py-2",
          collapsed && "justify-center px-0",
        )}
      >
        <img
          src="./logo-gatilho.png"
          alt="Logo GatilhoBR"
          width={collapsed ? 38 : 112}
          height={36}
          className={cn("h-9 shrink-0 object-contain", collapsed ? "w-9" : "w-28")}
        />
      </div>

      {items.map((item) => {
        const active = pathname === item.to;
        return (
          <Link
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            title={collapsed ? item.label : undefined}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-2.5 rounded-md border border-transparent px-2 py-2 text-[13px] font-medium transition-[color,background-color,border-color,box-shadow]",
              collapsed && "justify-center px-0",
              active
                ? "border-primary/20 bg-primary/10 text-sidebar-accent-foreground shadow-[inset_2px_0_0_0_var(--color-primary)]"
                : "text-muted-foreground hover:border-primary/10 hover:bg-sidebar-accent/70 hover:text-foreground",
            )}
          >
            <item.icon className={cn("size-4 shrink-0", active && "text-primary")} />
            {!collapsed ? <span className="truncate">{item.label}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}
