import pino from "pino";
import type { Env } from "../config/env.js";

/**
 * Structured logger with mandatory redaction. Message content is never logged —
 * callers log lengths/hashes for conversational content (SEC-11).
 */
export function createLogger(env: Pick<Env, "LOG_LEVEL" | "NODE_ENV">) {
  return pino({
    level: env.LOG_LEVEL,
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers['x-conversation-token']",
        "apiKey",
        "api_key",
        "credential",
        "token",
        "accessToken",
        "*.apiKey",
      ],
      censor: "[REDACTED]",
    },
    base: { env: env.NODE_ENV },
  });
}

export type Logger = ReturnType<typeof createLogger>;
