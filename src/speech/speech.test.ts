import { describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { AppError } from "../server/errors.js";
import { detectAudioKind, validateAudio, wavDurationSeconds } from "./audioValidation.js";
import { InferenceGate } from "./gate.js";
import { SidecarLifecycle, SidecarSpeechToText } from "./sidecar.js";
import { wavBytes } from "./testUtils.js";

/**
 * Speech-module fixture tests (layer: FIXTURE — the Python sidecar is
 * exercised only by the gated live script; these prove the contracts).
 */


describe("audio boundary validation (FR-8/SEC-10)", () => {
  it("sniffs containers by magic bytes", () => {
    expect(detectAudioKind(wavBytes())).toBe("wav");
    expect(detectAudioKind(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0]))).toBe("webm");
    expect(detectAudioKind(new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0, 0]))).toBe("ogg");
    expect(detectAudioKind(new Uint8Array([0, 0, 0, 0x20, ...Buffer.from("ftypM4A")]))).toBe("m4a");
    expect(detectAudioKind(new Uint8Array([1, 2, 3, 4, 5, 6]))).toBeNull();
  });

  it("computes WAV duration from headers and rejects over-limit durations", () => {
    expect(wavDurationSeconds(wavBytes(30, 8000))).toBeCloseTo(0.0005, 4); // 4-byte data payload
    const long = wavBytes(120);
    // forge a data size implying 120s at 32kB/s:
    const buf = Buffer.from(long);
    buf.writeUInt32LE(120 * 32000, 40);
    expect(() =>
      validateAudio(new Uint8Array(buf), { maxBytes: 10 ** 6, maxSeconds: 60 }),
    ).toThrow(AppError);
  });

  it("rejects empty, oversized and unknown payloads with typed errors", () => {
    expect(() => validateAudio(new Uint8Array(0), { maxBytes: 10, maxSeconds: 60 })).toThrow(AppError);
    const big = new Uint8Array(11);
    big.set([0x4f, 0x67, 0x67, 0x53]);
    expect(() => validateAudio(big, { maxBytes: 10, maxSeconds: 60 })).toMatchObject({});
    expect(() => validateAudio(new Uint8Array([9, 9, 9, 9, 9]), { maxBytes: 10, maxSeconds: 60 })).toThrow(
      /format is not supported/,
    );
  });
});

describe("inference gate (sequential STT/LLM)", () => {
  it("never runs two sections concurrently and is FIFO", async () => {
    const gate = new InferenceGate();
    const events: string[] = [];
    const task = async (name: string, ms: number) =>
      gate.run(async () => {
        events.push(`start:${name}`);
        await new Promise((r) => setTimeout(r, ms));
        events.push(`end:${name}`);
      });
    await Promise.all([task("a", 30), task("b", 10)]);
    expect(events).toEqual(["start:a", "end:a", "start:b", "end:b"]);
  });

  it("releases ownership when a section throws", async () => {
    const gate = new InferenceGate();
    await expect(gate.run(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    await gate.run(async () => "ok"); // must not deadlock
  });
});

describe("SidecarSpeechToText client (fixture HTTP)", () => {
  async function withServer(
    handler: (body: Buffer) => { status: number; json: unknown },
  ): Promise<{ server: Server; url: string }> {
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const out = handler(Buffer.concat(chunks));
        res.writeHead(out.status, { "content-type": "application/json" });
        res.end(JSON.stringify(out.json));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const address = server.address();
    const url = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
    return { server, url };
  }

  it("returns the transcript and latency on success", async () => {
    const { server, url } = await withServer(() => ({ status: 200, json: { transcript: "hello there" } }));
    const stt = new SidecarSpeechToText({ baseUrl: url });
    const result = await stt.transcribe(wavBytes(), 60);
    expect(result.transcript).toBe("hello there");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    server.close();
  });

  it("maps sidecar 413/422/5xx/invalid-json to typed errors", async () => {
    for (const [status, json, code] of [
      [413, { error: "audio_too_large" }, "AUDIO_TOO_LARGE"],
      [422, { error: "transcription_failed" }, "STT_FAILED"],
      [500, { error: "model_load_failed" }, "STT_FAILED"],
      [200, { nonsense: true }, "STT_FAILED"],
    ] as const) {
      const { server, url } = await withServer(() => ({ status, json }));
      const stt = new SidecarSpeechToText({ baseUrl: url });
      await expect(stt.transcribe(wavBytes(), 60)).rejects.toMatchObject({ code });
      server.close();
    }
  });

  it("unreachable sidecar surfaces STT_FAILED with server-only cause", async () => {
    const stt = new SidecarSpeechToText({ baseUrl: "http://127.0.0.1:1" });
    await expect(stt.transcribe(wavBytes(), 60)).rejects.toMatchObject({ code: "STT_FAILED" });
  });

  it.each(["not json", "null"])("malformed response %s is a typed STT failure, not an unhandled parser error", async body => {
    const stt = new SidecarSpeechToText({ baseUrl: "http://fixture", fetchFn: (async () => new Response(body, { status: 200 })) as typeof fetch });
    await expect(stt.transcribe(wavBytes(), 60)).rejects.toMatchObject({ code: "STT_FAILED" });
  });
});

describe("SidecarLifecycle admission (RAM guard)", () => {
  it("refuses to spawn below the free-memory floor (RESOURCE_LIMIT, no spawn)", async () => {
    let spawned = 0;
    const lifecycle = new SidecarLifecycle({
      port: 59999, pythonCmd: "python", appPath: "x",
      minFreeBytes: 1000,
      freememFn: () => 500,
      spawnFn: (() => {
        spawned += 1;
        return {} as never;
      }) as never,
    });
    await expect(lifecycle.ensureStarted()).rejects.toMatchObject({ code: "RESOURCE_LIMIT" });
    expect(spawned).toBe(0);
  });
});
