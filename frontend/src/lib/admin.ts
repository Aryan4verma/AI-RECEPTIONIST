import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Admin identity uses Supabase Auth (public URL + publishable/anon key —
// client-safe values). The backend independently verifies the JWT AND
// app_admins membership; this client never holds privileged secrets.
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabase: SupabaseClient | null = url && anonKey ? createClient(url, anonKey) : null;

export function supabaseConfigured(): boolean {
  return supabase !== null;
}

export async function adminSignIn(email: string, password: string): Promise<string> {
  if (!supabase) throw new Error("Supabase is not configured (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).");
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(error?.message ?? "Sign-in failed.");
  return data.session.access_token;
}

export async function adminSignOut(): Promise<void> {
  await supabase?.auth.signOut();
}

/* ---------- Admin API ---------- */

import { ApiError } from "./api";

const BASE = import.meta.env.VITE_API_BASE ?? "";

async function admin<T>(method: string, path: string, token: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json()) as T & { error?: { code: string; message: string; requestId: string } };
  if (!res.ok) {
    const e = json.error;
    const err = new (ApiError as new (
      code: string,
      message: string,
      status: number,
      requestId?: string,
    ) => InstanceType<typeof ApiError>)(e?.code ?? "INTERNAL", e?.message ?? "Request failed.", res.status, e?.requestId);
    throw err;
  }
  return json;
}

export interface Customer {
  id: string;
  displayName: string;
  contactEmail: string | null;
  contactPhone: string | null;
  notes: string | null;
}
export interface ConversationRow {
  id: string;
  channel: string;
  status: string;
  customerId: string | null;
  startedAt: string;
}
export interface AppointmentRow {
  id: string;
  conversation_id: string | null;
  customer_id: string | null;
  service_type: string | null;
  purpose: string | null;
  scheduled_start: string;
  scheduled_end: string;
  duration_minutes: number;
  timezone: string;
  status: string;
  google_event_id: string | null;
}
export interface Provider {
  id: string;
  kind: "local" | "cloud";
  adapter: string;
  displayName: string;
  baseUrl: string | null;
  modelId: string | null;
  capabilities: Record<string, unknown>;
  status: "unverified" | "ok" | "error";
  lastError: string | null;
  isActive: boolean;
  hasCredential: boolean;
}
export interface LocalModel {
  name: string;
  sizeBytes?: number;
  family?: string;
  parameterSize?: string;
}


export interface GoogleCalendarStatus {
  configured: boolean;
  connected: boolean;
  calendarId: string | null;
  accessRole: string | null;
  connectedAt: string | null;
  connectedBy: string | null;
  lastError: string | null;
  lastVerifiedAt: string | null;
}

export const adminApi = {
  customers: (t: string) => admin<{ customers: Customer[] }>("GET", "/api/v1/admin/customers", t),
  createCustomer: (t: string, body: Partial<Customer>) =>
    admin<Customer>("POST", "/api/v1/admin/customers", t, body),
  updateCustomer: (t: string, id: string, body: Partial<Customer>) =>
    admin<Customer>("PATCH", `/api/v1/admin/customers/${id}`, t, body),
  anonymizeCustomer: (t: string, id: string) =>
    admin<{ anonymized: boolean }>("DELETE", `/api/v1/admin/customers/${id}`, t),

  conversations: (t: string) =>
    admin<{ conversations: ConversationRow[] }>("GET", "/api/v1/admin/conversations", t),
  transcript: (t: string, id: string) =>
    admin<{
      messages: Array<{ id: string; role: string; content: string; contentType: string; createdAt: string }>;
    }>("GET", `/api/v1/admin/conversations/${id}/transcript`, t),

  appointments: (t: string) =>
    admin<{ appointments: AppointmentRow[] }>("GET", "/api/v1/admin/appointments", t),
  cancelAppointment: (t: string, id: string) =>
    admin<{ id: string; status: string; calendarCancelled: boolean }>(
      "POST",
      `/api/v1/admin/appointments/${id}/cancel`,
      t,
      {},
    ),

  config: (t: string, category: string) =>
    admin<{ category: string; content: Record<string, unknown>; version: number }>(
      "GET",
      `/api/v1/admin/business-config/${category}`,
      t,
    ),
  saveConfig: (t: string, category: string, content: Record<string, unknown>) =>
    admin<{ category: string; version: number }>(
      "PUT",
      `/api/v1/admin/business-config/${category}`,
      t,
      { content },
    ),

  localModels: (t: string) =>
    admin<{ ollama: { reachable: boolean; models: LocalModel[] } }>("GET", "/api/v1/admin/models/local", t),
  providers: (t: string) => admin<{ providers: Provider[] }>("GET", "/api/v1/admin/providers", t),
  createProvider: (t: string, body: Record<string, unknown>) =>
    admin<Provider>("POST", "/api/v1/admin/providers", t, body),
  updateProvider: (t: string, id: string, body: Record<string, unknown>) =>
    admin<Provider>("PATCH", `/api/v1/admin/providers/${id}`, t, body),
  deleteProvider: (t: string, id: string) =>
    admin<{ deleted: boolean }>("DELETE", `/api/v1/admin/providers/${id}`, t),
  setCredential: (t: string, id: string, apiKey: string) =>
    admin<{ masked: string }>("PUT", `/api/v1/admin/providers/${id}/credential`, t, { apiKey }),
  testProvider: (t: string, id: string) =>
    admin<{ status: "ok" | "error"; latencyMs: number; detail?: string }>(
      "POST",
      `/api/v1/admin/providers/${id}/test`,
      t,
      {},
    ),
  setActiveModel: (t: string, providerId: string, modelId?: string) =>
    admin<{ providerId: string; modelId: string; appliesFrom: string }>(
      "PUT",
      "/api/v1/admin/settings/active-model",
      t,
      { providerId, modelId },
    ),

  // Google Calendar connection (Stage 7) — metadata only; tokens never leave the server.
  googleStatus: (t: string) =>
    admin<GoogleCalendarStatus>("GET", "/api/v1/admin/integrations/google/status", t),
  googleConnect: (t: string) =>
    admin<{ authUrl: string }>("POST", "/api/v1/admin/integrations/google/connect", t, {}),
  googleDisconnect: (t: string) =>
    admin<{ disconnected: boolean }>("POST", "/api/v1/admin/integrations/google/disconnect", t, {}),
};
