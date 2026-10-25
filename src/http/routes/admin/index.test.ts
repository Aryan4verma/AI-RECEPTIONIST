import { describe, expect, it } from "vitest";
import { loadEnv } from "../../../config/env.js";
import { createLogger } from "../../../observability/logger.js";
import { MockCalendarAdapter } from "../../../calendar/mockAdapter.js";
import {
  MemoryAuditRepo,
  MemoryBookingStateRepo,
  MemoryBusinessConfigRepo,
  MemoryConsentRepo,
  MemoryConversationRepo,
  MemoryCustomerRepo,
} from "../../../db/memory/stores.js";
import { scriptedProvider } from "../../../domain/conversation/testProvider.js";
import { BookingService } from "../../../domain/booking/service.js";
import { ModelRegistry } from "../../../ai/registry.js";
import { MemoryModelProviderRepo } from "../../../db/memory/stores.js";
import { createSecretStore } from "../../../secrets/store.js";
import { ConversationService } from "../../../domain/conversation/service.js";
import { buildApp } from "../../../server/app.js";
import type { AdminRouteDeps } from "./index.js";

const SECRET = "0123456789abcdef0123456789abcdef";
const env = loadEnv({
  SUPABASE_URL: "https://ogxdszjypswutekqgorb.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-key-placeholder",
  SUPABASE_DB_URL: "postgresql://postgres.proj:pw@aws-0-eu-central-1.pooler.supabase.com:5432/postgres",
  SUPABASE_DB_CA_CERT_PATH: "/home/owner/prod-ca-2021.crt",
  TOKEN_HASH_SECRET: SECRET,
  LOG_LEVEL: "fatal",
});

async function buildHarness(opts: { member?: boolean; verify?: "ok" | "fail" } = {}) {
  const conversations = new MemoryConversationRepo();
  const customers = new MemoryCustomerRepo();
  const audit = new MemoryAuditRepo();
  const bookingState = new MemoryBookingStateRepo();
  const calendar = new MockCalendarAdapter();
  const bookingService = new BookingService({
    bookingState, calendar, tokenHashSecret: SECRET, offerTtlMinutes: 15,
  });
  const registry = new ModelRegistry({
    repo: new MemoryModelProviderRepo(),
    localProvider: scriptedProvider([{ intent: "greeting" }]),
    secretStore: createSecretStore({ kind: "disabled", reason: "fixture" }),
  });
  const admin: AdminRouteDeps = {
    registry,
    verifyAdmin: async (token) =>
      opts.verify === "fail" || token !== "admin-token"
        ? null
        : { userId: "admin-user-1" },
    isAdminMember: async () => opts.member ?? true,
    config: new MemoryBusinessConfigRepo(),
    customers,
    conversations,
    appointments: bookingState,
    booking: bookingService,
    audit,
  };
  const conversationService = new ConversationService({
    conversations,
    consent: new MemoryConsentRepo(),
    audit,
    config: new MemoryBusinessConfigRepo(),
    provider: scriptedProvider([{ intent: "greeting" }]),
    tokenHashSecret: SECRET,
  });
  const app = await buildApp({
    env,
    logger: createLogger(env),
    pgPool: { query: async () => ({ rows: [] }) } as never,
    ollamaBase: "http://localhost:11434",
    conversationService,
    bookingService,
    admin,
  });
  return { app, customers, audit, conversations, bookingService, bookingState, calendar, registry };
}

const authHeaders = { authorization: "Bearer admin-token", "content-type": "application/json" };
const authOnly = { authorization: "Bearer admin-token" };

