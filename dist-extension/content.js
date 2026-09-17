(function () {
  'use strict';

  // A aba pode receber uma injeção de recuperação depois do carregamento
  // declarativo. O coletor, o observer e o atalho devem existir uma única vez
  // por documento; repetir este arquivo criaria múltiplos disparos locais.
  if (window.__gbrContentRuntimeBooted === true) return;
  window.__gbrContentRuntimeBooted = true;

  // =========================================================================
  // FAST TRIGGER PRO - ENTRYPOINT PRINCIPAL (SUPORTE MULTI-CASAS & ADAPTERS)
  // =========================================================================

  // Detecta e instancia o adapter correspondente à casa de aposta atual
  const hostname = window.location.hostname;
  let adapter = null;

  const BetfairClass = window.BetfairSportsbookAdapter || (typeof BetfairSportsbookAdapter !== 'undefined' ? BetfairSportsbookAdapter : null);
  const Bet365Class = window.Bet365Adapter || (typeof Bet365Adapter !== 'undefined' ? Bet365Adapter : null);
  const BetnacionalClass = window.BetnacionalAdapter || (typeof BetnacionalAdapter !== 'undefined' ? BetnacionalAdapter : null);
  const BetanoClass = window.BetanoAdapter || (typeof BetanoAdapter !== 'undefined' ? BetanoAdapter : null);
  const BetMgmClass = window.BetMgmAdapter || window.BetMGMAdapter || (typeof BetMgmAdapter !== 'undefined' ? BetMgmAdapter : null);
  const SuperbetClass = window.SuperbetAdapter || (typeof SuperbetAdapter !== 'undefined' ? SuperbetAdapter : null);

  if (BetfairClass && BetfairClass.isMatchingSite(hostname)) {
    adapter = new BetfairClass();
  } else if (Bet365Class && Bet365Class.isMatchingSite(hostname)) {
    adapter = new Bet365Class();
  } else if (BetnacionalClass && BetnacionalClass.isMatchingSite(hostname)) {
    adapter = new BetnacionalClass();
  } else if (BetanoClass && BetanoClass.isMatchingSite(hostname)) {
    adapter = new BetanoClass();
  } else if (BetMgmClass && BetMgmClass.isMatchingSite(hostname)) {
    adapter = new BetMgmClass();
  } else if (SuperbetClass && SuperbetClass.isMatchingSite(hostname)) {
    adapter = new SuperbetClass();
  }

  window.FastTriggerAdapter = adapter;
  if (adapter) {
    console.log(`[Fast Trigger] 🔌 Adapter ativo: ${adapter.siteName} (${hostname})`);
  }

  // Handshake inicial de conexão da casa de aposta com o Service Worker (somente na janela principal)
  const isTopWindow = (window === window.top);
  const isBetfair = hostname.includes('betfair');
  const isBet365 = hostname.includes('bet365');
  const isBetnacional = hostname.includes('betnacional');
  const isBetano = hostname.includes('betano.bet.br');
  const isBetmgm = hostname.includes('betmgm');
  const isSuperbet = hostname.includes('superbet');
  const bet365FrameEvidence = new Map();

  if (isTopWindow && isBet365) {
    window.addEventListener('message', (event) => {
      if (
        event.source === window ||
        !event.data ||
        event.data.type !== 'GBR_BET365_FRAME_SENTINEL' ||
        event.data.schemaVersion !== 1
      ) return;
      if (!String(event.origin || '').toLowerCase().includes('bet365')) return;

      const frameToken = String(event.data.frameToken || '').slice(0, 32);
      if (!frameToken) return;
      bet365FrameEvidence.set(frameToken, {
        origin: String(event.origin || '').slice(0, 160),
        marketNodeCount: Math.max(0, Math.min(500, Number(event.data.marketNodeCount) || 0)),
        lastSeenAt: Number(event.data.seenAt) || Date.now(),
      });
    });
  }

  // Ponte opcional do experimento de rede. O MAIN world só publica um resumo
  // validado; este listener nunca recebe ou encaminha o payload WebSocket cru.
  if (isTopWindow && isBet365) {
    window.addEventListener('message', (event) => {
      if (
        event.source !== window ||
        event.origin !== window.location.origin ||
        event.data?.type !== 'GBR_BET365_WS_OBSERVATION' ||
        event.data?.schemaVersion !== 1
      ) return;

      const observation = event.data.observation;
      if (!observation || typeof observation !== 'object') return;
      const records = Array.isArray(observation.records)
        ? observation.records.slice(0, 32).map((record) => ({
            eventId: String(record?.eventId || '').slice(0, 96),
            marketId: String(record?.marketId || '').slice(0, 96),
            outcomeId: String(record?.outcomeId || '').slice(0, 96),
            odds: Number.isFinite(Number(record?.odds)) ? Number(record.odds) : null,
            suspended: typeof record?.suspended === 'boolean' ? record.suspended : null,
        }))
        : [];

      // Alimenta o índice de identidade do resolvedor com os mesmos registros
      // sanitizados. É a única fonte de `selectionId` na Bet365, e o `receivedAt`
      // do frame é o T0 da telemetria de latência. Nada de payload cru entra aqui.
      try {
        window.FastTriggerSelectionResolver?.observe?.(records, observation.receivedAt);
      } catch (error) {}

      const domOutcomeIds = Array.isArray(window.FastTriggerState?.domOutcomeIds)
        ? window.FastTriggerState.domOutcomeIds.slice(0, 500)
        : [];
      const domOutcomeSet = new Set(domOutcomeIds);
      const networkOutcomeIds = records
        .map((record) => record.outcomeId)
        .filter(Boolean);
      const matchedOutcomeIds = [...new Set(
        networkOutcomeIds.filter((outcomeId) => domOutcomeSet.has(outcomeId)),
      )].slice(0, 32);
      const domSeenAt = Number(window.FastTriggerState?.lastDomSnapshotAt) || null;

      const port = window.FastTriggerState?.livePort;
      if (!port || typeof port.postMessage !== 'function') return;
      try {
        port.postMessage({
          type: 'NETWORK_FEED_OBSERVATION',
          observation: {
            schemaVersion: 1,
            parserVersion: Number(observation.parserVersion) || 1,
            source: 'bet365',
            kind: 'websocket_message',
            networkSeenAt: Number(observation.receivedAt) || Date.now(),
            domSeenAt,
            size: Math.min(Number(observation.size) || 0, 5_000_000),
            parseable: observation.parseable === true,
            records,
            correlation: {
              domOutcomeCount: domOutcomeIds.length,
              networkOutcomeCount: [...new Set(networkOutcomeIds)].length,
              matchedOutcomeCount: matchedOutcomeIds.length,
              matchedOutcomeIds,
            },
          },
        });
      } catch (error) {}
    });
  }

  // Resultado da ordem direta publicado pelo despachante do MAIN world. Este
  // listener é só diagnóstico: telemetria de latência e aviso na tela. Ele nunca
  // autoriza outra ação financeira, e nunca repete uma ordem.
  //
  // A mensagem é dado NÃO confiável: qualquer script da página pode publicá-la.
  // Só vale resultado cujo `actionId` foi gerado pela ponte isolada
  // (`GatilhoBRDirectOrder.wasIssuedHere`) — sucesso inventado pela casa não
  // entra na telemetria nem aparece para o usuário.
  if (isTopWindow && isBet365) {
    window.addEventListener('message', (event) => {
      if (
        event.source !== window ||
        event.origin !== window.location.origin ||
        event.data?.type !== 'GBR_DIRECT_ORDER_RESULT' ||
        event.data?.schemaVersion !== 1
      ) return;

      const raw = event.data.result;
      if (!raw || typeof raw !== 'object') return;

      const actionId = String(raw.actionId || '').slice(0, 128);
      const bridge = window.GatilhoBRDirectOrder;
      if (!actionId || typeof bridge?.wasIssuedHere !== 'function') return;
      if (bridge.wasIssuedHere(actionId) !== true) return;

      const clampNumber = (value, min, max) => {
        const number = Number(value);
        if (!Number.isFinite(number)) return null;
        return Math.max(min, Math.min(max, number));
      };
      const code = String(raw.code || '').slice(0, 32);
      const result = {
        actionId,
        selectionId: String(raw.selectionId || '').slice(0, 96),
        ok: raw.ok === true,
        code,
        // `null` = desconhecido. Quem não sabe se a requisição saiu não repete.
        attempted: raw.attempted === true ? true : raw.attempted === false ? false : null,
        status: clampNumber(raw.status, 0, 599) ?? 0,
        rtt: clampNumber(raw.rtt, 0, 600_000) ?? 0,
        totalMs: clampNumber(raw.totalMs, 0, 600_000) ?? 0,
        stateAgeMs: clampNumber(raw.stateAgeMs, 0, 600_000),
        odds: clampNumber(raw.odds, 0, 1_000_000),
        reportedAt: clampNumber(raw.reportedAt, 0, Number.MAX_SAFE_INTEGER) ?? Date.now(),
      };

      if (window.FastTriggerState) {
        window.FastTriggerState.lastDirectOrderResult = { ...result, at: Date.now() };
      }

      // Relatório de execução da ação em curso, quando houver.
      const executionActionId = window.FastTriggerState?.activeExecutionActionId;
      if (executionActionId && typeof window.FastTriggerExecutionReport?.mark === 'function') {
        try {
          window.FastTriggerExecutionReport.mark(executionActionId, 'result', {
            executionMode: 'DIRECT_NETWORK',
            reasonCode: `direct_${code || 'unknown'}`,
            directOrderAttempted: result.attempted === true,
            currentOdds: result.odds,
            // T2 medido pelo despachante: alimenta o relatório comparativo.
            rttMs: result.rtt,
            totalMs: result.totalMs,
            stateAgeMs: result.stateAgeMs,
          });
        } catch (error) {}
      }

      const port = window.FastTriggerState?.livePort;
      if (port && typeof port.postMessage === 'function') {
        try {
          port.postMessage({
            type: 'DIRECT_ORDER_RESULT',
            result: {
              schemaVersion: 1,
              source: 'bet365',
              actionId: result.actionId,
              selectionId: result.selectionId,
              ok: result.ok,
              code: result.code,
              attempted: result.attempted,
              status: result.status,
              latency: {
                rttMs: result.rtt,
                totalMs: result.totalMs,
                stateAgeMs: result.stateAgeMs,
              },
              odds: result.odds,
              reportedAt: result.reportedAt,
            },
          });
        } catch (error) {}
      }

      if (typeof showFlashFeedback !== 'function') return;
      const describe = window.FastTriggerExecution?.describeCode;
      try {
        if (result.ok) {
          showFlashFeedback(
            `✅ Ordem direta aceita${result.rtt ? ` (${Math.round(result.rtt)}ms)` : ''}`,
          );
        } else if (result.code !== 'dry_run' && typeof describe === 'function') {
          // O ensaio (`dry_run`) fica de fora de propósito: o aviso dele sai do
          // `placeBetEngine`, único ponto com o `bridgeMs` do valor resolvido
          // pela ponte. Avisar aqui também daria dois toasts para a mesma ordem
          // — e o daqui viria sem o tempo medido.
          showFlashFeedback(describe(result));
        }
      } catch (error) {}
    });
  }

  if (isTopWindow && typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
    if (isBetfair) {
      chrome.runtime.sendMessage({ action: 'HOUSE_CONNECTED', house: 'betfair' }).catch(() => {});
    } else if (isBet365) {
      chrome.runtime.sendMessage({ action: 'HOUSE_CONNECTED', house: 'bet365' }).catch(() => {});
    } else if (isBetnacional) {
      chrome.runtime.sendMessage({ action: 'HOUSE_CONNECTED', house: 'betnacional' }).catch(() => {});
    } else if (isBetmgm) {
      chrome.runtime.sendMessage({ action: 'HOUSE_CONNECTED', house: 'betmgm' }).catch(() => {});
    } else if (isBetano) {
      // Betano também precisa anunciar o handshake explicitamente. Sem ele o
      // service worker pode manter a aba sem siteName e aplicar o fallback
      // histórico para Bet365 ao registrar snapshots/estado da conexão.
      chrome.runtime.sendMessage({ action: 'HOUSE_CONNECTED', house: 'betano' }).catch(() => {});
    } else if (isSuperbet) {
      chrome.runtime.sendMessage({ action: 'HOUSE_CONNECTED', house: 'superbet' }).catch(() => {});
    }
  }

  function extractCurrentEventContext() {
    const teams = [];
    const addTeam = (value) => {
      const clean = (value || '').toString().replace(/\s+/g, ' ').trim();
      if (!clean || clean.length < 2 || clean.length > 80) return;
      if (/^(hoje|amanhã|ao vivo|encerrado|\d{1,2}:\d{2}|vs|v|x|resultado final|super placar|criar aposta|dicas de aposta|super odds)$/i.test(clean)) return;
      if (!teams.some(team => team.toLowerCase() === clean.toLowerCase())) teams.push(clean);
    };

    if (isBetfair) {
      try {
        const segments = decodeURIComponent(window.location.pathname).split('/').filter(Boolean);
        const eventIdIndex = segments.findIndex(segment => /^e-\d+/i.test(segment));
        const slug = eventIdIndex > 0 ? segments[eventIdIndex - 1] : '';
        const separator = slug.match(/-x-|–|—|-v-/i)?.[0];
        if (slug && separator) {
          slug.split(separator).slice(0, 2).forEach(teamSlug => {
            const team = teamSlug
              .split('-')
              .filter(Boolean)
              .map(word => word.charAt(0).toUpperCase() + word.slice(1))
              .join(' ');
            addTeam(team);
          });
        }
      } catch (e) {}
    } else if (isBetano) {
      try {
        const segments = decodeURIComponent(window.location.pathname).split('/').filter(Boolean);
        const idIndex = segments.findIndex(s => /^\d{6,}$/.test(s));
        const slug = idIndex > 0 ? segments[idIndex - 1] : (segments[1] || '');
        if (slug && !/^(live|ao-vivo|futebol|sports|jogos)$/i.test(slug)) {
          const sep = slug.match(/-x-|–|—|-v-/i)?.[0];
          if (sep) {
            slug.split(sep).slice(0, 2).forEach(t => {
              addTeam(t.split('-').filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '));
            });
          } else {
            const parts = slug.split('-');
            if (parts.length >= 2) {
              const mid = Math.floor(parts.length / 2);
              addTeam(parts.slice(0, mid).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '));
              addTeam(parts.slice(mid).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '));
            }
          }
        }
      } catch (e) {}
    } else if (isSuperbet) {
      try {
        const path = decodeURIComponent(window.location.pathname);
        const match = path.match(/\/odds\/[^\/]+\/([a-z0-9-]+)-x-([a-z0-9-]+)-\d+/i);
        const formatSlug = (s) => (s || '').split('-').filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        if (match) {
          addTeam(formatSlug(match[1]));
          addTeam(formatSlug(match[2]));
        } else {
          const segments = path.split('/').filter(Boolean);
          for (const seg of segments) {
            if (seg.includes('-x-')) {
              const cleaned = seg.replace(/-\d+$/, '');
              const parts = cleaned.split('-x-');
              if (parts.length === 2) {
                addTeam(formatSlug(parts[0]));
                addTeam(formatSlug(parts[1]));
                break;
              }
            }
          }
        }
      } catch (e) {}
    }

    const teamSelectors = [
      '.sph-EventHeader_Label',
      '.sph-EventHeader_Team',
      '[class*="EventHeader_Team"]',
      '[class*="EventHeader_Label"]',
      '[class*="TeamName"]',
      '[class*="team-name"]',
      ...(isBetano
        ? [
            '[data-qa*="event-participant" i]',
            '[data-qa*="team-name" i]',
            '.event-participants__endpoint-name',
            '[class*="team-name" i]',
            '[class*="participant" i]'
          ]
        : []),
      ...(isBetmgm
        ? [
            '[data-testid*="event-participant" i]',
            '[data-testid*="eventParticipant" i]',
            '[data-testid="participantName"]',
            '[class*="eventParticipant" i]',
            '[class*="participant-name" i]'
          ]
        : []),
      ...(isSuperbet
        ? [
            '.e2e-scoreboard-home-team-name-text',
            '.e2e-scoreboard-away-team-name-text',
            '.scoreboard-teams .team-container:first-child .team-name',
            '.scoreboard-teams .team-container:last-child .team-name',
            '.scoreboard-teams .team-name',
            '.mini-scoreboard .e2e-scoreboard-home-team-name-text',
            '.mini-scoreboard .e2e-scoreboard-away-team-name-text',
            '[class*="event-header__team" i]',
            '[class*="event-head__team" i]',
            '[class*="scoreboard-team" i]',
            '[class*="competitor-name" i]'
          ]
        : [])
    ];

    document.querySelectorAll(teamSelectors.join(',')).forEach(node => {
      if (teams.length >= 4 || !node || (node.offsetWidth === 0 && node.offsetHeight === 0)) return;
      addTeam(node.innerText || node.textContent);
    });

    return {
      teams: teams.slice(0, 4),
      eventLabel: teams.slice(0, 2).join(' x ')
    };
  }

  function fastTriggerEventSlug(value) {
    return (value || '')
      .toString()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  window.FastTriggerGetEventIdentity = function () {
    const context = window.FastTriggerEventContext || extractCurrentEventContext();
    const teams = Array.isArray(context?.teams) ? context.teams : [];
    const label = context?.eventLabel || teams.join(' x ') || 'current-event';
    const siteName = adapter?.siteName ||
      (isBet365 ? 'Bet365' : isBetfair ? 'Betfair' : isBetnacional ? 'Betnacional' : isBetano ? 'Betano' : isSuperbet ? 'Superbet' : 'BetMGM');
    return `${siteName.toLowerCase()}:${fastTriggerEventSlug(label)}`;
  };

  function normalizeBetfairInterestKey(value) {
    if (value === '*') return '*';
    return fastTriggerEventSlug(value);
  }

  function deriveBetfairInterests(storageData = {}) {
    const interests = [];
    const append = (entry) => {
      if (!entry) return;
      const canonicalMarket = normalizeBetfairInterestKey(
        typeof entry === 'string'
          ? entry
          : entry.canonicalMarket || entry.market || entry.title || entry.key,
      );
      if (!canonicalMarket) return;
      interests.push({
        canonicalMarket,
        playerKey: normalizeBetfairInterestKey(entry.playerKey || entry.player || ''),
        option: normalizeBetfairInterestKey(entry.option || entry.selection || ''),
        line: entry.line ?? '',
      });
    };

    (storageData.favoriteMarketsByHouse?.betfair || []).forEach(append);
    (storageData.gbr_priority_market_keys || []).forEach(append);
    (storageData.playerPriorityRules || [])
      .filter((rule) => rule?.house === 'betfair')
      .forEach(append);
    Object.values(storageData.dynamicPlayerBinds || {}).forEach((rawEntry) => {
      (Array.isArray(rawEntry) ? rawEntry : [rawEntry])
        .filter((bind) => bind?.house === 'betfair')
        .forEach(append);
    });
    (window.FastTriggerConfig?.betfairInterests || []).forEach(append);
    (window.FastTriggerState?.betfairInterestsOverride || []).forEach(append);

    const unique = new Map();
    interests.forEach((interest) => {
      const signature = [
        interest.canonicalMarket,
        interest.playerKey,
        interest.option,
        interest.line,
      ].join('|');
      if (!unique.has(signature)) unique.set(signature, interest);
    });
    return [...unique.values()];
  }

  async function refreshBetfairInterests() {
    if (!isBetfair || !window.FastTriggerState) return [];
    const defaults = {
      favoriteMarketsByHouse: { betfair: [] },
      gbr_priority_market_keys: [],
      playerPriorityRules: [],
      dynamicPlayerBinds: {},
    };
    let storageData = defaults;
    try {
      if (typeof window.gbrUserScopedStorage?.get === 'function') {
        storageData = await window.gbrUserScopedStorage.get('local', defaults);
      } else if (chrome?.storage?.local?.get) {
        storageData = await chrome.storage.local.get(defaults);
      }
    } catch (error) {}
    const interests = deriveBetfairInterests(storageData || defaults);
    window.FastTriggerState.betfairInterests = interests;
    window.FastTriggerState.betfairInterestsLoaded = true;
    return interests;
  }

  window.FastTriggerSetBetfairInterests = function (interests) {
    if (!isBetfair || !window.FastTriggerState) return false;
    window.FastTriggerState.betfairInterestsOverride = Array.isArray(interests) ? interests : [];
    void refreshBetfairInterests();
    return true;
  };

  if (isBetfair) {
    void refreshBetfairInterests();
    chrome?.storage?.onChanged?.addListener?.((changes, areaName) => {
      if (areaName !== 'local') return;
      const changedKeys = Object.keys(changes || {});
      if (changedKeys.some((key) =>
        /(?:^|_)(favoriteMarketsByHouse|gbr_priority_market_keys|playerPriorityRules|dynamicPlayerBinds)$/.test(key)
      )) {
        void refreshBetfairInterests();
      }
    });
  }

  function extractOutcomeIds(groups) {
    const ids = new Set();
    const visit = (node, depth = 0) => {
      if (!node || depth > 6 || ids.size >= 500) return;
      if (Array.isArray(node)) {
        node.slice(0, 120).forEach((item) => visit(item, depth + 1));
        return;
      }
      if (typeof node !== 'object') return;

      ['outcomeId', 'selectionId', 'outcome_id', 'selection_id'].forEach((key) => {
        if (node[key] === null || node[key] === undefined) return;
        const id = String(node[key]).trim();
        if (id && id.length <= 96) ids.add(id);
      });

      ['selections', 'participants', 'odds', 'colOdds', 'tableRows', 'rows']
        .forEach((key) => visit(node[key], depth + 1));
    };
    visit(groups);
    return [...ids];
  }

  // Acima deste número de grupos no snapshot a página é considerada "grande"
  // (caso típico da aba "Todos os mercados" varrida na Betfair) e o broadcast
  // reativo passa a respeitar uma janela maior.
  const LARGE_SNAPSHOT_GROUP_COUNT = 24;
  const LARGE_SNAPSHOT_BROADCAST_INTERVAL_MS = 600;
  const HUGE_SNAPSHOT_GROUP_COUNT = 48;
  const HUGE_SNAPSHOT_BROADCAST_INTERVAL_MS = 900;

  function broadcastIntervalForSnapshot(state) {
    if (adapter?.siteName === 'BetMGM') return 180;
    if (adapter?.siteName === 'Betano' || isBetano) return 350;
    const groupCount = Number(state?.lastSnapshotGroupCount) || 0;
    if (groupCount > HUGE_SNAPSHOT_GROUP_COUNT) return HUGE_SNAPSHOT_BROADCAST_INTERVAL_MS;
    if (groupCount > LARGE_SNAPSHOT_GROUP_COUNT) return LARGE_SNAPSHOT_BROADCAST_INTERVAL_MS;
    return 100;
  }

  // Assinatura curta do snapshot para detectar "nada mudou". Serializar o
  // snapshot inteiro com JSON.stringify custava centenas de kB por rodada na aba
  // completa da Betfair — só para descobrir que nada mudou. Aqui percorremos
  // apenas os campos que o painel realmente mostra.
  function buildSnapshotSignature(groups, betslip, eventContext, source) {
    const parts = [source || '', betslip || '', eventContext?.eventLabel || ''];
    const list = Array.isArray(groups) ? groups : [];
    parts.push(String(list.length));
    const cellSignature = (cell) => {
      if (!cell) return '-';
      return `${cell.name || ''}=${cell.val ?? cell.odds ?? ''}:${cell.status || ''}` +
        `${cell.locked === true ? 'L' : ''}${cell.isClosed === true ? '!' : ''}` +
        `@${cell.rowIndex ?? ''}.${cell.colIndex ?? ''}`;
    };
    for (let i = 0; i < list.length; i += 1) {
      const group = list[i];
      if (!group || typeof group !== 'object') continue;
      parts.push(`${group.title || group.marketKey || ''}#${group.status || ''}`);
      const rows = Array.isArray(group.tableRows) ? group.tableRows : Array.isArray(group.rows) ? group.rows : null;
      if (rows) {
        for (let r = 0; r < rows.length; r += 1) {
          const row = rows[r];
          parts.push(row?.lineLabel || '');
          const cells = Array.isArray(row?.colOdds) ? row.colOdds : Array.isArray(row?.odds) ? row.odds : [];
          for (let c = 0; c < cells.length; c += 1) parts.push(cellSignature(cells[c]));
        }
      }
      const participants = Array.isArray(group.participants)
        ? group.participants
        : Array.isArray(group.selections) ? group.selections : [];
      for (let p = 0; p < participants.length; p += 1) parts.push(cellSignature(participants[p]));
    }
    return parts.join('|');
  }

  async function performReactiveBroadcast(options = {}) {
    const state = window.FastTriggerState;
    const force = options.force === true;
    const syncRequestIds = Array.isArray(options.syncRequestIds)
      ? [...new Set(options.syncRequestIds.map((value) => String(value || '').trim()).filter(Boolean))]
      : [];
    let expansionLockHeld = false;
    try {
      let groups;
      let source = 'dom-scan';
      let expansion = null;

      if (isBetfair && typeof adapter?.collectExpandedMarkets === 'function') {
        expansionLockHeld = true;
        state.expansionInFlight = true;
        state.suppressIntermediateBroadcasts = true;
        state.pendingBroadcastAfterExpansion = false;
        if (state.broadcastTimeout) {
          clearTimeout(state.broadcastTimeout);
          state.broadcastTimeout = null;
        }
        const expandedResult = await adapter.collectExpandedMarkets({
          interests: state.betfairInterests || [],
          batchSize: window.FastTriggerConfig?.betfairExpansionBatchSize || 6,
          restoreOriginal: window.FastTriggerConfig?.betfairRestoreCollapsedGroups !== false,
          timeoutMs: window.FastTriggerConfig?.betfairExpansionTimeoutMs || 900,
          // `undefined` mantém a detecção automática da aba "Todos os
          // mercados"; `false` desliga a varredura e volta ao modo por interesse.
          sweepAll: window.FastTriggerConfig?.betfairSweepAllMarkets === false ? false : undefined,
          maxGroups: window.FastTriggerConfig?.betfairSweepMaxGroups,
        });
        groups = Array.isArray(expandedResult?.groups) ? expandedResult.groups : adapter.scrapeClean();
        source = expandedResult?.source || 'dom-scan';
        expansion = {
          mode: expandedResult?.sweepMode === true ? 'sweep-all-markets' : 'expand-needed',
          attemptedGroupCount: Number(expandedResult?.attemptedGroupCount) || 0,
          expandedGroupCount: Number(expandedResult?.expandedGroupCount) || 0,
          failedGroupCount: Number(expandedResult?.failedGroupCount) || 0,
          sweptGroupCount: Number(expandedResult?.sweptGroupCount) || 0,
          sweepRemaining: Number(expandedResult?.sweepRemaining) || 0,
          eventKey: expandedResult?.eventKey || window.FastTriggerGetEventIdentity?.(),
        };
      } else {
        groups = adapter ? adapter.scrapeClean() : (typeof scrapeBet365Clean === 'function' ? scrapeBet365Clean() : []);
      }


      const betslip = (adapter && typeof adapter.scanBetslip === 'function')
        ? adapter.scanBetslip()
        : (typeof scanActiveBetslip === 'function' ? scanActiveBetslip() : '');
      const eventContext = extractCurrentEventContext();
      const capturedAt = Date.now();
      window.FastTriggerEventContext = eventContext;
      state.lastDomSnapshotAt = capturedAt;
      state.lastSnapshotGroupCount = Array.isArray(groups) ? groups.length : 0;
      state.domOutcomeIds = extractOutcomeIds(groups);
      window.FastTriggerMarketIndex?.rebuild?.(groups);
      const frameEvidence = isBet365 && isTopWindow
        ? [...bet365FrameEvidence.entries()]
            .filter(([, evidence]) => capturedAt - evidence.lastSeenAt <= 5000)
            .slice(0, 32)
            .map(([frameToken, evidence]) => ({ frameToken, ...evidence }))
        : [];
      const payloadString = buildSnapshotSignature(groups, betslip, eventContext, source);

      const now = Date.now();
      const isHeartbeatDue = (now - (state.lastBroadcastSentAt || 0)) >= 5000;
      if (!force && payloadString === state.lastStateString && source !== 'expanded-scan' && !isHeartbeatDue) {
        return false;
      }

      state.lastStateString = payloadString;
      state.lastBroadcastSentAt = now;
      state.livePort.postMessage({
        type: 'MARKET_DATA_UPDATE',
        siteName: adapter ? adapter.siteName : 'Bet365',
        groups,
        betslip,
        eventContext,
        capturedAt,
        source,
        expansion,
        frameEvidence,
        forced: force,
        syncRequestIds,
      });
      return true;
    } catch (error) {
      console.warn('[Fast Trigger] Falha ao consolidar snapshot de mercados:', error);
      return false;
    } finally {
      if (expansionLockHeld) {
        state.expansionInFlight = false;
        state.suppressIntermediateBroadcasts = false;
        // Mutações geradas pela abertura/restauração já estão representadas no
        // snapshot final. Não reagendamos broadcasts intermediários.
        state.pendingBroadcastAfterExpansion = false;
      }
    }
  }

  // A leitura de mercado e a execução da bind disputam a mesma thread e a mesma
  // fila serial por evento. Enquanto existe execução em voo, o broadcast reativo
  // é adiado: parsear dezenas de mercados aqui atrasaria o próprio clique.
  function isExecutionInFlight(state) {
    return state?.backgroundDispatchInProgress === true ||
      Number(state?.dynamicBindExecutionsInFlight) > 0;
  }

  function broadcastReactiveState(options = {}) {
    if (
      !isTopWindow ||
      !adapter ||
      !window.FastTriggerState ||
      !window.FastTriggerState.livePort ||
      isExecutionInFlight(window.FastTriggerState)
    ) return Promise.resolve(false);

    const state = window.FastTriggerState;
    if (state.expansionInFlight === true || state.suppressIntermediateBroadcasts === true) {
      state.pendingBroadcastAfterExpansion = true;
      return state.marketBroadcastPromise || Promise.resolve(false);
    }
    if (state.marketBroadcastPromise) {
      return state.marketBroadcastPromise;
    }

    const broadcastPromise = performReactiveBroadcast(options);
    state.marketBroadcastPromise = broadcastPromise;
    return broadcastPromise.finally(() => {
      if (state.marketBroadcastPromise === broadcastPromise) {
        state.marketBroadcastPromise = null;
      }
    });
  }

  // O pedido manual precisa sobreviver a uma coleta/execução já em voo. Antes,
  // o clique apenas zerava a assinatura e chamava `broadcastReactiveState`; se
  // já existisse uma Promise ativa, a chamada era absorvida e nenhum snapshot
  // novo chegava ao painel. A fila abaixo coalesce IDs duplicados, espera a
  // thread ficar livre e força uma leitura que não cai no dedupe de conteúdo.
  function scheduleForcedMarketUpdate(delayMs = 0) {
    const state = window.FastTriggerState;
    if (!state || state.forcedMarketUpdateTimer) return;
    state.forcedMarketUpdateTimer = setTimeout(async () => {
      state.forcedMarketUpdateTimer = null;
      const pending = state.pendingMarketSyncRequestIds;
      if (!(pending instanceof Set) || pending.size === 0) return;
      if (Date.now() > Number(state.forcedMarketUpdateDeadlineAt || 0)) {
        pending.clear();
        return;
      }

      if (
        isExecutionInFlight(state) ||
        state.expansionInFlight === true ||
        state.suppressIntermediateBroadcasts === true ||
        state.marketBroadcastPromise
      ) {
        scheduleForcedMarketUpdate(40);
        return;
      }

      const requestIds = [...pending];
      pending.clear();
      state.lastBroadcastTime = 0;
      const sent = await broadcastReactiveState({
        force: true,
        syncRequestIds: requestIds,
      });
      if (!sent) {
        requestIds.forEach((requestId) => pending.add(requestId));
        scheduleForcedMarketUpdate(80);
      }
    }, Math.max(0, Number(delayMs) || 0));
  }

  window.FastTriggerRequestMarketUpdate = function (requestId) {
    if (!isTopWindow || !window.FastTriggerState) return false;
    const state = window.FastTriggerState;
    if (!(state.pendingMarketSyncRequestIds instanceof Set)) {
      state.pendingMarketSyncRequestIds = new Set();
    }
    const normalizedRequestId = String(requestId || `manual-${Date.now()}`).trim();
    const now = Date.now();
    state.pendingMarketSyncRequestIds.add(normalizedRequestId);
    state.forcedMarketUpdateDeadlineAt = now + 5000;
    scheduleForcedMarketUpdate();
    return true;
  };

  function throttledBroadcast() {
    const now = Date.now();
    const state = window.FastTriggerState;
    if (!state) return;
    if (isExecutionInFlight(state)) return;
    if (state.expansionInFlight === true || state.suppressIntermediateBroadcasts === true) {
      state.pendingBroadcastAfterExpansion = true;
      return;
    }

    // A BetMGM monta muitas ondas de mutações para a mesma atualização visual.
    // O adapter mantém o snapshot e o clique rápido não depende deste broadcast;
    // uma janela ligeiramente maior evita travar a UI sem deixar o painel lento.
    // Na aba "Todos os mercados" da Betfair o snapshot passa de cinquenta grupos
    // abertos com odds ao vivo: manter 100ms ali consumiria a thread principal
    // em releitura de DOM e atrasaria a resolução da bind, que é o que o
    // usuário sente. O painel continua atualizando mais de uma vez por segundo.
    const broadcastInterval = broadcastIntervalForSnapshot(state);
    if (now - state.lastBroadcastTime >= broadcastInterval) {
      state.lastBroadcastTime = now;
      if (state.broadcastTimeout) {
        clearTimeout(state.broadcastTimeout);
        state.broadcastTimeout = null;
      }
      broadcastReactiveState();
    } else if (!state.broadcastTimeout) {
      state.broadcastTimeout = setTimeout(() => {
        state.broadcastTimeout = null;
        if (state.expansionInFlight === true || state.suppressIntermediateBroadcasts === true) {
          state.pendingBroadcastAfterExpansion = true;
          return;
        }
        state.lastBroadcastTime = Date.now();
        broadcastReactiveState();
      }, broadcastInterval - (now - state.lastBroadcastTime));
    }
  }

  // Observer de mutação para reação instantânea no DOM
  const observer = new MutationObserver((mutations) => {
    window.FastTriggerMarketIndex?.invalidateMutations(mutations);
    if (
      window.FastTriggerState?.expansionInFlight === true ||
      window.FastTriggerState?.suppressIntermediateBroadcasts === true
    ) {
      window.FastTriggerState.pendingBroadcastAfterExpansion = true;
      return;
    }
    let hasExternalMutation = false;
    for (let i = 0; i < mutations.length; i++) {
      const target = mutations[i].target;
      if (target && typeof target.id === 'string' && (target.id.includes('fast-trigger') || target.id.includes('low-latency'))) {
        continue;
      }
      // Se for Betano, ignora animações constantes de SVG, match tracker, placar e sidebar
      if (isBetano && target) {
        const tag = target.tagName;
        if (tag === 'SVG' || tag === 'PATH' || tag === 'CANVAS' || tag === 'G' || tag === 'CIRCLE') continue;
        if (typeof target.closest === 'function') {
          if (target.closest('#right-sidebar, aside, [class*="match-tracker" i], [class*="scoreboard" i], [class*="visualizer" i], [class*="pitch" i], svg')) {
            continue;
          }
        }
      }
      hasExternalMutation = true;
      break;
    }

    if (hasExternalMutation) throttledBroadcast();
  });

  observer.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true
  });

  window.FastTriggerContentTesting = Object.freeze({
    deriveBetfairInterests,
    refreshBetfairInterests,
    broadcastReactiveState,
    throttledBroadcast,
    buildSnapshotSignature,
    broadcastIntervalForSnapshot,
    isExecutionInFlight,
  });

  setInterval(throttledBroadcast, 1000);
  setTimeout(throttledBroadcast, 300);

  // Listener de Teclas de Atalho (Hotkey Local)
  document.addEventListener('keydown', (event) => {
    if (
      !isTopWindow ||
      !event.isTrusted ||
      event.repeat ||
      (window.FastTriggerState && window.FastTriggerState.nativeTextEntryInProgress) ||
      (window.FastTriggerState && (Date.now() - window.FastTriggerState.bootedAt) < 2000)
    ) {
      return;
    }

    const activeEl = document.activeElement;
    if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable)) {
      return;
    }

    const triggerKey = window.FastTriggerConfig ? window.FastTriggerConfig.triggerKeyStr : 'Space';

    if (event.code === triggerKey) {
      event.preventDefault();
      const isHotkey = true;
      if (adapter && typeof adapter.triggerPlaceBet === 'function') {
        adapter.triggerPlaceBet(true, isHotkey);
      } else if (typeof executeCachedTrigger === 'function') {
        executeCachedTrigger(isHotkey);
      }
    }
  });

  function playConfirmationBeep() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.1);

      gain.gain.setValueAtTime(0.18, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.12);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.12);
    } catch (e) {}
  }

  function showCrossTabToast(houseName, stakeVal) {
    try {
      playConfirmationBeep();
    } catch (e) {}

    const existingToast = document.getElementById('gbr-cross-tab-toast');
    if (existingToast) existingToast.remove();

    const toast = document.createElement('div');
    toast.id = 'gbr-cross-tab-toast';
    toast.style.cssText = `
      position: fixed;
      top: 16px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 9999999;
      background: #111827;
      border: 1px solid #10B981;
      border-radius: 10px;
      padding: 10px 20px;
      color: #F8FAFC;
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
      font-size: 13px;
      font-weight: 800;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.8), 0 0 20px rgba(16, 185, 129, 0.3);
      display: flex;
      align-items: center;
      gap: 10px;
      pointer-events: none;
      transition: opacity 0.3s ease;
    `;

    const stakeText = stakeVal ? ` (${stakeVal})` : '';
    toast.innerHTML = `<span style="font-size: 16px;">⚡</span> <span>GBR: Aposta confirmada na <b>${houseName}</b>!${stakeText}</span>`;

    (document.body || document.documentElement).appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, 2500);
  }

  // Listener para requisições diretas vindas da Service Worker (background.js)
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request && (request.action === 'FAST_TRIGGER_PING' || request.action === 'PING')) {
        if (sendResponse) sendResponse({ status: 'OK', ready: true });
        return true;
      }

      if (request && request.action === 'REQUEST_MARKET_UPDATE') {
        if (isTopWindow && typeof window.FastTriggerRequestMarketUpdate === 'function') {
          window.FastTriggerRequestMarketUpdate(request.requestId);
          if (sendResponse) sendResponse({ status: 'OK' });
        } else if (sendResponse) {
          sendResponse({ status: 'WAITING' });
        }
        return true;
      }

      if (request && request.action === 'DIRECT_ORDER_AUTO_CONFIGURED') {
        if (typeof showFlashFeedback === 'function') {
          showFlashFeedback('⚡ Aceleração Bet365 configurada automaticamente');
        }
        if (sendResponse) sendResponse({ status: 'OK' });
        return true;
      }

      if (request && (
        request.type === 'SELECT_ODDS' ||
        request.action === 'SELECT_ODDS' ||
        request.type === 'SELECT_ODDS_ACTION'
      )) {
        if (typeof window.dispatchFastTriggerCommand === 'function') {
          window.dispatchFastTriggerCommand(request, window.FastTriggerState?.livePort);
          if (sendResponse) sendResponse({ status: 'OK', handled: true });
          return true;
        }
      }

      if (request && (
        request.action === 'EXECUTE_ONE_SHOT' ||
        request.action === 'TRIGGER_PLACE_BET_NOW' ||
        request.action === 'DISPARAR_APOSTA' ||
        request.type === 'DISPARAR_APOSTA' ||
        request.type === 'EXECUTE_BET'
      )) {
        if (
          typeof window.consumeFastTriggerIntent !== 'function' ||
          !window.consumeFastTriggerIntent(request, 'trigger_bet')
        ) {
          console.warn('[Fast Trigger Safety] Disparo direto bloqueado por falta de intenção válida.');
          if (sendResponse) sendResponse({ status: 'BLOCKED', reason: 'invalid_or_stale_intent' });
          return true;
        }

        console.log(`[Fast Trigger] ⚡ Comando DISPARAR_APOSTA/EXECUTE_ONE_SHOT recebido na aba (${hostname})!`);

        const incomingStake =
          request.stakeVal ||
          request.stake ||
          window.FastTriggerExpectedExecutionStake ||
          (window.FastTriggerConfig ? window.FastTriggerConfig.stakeVal : null) ||
          '0.50';
        if (request.stakeVal || request.stake) {
          window.FastTriggerExpectedExecutionStake = String(request.stakeVal || request.stake);
          if (window.FastTriggerConfig) {
            window.FastTriggerConfig.stakeVal = String(request.stakeVal || request.stake);
          }
        }
        const currentStake = incomingStake;
        const formattedStake = `R$ ${currentStake.toString().replace('.', ',')}`;
        const isHotkey = request.isHotkey !== undefined ? request.isHotkey : true;

        const triggerAction = adapter && typeof adapter.triggerPlaceBet === 'function'
          ? adapter.triggerPlaceBet(true, isHotkey, false, false, null, currentStake)
          : (typeof executeCachedTrigger === 'function' ? executeCachedTrigger(isHotkey) : Promise.resolve(false));

        Promise.resolve(triggerAction).then((clicked) => {
          if (clicked !== false) {
              const houseName = adapter ? adapter.siteName : (hostname.includes('betfair') ? 'Betfair' : (hostname.includes('betnacional') ? 'Betnacional' : (hostname.includes('betmgm') ? 'BetMGM' : (hostname.includes('betano') ? 'Betano' : (hostname.includes('superbet') ? 'Superbet' : 'Bet365')))));
            chrome.runtime.sendMessage({
              action: 'NOTIFY_USER',
              house: houseName,
              stake: formattedStake
            }).catch(() => {});
          }
        });

        if (sendResponse) sendResponse({ status: 'OK', site: adapter ? adapter.siteName : 'Bet365' });
      } else if (request && request.action === 'SHOW_CROSS_TAB_TOAST') {
        showCrossTabToast(request.house, request.stake);
        if (sendResponse) sendResponse({ status: 'OK' });
      }
      return true;
    });
  }

  // Inicialização
  if (typeof connectPort === 'function') connectPort();
  if (typeof loadConfig === 'function') loadConfig();
  if (typeof window.ensureGatilhoBRLicense === 'function') {
    // A licença é aquecida no carregamento da casa; o atalho não precisa
    // esperar rede/storage no instante em que a tecla é pressionada.
    void window.ensureGatilhoBRLicense().catch(() => {});
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    if (typeof applyFloatingButtonState === 'function') applyFloatingButtonState();
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      if (typeof applyFloatingButtonState === 'function') applyFloatingButtonState();
    });
  }

  // Dispara coleta inicial de mercados assim que a página estabilizar
  setTimeout(() => {
    if (typeof broadcastReactiveState === 'function') {
      broadcastReactiveState({ force: true });
    }
  }, 1500);

  setTimeout(() => {
    if (typeof broadcastReactiveState === 'function') {
      broadcastReactiveState({ force: true });
    }
  }, 4000);

  // Heartbeat contínuo de sincronização ativa a cada 2.5s
  // Mantém os mercados e odds permanentemente atualizados em tempo real sem expirar
  setInterval(() => {
    if (!isTopWindow || !window.FastTriggerState) return;
    const state = window.FastTriggerState;
    if (isExecutionInFlight(state)) return;
    if (!state.livePort && typeof connectPort === 'function') {
      connectPort();
    }
    if (typeof broadcastReactiveState === 'function') {
      broadcastReactiveState({ force: false });
    }
  }, 2500);

  // Re-sincroniza instantaneamente quando a janela da casa ganha foco ou volta à visibilidade
  window.addEventListener('focus', () => {
    if (typeof broadcastReactiveState === 'function') {
      broadcastReactiveState({ force: true });
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && typeof broadcastReactiveState === 'function') {
      broadcastReactiveState({ force: true });
    }
  });

})();
