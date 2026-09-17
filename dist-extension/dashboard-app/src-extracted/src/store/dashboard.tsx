import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";

import { createActions, type Actions } from "@/actions";
import { statusToast } from "@/components/gatilho/StatusToast";
import { extensionBridge } from "@/services/extensionBridge";
import { appReducer, INITIAL_STATE, type AppState } from "@/store/state";
import type { Bind } from "@/types/gatilho";

interface DashboardContextValue extends AppState {
  actions: Actions;
}

const DashboardContext = createContext<DashboardContextValue | null>(null);

export function DashboardProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, INITIAL_STATE);
  const stateRef = useRef(state);
  const mountedAtRef = useRef(Date.now());
  const lastBindDispatchAtRef = useRef(new Map<string, number>());
  stateRef.current = state;

  const actions = useMemo(() => createActions({ dispatch, getState: () => stateRef.current }), []);

  useEffect(() => {
    void actions.load();
  }, [actions]);

  useEffect(() => {
    return extensionBridge.subscribeToMarketUpdates((markets) => {
      actions.applyMarketUpdate(markets);
    });
  }, [actions]);

  useEffect(() => {
    const matchesKeyboardEvent = (bind: Bind, event: KeyboardEvent) => {
      const key = bind.key.trim().toUpperCase();
      const eventKey = event.key.length === 1 ? event.key.toUpperCase() : event.key.toUpperCase();
      const codeKey = event.code.startsWith("Key")
        ? event.code.slice(3)
        : event.code.startsWith("Digit")
          ? event.code.slice(5)
          : event.code.replace(/^Numpad/, "");
      const modifiers = new Set(bind.modifiers ?? []);
      return (
        (key === eventKey || key === codeKey.toUpperCase()) &&
        event.ctrlKey === modifiers.has("ctrl") &&
        event.altKey === modifiers.has("alt") &&
        event.shiftKey === modifiers.has("shift") &&
        !event.metaKey
      );
    };

    const handleBindKeyDown = async (event: KeyboardEvent) => {
      if (
        !event.isTrusted ||
        event.repeat ||
        event.isComposing ||
        event.defaultPrevented ||
        Date.now() - mountedAtRef.current < 1_000
      ) {
        return;
      }

      const target = event.target as HTMLElement | null;
      if (
        target &&
        (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
          target.isContentEditable ||
          target.closest('[role="dialog"], [role="listbox"], [data-radix-popper-content-wrapper]'))
      ) {
        return;
      }

      const matches = stateRef.current.binds
        .filter((bind) => bind.enabled && matchesKeyboardEvent(bind, event))
        .filter(
          (bind, index, list) =>
            list.findIndex((candidate) => candidate.id === bind.id) === index,
        );
      if (matches.length === 0) return;

      const matchesByHouse = new Map<string, Bind[]>();
      matches.forEach((bind) => {
        matchesByHouse.set(bind.houseId, [...(matchesByHouse.get(bind.houseId) ?? []), bind]);
      });
      const selectedMatches: Bind[] = [];
      const ambiguousHouses: string[] = [];

      matchesByHouse.forEach((houseMatches, houseId) => {
        const currentEvent = stateRef.current.events[houseId as Bind["houseId"]];
        const contextualMatches = currentEvent
          ? houseMatches.filter((bind) => {
              if (bind.eventId) return bind.eventId === currentEvent.id;
              return [currentEvent.homeTeamId, currentEvent.awayTeamId].includes(bind.teamId);
            })
          : [];

        if (contextualMatches.length === 1) selectedMatches.push(contextualMatches[0]);
        else if (contextualMatches.length > 1 || houseMatches.length > 1) {
          ambiguousHouses.push(houseId);
        } else if (houseMatches.length === 1) {
          selectedMatches.push(houseMatches[0]);
        }
      });

      event.preventDefault();
      event.stopPropagation();

      if (selectedMatches.length === 0) {
        statusToast.blocked(
          ambiguousHouses.length > 0
            ? `Há mais de uma bind desta tecla na mesma casa (${ambiguousHouses.join(", ")}). Use teclas diferentes ou deixe apenas uma bind nessa casa.`
            : "Nenhuma bind desta tecla corresponde ao jogo atual.",
        );
        return;
      }
      // O bloqueio é por combinação de binds, não global. Assim uma segunda
      // casa pode sair no mesmo pressionamento sem ser descartada por uma
      // ação recente de outra casa.
      const dispatchKey = selectedMatches
        .map((bind) => `${bind.houseId}:${bind.id || bind.key}`)
        .sort()
        .join("|");
      const now = Date.now();
      const lastDispatchAt = lastBindDispatchAtRef.current.get(dispatchKey) ?? 0;
      if (now - lastDispatchAt < 100) return;
      lastBindDispatchAtRef.current.set(dispatchKey, now);

      if (selectedMatches.length > 1 || ambiguousHouses.length > 0) {
        statusToast.info(
          "Binds acionadas",
          `Localizando as selecoes em ${selectedMatches.map((bind) => bind.houseId).join(", ")}...`,
        );
        const results = await actions.executeBindBatch(selectedMatches);
        const successful = results.filter((result) => result.ok).length;
        const failedDetails = results
          .map((result, index) =>
            result.ok
              ? ""
              : `${selectedMatches[index]?.houseId || "casa"}: ${result.message}`,
          )
          .filter(Boolean);
        const ambiguousDetails = ambiguousHouses.length
          ? `Ambígua na mesma casa: ${ambiguousHouses.join(", ")}. Use outra tecla nessa casa.`
          : "";
        if (successful === selectedMatches.length && ambiguousHouses.length === 0) {
          statusToast.success("Binds executadas", `${successful} casa(s) processada(s).`);
        } else if (successful > 0) {
          statusToast.blocked(
            `${successful} casa(s) processada(s). ${[...failedDetails, ambiguousDetails]
              .filter(Boolean)
              .join(" ")}`,
          );
        } else {
          statusToast.blocked(
            [...failedDetails, ambiguousDetails].filter(Boolean).join(" ") ||
              "Nenhuma bind foi executada.",
          );
        }
        return;
      }

      const bind = selectedMatches[0];
      statusToast.info("Bind acionada", "Localizando a seleção na casa…");
      const result = await actions.executeBind(bind);
      if (result.ok) statusToast.success("Bind executada", result.message);
      else statusToast.blocked(result.message);
    };

    window.addEventListener("keydown", handleBindKeyDown, true);
    return () => window.removeEventListener("keydown", handleBindKeyDown, true);
  }, [actions]);

  const value = useMemo(() => ({ ...state, actions }), [state, actions]);

  return <DashboardContext.Provider value={value}>{children}</DashboardContext.Provider>;
}

export function useDashboard() {
  const context = useContext(DashboardContext);
  if (!context) {
    throw new Error("useDashboard precisa estar dentro de DashboardProvider");
  }
  return context;
}
