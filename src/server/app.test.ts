import { describe, expect, it } from "vitest";
import { loadEnv } from "../config/env.js";
import { createLogger } from "../observability/logger.js";
import { MockCalendarAdapter } from "../calendar/mockAdapter.js";
import {
  MemoryAuditRepo,
  MemoryBookingStateRepo,
  MemoryBusinessConfigRepo,
  MemoryConsentRepo,
  MemoryConversationRepo,
} from "../db/memory/stores.js";
import { scriptedProvider } from "../domain/conversation/testProvider.js";
import { BookingService } from "../domain/booking/service.js";
import { ConversationService } from "../domain/conversation/service.js";
import { buildApp } from "./app.js";

const env = loadEnv({
  SUPABASE_URL: "https://ogxdszjypswutekqgorb.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-key-placeholder",
  SUPABASE_DB_URL: "postgresql://postgres.proj:pw@aws-0-eu-central-1.pooler.supabase.com:5432/postgres",
  SUPABASE_DB_CA_CERT_PATH: "/home/owner/prod-ca-2021.crt",
  TOKEN_HASH_SECRET: "0123456789abcdef0123456789abcdef",
  LOG_LEVEL: "fatal",
});

const SECRET = "0123456789abcdef0123456789abcdef";
const stubPool = { query: async () => ({ rows: [] }) } as never;

function buildDeps() {
  const bookingState = new MemoryBookingStateRepo();
  const calendar = new MockCalendarAdapter();
  return {
    conversationService: new ConversationService({
      conversations: new MemoryConversationRepo(),
      consent: new MemoryConsentRepo(),
      audit: new MemoryAuditRepo(),
      config: new MemoryBusinessConfigRepo(),
      provider: scriptedProvider([{ intent: "greeting" }]),
      tokenHashSecret: SECRET,
    }),
    bookingService: new BookingService({
      bookingState,
      calendar,
      tokenHashSecret: SECRET,
      offerTtlMinutes: 15,
    }),
  };
}

describe("http app", () => {
  it("serves /healthz", async () => {
    const app = await buildApp({
      env, logger: createLogger(env), pgPool: stubPool, ollamaBase: "http://localhost:11434", ...buildDeps(),
    });
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "alive" });
    await app.close();
  });

  it("serves an honest degraded /readyz when Ollama is down (TC-21 readiness view)", async () => {
    const app = await buildApp({
      env, logger: createLogger(env), pgPool: stubPool, ollamaBase: "http://localhost:11434", ...buildDeps(),
      fetchFn: (async () => {
        throw new Error("ECONNREFUSED");
      }) as unknown as typeof fetch,
    });
    const res = await app.inject({ method: "GET", url: "/readyz" });
    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.status).toBe("degraded");
    expect(body.dependencies.ollama.ok).toBe(false);
    await app.close();
  });

  it("returns the shared error envelope for unknown routes", async () => {
    const app = await buildApp({
      env, logger: createLogger(env), pgPool: stubPool, ollamaBase: "http://localhost:11434", ...buildDeps(),
    });
    const res = await app.inject({ method: "GET", url: "/nope" });
    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.error.code).toBe("NOT_FOUND");
    expect(body.error.requestId).toBeTruthy();
    await app.close();
  });

  it("exchanges a customer message over the conversation-token guard (TC-01/TC-02 route layer)", async () => {
    const deps = buildDeps();
    const app = await buildApp({
      env, logger: createLogger(env), pgPool: stubPool, ollamaBase: "http://localhost:11434", ...deps,
    });
    const started = await deps.conversationService.start("text");
    const good = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${started.conversationId}/messages`,
      headers: { "x-conversation-token": started.accessToken },
      payload: { text: "hello there" },
    });
    expect(good.statusCode).toBe(200);
    expect(good.json()).toMatchObject({ intent: "greeting" });
    const bad = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${started.conversationId}/messages`,
      headers: { "x-conversation-token": "wrong-token-entirely" },
      payload: { text: "hello" },
    });
    expect(bad.statusCode).toBe(404);
    const noToken = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${started.conversationId}/messages`,
      payload: { text: "hello" },
    });
    expect(noToken.statusCode).toBe(404);
    await app.close();
  });
});
