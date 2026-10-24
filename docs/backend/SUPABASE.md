# SUPABASE — Managed Provider Specification

| Field | Value |
| --- | --- |
| Project ID | AI-RECEPTIONIST |
| Document ID | SUPABASE |
| Version / date | v0.2 — 2026-10-24 (G02 change-request revisions: connection mode, credential classes, CLI-only migration path, Vault verification) |
| Owner | ZCode execution agent (maintainer); human decision authority: project owner |
| Scope | Supabase provider topology, credential classes, connection mode, capabilities for project `ogxdszjypswutekqgorb` |
| Document lifecycle | review-ready — pending **G02-DESIGN** |
| Input provenance | G01 approval (Q1 = Supabase, platform-only); protocol 08; `DATABASE.md` v0.1 |
| Related authoritative files | `DATABASE.md`, `AUTH.md`, `ENVIRONMENT.md`, `decisions/ADR-0001/0002.md` |
| Approval reference | NONE — pending G02 |

## 1. [REQUIRED when active] Control and targets

| Environment | Identity | Status |
| --- | --- | --- |
| "Production-equivalent dev" (only environment) | Supabase project `ogxdszjypswutekqgorb` — URL `https://ogxdszjypswutekqgorb.supabase.co` (verified via MCP 2026-10-23) | Reachable; `public` schema empty; zero migrations |
| Local staging | None (no local Supabase CLI stack; decision below) | NOT_PROVISIONED |

There is **one** Supabase environment. It is treated as non-disposable (RULES: never treat a database as disposable without verifying purpose/scope); destructive operations require explicit authorization. No local Supabase stack: single-dev scale + MCP verification path make a local stack overhead without benefit; revisit if migration replay needs isolation (TC-20 can replay against the real project pre-data since it is empty — with action authorization).

**CLI/SDK:** Supabase CLI not installed (checked at discovery — to re-verify at implementation); supabase-js v2 for CRUD; `pg` for transactions. MCP is an authorized read/verification mechanism — committed migrations remain the schema authority (protocol 08 §5).

## 2. [REQUIRED when active] Architecture and authorities

- **Data API exposure:** `public` schema exposed by default provider setting — **design intent: zero anon policies and zero grants to `anon`**, so Data API exposure is inert for unauthenticated callers; `authenticated` limited per AUTH matrix. Verify exposed-schema settings at implementation and record drift.
- **Server SQL path:** backend service_role client (supabase-js) + `pg` transaction client (session/transaction pooler). All privileged operations server-side only.
- **RPC path:** none designed (AD-9 keeps transitions in domain code via `pg` transactions). Vault functions used only for secrets (ADR-0002).
- **Migrations/configuration owner:** `supabase/migrations/` single stream (DATABASE.md §5). **Application path: the Supabase CLI only** — it records applied identity in the remote `supabase_migrations.schema_migrations` history; there is **no** ordinary MCP `execute_sql` migration workflow (condition G). MCP is restricted to read-only verification (catalog checks, `query_logs`, advisors) and, only with separate owner authorization, scoped repair; its success alone is never migration-history proof. Any schema change outside the committed stream is recorded as drift (a finding), never silently adopted.
- **Intended vs observed drift:** none yet (empty catalog). Drift check after every migration.

## 3. [REQUIRED when active] Auth, grants and RLS

- Identity: Supabase Auth (email/password, invite-only admins) — details in `AUTH.md`.
- Grants/RLS: per `DATABASE.md` §3 — RLS enabled everywhere; `anon` zero; `authenticated` admin-scoped via `app_admins` membership; `service_role` server-only.
- Helper/view surface: none designed (no SECURITY DEFINER functions in v1; if later needed, hardened search_path + explicit grants per protocol 10).
- Testing path: real-role tests (anon / authenticated admin / service_role) against the real project — TC-11/TC-28. Service-role success never counts as user proof.

## 4. [OPTIONAL] Storage, Realtime, Edge/DB functions

| Capability | Decision | Reason |
| --- | --- | --- |
| Storage | Designed, **dormant**: private bucket `recordings` for consent-gated audio (FR-9), created only after Q4 policy approval; service-role server-managed uploads only | Consent gate (FR-9); no other file need |
| Realtime | NOT_APPLICABLE | Turn-based polling API; no client-direct DB |
| Edge Functions | NOT_APPLICABLE | All privileged logic lives in the Node backend (runtime boundary mismatch) |
| DB functions (security definer) | NOT_APPLICABLE v1 | See §2 |

