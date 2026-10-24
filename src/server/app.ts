import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import type { Env } from "../config/env.js";
import type { Logger } from "../observability/logger.js";
import { toEnvelope } from "./errors.js";
import { registerHealthRoutes, type HealthDeps } from "./health.js";
import { registerConversationRoutes, type ConversationRouteDeps } from "../http/routes/public/conversations.js";

export interface AppDeps extends HealthDeps, ConversationRouteDeps {
  env: Env;
  logger: Logger;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    loggerInstance: deps.logger as FastifyBaseLogger,
    trustProxy: false,
    bodyLimit: 1024 * 1024, // 1 MB JSON bound (SEC-10)
    genReqId: () => crypto.randomUUID(),
  });

  await app.register(rateLimit, {
    max: 60,
    timeWindow: "1 minute",
    errorResponseBuilder: (_req, ctx) => ({
      error: {
        code: "RATE_LIMITED",
        message: `Rate limit exceeded, retry in ${ctx.after}`,
      },
    }),
  });

  app.setErrorHandler((err, request, reply) => {
    const envelope = toEnvelope(err, request.id);
    const rawStatus = (err as { statusCode?: unknown }).statusCode;
    const status = typeof rawStatus === "number" && rawStatus >= 400 && rawStatus <= 599
      ? rawStatus
      : statusFor(envelope.error.code);
    // Full diagnostics stay server-side (pino redaction applies); the client
    // receives only the safe envelope (quality correction 3).
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

  return app;
}

function statusFor(code: string): number {
  if (code === "RATE_LIMITED") return 429;
  if (code === "NOT_FOUND") return 404;
  return 500;
}
