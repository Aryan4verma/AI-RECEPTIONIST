import { readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Pool } from "pg";
import type { Env } from "../config/env.js";

export interface DbClients {
  /** Data API client (service role) — server-only. Never a Postgres credential. */
  supabase: SupabaseClient;
  /** PostgreSQL pool via the session pooler — used for atomic transactions. */
  pgPool: Pool;
  close(): Promise<void>;
}

/**
 * Load the owner-supplied Supabase CA certificate for verify-full TLS.
 * Fails closed: an unreadable/missing certificate aborts startup — TLS
 * verification is never silently disabled (security preflight, condition 4).
 */
export function loadCaCert(path: string): string {
  try {
    const ca = readFileSync(path, "utf8");
    if (!ca.includes("BEGIN CERTIFICATE")) {
      throw new Error("file does not contain a PEM certificate");
    }
    return ca;
  } catch (err) {
    throw new Error(
      `SUPABASE_DB_CA_CERT_PATH is not a readable PEM certificate (${path}): ${err instanceof Error ? err.message : "unknown error"}. ` +
        "Download the CA certificate from the Supabase dashboard (Database settings) and provide its path. TLS verification cannot be skipped.",
    );
  }
}

export function createDbClients(env: Env): DbClients {
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const ca = loadCaCert(env.SUPABASE_DB_CA_CERT_PATH);
  const dbUrl = new URL(env.SUPABASE_DB_URL);
  const pgPool = new Pool({
    connectionString: env.SUPABASE_DB_URL,
    max: 3,
    ssl: {
      ca,
      rejectUnauthorized: true, // verify-full: certificate validation is mandatory
      servername: dbUrl.hostname, // SNI must match the pooler host being verified
    },
    application_name: "ai-receptionist-backend",
  });

  return {
    supabase,
    pgPool,
    async close() {
      await pgPool.end();
    },
  };
}

/** Connectivity probe used by /readyz. */
export async function checkDatabase(pgPool: Pool): Promise<{ ok: boolean; error?: string }> {
  try {
    await pgPool.query("select 1");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "unknown error" };
  }
}
