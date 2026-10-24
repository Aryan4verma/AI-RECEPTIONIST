# SUPABASE — Managed Provider Specification

| Field | Value |
| --- | --- |
| Project ID | AI-RECEPTIONIST |
| Document ID | SUPABASE |
| Version / date | v0.1 — 2026-10-24 |
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
- **Migrations/configuration owner:** `supabase/migrations/` single stream (DATABASE.md §5). Applied via Supabase CLI if installable, otherwise via MCP `execute_sql` per migration file with per-migration verification queries and recorded evidence — either way, file → apply → verify → record, never undocumented ad-hoc SQL (protocol 08 forbidden).
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

- **Connection mode:** `pg` via Supabase **transaction pooler** (port 6543) for transactions with prepared statements disabled (PgBouncer compatibility — verify exact driver settings against official connection guidance at implementation); supabase-js REST for single statements. Connection budget: ≤ 5 server-side connections total (pool max 3 pg + supabase-js) — the app is single-process.
- **Credential classes (names only, values in `.env`, never in repo/client/logs):** `SUPABASE_URL` (public class), `SUPABASE_SERVICE_ROLE_KEY` (**secret**, server-only), `SUPABASE_ANON_KEY` (public class; unused this phase), `SUPABASE_VAULT_ROOT…` none (Vault managed provider-side).
- **Types generation:** `supabase gen types` (CLI) or MCP `generate_typescript_types` after each migration; output committed to `src/db/types.ts` (single generated-types owner; drift-checked).
- **Action authorization:** first migration application requires explicit approval (PLAN §4 row) — G02 design approval alone does not authorize DDL.

## 6. [REQUIRED when active] Signals, recovery and release proof

- Provider logs (API/postgres) inspectable via MCP `query_logs` for failure diagnosis; application logs remain primary (OBSERVABILITY.md).
- Recovery: provider managed backups — **actual backup coverage/retention unverified** (unknown, owner: implementation stage; needed for G16 eventually). Schema recovery = migration replay. No Storage bytes in scope until bucket activated.
- Advisors: security/performance advisors checked after each migration (recorded as evidence inputs, not gate substitutes).
- Unknowns/decisions: Vault availability on project (verify at implementation); backup retention (verify); exposed-schema settings (verify + record drift); Postgres major version (verify).
