import type { CardDetails } from "@/types/billing";

type BridgeResponse = {
  source: "gbr-cakto-sdk";
  requestId: string;
  ok: boolean;
  value?: unknown;
  error?: string;
};

type BridgeRequest = {
  source: "gbr-cakto-sdk-parent";
  requestId: string;
  type: "init" | "antifraud" | "tokenize" | "cleanup";
  payload?: Record<string, unknown>;
};

let iframe: HTMLIFrameElement | null = null;
let ready: Promise<HTMLIFrameElement> | null = null;
const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();

function ensureListener() {
  if (typeof window === "undefined") return;
  if (window.__gbrCaktoSdkListener) return;
  window.__gbrCaktoSdkListener = true;
  window.addEventListener("message", (event: MessageEvent<BridgeResponse>) => {
    const response = event.data;
    if (!response || response.source !== "gbr-cakto-sdk") return;
    const request = pending.get(response.requestId);
    if (!request) return;
    pending.delete(response.requestId);
    if (response.ok) request.resolve(response.value);
    else request.reject(new Error(response.error || "Falha no SDK da Cakto."));
  });
}

declare global {
  interface Window {
    __gbrCaktoSdkListener?: boolean;
  }
}

function ensureFrame() {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return Promise.reject(new Error("SDK da Cakto indisponivel fora do navegador."));
  }
  if (ready) return ready;
  ensureListener();
  ready = new Promise<HTMLIFrameElement>((resolve, reject) => {
    const frame = document.createElement("iframe");
    frame.title = "Cakto SDK";
    frame.setAttribute("aria-hidden", "true");
    frame.style.position = "fixed";
    frame.style.width = "1px";
    frame.style.height = "1px";
    frame.style.opacity = "0";
    frame.style.pointerEvents = "none";
    frame.style.border = "0";
    frame.src = new URL("./cakto-sdk-bridge.html", window.location.href).toString();
    frame.addEventListener("load", () => {
      iframe = frame;
      resolve(frame);
    }, { once: true });
    frame.addEventListener("error", () => {
      ready = null;
      reject(new Error("Nao foi possivel iniciar o SDK da Cakto."));
    }, { once: true });
    document.body.appendChild(frame);
  });
  return ready;
}

async function request<T>(type: BridgeRequest["type"], payload: Record<string, unknown> = {}) {
  const frame = await ensureFrame();
  const requestId = crypto.randomUUID();
  const promise = new Promise<unknown>((resolve, reject) => {
    pending.set(requestId, { resolve, reject });
    window.setTimeout(() => {
      if (!pending.has(requestId)) return;
      pending.delete(requestId);
      reject(new Error("O SDK da Cakto demorou para responder."));
    }, 20000);
  });
  const message: BridgeRequest = {
    source: "gbr-cakto-sdk-parent",
    requestId,
    type,
    payload,
  };
  frame.contentWindow?.postMessage(message, "*");
  return await promise as T;
}

export function getCaktoSdkBridge() {
  return {
    async init(clientId: string) {
      if (!clientId) throw new Error("A configuracao publica da Cakto nao foi encontrada.");
      await request("init", { clientId });
    },
    async getAntifraudReference() {
      const value = await request<{ reference?: string }>("antifraud");
      if (!value?.reference) throw new Error("A Cakto nao retornou a referencia antifraude.");
      return value.reference;
    },
    async tokenize(card: CardDetails) {
      const value = await request<{ cardToken?: string }>("tokenize", { ...card });
      if (!value?.cardToken) throw new Error("A Cakto nao retornou o token do cartao.");
      return value.cardToken;
    },
    async cleanup() {
      await request("cleanup").catch(() => undefined);
    },
  };
}
