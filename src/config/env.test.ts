import { describe, expect, it } from "vitest";
import { ConfigValidationError, loadEnv } from "./env.js";

const baseEnv = {
  SUPABASE_URL: "https://ogxdszjypswutekqgorb.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-key-placeholder",
  SUPABASE_DB_URL: "postgresql://postgres.proj:pw@aws-0-eu-central-1.pooler.supabase.com:5432/postgres",
  SUPABASE_DB_CA_CERT_PATH: "/home/owner/prod-ca-2021.crt",
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

  it("refuses to start without a CA certificate path (TLS verification is mandatory)", () => {
    const { SUPABASE_DB_CA_CERT_PATH: _omitted, ...rest } = baseEnv;
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

describe("local-database test mode (TC-65 isolation)", () => {
  const localEnv = {
    ...baseEnv,
    SUPABASE_DB_URL: "postgresql://postgres:postgres@127.0.0.1:54330/postgres",
    SUPABASE_DB_CA_CERT_PATH: "",
  };

  it("accepts a strictly loopback database URL without a CA (test mode only)", () => {
    const env = loadEnv(localEnv, { localDatabase: true });
    expect(env.SUPABASE_DB_CA_CERT_PATH).toBeUndefined();
  });

  it("isolation guard: rejects a NON-loopback database URL even in test mode", () => {
    expect(() =>
      loadEnv({ ...localEnv, SUPABASE_DB_URL: "postgresql://postgres.proj:pw@aws-0-eu-central-1.pooler.supabase.com:5432/postgres" }, { localDatabase: true }),
    ).toThrow(/LOOPBACK/);
  });

  it("production mode still rejects the local URL and requires the CA (no weakening)", () => {
    expect(() => loadEnv(localEnv)).toThrow(ConfigValidationError); // not a pooler host
    const noCa = { ...baseEnv };
    delete (noCa as Record<string, string | undefined>).SUPABASE_DB_CA_CERT_PATH;
    expect(() => loadEnv(noCa)).toThrow(/SUPABASE_DB_CA_CERT_PATH/);
  });
});
