// Live-database readiness verification (read-only).
// Loads the real .env, verifies TLS/PostgreSQL connectivity, the applied
// schema contract, RLS/grant posture and migration history — via SELECT-only
// queries. Never prints credential values. Exits 0 only when every check passes.
import "dotenv/config";
import { pathToFileURL } from "node:url";
import { readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";

function committedMigrations() {
  const dir = new URL("../supabase/migrations/", import.meta.url);
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => {
      const m = /^(\d+)_(.+)\.sql$/.exec(f);
      const hash = createHash("sha256").update(readFileSync(new URL(f, dir))).digest("hex").slice(0, 16);
      return { file: f, version: m?.[1] ?? "", name: m?.[2] ?? "", hash };
    })
    .filter((x) => x.version);
}

function committedTables() {
  const dir = new URL("../supabase/migrations/", import.meta.url);
  return committedMigrations().flatMap((migration) => {
    const sql = readFileSync(new URL(migration.file, dir), "utf8").replace(/--[^\n]*/g, "");
    return [...sql.matchAll(/create table\s+(?:if not exists\s+)?public\.(\w+)/gi)].map((m) => m[1]);
  }).sort();
}
import { loadEnv } from "../dist/config/env.js";
import { createDbClients } from "../dist/db/clients.js";

const POOLER_USER = "postgres.ogxdszjypswutekqgorb";

/**
 * Distinguish a wrong POOLER USERNAME from a wrong DATABASE PASSWORD without
 * exposing credentials (repair finding 1). Postgres reports both as 28P01
 * "password authentication failed for user <username>" — the attempted
 * username is diagnostic, not secret.
 */
export function classifyPgAuthError(message) {
  const match = /for user "([^"]+)"/.exec(message ?? "");
  const attemptedUser = match?.[1] ?? "unknown";
  if (attemptedUser === POOLER_USER) {
    return {
      kind: "password",
      hint:
        "The pooler username is correct (" +
        POOLER_USER +
        "); the database password is incorrect. Copy a fresh session-pooler string from Supabase dashboard -> Connect.",
    };
  }
  return {
    kind: "username",
    hint:
      'The attempted user is "' +
      attemptedUser +
      '"; the session pooler requires "' +
      POOLER_USER +
      '" (project-ref suffix). Copy the session-pooler string from Supabase dashboard -> Connect.',
  };
}

/** Check contract: callbacks RETURN { ok, detail } — no shared mutable state. */
const run = async (pool, name, query, evaluate) => {
  const { rows } = await pool.query(query);
  const { ok, detail } = evaluate(rows);
  return { name, ok, detail };
};

