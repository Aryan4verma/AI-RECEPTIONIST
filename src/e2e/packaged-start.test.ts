import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * Packaged-process smoke test (final safety check 3): the COMPILED
 * dist/server/main.js actually starts with a valid-shaped environment and
 * serves /healthz — verifying npm run build + npm start end-to-end at the
 * process level (no DB connection needed for liveness; clients are lazy).
 * Layer: real packaged process, fixture environment.
 */
const PORT = 8797;
const caPath = join(mkdtempSync(join(tmpdir(), "smoke-ca-")), "ca.crt");
writeFileSync(caPath, "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n");

const env: Record<string, string> = {
  ...process.env,
  PORT: String(PORT),
  SUPABASE_URL: "https://ogxdszjypswutekqgorb.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-key-placeholder",
  SUPABASE_DB_URL: "postgresql://postgres.proj:pw@aws-0-eu-central-1.pooler.supabase.com:5432/postgres",
  SUPABASE_DB_CA_CERT_PATH: caPath,
  TOKEN_HASH_SECRET: "0123456789abcdef0123456789abcdef",
  LOG_LEVEL: "fatal",
};

let child: ReturnType<typeof spawn> | null = null;

afterAll(() => {
  child?.kill();
});

describe("packaged server startup", () => {
  it("compiled dist/server/main.js exists after build", () => {
    expect(existsSync("dist/server/main.js")).toBe(true);
    expect(existsSync("dist/config/env.js")).toBe(true);
  });

  it("starts the compiled server and serves /healthz", { timeout: 60_000 }, async () => {
    child = spawn(process.execPath, ["dist/server/main.js"], { env, stdio: "ignore" });
    // Poll /healthz until the process is listening (or timeout):
    let lastError: unknown = null;
    let healthy = false;
    for (let i = 0; i < 40; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${PORT}/healthz`, { signal: AbortSignal.timeout(1500) });
        if (res.ok) {
          healthy = true;
          const body = (await res.json()) as { status: string };
          expect(body.status).toBe("alive");
          break;
        }
      } catch (err) {
        lastError = err;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    expect(healthy, `compiled server never became healthy: ${lastError}`).toBe(true);
    // Process still running (no startup crash):
    expect(child.exitCode).toBeNull();
  });

  it("fails fast on a missing CA certificate (fail-closed startup)", { timeout: 30_000 }, async () => {
    const bad = spawn(
      process.execPath,
      ["dist/server/main.js"],
      { env: { ...env, PORT: String(PORT + 1), SUPABASE_DB_CA_CERT_PATH: join(tmpdir(), "synthetic-confidential-path-canary.crt") }, stdio: "pipe" },
    );
    let stderr = "";
    bad.stderr?.on("data", (d) => (stderr += String(d)));
    bad.stdout?.on("data", (d) => (stderr += String(d)));
    const code = await new Promise<number | null>((resolve) => {
      const t = setTimeout(() => resolve(null), 15_000);
      bad.on("exit", (c) => {
        clearTimeout(t);
        resolve(c);
      });
    });
    expect(code).not.toBeNull(); // exited (fail-closed), never kept listening
    expect(stderr).toContain("Backend startup failed");
    expect(stderr).not.toContain("synthetic-confidential-path-canary");
  });
});