describe("admin management APIs (TC-28 route layer)", () => {
  it("denies unauthenticated access to every admin route", async () => {
    const { app } = await buildHarness();
    for (const [method, url] of [
      ["GET", "/api/v1/admin/customers"],
      ["GET", "/api/v1/admin/business-config/faqs"],
      ["GET", "/api/v1/admin/conversations"],
    ] as const) {
      const res = await app.inject({ method, url });
      expect(res.statusCode, `${method} ${url}`).toBe(401);
    }
    await app.close();
  });

  it("denies a valid token without admin membership (403)", async () => {
    const { app } = await buildHarness({ member: false });
    const res = await app.inject({ method: "GET", url: "/api/v1/admin/customers", headers: authOnly });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it("creates, lists, patches, and anonymizes customers with audit entries", async () => {
    const { app, customers, audit } = await buildHarness();
    const created = await app.inject({
      method: "POST", url: "/api/v1/admin/customers", headers: authHeaders,
      payload: { displayName: "Asha", contactEmail: "asha@example.com" },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id;

    const patched = await app.inject({
      method: "PATCH", url: `/api/v1/admin/customers/${id}`, headers: authHeaders,
      payload: { notes: "vip" },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().notes).toBe("vip");

    const removed = await app.inject({ method: "DELETE", url: `/api/v1/admin/customers/${id}`, headers: authOnly });
    expect(removed.statusCode).toBe(200);
    const row = await customers.findById(id);
    expect(row?.displayName).toBe("[deleted customer]");
    expect(row?.contactEmail).toBeNull();
    expect(audit.entries.some((e) => e.action === "customer.anonymized")).toBe(true);
    await app.close();
  });

  it("updates business config with version increments and audit", async () => {
    const { app, audit } = await buildHarness();
    const put1 = await app.inject({
      method: "PUT", url: "/api/v1/admin/business-config/faqs", headers: authHeaders,
      payload: { content: { entries: [{ question: "hours?", answer: "9-6", keywords: ["hours"] }] } },
    });
    expect(put1.json().version).toBe(1);
    const put2 = await app.inject({
      method: "PUT", url: "/api/v1/admin/business-config/faqs", headers: authHeaders,
      payload: { content: { entries: [] } },
    });
    expect(put2.json().version).toBe(2);
    const get = await app.inject({ method: "GET", url: "/api/v1/admin/business-config/faqs", headers: authHeaders });
    expect(get.json().version).toBe(2);
    expect(audit.entries.filter((e) => e.action === "business_config.updated")).toHaveLength(2);
    await app.close();
  });

  it("rejects unknown configuration categories", async () => {
    const { app } = await buildHarness();
    const res = await app.inject({
      method: "GET", url: "/api/v1/admin/business-config/nonsense", headers: authOnly,
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("serves the admin conversation transcript with authorization", async () => {
    const { app, conversations } = await buildHarness();
    const row = await conversations.create({ channel: "text", accessTokenHash: "hash" });
    await conversations.insertMessage({ conversationId: row.id, role: "customer", content: "hello" });
    const res = await app.inject({
      method: "GET", url: `/api/v1/admin/conversations/${row.id}/transcript`, headers: authOnly,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().messages).toHaveLength(1);
    await app.close();
  });
});


describe("AI Models & Providers admin routes (OP-14..OP-18)", () => {

  it("requires authentication for local model discovery", async () => {
    const { app } = await buildHarness();
    const res = await app.inject({ method: "GET", url: "/api/v1/admin/models/local" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("discovers local models live (OP-14)", async () => {
    const { app } = await buildHarness();
    const res = await app.inject({ method: "GET", url: "/api/v1/admin/models/local", headers: authOnly });
    expect(res.statusCode).toBe(200);
    expect(res.json().ollama.models.map((m: { name: string }) => m.name)).toContain("qwen3:1.7b");
    await app.close();
  });

  it("rejects an unsafe provider endpoint (OP-15, SEC-16)", async () => {
    const { app } = await buildHarness();
    const res = await app.inject({
      method: "POST", url: "/api/v1/admin/providers", headers: authHeaders,
      payload: { kind: "cloud", adapter: "openai_compatible", displayName: "bad", baseUrl: "https://169.254.169.254/v1" },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("UNSAFE_ENDPOINT");
    await app.close();
  });

  it("credential entry fails closed while the store is disabled (OP-16)", async () => {
    const { app } = await buildHarness();
    const created = await app.inject({
      method: "POST", url: "/api/v1/admin/providers", headers: authHeaders,
      payload: { kind: "cloud", adapter: "openai_compatible", displayName: "cloud", baseUrl: "https://api.example.com" },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id;
    const res = await app.inject({
      method: "PUT", url: `/api/v1/admin/providers/${id}/credential`, headers: authHeaders,
      payload: { apiKey: "sk-test" },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe("CREDENTIAL_STORE_UNAVAILABLE");
    // Provider listing shows hasCredential=false and never the key:
    const list = await app.inject({ method: "GET", url: "/api/v1/admin/providers", headers: authOnly });
    const row = list.json().providers.find((p: { id: string }) => p.id === id);
    expect(row.hasCredential).toBe(false);
    expect(JSON.stringify(list.json())).not.toContain("sk-test");
    await app.close();
  });

  it("active-model switching validates against discovered local models (OP-18)", async () => {
    const { app, registry } = await buildHarness();
    const local = await registry.addProvider({ kind: "local", adapter: "ollama", displayName: "local", modelId: "qwen3:1.7b" });
    const bad = await app.inject({
      method: "PUT", url: "/api/v1/admin/settings/active-model", headers: authHeaders,
      payload: { providerId: local.id, modelId: "not-installed" },
    });
    expect(bad.statusCode).toBe(409);
    expect(bad.json().error.code).toBe("MODEL_UNAVAILABLE");
    const good = await app.inject({
      method: "PUT", url: "/api/v1/admin/settings/active-model", headers: authHeaders,
      payload: { providerId: local.id, modelId: "qwen3:1.7b" },
    });
    expect(good.statusCode).toBe(200);
    expect(good.json()).toMatchObject({ appliesFrom: "next_turn" });
    await app.close();
  });
});
