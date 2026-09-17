// =========================================================================
// GATILHOBR - RELATÓRIO DE EXECUÇÃO POR ACTION ID
// =========================================================================

(function () {
  "use strict";

  if (typeof window === "undefined") return;

  const MAX_LOCAL_REPORTS = 100;
  const STAGE_TIMESTAMP_KEYS = {
    intent: "intentAt",
    route: "routedAt",
    target: "targetReadyAt",
    selection: "selectionReadyAt",
    stake: "stakeReadyAt",
    cta: "ctaReadyAt",
    odds_change: "oddsChangeAt",
    commit: "commitSentAt",
    result: "resultAt",
  };
  const STAGE_ORDER = {
    intent: 0,
    route: 1,
    target: 2,
    selection: 3,
    stake: 4,
    odds_change: 5,
    cta: 6,
    commit: 7,
    result: 8,
  };

  const reports = new Map();

  function safeString(value, maxLength = 80) {
    return typeof value === "string" ? value.slice(0, maxLength) : "";
  }

  function safeNumber(value) {
    return Number.isFinite(Number(value)) ? Number(value) : null;
  }

  function getActionId(actionId) {
    const value = safeString(actionId, 160);
    return value || safeString(window.FastTriggerState?.activeExecutionActionId, 160);
  }

  function currentHouse() {
    const host = window.location?.hostname?.toLowerCase() || "";
    if (host.includes("bet365")) return "bet365";
    if (host.includes("betfair")) return "betfair";
    if (host.includes("betnacional")) return "betnacional";
    if (host.includes("betmgm")) return "betmgm";
    return "";
  }

  function cloneReport(report) {
    return JSON.parse(JSON.stringify(report));
  }

  function stageRank(stage) {
    return Object.prototype.hasOwnProperty.call(STAGE_ORDER, stage)
      ? STAGE_ORDER[stage]
      : -1;
  }

  function advanceStage(report, requestedStage) {
    const normalizedStage = safeString(requestedStage, 24) || report.stage;
    if (stageRank(normalizedStage) >= stageRank(report.stage)) {
      report.stage = normalizedStage;
    }
    return report.stage;
  }

  // Campos que descrevem COMO a ação foi executada e quanto tempo cada trecho
  // levou. Ficam fora de `mark`/`finish` porque os dois estágios os recebem.
  function applyExecutionDetails(report, details) {
    if (details.executionMode) {
      const mode = safeString(details.executionMode, 24);
      // Ordem direta que cai para o DOM produz DOIS modos na mesma ação. O
      // relatório precisa saber: os T1/T2 dela não descrevem um caminho só,
      // então ela sai das duas médias e é contada como híbrida.
      if (report.executionMode && report.executionMode !== mode) {
        report.executionModeChanged = true;
      }
      report.executionMode = mode;
    }
    if (details.selectionSource) {
      report.selectionSource = safeString(details.selectionSource, 40);
    }
    // T0 nunca é reescrito: o primeiro frame conhecido é o que vale.
    if (details.frameSeenAt !== undefined && !report.timestamps.frameSeenAt) {
      report.timestamps.frameSeenAt = safeNumber(details.frameSeenAt);
    }
    const rttMs = safeNumber(details.rttMs);
    if (rttMs !== null) report.latency.rttMs = rttMs;
    const totalMs = safeNumber(details.totalMs);
    if (totalMs !== null) report.latency.totalMs = totalMs;
    const stateAgeMs = safeNumber(details.stateAgeMs);
    if (stateAgeMs !== null) report.latency.stateAgeMs = stateAgeMs;
  }

  function emit(report) {
    const port = window.FastTriggerState?.livePort;
    if (!port || !report?.actionId) return;

    try {
      port.postMessage({
        type: "EXECUTION_REPORT",
        report: cloneReport(report),
      });
    } catch (error) {}
  }

  function ensure(actionId, initial = {}) {
    const id = getActionId(actionId);
    if (!id) return null;

    let report = reports.get(id);
    if (!report) {
      report = {
        schemaVersion: 1,
        actionId: id,
        house: safeString(initial.house, 32) || currentHouse(),
        keyCode: safeString(initial.keyCode, 32),
        intentSource: safeString(initial.intentSource, 32),
        intentType: safeString(initial.intentType, 32),
        oddsChange: {
          policy: "",
          decision: "",
          expectedOdds: null,
          currentOdds: null,
        },
        stage: "intent",
        outcome: "pending",
        reasonCode: "",
        clickAttempted: false,
        // Caminho realmente usado nesta ação. Sem este campo o relatório
        // comparativo não sabe separar ordem direta de clique no DOM.
        executionMode: "",
        executionModeChanged: false,
        selectionSource: "",
        latency: {
          rttMs: null,
          totalMs: null,
          stateAgeMs: null,
        },
        marketIndex: {
          hit: false,
          miss: false,
        },
        timestamps: {
          // T0: chegada do frame de WebSocket que descreve a seleção.
          frameSeenAt: null,
          intentAt: safeNumber(initial.intentAt || initial.issuedAt) || Date.now(),
          routedAt: safeNumber(initial.routedAt),
          targetReadyAt: null,
          selectionReadyAt: null,
          stakeReadyAt: null,
          ctaReadyAt: null,
          oddsChangeAt: null,
          // T1: instante em que a ordem saiu (ponte) ou o clique foi entregue.
          commitSentAt: null,
          // T2: conclusão — resposta da casa no caminho direto.
          resultAt: null,
        },
        updatedAt: Date.now(),
      };
      reports.set(id, report);
    } else {
      report.marketIndex = report.marketIndex || { hit: false, miss: false };
      report.latency = report.latency || { rttMs: null, totalMs: null, stateAgeMs: null };
      if (typeof report.executionModeChanged !== "boolean") {
        report.executionModeChanged = false;
      }
      if (initial.house && !report.house) report.house = safeString(initial.house, 32);
      if (initial.keyCode && !report.keyCode) report.keyCode = safeString(initial.keyCode, 32);
      if (initial.intentSource && !report.intentSource) {
        report.intentSource = safeString(initial.intentSource, 32);
      }
      if (initial.intentType && !report.intentType) {
        report.intentType = safeString(initial.intentType, 32);
      }
      if (initial.routedAt && !report.timestamps.routedAt) {
        report.timestamps.routedAt = safeNumber(initial.routedAt);
      }
    }

    while (reports.size > MAX_LOCAL_REPORTS) {
      reports.delete(reports.keys().next().value);
    }
    return report;
  }

  function start(actionId, initial = {}) {
    const report = ensure(actionId, initial);
    if (!report) return null;
    advanceStage(report, "intent");
    if (!report.outcome || report.outcome === "pending") report.outcome = "pending";
    report.updatedAt = Date.now();
    emit(report);
    return cloneReport(report);
  }

  function mark(actionId, stage, details = {}) {
    const report = ensure(actionId, details);
    if (!report) return null;
    report.oddsChange = report.oddsChange || {
      policy: "",
      decision: "",
      expectedOdds: null,
      currentOdds: null,
    };

    const normalizedStage = safeString(stage, 24) || report.stage;
    advanceStage(report, normalizedStage);
    const timestampKey = STAGE_TIMESTAMP_KEYS[normalizedStage];
    if (timestampKey && !report.timestamps[timestampKey]) {
      report.timestamps[timestampKey] = Date.now();
    }
    applyExecutionDetails(report, details);
    if (details.reasonCode) report.reasonCode = safeString(details.reasonCode, 64);
    if (details.oddsChangePolicy) {
      report.oddsChange.policy = safeString(details.oddsChangePolicy, 32);
    }
    if (details.oddsChangeDecision) {
      report.oddsChange.decision = safeString(details.oddsChangeDecision, 40);
    }
    if (details.expectedOdds !== undefined) {
      report.oddsChange.expectedOdds = safeNumber(details.expectedOdds);
    }
    if (details.currentOdds !== undefined) {
      report.oddsChange.currentOdds = safeNumber(details.currentOdds);
    }
    if (typeof details.clickAttempted === "boolean") {
      report.clickAttempted = details.clickAttempted;
    }
    if (details.indexHit === true) report.marketIndex.hit = true;
    if (details.indexMiss === true) report.marketIndex.miss = true;
    report.updatedAt = Date.now();
    emit(report);
    return cloneReport(report);
  }

  function finish(actionId, outcome, details = {}) {
    const report = ensure(actionId, details);
    if (!report) return null;
    report.oddsChange = report.oddsChange || {
      policy: "",
      decision: "",
      expectedOdds: null,
      currentOdds: null,
    };

    advanceStage(report, safeString(details.stage, 24) || "result");
    report.outcome = safeString(outcome, 24) || "failed";
    report.reasonCode = safeString(details.reasonCode, 64);
    applyExecutionDetails(report, details);
    if (details.oddsChangePolicy) {
      report.oddsChange.policy = safeString(details.oddsChangePolicy, 32);
    }
    if (details.oddsChangeDecision) {
      report.oddsChange.decision = safeString(details.oddsChangeDecision, 40);
    }
    if (details.expectedOdds !== undefined) {
      report.oddsChange.expectedOdds = safeNumber(details.expectedOdds);
    }
    if (details.currentOdds !== undefined) {
      report.oddsChange.currentOdds = safeNumber(details.currentOdds);
    }
    if (typeof details.clickAttempted === "boolean") {
      report.clickAttempted = details.clickAttempted;
    }
    if (details.indexHit === true) report.marketIndex.hit = true;
    if (details.indexMiss === true) report.marketIndex.miss = true;
    if (details.timing && typeof details.timing === "object") {
      for (const [key, value] of Object.entries(details.timing)) {
        if (Object.prototype.hasOwnProperty.call(report.timestamps, key)) {
          report.timestamps[key] = safeNumber(value);
        }
      }
    }
    if (!report.timestamps.resultAt) report.timestamps.resultAt = Date.now();
    report.updatedAt = Date.now();
    emit(report);
    return cloneReport(report);
  }

  function get(actionId) {
    const report = reports.get(getActionId(actionId));
    return report ? cloneReport(report) : null;
  }

  function list() {
    return [...reports.values()].map(cloneReport);
  }

  // =======================================================================
  // RELATÓRIO COMPARATIVO — T0 (frame) -> T1 (ordem) -> T2 (resposta)
  // =======================================================================

  const TELEMETRY_TIMEOUT_MS = 1500;

  // Delta só existe quando os dois instantes são conhecidos e a ordem faz
  // sentido. Diferença negativa é relógio inconsistente, não latência.
  function diff(from, to) {
    const a = safeNumber(from);
    const b = safeNumber(to);
    if (a === null || b === null || a <= 0 || b <= 0) return null;
    const delta = b - a;
    return delta >= 0 ? delta : null;
  }

  // Linha do tempo de UMA ação. `frameToCommitMs` é a métrica que interessa:
  // quanto tempo passou entre saber o preço (T0) e a ordem sair (T1).
  function timeline(report) {
    if (!report || typeof report !== "object") return null;
    const stamps = report.timestamps || {};
    const latency = report.latency || {};
    return {
      actionId: report.actionId,
      house: report.house,
      executionMode: report.executionMode || "",
      executionModeChanged: report.executionModeChanged === true,
      selectionSource: report.selectionSource || "",
      outcome: report.outcome,
      reasonCode: report.reasonCode || "",
      stage: report.stage,
      t0FrameSeenAt: safeNumber(stamps.frameSeenAt),
      t1CommitSentAt: safeNumber(stamps.commitSentAt),
      t2ResultAt: safeNumber(stamps.resultAt),
      frameToCommitMs: diff(stamps.frameSeenAt, stamps.commitSentAt),
      intentToCommitMs: diff(stamps.intentAt, stamps.commitSentAt),
      commitToResultMs: diff(stamps.commitSentAt, stamps.resultAt),
      intentToResultMs: diff(stamps.intentAt, stamps.resultAt),
      rttMs: safeNumber(latency.rttMs),
      totalMs: safeNumber(latency.totalMs),
      stateAgeMs: safeNumber(latency.stateAgeMs),
    };
  }

  function round2(value) {
    return Math.round(value * 100) / 100;
  }

  function summarize(values) {
    const finite = (Array.isArray(values) ? values : []).filter((value) =>
      Number.isFinite(value),
    );
    if (finite.length === 0) {
      return { count: 0, avgMs: null, minMs: null, maxMs: null, p50Ms: null };
    }
    const sorted = [...finite].sort((a, b) => a - b);
    const sum = sorted.reduce((acc, value) => acc + value, 0);
    return {
      count: sorted.length,
      avgMs: round2(sum / sorted.length),
      minMs: sorted[0],
      maxMs: sorted[sorted.length - 1],
      p50Ms: sorted[Math.floor((sorted.length - 1) / 2)],
    };
  }

  // Rótulo honesto: com 2 amostras de cada lado o diferencial não sustenta
  // decisão nenhuma, e o número sozinho não avisa isso.
  function confidenceLabel(directCount, domCount) {
    const smallest = Math.min(directCount, domCount);
    if (smallest === 0) return "insuficiente";
    if (smallest < 5) return "baixa";
    if (smallest < 20) return "media";
    return "alta";
  }

  // background.js guarda o resultado bruto de cada ordem direta (RTT medido no
  // service worker). O content script não vê esse mapa, então pedimos por
  // mensagem. Silêncio ou erro devolve `null`: telemetria nunca quebra o fluxo.
  function fetchBackgroundTelemetry() {
    return new Promise((resolve) => {
      if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) {
        resolve(null);
        return;
      }
      let settled = false;
      const settle = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      const timer = setTimeout(() => settle(null), TELEMETRY_TIMEOUT_MS);
      try {
        chrome.runtime.sendMessage(
          { action: "GET_DIRECT_ORDER_TELEMETRY" },
          (response) => {
            clearTimeout(timer);
            if (chrome.runtime.lastError) {
              settle(null);
              return;
            }
            settle(response && typeof response === "object" ? response : null);
          },
        );
      } catch (error) {
        clearTimeout(timer);
        settle(null);
      }
    });
  }

  function resolverStats() {
    try {
      const stats = window.FastTriggerSelectionResolver?.stats?.();
      return stats && typeof stats === "object" ? stats : null;
    } catch (error) {
      return null;
    }
  }

  const DIFFERENTIAL_CAVEAT =
    "Estimativa. No fluxo DOM o T2 (resultAt) marca a conclusão do clique local, " +
    "não a confirmação da casa; na ordem direta o T2 é a resposta de rede real. " +
    "O diferencial é indicativo de ganho, não medida de aceite da aposta.";

  // Relatório comparativo. Ações híbridas (ordem direta que caiu para o DOM)
  // ficam fora das duas médias: os T1/T2 delas misturam os dois caminhos.
  async function telemetry(options = {}) {
    const rows = list().map(timeline).filter(Boolean);
    const hybrid = rows.filter((row) => row.executionModeChanged);
    const clean = rows.filter((row) => !row.executionModeChanged);
    const direct = clean.filter((row) => row.executionMode === "DIRECT_NETWORK");
    const dom = clean.filter((row) => row.executionMode === "DOM_UI");

    const directCommitToResult = summarize(direct.map((row) => row.commitToResultMs));
    const domCommitToResult = summarize(dom.map((row) => row.commitToResultMs));
    const gainMs =
      directCommitToResult.avgMs !== null && domCommitToResult.avgMs !== null
        ? round2(domCommitToResult.avgMs - directCommitToResult.avgMs)
        : null;

    const background =
      options.includeBackground === false ? null : await fetchBackgroundTelemetry();

    return {
      schemaVersion: 1,
      generatedAt: Date.now(),
      samples: {
        total: rows.length,
        direct: direct.length,
        dom: dom.length,
        hybrid: hybrid.length,
        unlabeled: clean.length - direct.length - dom.length,
      },
      direct: {
        frameToCommit: summarize(direct.map((row) => row.frameToCommitMs)),
        commitToResult: directCommitToResult,
        rtt: summarize(direct.map((row) => row.rttMs)),
        total: summarize(direct.map((row) => row.totalMs)),
        intentToResult: summarize(direct.map((row) => row.intentToResultMs)),
      },
      dom: {
        commitToResult: domCommitToResult,
        intentToResult: summarize(dom.map((row) => row.intentToResultMs)),
      },
      differential: {
        basis: "commit_to_result",
        directAvgMs: directCommitToResult.avgMs,
        domAvgMs: domCommitToResult.avgMs,
        estimatedGainMs: gainMs,
        estimatedGainPct:
          gainMs !== null && domCommitToResult.avgMs > 0
            ? round2((gainMs / domCommitToResult.avgMs) * 100)
            : null,
        confidence: confidenceLabel(directCommitToResult.count, domCommitToResult.count),
        caveat: DIFFERENTIAL_CAVEAT,
      },
      background: background
        ? {
            metrics: background.metrics || null,
            latest: Array.isArray(background.latest) ? background.latest : [],
          }
        : null,
      resolver: resolverStats(),
      rows: options.includeRows === false ? [] : rows,
    };
  }

  function telemetryRowsForConsole(rows) {
    return rows.map((row) => ({
      acao: row.actionId,
      modo: row.executionModeChanged ? `${row.executionMode} (hibrido)` : row.executionMode || "-",
      origem: row.selectionSource || "-",
      "T0>T1": row.frameToCommitMs === null ? "-" : row.frameToCommitMs,
      "T1>T2": row.commitToResultMs === null ? "-" : row.commitToResultMs,
      rtt: row.rttMs === null ? "-" : row.rttMs,
      resultado: row.outcome || "-",
      motivo: row.reasonCode || "-",
    }));
  }

  // Saída para o console do navegador (F12) durante validação em partida.
  async function printTelemetry(options = {}) {
    const data = await telemetry(options);
    try {
      console.log("[GatilhoBR] Relatório comparativo de execução");
      console.log(
        `Amostras: ${data.samples.total} | direta: ${data.samples.direct} | DOM: ${data.samples.dom} | híbridas: ${data.samples.hybrid}`,
      );
      const table = telemetryRowsForConsole(data.rows);
      if (table.length && typeof console.table === "function") {
        console.table(table);
      }
      console.log("Direta — T0 (frame) até T1 (ordem):", data.direct.frameToCommit);
      console.log("Direta — T1 (ordem) até T2 (resposta):", data.direct.commitToResult);
      console.log("Direta — RTT de rede:", data.direct.rtt);
      console.log("DOM — T1 (clique) até T2 (conclusão local):", data.dom.commitToResult);
      console.log("Diferencial estimado:", data.differential);
      if (data.background) console.log("Telemetria do background:", data.background);
      if (data.resolver) console.log("Resolvedor de seleção:", data.resolver);
    } catch (error) {}
    return data;
  }

  window.FastTriggerExecutionReport = {
    start,
    mark,
    finish,
    get,
    list,
    timeline,
    telemetry,
    printTelemetry,
  };
})();
