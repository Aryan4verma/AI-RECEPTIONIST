import { expect, it } from "vitest";
import Fastify, { type FastifyBaseLogger } from "fastify";
import { createLogger } from "./logger.js";

it("never serializes exception messages, nested details, causes or SQL row contents", () => {
  let output = "";
  const logger = createLogger({ NODE_ENV: "test", LOG_LEVEL: "warn" }, { write(chunk: string) { output += chunk; } });
  const error = Object.assign(new Error("synthetic-confidential-error-canary"), { code: "INTERNAL", details: { providerError: "synthetic-provider-key-canary", token: "synthetic-token-canary" }, cause: new Error("synthetic-sql-row-canary") });
  logger.warn({ err: error, requestId: "synthetic-request", code: "INTERNAL" }, "request failed");
  for (const canary of ["synthetic-confidential-error-canary", "synthetic-provider-key-canary", "synthetic-token-canary", "synthetic-sql-row-canary"]) expect(output).not.toContain(canary);
  expect(output).toContain("synthetic-request");
  expect(output).toContain("INTERNAL");
});

it("real Fastify request logs retain the callback path but never OAuth query credentials or bearer headers", async () => {
  let output = "";
  const logger = createLogger({ NODE_ENV: "test", LOG_LEVEL: "info" }, {
    write(chunk: string) { output += chunk; },
  });
  const app = Fastify({ loggerInstance: logger as FastifyBaseLogger });
  app.get("/api/v1/admin/integrations/google/callback", (_request, reply) => reply.code(400).send({ error: "synthetic rejection" }));
  try {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/integrations/google/callback?code=synthetic-oauth-code&state=synthetic-oauth-state",
      headers: { authorization: "Bearer synthetic-admin-token" },
    });
    expect(res.statusCode).toBe(400);
    expect(output).toContain('"url":"/api/v1/admin/integrations/google/callback"');
    expect(output).toContain('"reqId":');
    for (const secret of ["synthetic-oauth-code", "synthetic-oauth-state", "synthetic-admin-token"]) {
      expect(output).not.toContain(secret);
    }
  } finally { await app.close(); }
});
