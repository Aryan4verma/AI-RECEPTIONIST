import { spawn, type ChildProcess } from "node:child_process";
import { freemem } from "node:os";
import { AppError } from "../server/errors.js";
import { inferenceGate } from "./gate.js";

/** SpeechToText port (ADR-0005): bounded, typed, never persistent. */
export interface SpeechToText {
  transcribe(audio: Uint8Array, maxSeconds: number): Promise<{ transcript: string; latencyMs: number }>;
  healthCheck(): Promise<{ ok: boolean; modelLoaded?: boolean; error?: string }>;
  stop(): Promise<void>;
}

/**
 * HTTP client for the Python sidecar. Every transcription holds the global
 * inference gate (sequential STT/LLM) and enforces a hard timeout.
 */
export class SidecarSpeechToText implements SpeechToText {
  constructor(
    private readonly deps: {
      baseUrl: string;
      fetchFn?: typeof fetch;
      timeoutMs?: number;
    },
  ) {}

  async transcribe(audio: Uint8Array, maxSeconds: number): Promise<{ transcript: string; latencyMs: number }> {
    const fetchFn = this.deps.fetchFn ?? fetch;
    const started = Date.now();
    return inferenceGate.run(async () => {
      let res: Response;
      try {
        res = await fetchFn(new URL(`/transcribe?max_seconds=${maxSeconds}`, this.deps.baseUrl), {
          method: "POST",
          headers: { "content-type": "application/octet-stream" },
          body: Buffer.from(audio.buffer, audio.byteOffset, audio.byteLength),
          signal: AbortSignal.timeout(this.deps.timeoutMs ?? 30_000),
        });
      } catch (err) {
        throw new AppError("STT_FAILED", "Speech recognition is currently unavailable.", {
          cause: err instanceof Error ? err.message : "unreachable",
        });
      }
      if (res.status === 413) {
        throw new AppError("AUDIO_TOO_LARGE", "The audio file exceeds the size limit.");
      }
      if (res.status === 422) {
        throw new AppError("STT_FAILED", "The audio could not be transcribed.");
      }
      if (!res.ok) {
        throw new AppError("STT_FAILED", "Speech recognition is currently unavailable.", {
          status: res.status,
        });
      }
      const body = (await res.json().catch(() => {
        throw new AppError("STT_FAILED", "Speech recognition returned an invalid response.");
      })) as { transcript?: string };
      if (typeof body?.transcript !== "string") {
        throw new AppError("STT_FAILED", "Speech recognition returned an invalid response.");
      }
      return { transcript: body.transcript, latencyMs: Date.now() - started };
    });
  }

  async healthCheck(): Promise<{ ok: boolean; modelLoaded?: boolean; error?: string }> {
    const fetchFn = this.deps.fetchFn ?? fetch;
    try {
      const res = await fetchFn(new URL("/health", this.deps.baseUrl), { signal: AbortSignal.timeout(3000) });
      if (!res.ok) return { ok: false, error: `status ${res.status}` };
      const body = (await res.json()) as { ok?: boolean; model_loaded?: boolean };
      return { ok: body.ok === true, modelLoaded: body.model_loaded };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "unreachable" };
    }
  }

  async stop(): Promise<void> {
    /* client-only instance: lifecycle managed elsewhere */
  }
}

export interface SidecarLifecycleDeps {
  port: number;
  pythonCmd: string;
  appPath: string;
  /** Minimum free system memory (bytes) required before spawning. */
  minFreeBytes: number;
  fetchFn?: typeof fetch;
  spawnFn?: typeof spawn;
  freememFn?: () => number;
}

/**
 * On-demand sidecar lifecycle (ADR-0005): admission check (free RAM), spawn,
 * health-wait, and graceful stop. The heavy Python process exists only while
 * speech is in use; the caller keeps it alive between requests and stops it
 * on shutdown/idle per the runbook.
 */
export class SidecarLifecycle {
  private child: ChildProcess | null = null;
  private starting: Promise<void> | null = null;

  constructor(private readonly deps: SidecarLifecycleDeps) {}

  get baseUrl(): string {
    return `http://127.0.0.1:${this.deps.port}`;
  }

  /** Ensure the sidecar is running (idempotent). Throws RESOURCE_LIMIT on admission failure. */
  async ensureStarted(): Promise<string> {
    if (await this.isHealthy()) return this.baseUrl;
    if (this.starting) {
      await this.starting;
      return this.baseUrl;
    }
    const free = (this.deps.freememFn ?? freemem)();
    if (free < this.deps.minFreeBytes) {
      throw new AppError("RESOURCE_LIMIT", "Insufficient free memory to start speech recognition. Try again after closing other applications.", {
        freeBytes: free,
        requiredBytes: this.deps.minFreeBytes,
      });
    }
    this.starting = (async () => {
      const spawnFn = this.deps.spawnFn ?? spawn;
      this.child = spawnFn(this.deps.pythonCmd, [this.deps.appPath], {
        env: { ...process.env, WHISPER_SIDECAR_PORT: String(this.deps.port) },
        stdio: ["ignore", "pipe", "pipe"],
      });
      this.child.unref();
      const fetchFn = this.deps.fetchFn ?? fetch;
      for (let i = 0; i < 120; i++) {
        try {
          const res = await fetchFn(new URL("/health", this.baseUrl), { signal: AbortSignal.timeout(1500) });
          if (res.ok) return;
        } catch {
          /* not up yet */
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
      throw new AppError("STT_FAILED", "The speech service did not become healthy in time.");
    })();
    try {
      await this.starting;
    } finally {
      this.starting = null;
    }
    return this.baseUrl;
  }

  async isHealthy(): Promise<boolean> {
    const fetchFn = this.deps.fetchFn ?? fetch;
    try {
      const res = await fetchFn(new URL("/health", this.baseUrl), { signal: AbortSignal.timeout(1500) });
      return res.ok;
    } catch {
      return false;
    }
  }

  async stop(): Promise<void> {
    if (!this.child) return;
    const child = this.child;
    this.child = null;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 5000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      child.kill("SIGTERM");
    });
  }
}
