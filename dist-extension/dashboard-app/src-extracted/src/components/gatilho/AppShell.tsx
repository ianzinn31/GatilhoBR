import { useEffect, useState, type ReactNode } from "react";

import { Sidebar } from "@/components/gatilho/Sidebar";
import { TopBar } from "@/components/gatilho/TopBar";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";

export function AppShell({ children }: { children: ReactNode }) {
  const isMobile = useIsMobile();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (isMobile) setMobileOpen(false);
  }, [isMobile]);

  return (
    <div className="flex min-h-screen w-full flex-col bg-transparent">
      <TopBar onToggleSidebar={() => (isMobile ? setMobileOpen((v) => !v) : setCollapsed((v) => !v))} />

      <div className="flex min-h-0 w-full flex-1">
        {!isMobile ? (
          <aside className="sticky top-[49px] h-[calc(100vh-49px)] shrink-0">
            <Sidebar collapsed={collapsed} />
          </aside>
        ) : null}

        {isMobile && mobileOpen ? (
          <>
            <button
              type="button"
              aria-label="Fechar navegação"
              className="fixed inset-0 z-40 bg-background/70 backdrop-blur-sm"
              onClick={() => setMobileOpen(false)}
            />
            <aside className="fixed left-0 top-[49px] z-50 h-[calc(100vh-49px)]">
              <Sidebar collapsed={false} onNavigate={() => setMobileOpen(false)} />
            </aside>
          </>
        ) : null}

        <main
          className={cn(
            "min-w-0 flex-1 px-3 py-4 sm:px-4 lg:px-6",
            "mx-auto w-full max-w-[1600px]",
          )}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
