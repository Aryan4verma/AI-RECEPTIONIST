import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
import type { Env } from "../config/env.js";
import type { Logger } from "../observability/logger.js";
import { AppError, toEnvelope } from "./errors.js";
import { ZodError } from "zod";
import { registerHealthRoutes, type HealthDeps } from "./health.js";
import { registerConversationRoutes, type ConversationRouteDeps } from "../http/routes/public/conversations.js";
import { registerAdminRoutes, type AdminRouteDeps } from "../http/routes/admin/index.js";
import { registerAudioRoutes, type AudioRouteDeps } from "../http/routes/public/audio.js";

export interface AppDeps extends HealthDeps, ConversationRouteDeps {
  env: Env;
  logger: Logger;
  /** Present in production composition; tests may omit admin routes. */
  admin?: AdminRouteDeps;
  /** Present when speech is enabled; audio routes register only then. */
  audio?: AudioRouteDeps;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    loggerInstance: deps.logger as FastifyBaseLogger,
    trustProxy: false,
    bodyLimit: 1024 * 1024, // 1 MB JSON bound (SEC-10)
    genReqId: () => crypto.randomUUID(),
  });

  await app.register(multipart);
  await app.register(rateLimit, {
    global: true,
    max: 60,
    timeWindow: "1 minute",
  });

  app.setErrorHandler((rawErr, request, reply) => {
    // Route-level Zod validation failures are client errors (400 INVALID_INPUT)
    // with server-only details — never 500, never echoed payload text.
    let err = rawErr instanceof ZodError
      ? new AppError(
          "INVALID_INPUT",
          "Invalid request payload.",
          { issues: rawErr.issues.map((i) => `${i.path.join(".")}: ${i.message}`) },
        )
      : rawErr;
    // Rate-limit rejections arrive as framework errors — remap to the typed
    // envelope with the correct 429 (never a re-wrapped 500).
    if (!(err instanceof AppError) && (err as { statusCode?: unknown }).statusCode === 429) {
      err = new AppError("RATE_LIMITED", "Too many requests — please retry shortly.");
    }
    const envelope = toEnvelope(err, request.id);
    const rawStatus = (err as { statusCode?: unknown }).statusCode;
    // AppError carries its canonical HTTP status; framework errors carry
    // statusCode; anything else falls back to the code table.
    const status = err instanceof AppError
      ? err.status
      : typeof rawStatus === "number" && rawStatus >= 400 && rawStatus <= 599
        ? rawStatus
        : statusFor(envelope.error.code);
    // Log correlation and typed codes; the error serializer excludes raw
    // exception text, nested causes and SQL/provider data.
    deps.logger.warn(
      { requestId: request.id, code: envelope.error.code, err },
      "request failed",
    );
    reply.status(status).send(envelope);
  });

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      error: { code: "NOT_FOUND", message: "Unknown route.", requestId: request.id },
    });
  });

  registerHealthRoutes(app, deps);
  registerConversationRoutes(app, deps);
  if (deps.admin) registerAdminRoutes(app, deps.admin);
  if (deps.audio) registerAudioRoutes(app, deps.audio);

  return app;
}

function statusFor(code: string): number {
  if (code === "RATE_LIMITED") return 429;
  if (code === "NOT_FOUND") return 404;
  return 500;
}
