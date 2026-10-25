// Backend API client. Contracts: docs/backend/API.md. The customer
// conversation token is returned exactly once at session start and kept in
// sessionStorage (never localStorage — INTEGRATION.md §3).

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown; requestId: string };
}

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const BASE = import.meta.env.VITE_API_BASE ?? "";

async function request<T>(
  method: string,
  path: string,
  opts: { body?: unknown; raw?: ArrayBuffer; token?: string; adminToken?: string; contentType?: string } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.token) headers["x-conversation-token"] = opts.token;
  if (opts.adminToken) headers.authorization = `Bearer ${opts.adminToken}`;
  let body: BodyInit | undefined;
  if (opts.raw !== undefined) {
    body = opts.raw;
    if (opts.contentType) headers["content-type"] = opts.contentType;
  } else if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  const res = await fetch(`${BASE}${path}`, { method, headers, body });
  if (res.status === 202 || res.headers.get("content-type")?.includes("application/json")) {
    const json = (await res.json()) as T & Partial<ApiErrorBody>;
    if (!res.ok) {
      const e = json.error;
      throw new ApiError(e?.code ?? "INTERNAL", e?.message ?? "Request failed.", res.status, e?.requestId);
    }
    return json;
  }
  if (!res.ok) {
    throw new ApiError("INTERNAL", "The service returned an unexpected response.", res.status);
  }
  return {} as T;
}

/* ---------- Customer conversation ---------- */

export interface StartResult {
  conversationId: string;
  greeting: string;
  accessToken: string;
}

export interface Offer {
  slot: string;
  end: string;
  expiresAt: string;
  offerToken: string;
  durationMinutes: number;
  timezone: string;
}

export interface TurnResult {
  reply: string;
  intent: string;
  extractionComplete: boolean | null;
  offer?: Offer;
  conversationState?: string;
}

export interface StatusResult {
  status: string;
  booking: "confirmed" | "pending" | "cancelled" | "none";
  consentRecording: boolean;
  startedAt: string;
}

export interface ConfirmResult {
  bookingState: string;
  appointmentId?: string;
  eventId?: string;
  message?: string;
}

export const api = {
  startConversation: (channel: "text" | "voice") =>
    request<StartResult>("POST", "/api/v1/conversations", { body: { channel } }),

  sendMessage: (id: string, token: string, text: string) =>
    request<TurnResult>("POST", `/api/v1/conversations/${id}/messages`, { body: { text }, token }),

  consent: (id: string, token: string, decision: boolean) =>
    request<{ consentRecording: boolean }>("POST", `/api/v1/conversations/${id}/consent`, {
      body: { decision },
      token,
    }),

  confirm: (id: string, token: string, offerToken: string, decision: "accept" | "decline") =>
    request<ConfirmResult>("POST", `/api/v1/conversations/${id}/confirm`, {
      body: { offerToken, decision },
      token,
    }),

  // EXPLICIT customer booking cancellation — the only call that may cancel an
  // appointment. Wire to a deliberate "Cancel appointment" action, never to
  // closing the session (use endConversation for that).
  cancel: (id: string, token: string) =>
    request<{ conversationState: string }>("POST", `/api/v1/conversations/${id}/cancel`, { token, body: {} }),

  // End the conversation only — a confirmed appointment always survives this.
  endConversation: (id: string, token: string) =>
    request<{ conversationState: string }>("POST", `/api/v1/conversations/${id}/end`, { token, body: {} }),

  status: (id: string, token: string) =>
    request<StatusResult>("GET", `/api/v1/conversations/${id}`, { token }),
};

/* Multipart helper (fetch FormData directly — no JSON envelope for body) */
export async function postAudio(
  id: string,
  token: string,
  audio: Blob,
  filename: string,
): Promise<TurnResult & { transcript: string; sttLatencyMs: number }> {
  const form = new FormData();
  form.append("file", audio, filename);
  const res = await fetch(`${BASE}/api/v1/conversations/${id}/audio`, {
    method: "POST",
    headers: { "x-conversation-token": token },
    body: form,
  });
  const json = (await res.json()) as TurnResult & { transcript: string } & Partial<ApiErrorBody>;
  if (!res.ok) {
    const e = json.error;
    throw new ApiError(e?.code ?? "INTERNAL", e?.message ?? "Upload failed.", res.status, e?.requestId);
  }
  return json as TurnResult & { transcript: string; sttLatencyMs: number };
}
