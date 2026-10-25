import { z } from "zod";

const loopbackHttpUrl = z
  .url()
  .refine((v) => {
    try {
      const u = new URL(v);
      return u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
    } catch {
      return false;
    }
  }, "must be a loopback HTTP URL (Ollama is never internet-exposed)");

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1024).max(65535).default(8787),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  // public class
  SUPABASE_URL: z.url(),
  SUPABASE_PUBLISHABLE_KEY: z.string().optional(),
  OLLAMA_BASE_URL: loopbackHttpUrl.default("http://localhost:11434"),
  WHISPER_SIDECAR_PORT: z.coerce.number().int().min(1024).max(65535).default(8788),
  WHISPER_MODEL: z.enum(["tiny-int8", "base-int8"]).default("tiny-int8"),
  CALENDAR_MODE: z.enum(["mock", "google"]).default("mock"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  MAX_AUDIO_MB: z.coerce.number().int().min(1).max(10).default(10),
  MAX_AUDIO_SECONDS: z.coerce.number().int().min(1).max(60).default(60),
  // server-only secrets
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SUPABASE_DB_URL: z
    .string()
    .refine((v) => v.startsWith("postgresql://") || v.startsWith("postgres://"), "must be a postgres connection string")
    .refine((v) => {
      try {
        return new URL(v).hostname.endsWith(".pooler.supabase.com");
      } catch {
        return false;
      }
    }, "expected the session-pooler host (*.pooler.supabase.com) per the approved connection mode"),
  // TLS verification is mandatory in production (fail-closed): path to the
  // Supabase CA certificate downloaded from the dashboard. Never committed.
  // (Optional only in the strictly-loopback test mode below.)
  SUPABASE_DB_CA_CERT_PATH: z.string().min(1, "required — TLS verification must not be disabled"),

  TOKEN_HASH_SECRET: z.string().min(32),
  // Optional secrets normalize BLANK values to undefined — an unfilled
  // .env line must never fail startup (final runtime check 2). Fail-closed
  // verification applies only when a secret is actually required.
  SECRET_MASTER_KEY: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().min(32).optional(),
  ), // inert unless a fallback store is separately approved (ADR-0002 v0.2)
  // Stage 7 only
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
  GOOGLE_OAUTH_REDIRECT_URI: z.string().optional(),
  /** Dedicated Calendar ID — every Google operation targets exactly this calendar. */
  GOOGLE_CALENDAR_ID: z.string().optional(),
});

const localEnvSchema = envSchema.extend({
  SUPABASE_URL: z.string().url(),
  SUPABASE_DB_URL: z
    .string()
    .refine((v) => v.startsWith("postgresql://") || v.startsWith("postgres://"), "must be a postgres connection string")
    .refine((v) => {
      try {
        return ["127.0.0.1", "localhost", "[::1]", "::1"].includes(new URL(v).hostname);
      } catch {
        return false;
      }
    }, "local test mode requires a LOOPBACK database address (isolation guard)"),
  // Blank/absent CA is allowed ONLY in loopback test mode; createDbClients
  // then connects without TLS to the local container.
  SUPABASE_DB_CA_CERT_PATH: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().optional(),
  ),
});

/**
 * Test-only local-database mode (TC-65): the DB URL must be a LOOPBACK
 * postgres address (isolation guard — a test config can never point at the
 * shared project), TLS/CA becomes optional, and SUPABASE_URL may be any URL.
 * Production (no opts) keeps the strict pooler-hostname + mandatory-CA
 * validation unchanged — this mode cannot weaken it.
 */
export interface EnvOptions {
  localDatabase?: boolean;
}

export class ConfigValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid configuration: ${issues.join("; ")}`);
    this.name = "ConfigValidationError";
  }
}

export function loadEnv(
  source: Record<string, string | undefined> = process.env,
  opts: EnvOptions = {},
): Env {
  const schema = opts.localDatabase ? localEnvSchema : envSchema;
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    throw new ConfigValidationError(
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    );
  }
  const requiredGoogle = [
    "GOOGLE_OAUTH_CLIENT_ID",
    "GOOGLE_OAUTH_CLIENT_SECRET",
    "GOOGLE_OAUTH_REDIRECT_URI",
    "GOOGLE_CALENDAR_ID",
  ] as const;
  if (parsed.data.CALENDAR_MODE === "google") {
    const missing = requiredGoogle.filter((k) => !parsed.data[k]);
    if (missing.length > 0) {
      throw new ConfigValidationError([
        `CALENDAR_MODE=google requires ${missing.join(", ")} — complete the owner setup in .env (see .env.example), or use CALENDAR_MODE=mock`,
      ]);
    }
    // Configuration alone does not authorize real Calendar writes: the
    // adapter stays inert until the owner completes the OAuth connection,
    // and genuine event writes remain gated by the Q3 action authorization.
  }
  return parsed.data;
}

// Widest runtime shape; production strictness is enforced at parse time.
export type Env = z.infer<typeof localEnvSchema>;
