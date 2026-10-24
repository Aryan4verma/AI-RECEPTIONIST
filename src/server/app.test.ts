import { describe, expect, it } from "vitest";
import { loadEnv } from "../config/env.js";
import { createLogger } from "../observability/logger.js";
import { buildApp } from "./app.js";

const env = loadEnv({
  SUPABASE_URL: "https://ogxdszjypswutekqgorb.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-key-placeholder",
  SUPABASE_DB_URL: "postgresql://postgres.proj:pw@aws-0-eu-central-1.pooler.supabase.com:5432/postgres",
  SUPABASE_DB_CA_CERT_PATH: "/home/owner/prod-ca-2021.crt",
  TOKEN_HASH_SECRET: "0123456789abcdef0123456789abcdef",
  LOG_LEVEL: "fatal",
});

const stubPool = { query: async () => ({ rows: [] }) } as never;

describe("http app", () => {
  it("serves /healthz", async () => {
    const app = await buildApp({
      env,
      logger: createLogger(env),
      pgPool: stubPool,
      ollamaBase: "http://localhost:11434",
    });
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "alive" });
    await app.close();
  });

  it("serves an honest degraded /readyz when Ollama is down (TC-21 readiness view)", async () => {
    const app = await buildApp({
      env,
      logger: createLogger(env),
      pgPool: stubPool,
      ollamaBase: "http://localhost:11434",
      fetchFn: (async () => {
        throw new Error("ECONNREFUSED");
      }) as unknown as typeof fetch,
    });
    const res = await app.inject({ method: "GET", url: "/readyz" });
    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.status).toBe("degraded");
    expect(body.dependencies.ollama.ok).toBe(false);
    await app.close();
  });

  it("returns the shared error envelope for unknown routes", async () => {
    const app = await buildApp({
      env,
      logger: createLogger(env),
      pgPool: stubPool,
      ollamaBase: "http://localhost:11434",
    });
    const res = await app.inject({ method: "GET", url: "/nope" });
    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.error.code).toBe("NOT_FOUND");
    expect(body.error.requestId).toBeTruthy();
    await app.close();
  });
});
