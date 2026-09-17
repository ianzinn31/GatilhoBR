import { extensionBridge } from "@/services/extensionBridge";
import {
  bindShortcut,
  bindTargetLabel,
  canonicalLabel,
  playerName,
  resolveBind,
} from "@/lib/selectors";
import {
  createPriorityPlayerNote,
  priorityHouseFromPlayerId,
  priorityPlayerDisplayName,
  type PlayerPriorityHouse,
  type PriorityPlayerNote,
} from "@/lib/playerPriorities";
import { statusToast } from "@/components/gatilho/StatusToast";
import type { AppAction, AppState } from "@/store/state";
import type {
  ActivityResult,
  Bind,
  GatilhoEventName,
  HouseId,
  MarketCanonicalKey,
  Preferences,
  Preset,
  PresetSection,
  Selection,
  StakeSettings,
  TriggerResult,
} from "@/types/gatilho";

/**
 * Camada central de ações. Toda regra de negócio da interface vive aqui;
 * componentes apenas chamam estas funções e renderizam o resultado.
 */

export interface ActionDeps {
  dispatch: (action: AppAction) => void;
  getState: () => AppState;
}

let sequence = 0;
const nextId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(sequence += 1)}`;

function bindShortcutIdentity(bind: Pick<Bind, "houseId" | "key" | "modifiers">) {
  return [
    bind.houseId,
    bind.key.trim().toUpperCase(),
    [...(bind.modifiers ?? [])].sort().join("+"),
  ].join(":");
}

export function createActions({ dispatch, getState }: ActionDeps) {
  let stakeMutationRevision = 0;
  let playerPriorityMutationRevision = 0;
  let marketPriorityMutationRevision = 0;
  let bindMutationRevision = 0;
  let pendingPlayerPriorityIds: string[] | null = null;
  let pendingPlayerPriorityNotes: PriorityPlayerNote[] | null = null;
  let pendingMarketPriorityKeys: MarketCanonicalKey[] | null = null;
  let playerPriorityPersistQueue: Promise<void> = Promise.resolve();
  let marketPriorityPersistQueue: Promise<void> = Promise.resolve();

  function stakeForHouse(house: HouseId, override?: number) {
    if (override !== undefined && override > 0) return override;
    const configured = getState().stake.stakeByHouse?.[house];
    return configured !== undefined && configured > 0 ? configured : getState().stake.stake;
  }

  /** Estado corrente das prioridades, já considerando gravações em voo. */
  function currentPlayerPriorities() {
    const state = getState();
    return {
      ids: pendingPlayerPriorityIds ?? state.favoritePlayerIds,
      notes: pendingPlayerPriorityNotes ?? state.priorityPlayerNotes,
    };
  }

  /**
   * Grava ids e anotações como uma unidade. A interface é atualizada antes da
   * confirmação e voltada ao estado anterior se a gravação falhar, para que a
   * lista nunca mostre um jogador que a extensão não guardou.
   */
  async function persistPlayerPriorities(
    nextIds: string[],
    nextNotes: PriorityPlayerNote[],
  ): Promise<boolean> {
    const previous = currentPlayerPriorities();
    pendingPlayerPriorityIds = nextIds;
    pendingPlayerPriorityNotes = nextNotes;
    const revision = ++playerPriorityMutationRevision;
    dispatch({ type: "favoritePlayers:set", playerIds: nextIds });
    dispatch({ type: "playerNotes:set", notes: nextNotes });
    const persistence = playerPriorityPersistQueue.then(async () => {
      await extensionBridge.updatePriorityPlayerNotes(nextNotes);
      await extensionBridge.updateFavoritePlayers(nextIds);
    });
    playerPriorityPersistQueue = persistence.catch(() => undefined);
    try {
      await persistence;
      if (playerPriorityMutationRevision === revision) {
        pendingPlayerPriorityIds = null;
        pendingPlayerPriorityNotes = null;
      }
      return true;
    } catch {
      if (playerPriorityMutationRevision === revision) {
        pendingPlayerPriorityIds = previous.ids;
        pendingPlayerPriorityNotes = previous.notes;
        dispatch({ type: "favoritePlayers:set", playerIds: previous.ids });
        dispatch({ type: "playerNotes:set", notes: previous.notes });
      }
      statusToast.blocked("Não foi possível salvar o jogador prioritário.");
      return false;
    }
  }

  /**
   * Caminho do botão do painel. A bind é resolvida na fotografia que está na
   * tela e enviada como `SELECT_ODDS_ACTION` — a mesma mensagem do clique
   * direto na odd, que é a rota mais rápida e a mais precisa porque mira o
   * outcome em vez da posição da linha. Devolve `null` quando o painel não
   * consegue apontar o alvo; aí a resolução no DOM da casa assume.
   */
  async function dispatchBindThroughPanel(bind: Bind): Promise<TriggerResult | null> {
    const state = getState();
    const resolution = resolveBind(bind, state.markets, state.connections);
    if (resolution.availability !== "available" || !resolution.selection) return null;
    const result = await extensionBridge.triggerBet(
      resolution.selection,
      stakeForHouse(bind.houseId, bind.stake),
    );
    return result.ok ? result : null;
  }

  function recordBindDispatch(bind: Bind, result: TriggerResult, viaPanel: boolean) {
    record(
      "bet:triggered",
      result.ok
        ? `Bind ${bindShortcut(bind)} executada`
        : `Bind ${bindShortcut(bind)} não executada`,
      result.ok ? "success" : "blocked",
      {
        house: bind.houseId,
        detail: `${bindTargetLabel(bind)} · ${viaPanel ? "painel" : "casa"} · ${result.message}`,
      },
    );
  }

  function record(
    event: GatilhoEventName,
    label: string,
    result: ActivityResult,
    options: { detail?: string; house?: HouseId } = {},
  ) {
    const activity = {
      id: nextId("act"),
      at: new Date().toISOString(),
      event,
      label,
      result,
      detail: options.detail,
      house: options.house,
    };
    dispatch({
      type: "activity:pushed",
      record: activity,
    });
    void extensionBridge.appendActivity(activity);
  }

  const actions = {
    async load() {
      dispatch({ type: "load:start" });
      try {
        // Entrega o cache local primeiro para o painel ficar utilizável sem
        // aguardar rede, histórico ou sincronização dos mercados.
        const snapshot = await extensionBridge.getSnapshot({ remote: false });
        dispatch({ type: "load:success", snapshot });

        // Preferências e histórico remotos continuam sendo a fonte de
        // sincronização, mas chegam em segundo plano sem travar a abertura.
        const remoteStakeRevision = stakeMutationRevision;
        const remotePlayerPriorityRevision = playerPriorityMutationRevision;
        const remoteMarketPriorityRevision = marketPriorityMutationRevision;
        const remoteBindRevision = bindMutationRevision;
        void extensionBridge
          .getSnapshot({ remote: true })
          .then((remoteSnapshot) => {
            const currentState = getState();
            dispatch({
              type: "load:success",
              snapshot: {
                ...remoteSnapshot,
                stake:
                  stakeMutationRevision === remoteStakeRevision
                    ? remoteSnapshot.stake
                    : currentState.stake,
                favoritePlayerIds:
                  playerPriorityMutationRevision === remotePlayerPriorityRevision
                    ? remoteSnapshot.favoritePlayerIds
                    : currentState.favoritePlayerIds,
                priorityMarketKeys:
                  marketPriorityMutationRevision === remoteMarketPriorityRevision
                    ? remoteSnapshot.priorityMarketKeys
                    : currentState.priorityMarketKeys,
                // A gravação da bind na nuvem é assíncrona. Se o usuário criou
                // ou apagou uma bind enquanto o snapshot remoto estava em voo,
                // a lista local é a mais nova e não pode ser sobrescrita.
                binds:
                  bindMutationRevision === remoteBindRevision
                    ? remoteSnapshot.binds
                    : currentState.binds,
              },
            });
          })
          .catch(() => undefined);
      } catch {
        dispatch({
          type: "load:error",
          message: "Não foi possível ler os dados da extensão. Tente sincronizar novamente.",
        });
      }
    },

    async sync() {
      const result = await extensionBridge.syncMarkets();
      if (result.pendingHouses.length > 0) {
        throw new Error(
          `Sem resposta atual de: ${result.pendingHouses.join(", ")}. Verifique se a página da casa está aberta.`,
        );
      }
      dispatch({ type: "markets:updated", markets: result.markets });
      record("data:synced", "Dados sincronizados com as abas abertas", "info");
      return result;
    },

    applyMarketUpdate(markets: AppState["markets"]) {
      dispatch({ type: "markets:updated", markets });
    },

    selectHouse(house: HouseId) {
      dispatch({ type: "house:selected", house });
      record("house:selected", `Casa ativa alterada`, "info", { house });
    },

    selectOdd(selection: Selection) {
      dispatch({ type: "selection:selected", selectionId: selection.id });
      record("odd:selected", `Seleção marcada · ${selection.playerName}`, "info", {
        detail: `${selection.marketDisplayName} · ${selection.line}`,
        house: selection.house,
      });
    },

    async triggerBet(selection: Selection, stakeOverride?: number): Promise<TriggerResult> {
      const stake = stakeForHouse(selection.house, stakeOverride);
      const result = await extensionBridge.triggerBet(selection, stake);
      record(
        "bet:triggered",
        result.ok ? "Disparo encaminhado" : "Disparo não realizado",
        result.ok ? "success" : selection.status === "open" ? "error" : "blocked",
        {
          house: selection.house,
          detail: `${selection.playerName} · ${selection.marketDisplayName} · ${selection.line} — ${result.message}`,
        },
      );
      return result;
    },

    async testBind(bind: Bind): Promise<TriggerResult> {
      const state = getState();
      const resolution = resolveBind(bind, state.markets, state.connections);
      const result = await extensionBridge.testBind(resolution.selection);
      record(
        "bind:tested",
        `Teste seguro da bind ${bindShortcut(bind)}`,
        result.ok ? "info" : "blocked",
        {
          house: bind.houseId,
          detail: result.ok
            ? `${bindTargetLabel(bind)} · ${canonicalLabel(bind.marketCanonicalKey)} — nenhuma aposta enviada`
            : resolution.reason,
        },
      );
      return result;
    },

    async executeBind(bind: Bind): Promise<TriggerResult> {
      const viaPanel = await dispatchBindThroughPanel(bind);
      const result = viaPanel ?? (await extensionBridge.executeBind(bind));
      recordBindDispatch(bind, result, viaPanel !== null);
      return result;
    },

    async executeBindBatch(binds: Bind[]): Promise<TriggerResult[]> {
      const panelResults = await Promise.all(
        binds.map((bind) => dispatchBindThroughPanel(bind)),
      );
      const fallbackIndexes = panelResults
        .map((result, index) => (result === null ? index : -1))
        .filter((index) => index >= 0);

      const results = [...panelResults];
      if (fallbackIndexes.length > 0) {
        const fallback = await extensionBridge.executeBindBatch(
          fallbackIndexes.map((index) => binds[index]),
        );
        fallbackIndexes.forEach((index, position) => {
          results[index] = fallback[position] ?? {
            ok: false,
            message: "A casa não confirmou a execução da bind.",
          };
        });
      }

      return results.map((result, index) => {
        const settled = result ?? {
          ok: false,
          message: "A casa não confirmou a execução da bind.",
        };
        const bind = binds[index];
        if (bind) recordBindDispatch(bind, settled, panelResults[index] !== null);
        return settled;
      });
    },

    async saveBind(draft: Omit<Bind, "id"> & { id?: string }) {
      const normalizedKey = String(draft.key || "").trim().toUpperCase();
      if (!/^[A-Z0-9]$/.test(normalizedKey)) {
        throw new Error("Defina uma letra ou número para a bind.");
      }
      const bind = {
        ...draft,
        key: normalizedKey,
        id: draft.id ?? nextId("bind"),
      } as Bind;
      const replaced = getState().binds.filter(
        (item) =>
          item.id !== bind.id &&
          bindShortcutIdentity(item) === bindShortcutIdentity(bind),
      );

      // O storage também recebe a regra de substituição, evitando que uma
      // bind antiga permaneça escondida no array legado da mesma tecla.
      bindMutationRevision += 1;
      await extensionBridge.saveBind(bind, true);
      replaced.forEach((item) => dispatch({ type: "bind:deleted", id: item.id }));
      dispatch({ type: draft.id ? "bind:updated" : "bind:added", bind } as AppAction);
      record(
        draft.id ? "bind:updated" : "bind:saved",
        replaced.length > 0
          ? `Bind ${bindShortcut(bind)} substituída`
          : draft.id
            ? `Bind ${bindShortcut(bind)} atualizada`
            : `Bind ${bindShortcut(bind)} criada`,
        "success",
        {
        house: bind.houseId,
        detail: `${bindTargetLabel(bind)} · ${canonicalLabel(bind.marketCanonicalKey)}`,
        },
      );
      return { bind, replaced: replaced.length };
    },

    async duplicateBind(bind: Bind) {
      const copy: Bind = { ...bind, id: nextId("bind"), key: "", enabled: false };
      bindMutationRevision += 1;
      await extensionBridge.saveBind(copy);
      dispatch({ type: "bind:added", bind: copy });
      record("bind:duplicated", `Bind duplicada a partir de ${bindShortcut(bind)}`, "info", {
        house: bind.houseId,
      });
      return copy;
    },

    async deleteBind(bind: Bind) {
      bindMutationRevision += 1;
      await extensionBridge.deleteBind(bind.id);
      dispatch({ type: "bind:deleted", id: bind.id });
      record("bind:deleted", `Bind ${bindShortcut(bind)} removida`, "info", {
        house: bind.houseId,
      });
    },

    async toggleBindEnabled(bind: Bind) {
      const next = { ...bind, enabled: !bind.enabled };
      bindMutationRevision += 1;
      await extensionBridge.updateBind(next);
      dispatch({ type: "bind:updated", bind: next });
    },

    async updateStake(stake: StakeSettings) {
      const revision = ++stakeMutationRevision;
      const optimisticStake: StakeSettings = {
        ...stake,
        stakeByHouse: { ...(stake.stakeByHouse ?? {}) },
        quickValues: [...stake.quickValues],
      };
      // Atualiza a fonte usada pelas rotas antes de aguardar abas e nuvem.
      // Assim, desmontar o formulário não restaura o valor anterior.
      dispatch({ type: "stake:updated", stake: optimisticStake });
      const persistedStake = await extensionBridge.updateStake(optimisticStake);
      if (stakeMutationRevision === revision) {
        dispatch({ type: "stake:updated", stake: persistedStake });
      }
      record("stake:updated", "Configuração de stake atualizada", "info", {
        detail: `Stake padrão R$ ${persistedStake.stake.toFixed(2)} · limite R$ ${persistedStake.maxStake.toFixed(2)}`,
      });
      return persistedStake;
    },

    async updatePreferences(preferences: Preferences) {
      await extensionBridge.updatePreferences(preferences);
      dispatch({ type: "preferences:updated", preferences });
      record("preferences:updated", "Preferências atualizadas", "info");
    },

    async toggleFavoriteMarket(key: MarketCanonicalKey) {
      const current = getState().favoriteMarketKeys;
      await extensionBridge.updateFavoriteMarkets(
        current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
      );
      dispatch({ type: "favoriteMarket:toggled", key });
      record("favorite:market:toggled", `Favoritos: ${canonicalLabel(key)}`, "info");
    },

    async togglePriorityMarket(key: MarketCanonicalKey) {
      const current = pendingMarketPriorityKeys ?? getState().priorityMarketKeys;
      const next = current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key];
      pendingMarketPriorityKeys = next;
      const revision = ++marketPriorityMutationRevision;
      dispatch({ type: "priorityMarket:toggled", key });
      const persistence = marketPriorityPersistQueue.then(() =>
        extensionBridge.updatePriorityMarkets(next)
      );
      marketPriorityPersistQueue = persistence.catch(() => undefined);
      try {
        await persistence;
        if (marketPriorityMutationRevision === revision) {
          pendingMarketPriorityKeys = null;
        }
      } catch {
        if (marketPriorityMutationRevision === revision) {
          pendingMarketPriorityKeys = current;
          dispatch({ type: "priorityMarket:toggled", key });
        }
        statusToast.blocked("Não foi possível salvar a cobertura da Betfair.");
        return;
      }
      record("priority:market:toggled", `Prioridade: ${canonicalLabel(key)}`, "info");
    },

    /**
     * Estrela do painel. O nome publicado pela casa é anotado junto: sem isso o
     * jogador salvo aparece como slug quando o evento sai do ar.
     */
    async toggleFavoritePlayer(playerId: string, liveName?: string) {
      const current = currentPlayerPriorities();
      const removing = current.ids.includes(playerId);
      const nextIds = removing
        ? current.ids.filter((item) => item !== playerId)
        : [...current.ids, playerId];
      const house = priorityHouseFromPlayerId(playerId);
      const note = removing || !house ? null : createPriorityPlayerNote(house, liveName);
      const nextNotes = removing
        ? current.notes.filter((item) => item.id !== playerId)
        : // O id da anotação é derivado do nome; se divergir do id da linha, a
          // recarga recalcularia outro id e a anotação viraria um fantasma.
          note && note.id === playerId && !current.notes.some((item) => item.id === note.id)
          ? [...current.notes, note]
          : current.notes;
      if (!(await persistPlayerPriorities(nextIds, nextNotes))) return;
      record("favorite:player:toggled", `Jogador prioritário: ${playerName(playerId)}`, "info");
    },

    /** Jogador digitado pelo usuário, mesmo que não esteja no evento aberto. */
    async addPriorityPlayer(house: PlayerPriorityHouse, name: string) {
      const note = createPriorityPlayerNote(house, name);
      if (!note) {
        statusToast.blocked("Informe o nome do jogador como a casa publica, sem números.");
        return false;
      }
      const current = currentPlayerPriorities();
      if (current.notes.some((item) => item.id === note.id)) {
        statusToast.info("Jogador já salvo", note.name);
        return false;
      }
      const nextIds = current.ids.includes(note.id) ? current.ids : [...current.ids, note.id];
      if (!(await persistPlayerPriorities(nextIds, [...current.notes, note]))) return false;
      record("favorite:player:toggled", `Jogador salvo: ${note.name}`, "success", {
        house,
      });
      return true;
    },

    async removePriorityPlayer(playerId: string) {
      const current = currentPlayerPriorities();
      const label = priorityPlayerDisplayName(playerId, current.notes);
      const nextIds = current.ids.filter((item) => item !== playerId);
      const nextNotes = current.notes.filter((item) => item.id !== playerId);
      if (!(await persistPlayerPriorities(nextIds, nextNotes))) return;
      record("favorite:player:toggled", `Jogador removido: ${label}`, "info");
    },

    async exportPreset(name: string, sections: PresetSection[]) {
      const state = getState();
      const full = {
        favoriteMarketKeys: state.favoriteMarketKeys,
        priorityMarketKeys: state.priorityMarketKeys,
        favoritePlayerIds: state.favoritePlayerIds,
        binds: state.binds,
        stake: state.stake,
        preferences: state.preferences,
      };
      const payload = Object.fromEntries(
        sections.map((section) => [section, full[section]]),
      ) as unknown as Preset["payload"];
      const preset: Preset = { name, createdAt: new Date().toISOString(), version: 1, payload };
      const code = await extensionBridge.exportPreset(preset);
      record("preset:exported", `Preset "${name}" exportado`, "success", {
        detail: `${sections.length} seções incluídas`,
      });
      return code;
    },

    async importPreset(code: string, sections: PresetSection[]) {
      const partial = await extensionBridge.importPreset(code, sections);
      await extensionBridge.applyPreset(partial);
      const patch: Partial<AppState> = {};
      if (partial.favoriteMarketKeys) patch.favoriteMarketKeys = partial.favoriteMarketKeys;
      if (partial.priorityMarketKeys) patch.priorityMarketKeys = partial.priorityMarketKeys;
      if (partial.favoritePlayerIds) patch.favoritePlayerIds = partial.favoritePlayerIds;
      if (partial.binds) patch.binds = partial.binds;
      if (partial.stake) patch.stake = partial.stake;
      if (partial.preferences) patch.preferences = partial.preferences;
      dispatch({ type: "preset:applied", patch });
      record("preset:imported", "Preset importado", "success", {
        detail: `Seções aplicadas: ${Object.keys(patch).length}`,
      });
      return patch;
    },
  };

  return actions;
}

export type Actions = ReturnType<typeof createActions>;
