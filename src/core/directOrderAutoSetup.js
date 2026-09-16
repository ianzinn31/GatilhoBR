// =========================================================================
// GATILHOBR - APRENDIZADO AUTOMATICO DO PERFIL DE ORDEM DIRETA (SERVICE WORKER)
// =========================================================================
//
// Modulo puro carregado pelo background.js. Ele nao observa a rede sozinho:
// recebe somente a janela curta de uma aposta explicitamente acionada pelo
// usuario e tenta transformar UMA requisicao JSON inequívoca em um modelo para
// `directOrderBridge.js`.
//
// Travas centrais:
// - apenas hosts oficiais Bet365 em HTTPS;
// - exige selectionId e stake exatos e unicos no corpo;
// - recusa payload com token, segredo, sessao, nonce ou identificador dinamico;
// - nunca aprende corpo binario, texto arbitrario ou formulario ambiguo;
// - nao envia nada: apenas devolve um modelo sanitizado ao service worker.
// =========================================================================

(function (root) {
  "use strict";

  const PROFILE_VERSION = 1;
  const MAX_BODY_BYTES = 65_536;
  const MAX_TREE_NODES = 2_048;
  const MAX_TREE_DEPTH = 12;
  const BET365_HOST_PATTERN = /(^|\.)bet365\.(?:bet\.br|com|es)$/i;
  const SENSITIVE_KEY_PATTERN = /(?:authorization|access.?token|refresh.?token|cookie|passw(?:or)?d|secret|csrf|xsrf|session.?token|api.?key|private.?key)/i;
  const DYNAMIC_KEY_PATTERN = /(?:nonce|timestamp|request.?id|correlation.?id|transaction.?id|idempotency)/i;

  function normalizeText(value, maxLength = 256) {
    if (typeof value === "string") return value.trim().slice(0, maxLength);
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    return "";
  }

  function normalizePositiveNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : null;
  }

  function isOfficialBet365Host(hostname) {
    return typeof hostname === "string" && BET365_HOST_PATTERN.test(hostname.trim());
  }

  function parseHttpsUrl(raw) {
    if (typeof raw !== "string" || raw.length > 2_048) return null;
    try {
      const url = new URL(raw);
      if (url.protocol !== "https:" || !isOfficialBet365Host(url.hostname)) return null;
      url.hash = "";
      return url;
    } catch (error) {
      return null;
    }
  }

  function decodeRawBody(requestBody) {
    const parts = Array.isArray(requestBody?.raw) ? requestBody.raw : [];
    if (parts.length === 0 || typeof TextDecoder === "undefined") return null;

    let total = 0;
    const chunks = [];
    for (const part of parts) {
      const bytes = part?.bytes;
      if (bytes === null || bytes === undefined) return null;
      let view = null;
      try {
        view = bytes instanceof Uint8Array
          ? bytes
          : new Uint8Array(bytes);
      } catch (error) {
        return null;
      }
      total += view.byteLength;
      if (total <= 0 || total > MAX_BODY_BYTES) return null;
      chunks.push(view);
    }

    const joined = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      joined.set(chunk, offset);
      offset += chunk.byteLength;
    }
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(joined);
    } catch (error) {
      return null;
    }
  }

  function parseJsonBody(requestBody) {
    const text = decodeRawBody(requestBody);
    if (typeof text !== "string") return { ok: false, reason: "body_unreadable" };
    const trimmed = text.trim();
    if (trimmed.length < 2 || trimmed.length > MAX_BODY_BYTES) {
      return { ok: false, reason: "body_unreadable" };
    }
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
      return { ok: false, reason: "body_not_json" };
    }
    try {
      const body = JSON.parse(trimmed);
      if (body === null || typeof body !== "object") {
        return { ok: false, reason: "body_not_object" };
      }
      return { ok: true, body };
    } catch (error) {
      return { ok: false, reason: "body_invalid_json" };
    }
  }

  function pointerEscape(segment) {
    return String(segment).replace(/~/g, "~0").replace(/\//g, "~1");
  }

  function finalPointerSegment(pointer) {
    const index = pointer.lastIndexOf("/");
    const raw = index >= 0 ? pointer.slice(index + 1) : pointer;
    return raw.replace(/~1/g, "/").replace(/~0/g, "~");
  }

  function scanBody(body) {
    const leaves = [];
    let nodes = 0;
    let rejectedKey = "";

    function visit(value, pointer, depth) {
      nodes += 1;
      if (nodes > MAX_TREE_NODES || depth > MAX_TREE_DEPTH) return false;
      if (value === null || typeof value !== "object") {
        leaves.push({ pointer, key: finalPointerSegment(pointer), value });
        return true;
      }

      const entries = Array.isArray(value)
        ? value.map((item, index) => [String(index), item])
        : Object.entries(value);
      for (const [key, child] of entries) {
        if (!Array.isArray(value) && (SENSITIVE_KEY_PATTERN.test(key) || DYNAMIC_KEY_PATTERN.test(key))) {
          rejectedKey = key;
          return false;
        }
        if (!visit(child, `${pointer}/${pointerEscape(key)}`, depth + 1)) return false;
      }
      return true;
    }

    const ok = visit(body, "", 0);
    if (!ok) {
      return {
        ok: false,
        reason: rejectedKey ? "body_sensitive_or_dynamic" : "body_too_complex",
      };
    }
    return { ok: true, leaves };
  }

  function numericValue(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value !== "string") return null;
    const cleaned = value.trim().replace(/\s+/g, "").replace(",", ".");
    if (!/^-?\d+(?:\.\d+)?$/.test(cleaned)) return null;
    const number = Number(cleaned);
    return Number.isFinite(number) ? number : null;
  }

  function approximatelyEqual(left, right) {
    return Math.abs(Number(left) - Number(right)) <= 0.000001;
  }

  function uniqueMatch(leaves, predicate) {
    const matches = leaves.filter(predicate);
    return matches.length === 1 ? matches[0] : null;
  }

  function contextFieldForIdentity(leaf, stringField, numberField) {
    return typeof leaf.value === "number" ? numberField : stringField;
  }

  function inferTemplate(details, capture) {
    const endpoint = parseHttpsUrl(details?.url);
    if (endpoint === null) return { ok: false, reason: "endpoint_not_allowed" };

    const initiator = parseHttpsUrl(capture?.pageUrl || details?.initiator || "");
    if (initiator === null) return { ok: false, reason: "initiator_not_allowed" };

    const method = normalizeText(details?.method, 12).toUpperCase();
    if (!["POST", "PUT", "PATCH"].includes(method)) {
      return { ok: false, reason: "method_not_supported" };
    }

    const selectionId = normalizeText(capture?.selectionId, 96);
    const stake = normalizePositiveNumber(capture?.stake);
    if (!selectionId || stake === null) return { ok: false, reason: "capture_invalid" };

    const parsed = parseJsonBody(details?.requestBody);
    if (!parsed.ok) return parsed;
    const scanned = scanBody(parsed.body);
    if (!scanned.ok) return scanned;

    const selection = uniqueMatch(scanned.leaves, (leaf) => {
      if (normalizeText(leaf.value, 128) !== selectionId) return false;
      return /(?:selection|outcome|pick|bet|wager)/i.test(leaf.pointer);
    });
    if (selection === null) return { ok: false, reason: "selection_not_unique" };

    const stakeMatch = uniqueMatch(scanned.leaves, (leaf) => {
      if (!/(?:stake|amount|wager|risk|bet)/i.test(leaf.key)) return false;
      const number = numericValue(leaf.value);
      if (number === null) return false;
      return approximatelyEqual(number, stake) || approximatelyEqual(number, Math.round(stake * 100));
    });
    if (stakeMatch === null) return { ok: false, reason: "stake_not_unique" };

    const stakeNumber = numericValue(stakeMatch.value);
    let stakeContext = "stake";
    if (approximatelyEqual(stakeNumber, Math.round(stake * 100)) && !approximatelyEqual(stakeNumber, stake)) {
      stakeContext = "stakeMinor";
    } else if (typeof stakeMatch.value === "string") {
      stakeContext = "stakeFixed2";
    }

    const bodyContext = {
      [selection.pointer]: contextFieldForIdentity(
        selection,
        "selectionId",
        "selectionIdNumber",
      ),
      [stakeMatch.pointer]: stakeContext,
    };

    const optionalIdentities = [
      ["marketId", "marketIdNumber", normalizeText(capture?.marketId, 128), /market/i],
      ["eventId", "eventIdNumber", normalizeText(capture?.eventId, 128), /event|fixture/i],
    ];
    for (const [stringField, numberField, expected, keyPattern] of optionalIdentities) {
      if (!expected) continue;
      const match = uniqueMatch(scanned.leaves, (leaf) =>
        keyPattern.test(leaf.key) && normalizeText(leaf.value, 128) === expected,
      );
      if (match) bodyContext[match.pointer] = contextFieldForIdentity(match, stringField, numberField);
    }

    const odds = normalizePositiveNumber(capture?.odds);
    const oddsLeaves = scanned.leaves.filter((leaf) => /(?:odds?|price)/i.test(leaf.key));
    if (oddsLeaves.length > 0) {
      const oddsMatch = odds === null
        ? null
        : uniqueMatch(oddsLeaves, (leaf) => {
            const number = numericValue(leaf.value);
            return number !== null && approximatelyEqual(number, odds);
          });
      // Reutilizar uma odd estatica em outra selecao seria perigoso. Se o
      // payload declara preco, ele precisa ser correlacionado sem ambiguidade.
      if (oddsMatch === null) return { ok: false, reason: "odds_not_unique" };
      bodyContext[oddsMatch.pointer] = typeof oddsMatch.value === "string" ? "oddsText" : "odds";
    }

    return {
      ok: true,
      profileVersion: PROFILE_VERSION,
      endpointHost: endpoint.hostname.toLowerCase(),
      template: {
        endpoint: endpoint.href,
        method,
        headers: { "Content-Type": "application/json" },
        body: parsed.body,
        bodyContext,
        readResponse: true,
        timeoutMs: 4_000,
      },
    };
  }

  root.FastTriggerDirectOrderAutoSetup = Object.freeze({
    profileVersion: PROFILE_VERSION,
    isOfficialBet365Host,
    decodeRawBody,
    parseJsonBody,
    scanBody,
    inferTemplate,
  });
})(typeof self !== "undefined" ? self : globalThis);