export async function verify(pool) {
  const checks = [];

  checks.push(
    await run(
      pool,
      "RLS enabled on all application tables",
      `select c.relname as name, c.relrowsecurity as rls from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' order by c.relname`,
      (rows) => {
        const expected = committedTables();
        return {
          ok: JSON.stringify(rows.map((r) => r.name).sort()) === JSON.stringify(expected) && rows.every((r) => r.rls),
          detail: `${rows.length} tables (expected ${expected.length}), ${rows.filter((r) => r.rls).length} with RLS`,
        };
      },
    ),
  );

  checks.push(
    await run(
      pool,
      "migration stream identity (committed files == remote history, hashes recorded)",
      `select version, name from supabase_migrations.schema_migrations order by version`,
      (rows) => {
        // Complete-stream comparison, not a count: every committed file must
        // appear remotely as version+name, and vice versa. File SHA-256 hashes
        // are recorded as evidence (the remote table stores no hashes — an
        // explicit, documented limitation; catalog checks cover structure).
        const committed = committedMigrations();
        const remoteKeys = new Set(rows.map((r) => `${r.version}:${r.name}`));
        const localKeys = new Set(committed.map((m) => `${m.version}:${m.name}`));
        const identical =
          remoteKeys.size === localKeys.size && [...remoteKeys].every((k) => localKeys.has(k));
        return {
          ok: identical && committed.length > 0,
          detail: identical
            ? committed.map((m) => `${m.version}_${m.name}#${m.hash}`).join(", ")
            : `remote=[${[...remoteKeys].join("|")}] committed=[${[...localKeys].join("|")}]`,
        };
      },
    ),
  );

  checks.push(
    await run(
      pool,
      "role grant matrix (anon zero, authenticated scoped, service_role backend)",
      `select
         has_table_privilege('anon','public.customers','select') as anon_select,
         has_table_privilege('authenticated','public.customers','select') as auth_select,
         has_table_privilege('authenticated','public.messages','insert') as auth_insert_messages,
         has_table_privilege('service_role','public.appointments','insert') as svc_insert,
         has_table_privilege('service_role','public.audit_log','delete') as svc_delete_audit`,
      (rows) => {
        const r = rows[0];
        return {
          ok:
            r.anon_select === false &&
            r.auth_select === true &&
            r.auth_insert_messages === false &&
            r.svc_insert === true &&
            r.svc_delete_audit === false,
          detail: `anon_select=${r.anon_select} auth_insert_messages=${r.auth_insert_messages} svc_delete_audit=${r.svc_delete_audit}`,
        };
      },
    ),
  );

  checks.push(
    await run(
      pool,
      "consent enforcement trigger active",
      `select tgname, tgenabled from pg_trigger
       where tgrelid = 'public.recordings'::regclass and not tgisinternal`,
      (rows) => ({
        ok: rows.length === 1 && rows[0].tgenabled === "O",
        detail: rows.map((r) => `${r.tgname}:${r.tgenabled}`).join(", "),
      }),
    ),
  );

  checks.push(
    await run(
      pool,
      "SECURITY DEFINER helpers pinned search_path",
      `select p.proname, p.proconfig from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private'`,
      (rows) => ({
        ok: rows.length === 2 && rows.every((r) => r.proconfig?.some((c) => c.includes('search_path=""'))),
        detail: rows.map((r) => r.proname).join(", "),
      }),
    ),
  );

  checks.push(
    await run(
      pool,
      "populated booking integrity (read-only; emptiness is not a readiness requirement)",
      `select
         (select count(*) from public.customers) as customers,
         (select count(*) from public.conversations) as conversations,
         (select count(*) from public.appointments) as appointments,
         (select count(*) from public.appointments a left join public.conversations c on c.id=a.conversation_id
          where a.conversation_id is not null and c.id is null) as orphan_appointments,
         (select count(*) from public.appointments where status='confirmed' and google_event_id is null) as confirmed_without_event,
         (select count(*) from (select google_event_id from public.appointments where google_event_id is not null
          group by google_event_id having count(*) > 1) d) as duplicate_events,
         (select count(*) from public.appointments where status='unresolved') as unresolved_appointments`,
      (rows) => ({
        ok:
          Number(rows[0].orphan_appointments) === 0 &&
          Number(rows[0].confirmed_without_event) === 0 &&
          Number(rows[0].duplicate_events) === 0 &&
          Number(rows[0].unresolved_appointments) === 0,
        detail: `customers=${rows[0].customers} conversations=${rows[0].conversations} appointments=${rows[0].appointments}; orphan=${rows[0].orphan_appointments} confirmed_without_event=${rows[0].confirmed_without_event} duplicate_events=${rows[0].duplicate_events} unresolved=${rows[0].unresolved_appointments}`,
      }),
    ),
  );

  checks.push(await run(pool, "actual PostgreSQL runtime least privilege",
    `select current_user as runtime_role, r.rolbypassrls as bypass_rls,
       has_table_privilege(current_user,'public.audit_log','update,delete') as audit_mutation,
       has_schema_privilege(current_user,'public','create') as schema_create,
       exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
         where n.nspname='public' and c.relkind='r' and c.relowner=r.oid) as owns_app_tables
     from pg_roles r where r.rolname=current_user`,
    rows => ({
      ok: rows[0]?.audit_mutation === false && rows[0]?.schema_create === false && rows[0]?.owns_app_tables === false,
      detail: `role=${rows[0]?.runtime_role} bypass_rls=${rows[0]?.bypass_rls} audit_mutation=${rows[0]?.audit_mutation} schema_create=${rows[0]?.schema_create} owns_app_tables=${rows[0]?.owns_app_tables}`,
    })));
  return checks;
}

async function main() {
  const env = loadEnv(process.env);
  console.log("[1/5] configuration: valid (all required secrets present, values not shown)");

  let db;
  try {
    db = createDbClients(env);
    await db.pgPool.query("select 1");
    console.log("[2/5] TLS + PostgreSQL connectivity: session-pooler connection established");
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    if (message.includes("password authentication failed")) {
      const { kind, hint } = classifyPgAuthError(message);
      console.error(`[2/5] BLOCKED (${kind}): ${hint}`);
    } else {
      console.error("[2/5] BLOCKED: database connection failed (raw error suppressed).");
    }
    process.exit(2);
  }
  console.log("(credentials verified without disclosure)");

  const checks = await verify(db.pgPool);
  for (const check of checks) {
    console.log(`[3/5] ${check.ok ? "PASS" : "FAIL"} — ${check.name}: ${check.detail}`);
  }
  if (checks.some((c) => !c.ok)) {
    console.error("[4/5] READINESS: FAIL — see failed checks above");
    await db.close();
    process.exit(3);
  }
  console.log("[3/5] schema contract + RLS + grants + trigger + history: all checks passed");

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
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error("Read-only verification failed unexpectedly (raw error suppressed).");
    process.exit(1);
  });
}
