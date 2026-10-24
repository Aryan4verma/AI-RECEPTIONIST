import { describe, expect, it } from "vitest";
import { ConfigValidationError, loadEnv } from "./env.js";

const baseEnv = {
  SUPABASE_URL: "https://ogxdszjypswutekqgorb.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-key-placeholder",
  SUPABASE_DB_URL: "postgresql://postgres.proj:pw@aws-0-eu-central-1.pooler.supabase.com:5432/postgres",
  TOKEN_HASH_SECRET: "0123456789abcdef0123456789abcdef",
};

describe("env validation", () => {
  it("parses a minimal valid environment with defaults", () => {
    const env = loadEnv(baseEnv);
    expect(env.PORT).toBe(8787);
    expect(env.CALENDAR_MODE).toBe("mock");
    expect(env.OLLAMA_BASE_URL).toBe("http://localhost:11434");
  });

  it("fails fast on a missing secret", () => {
    const { SUPABASE_SERVICE_ROLE_KEY: _omitted, ...rest } = baseEnv;
    expect(() => loadEnv(rest)).toThrow(ConfigValidationError);
  });

  it("rejects a non-loopback Ollama URL (SEC-5)", () => {
    expect(() => loadEnv({ ...baseEnv, OLLAMA_BASE_URL: "https://api.example.com" })).toThrow(ConfigValidationError);
  });

  it("rejects a non-pooler database URL", () => {
    expect(() =>
      loadEnv({ ...baseEnv, SUPABASE_DB_URL: "postgresql://postgres:pw@db.ogxdszjypswutekqgorb.supabase.co:5432/postgres" }),
    ).toThrow(ConfigValidationError);
  });

  it("refuses CALENDAR_MODE=google outright (Q3 authorization boundary)", () => {
    expect(() => loadEnv({ ...baseEnv, CALENDAR_MODE: "google" })).toThrow(ConfigValidationError);
  });

  it("does not echo secret values in validation errors", () => {
    try {
      loadEnv({ ...baseEnv, TOKEN_HASH_SECRET: "short" });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigValidationError);
      expect((err as ConfigValidationError).message).not.toContain("0123456789abcdef");
    }
  });
});