## 5. [REQUIRED when active] Configuration and execution

- **Connection mode (decided, doc-grounded against current Supabase connection guidance):** `pg` uses the **shared pooler in session mode (port 5432, host from the dashboard Connect string, user `postgres.<project-ref>`)** — IPv4-compatible on every plan, supports prepared statements and session state required by the long-running Node service's transactions. **TLS is verify-full and mandatory (security preflight 2026-10-24):** the owner downloads the CA certificate from the Supabase dashboard, provides its path via `SUPABASE_DB_CA_CERT_PATH`, and the client pins it with `rejectUnauthorized: true`; an unreadable/missing certificate aborts startup — verification is never disabled. Direct connection (IPv6-by-default) becomes the preferred replacement only if verified working on this network at Stage 3. Transaction mode (6543) rejected — no prepared statements/session state. supabase-js uses the Data API over HTTPS independently.
- **Grants (security preflight):** with Supabase's default-grants enforcement (October 30, 2026 legacy-key deadline), no role relies on automatic Data API grants — migration 0006 grants explicitly per the access matrix (anon: none; authenticated: matrix-scoped; service_role: backend tables, audit log append-only for every role), and RLS is enabled at each table's creation in 0002–0005 so no transient unprotected window exists.
- **Credential classes (names only, values never in repo/client/logs):**
  1. **Public:** `SUPABASE_URL` (Data API base), `SUPABASE_PUBLISHABLE_KEY` (publishable/anon key — unused by backend this phase).
  2. **Server-only Data API secret:** `SUPABASE_SERVICE_ROLE_KEY` — used by supabase-js only. **Never a PostgreSQL password.**
  3. **Server-only PostgreSQL secret:** `SUPABASE_DB_URL` — session-pooler connection string containing the **separate database password**, used by `pg` only.
  4. **Development-agent credentials:** Supabase MCP access keys live in ZCode's MCP configuration (agent-side tooling) — **never** in application `.env`, code, runtime, or repository. The application never uses MCP credentials.
- **Migration application method (decided):** the **Supabase CLI** is installed at Stage 3 (npm devDependency) and is the single migration application path — it records applied identity in the remote `supabase_migrations.schema_migrations` history, keeping committed SQL ↔ remote history ↔ applied schema ↔ generated types consistent. **MCP `execute_sql` is NOT a migration application path** — it is restricted to read-only verification (catalog checks, `query_logs`, advisors) and, only with separate owner authorization, scoped repair; its success alone is never treated as migration-history proof. Any schema change found outside the committed stream is recorded as drift (a finding), never silently adopted.
- **Verification before any G06/G07/G09 claim:** clean replay of the full stream on an empty database (TC-20), remote-history ↔ committed-file identity check (TC-34), intended-vs-catalog drift comparison, and real-role allow/deny tests (TC-11/TC-28/TC-35). No PASS without all applicable evidence.
- **Types generation:** `supabase gen types` (CLI) after each migration; output committed to `src/db/types.ts` (single generated-types owner; drift-checked in the build).
- **Action authorization:** first migration application requires explicit approval (PLAN §4 row) — G02 design approval alone does not authorize DDL, and **no remote migration is applied at design review stage**.

## 6. [REQUIRED when active] Signals, recovery and release proof

- Provider logs (API/postgres) inspectable via MCP `query_logs` for failure diagnosis; application logs remain primary (OBSERVABILITY.md).
- Recovery: provider managed backups — **actual backup coverage/retention unverified** (unknown, owner: implementation stage; needed for G16 eventually). Schema recovery = migration replay from the committed stream. No Storage bytes in scope until bucket activated.
- Advisors: security/performance advisors checked after each migration (recorded as evidence inputs, not gate substitutes).
- **Vault security verification (ADR-0002 fail-closed precondition):** at implementation, verify (a) Vault extension availability, (b) decrypted-secret read access is restricted to the service role and not exposed via Data API grants to `anon`/`authenticated`, (c) secret listing does not leak ciphertext or plaintext to non-privileged roles. Vault is adopted **only if available and verified secure**; otherwise cloud-provider credential persistence stays disabled (fail-closed).
- Unknowns/decisions: Vault availability + privilege security (verify); backup retention (verify); exposed-schema settings (verify + record drift); Postgres major version (verify); network IPv6 availability (Stage 3 connectivity test — decides direct vs session-pooler).
