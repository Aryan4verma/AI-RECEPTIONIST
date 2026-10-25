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
import { buildApp } from "../server/app.js";
import { wavBytes } from "../speech/testUtils.js";

/**
 * Stage 9 — residual E2E paths not covered by earlier suites (fixture layer):
 * audio error handling (TC-09 negative), LLM outage mid-conversation (TC-18
 * LLM branch), and request flooding (TC-17/SEC-10 smoke).
 */
const SECRET = "0123456789abcdef0123456789abcdef";
const env = loadEnv({
  SUPABASE_URL: "https://ogxdszjypswutekqgorb.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-key-placeholder",
  SUPABASE_DB_URL: "postgresql://postgres.proj:pw@aws-0-eu-central-1.pooler.supabase.com:5432/postgres",
  SUPABASE_DB_CA_CERT_PATH: "/x",
  TOKEN_HASH_SECRET: SECRET,
  LOG_LEVEL: "fatal",
});

function makeSpeech(fail = false) {
  return {
    transcribe: async () => {
      if (fail) {
        const { AppError } = await import("../server/errors.js");
        throw new AppError("STT_FAILED", "The audio could not be transcribed.");
      }
      return { transcript: "hello", latencyMs: 1 };
    },
    healthCheck: async () => ({ ok: !fail }),
    stop: async () => undefined,
  };
}

async function build(providerFail = false, speechFail = false) {
  const conversations = new MemoryConversationRepo();
  const bookingState = new MemoryBookingStateRepo();
  const conversationService = new ConversationService({
    conversations,
    consent: new MemoryConsentRepo(),
    audit: new MemoryAuditRepo(),
    config: new MemoryBusinessConfigRepo(),
    provider: scriptedProvider(providerFail ? ["malformed"] : [{ intent: "greeting" }]),
    tokenHashSecret: SECRET,
  });
  const bookingService = new BookingService({
    bookingState, calendar: new MockCalendarAdapter(), tokenHashSecret: SECRET, offerTtlMinutes: 15,
  });
  const app = await buildApp({
    env, logger: createLogger(env),
    pgPool: { query: async () => ({ rows: [] }) } as never,
    ollamaBase: "http://localhost:11434",
    conversationService, bookingService,
    audio: { conversationService, speech: makeSpeech(speechFail) as never, maxAudioBytes: 1000, maxAudioSeconds: 60 },
  });
  return { app, conversationService };
}

const multipart = (body: Buffer, token: string) => ({
  method: "POST",
  headers: { "x-conversation-token": token, "content-type": "multipart/form-data; boundary=b" },
  payload: body,
});
const part = (data: Buffer) =>
  Buffer.concat([
    Buffer.from(`--b\r\nContent-Disposition: form-data; name="file"; filename="a.wav"\r\nContent-Type: audio/wav\r\n\r\n`),
    data,
    Buffer.from("\r\n--b--\r\n"),
  ]);

describe("Stage 9 residual paths (fixture)", () => {
  it("audio: unsupported format rejected by magic bytes before any STT work", async () => {
    const { app, conversationService } = await build();
    const s = await conversationService.start("text");
    const res = await app.inject({ ...multipart(part(Buffer.from([9, 9, 9, 9, 9])), s.accessToken), url: `/api/v1/conversations/${s.conversationId}/audio` });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("UNSUPPORTED_MEDIA_TYPE");
    await app.close();
  });

  it("audio: oversized payload rejected with the size limit envelope", async () => {
    const { app, conversationService } = await build();
    const s = await conversationService.start("text");
    const big = Buffer.concat([Buffer.from([0x4f, 0x67, 0x67, 0x53]), Buffer.alloc(1200)]);
    const res = await app.inject({ ...multipart(part(big), s.accessToken), url: `/api/v1/conversations/${s.conversationId}/audio` });
    expect([400, 413]).toContain(res.statusCode);
    expect(res.json().error.code).toBe("AUDIO_TOO_LARGE");
    await app.close();
  });

  it("audio: STT failure surfaces the safe STT_FAILED envelope (never a 500 leak)", async () => {
    const { app, conversationService } = await build(false, true);
    const s = await conversationService.start("text");
    const res = await app.inject({ ...multipart(part(Buffer.from(wavBytes(1))), s.accessToken), url: `/api/v1/conversations/${s.conversationId}/audio` });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("STT_FAILED");
    await app.close();
  });

  it("LLM outage mid-conversation: the turn degrades to the unknown path, conversation stays usable", async () => {
    const { app, conversationService } = await build(true);
    const s = await conversationService.start("text");
    const bad = await app.inject({
      method: "POST", url: `/api/v1/conversations/${s.conversationId}/messages`,
      headers: { "x-conversation-token": s.accessToken, "content-type": "application/json" },
      payload: { text: "book me something" },
    });
    expect(bad.statusCode).toBe(200); // degraded, not crashed
    expect(bad.json().intent).toBe("unknown");
    expect(bad.json().reply).toContain("didn't quite understand");
    // Conversation remains active for subsequent turns:
    const status = await app.inject({ method: "GET", url: `/api/v1/conversations/${s.conversationId}`, headers: { "x-conversation-token": s.accessToken } });
    expect(status.statusCode).toBe(200);
    expect(status.json().status).toBe("active");
    await app.close();
  });

  it("request flooding is bounded: a burst hits the shared rate limiter (SEC-10 smoke)", async () => {
    const { app } = await build();
    const codes = new Set<number>();
    for (let i = 0; i < 80; i++) {
      const res = await app.inject({ method: "GET", url: "/healthz" });
      codes.add(res.statusCode);
    }
    expect(codes.has(429)).toBe(true); // limiter engaged within a single client burst
    await app.close();
  });
});
