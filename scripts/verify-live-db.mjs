// Live-database readiness verification (read-only).
// Loads the real .env, verifies TLS/PostgreSQL connectivity, the applied
// schema contract, RLS/grant posture and migration history — via SELECT-only
// queries. Never prints credential values. Exits 0 only when every check passes.
import "dotenv/config";
import { loadEnv } from "../dist/config/env.js";
import { createDbClients } from "../dist/db/clients.js";

const env = loadEnv(process.env);
console.log("[1/5] configuration: valid (all required secrets present, values not shown)");

let db;
try {
  db = createDbClients(env);
  const probe = await db.pgPool.query("select 1");
  void probe;
  console.log("[2/5] TLS + PostgreSQL connectivity: session-pooler connection established");
} catch (err) {
  const message = err instanceof Error ? err.message : "unknown error";
  if (message.includes("password authentication failed")) {
    console.error(
      "[2/5] BLOCKED: password authentication failed for the pooler user.\n       The session pooler username must be `postgres.ogxdszjypswutekqgorb` \n       (project-ref suffix), not plain `postgres`.\n       Fix SUPABASE_DB_URL in .env: copy the session-pooler string from Supabase dashboard -> Connect.");
  } else {
    console.error("[2/5] BLOCKED: ${message}");
  }
  process.exit(2);
}

const checks = [];
const run = async (name, query, expect) => {
  const { rows } = await db.pgPool.query(query);
  const ok = expect(rows);
  checks.push({ name, ok, detail: expect.detailText ?? "" });
  if (!ok) throw new Error(`check failed: ${name}`);
  return rows;
};

// Applied schema: all 11 tables with RLS enabled
const tables = await run(
  "RLS enabled on all application tables",
  `select c.relname as name, c.relrowsecurity as rls from pg_class c
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' order by c.relname`,
  (rows) => {
    expect.detailText = `${rows.length} tables, ${rows.filter((r) => r.rls).length} with RLS`;
    return rows.length === 11 && rows.every((r) => r.rls);
  },
);

// Migration history matches the committed stream
const migrations = await run(
  "remote migration history (6 applied)",
  `select version from supabase_migrations.schema_migrations order by version`,
  (rows) => {
    expect.detailText = rows.map((r) => r.version).join(", ");
    return rows.length === 6;
  },
);

// Grant posture (read-only catalog function)
await run(
  "role grant matrix (anon zero, authenticated scoped, service_role backend)",
  `select
     has_table_privilege('anon','public.customers','select') as anon_select,
     has_table_privilege('authenticated','public.customers','select') as auth_select,
     has_table_privilege('authenticated','public.messages','insert') as auth_insert_messages,
     has_table_privilege('service_role','public.appointments','insert') as svc_insert,
     has_table_privilege('service_role','public.audit_log','delete') as svc_delete_audit`,
  (rows) => {
    const r = rows[0];
    expect.detailText = `anon_select=${r.anon_select} auth_insert_messages=${r.auth_insert_messages} svc_delete_audit=${r.svc_delete_audit}`;
    return r.anon_select === false && r.auth_select === true && r.auth_insert_messages === false && r.svc_insert === true && r.svc_delete_audit === false;
  },
);

// Consent trigger present and enabled
await run(
  "consent enforcement trigger active",
  `select tgname, tgenabled from pg_trigger
   where tgrelid = 'public.recordings'::regclass and not tgisinternal`,
  (rows) => rows.length === 1 && rows[0].tgenabled === "O",
);

// Security helper hardened
await run(
  "SECURITY DEFINER helpers pinned search_path",
  `select p.proname, p.proconfig from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private'`,
  (rows) => rows.length === 2 && rows.every((r) => r.proconfig?.some((c) => c.includes('search_path=""'))),
);

// Business tables are empty (no unexpected data before the authorized E2E)
const counts = await run(
  "application tables empty (pre-E2E state)",
  `select
     (select count(*) from public.customers) as customers,
     (select count(*) from public.conversations) as conversations,
     (select count(*) from public.appointments) as appointments`,
  (rows) => {
    expect.detailText = `customers=${rows[0].customers} conversations=${rows[0].conversations} appointments=${rows[0].appointments}`;
    return Number(rows[0].customers) === 0 && Number(rows[0].conversations) === 0 && Number(rows[0].appointments) === 0;
  },
);

console.log("[3/5] schema contract + RLS + grants + trigger + history: all checks passed");
console.log(`      (${tables.length} tables; migrations: ${migrations.length})`);

// Ollama reachability (real-model layer)
let ollama = "unreachable";
try {
  const res = await fetch(new URL("/api/version", env.OLLAMA_BASE_URL), { signal: AbortSignal.timeout(3000) });
  ollama = res.ok ? "reachable" : `status ${res.status}`;
} catch {
  /* unreachable */
}
console.log(`[4/5] Ollama (${env.OLLAMA_BASE_URL}): ${ollama}`);

await db.close();
console.log("[5/5] READINESS: PASS — all read-only live-database checks passed (no data written)");
process.exit(0);
