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

export function createDbClients(env: Env): DbClients {
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const pgPool = new Pool({
    connectionString: env.SUPABASE_DB_URL,
    max: 3,
    ssl: { rejectUnauthorized: false }, // sslmode=require equivalent; verify-full with root cert at deployment hardening
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
