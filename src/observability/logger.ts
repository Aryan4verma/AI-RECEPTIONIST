import pino, { type DestinationStream } from "pino";
import type { Env } from "../config/env.js";

/**
 * Structured logger with mandatory redaction. Message content is never logged —
 * callers log lengths/hashes for conversational content (SEC-11).
 */
export function createLogger(env: Pick<Env, "LOG_LEVEL" | "NODE_ENV">, destination?: DestinationStream) {
  return pino({
    level: env.LOG_LEVEL,
    serializers: {
      // OAuth callbacks carry one-time credentials in the query string.
      // Keep request correlation and route information, never query values.
      req: (req: { method?: string; url?: string }) => ({
        method: req.method,
        url: req.url?.split("?")[0],
      }),
    },
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
  }, destination);
}

export type Logger = ReturnType<typeof createLogger>;
