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
  MemoryCustomerRepo,
} from "../db/memory/stores.js";
import { scriptedProvider } from "../domain/conversation/testProvider.js";
import { BookingService } from "../domain/booking/service.js";
import { ConversationService } from "../domain/conversation/service.js";
import { buildApp } from "../server/app.js";
import { inferenceGate } from "../concurrency/inferenceGate.js";
import { wavBytes } from "../speech/testUtils.js";

/**
 * Finding 1 proof: REAL application paths cannot overlap heavy inference.
 * The audio route drives speech.transcribe (gate-held) and then the
 * conversation turn whose provider.structured is the same process-wide gate —
 * using the SAME gating wrapper the real OllamaProvider uses. A concurrent
 * direct LLM call from another "flow" must wait until the audio turn's STT
 * AND LLM complete. Layer: fixture providers, real route composition.
 */

const SECRET = "0123456789abcdef0123456789abcdef";
const env = loadEnv({
  SUPABASE_URL: "https://ogxdszjypswutekqgorb.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-key-placeholder",
  SUPABASE_DB_URL: "postgresql://postgres.proj:pw@aws-0-eu-central-1.pooler.supabase.com:5432/postgres",
  SUPABASE_DB_CA_CERT_PATH: "/home/owner/prod-ca-2021.crt",
  TOKEN_HASH_SECRET: SECRET,
  LOG_LEVEL: "fatal",
});

describe("sequential inference across real application paths (finding 1)", () => {
  it("STT and LLM within one audio turn never overlap, and a concurrent flow waits", async () => {
    const timeline: Array<{ event: string; t: number }> = [];
    const mark = (event: string) => timeline.push({ event, t: Date.now() });

    // Gated STT fake — the exact mechanism SidecarSpeechToText uses.
    const speech = {
      transcribe: async (audio: Uint8Array, maxSeconds: number) =>
        inferenceGate.run(async () => {
          mark("stt:start");
          await new Promise((r) => setTimeout(r, 60));
          mark("stt:end");
          void audio; void maxSeconds;
          return { transcript: "hello I want to book", latencyMs: 60 };
        }),
      healthCheck: async () => ({ ok: true }),
      stop: async () => undefined,
    };

    // Gated LLM fake — same wrapper OllamaProvider.structured uses.
    const provider = {
      kind: "local" as const, adapter: "ollama" as const,
      discoverModels: async () => [{ name: "qwen3:1.7b" }],
      structured: (request: unknown) =>
        inferenceGate.run(async () => {
          mark("llm:start");
          await new Promise((r) => setTimeout(r, 40));
          mark("llm:end");
          const schema = (request as { schema: { safeParse: (v: unknown) => { success: boolean } } }).schema;
          const parsed = schema.safeParse({ schema_version: 1, intent: "book_appointment" });
          return parsed.success
            ? { status: "ok", value: { schema_version: 1, intent: "book_appointment" }, raw: "" }
            : { status: "invalid_output", reason: "fixture", raw: "" };
        }) as never,
      healthCheck: async () => ({ ok: true }),
    };

    const conversations = new MemoryConversationRepo();
    const bookingState = new MemoryBookingStateRepo();
    const conversationService = new ConversationService({
      conversations,
      consent: new MemoryConsentRepo(),
      audit: new MemoryAuditRepo(),
      config: new MemoryBusinessConfigRepo(),
      provider: provider as never,
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
      audio: {
        conversationService,
        speech: speech as never,
        maxAudioBytes: 10 ** 6,
        maxAudioSeconds: 60,
      },
    });

    const started = await conversationService.start("text");
    // A concurrent LLM-only flow from a DIFFERENT async context:
    const concurrent = provider.structured({
      schema: { safeParse: (v: unknown) => ({ success: (v as { intent?: string })?.intent === "book_appointment" }) },
    } as never) as Promise<{ status: string }>;
    void concurrent;

    const audioRes = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${started.conversationId}/audio`,
      headers: { "x-conversation-token": started.accessToken, "content-type": "multipart/form-data; boundary=b" },
      payload: Buffer.concat([
        Buffer.from(`--b\r\nContent-Disposition: form-data; name="file"; filename="a.wav"\r\nContent-Type: audio/wav\r\n\r\n`),
        Buffer.from(wavBytes(1)),
        Buffer.from("\r\n--b--\r\n"),
      ]),
    });
    expect(audioRes.statusCode, audioRes.body.slice(0, 200)).toBe(200);
    await concurrent;

    // GLOBAL invariant: heavy sections strictly alternate start/end — no two
    // intervals can ever overlap, regardless of which flow they belong to.
    const seq = timeline.map((x) => x.event);
    expect(seq.length).toBeGreaterThanOrEqual(4);
    for (let i = 0; i < seq.length; i += 2) {
      const s = seq[i] ?? "";
      const e = seq[i + 1] ?? "";
      expect(s.endsWith(":start"), ).toBe(true);
      expect(e, ).toBe(s.replace(":start", ":end"));
    }
    // Within the AUDIO turn specifically: its STT ends before its LLM begins.
    const lastIdx = (e: string) => seq.lastIndexOf(e);
    expect(lastIdx("stt:end")).toBeGreaterThanOrEqual(0);
    expect(lastIdx("llm:start")).toBeGreaterThan(lastIdx("stt:end"));
    await app.close();
  });

  it("the gate is reentrant within one logical flow (no self-deadlock)", async () => {
    const inner = await inferenceGate.run(async () => inferenceGate.run(async () => "inner-ok"));
    expect(inner).toBe("inner-ok");
  });
});
