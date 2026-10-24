# DATABASE — Intended Data and Security Model

| Field | Value |
| --- | --- |
| Project ID | AI-RECEPTIONIST |
| Document ID | DATABASE |
| Version / date | v0.2 — 2026-10-24 (G02 change-request revisions: consent-evidence FK, consent trigger, is_app_admin function, expiry columns) |
| Owner | ZCode execution agent (maintainer); human decision authority: project owner |
| Scope | Intended schema, integrity, access, queries, evolution for Supabase/PostgreSQL `ogxdszjypswutekqgorb` |
| Document lifecycle | review-ready — pending **G02-DESIGN** (no DDL applied) |
| Input provenance | Approved `PROJECT.md` v0.2; `ARCHITECTURE.md` v0.1; protocols 07/08/10 |
| Related authoritative files | `SUPABASE.md`, `AUTH.md`, `decisions/ADR-0001/0002/0006.md` |
| Approval reference | NONE — pending G02 |

## 1. [REQUIRED] Control and state authority

- **Engine/provider:** Supabase PostgreSQL, project `ogxdszjypswutekqgorb` (approved at G01 — platform only). Exact Postgres version: to be confirmed read-only at implementation start (catalog query); recorded unknown until then.
- **Migration owner:** `supabase/migrations/` in the application repository — one versioned, reviewed, committed SQL stream (G07). Application of migrations requires design approval (this bundle) + action authorization per PLAN §4.
- **Observed catalog:** `public` schema verified EMPTY, zero migrations (PROGRESS §4, 2026-10-23). Re-verified before first migration.
- **Intended schema** below is a proposal; nothing exists yet.

## 2. [REQUIRED] Entities, attributes and relationships

Conventions: `id uuid pk default gen_random_uuid()`; `created_at/updated_at timestamptz not null default now()`; RLS enabled on every table; all customer-facing writes via service_role (backend) only.

| Object | Columns (type, nullability, defaults) | Keys / relationships | Lifecycle / privacy |
| --- | --- | --- | --- |
| `app_admins` | `user_id uuid` (references `auth.users`), `display_name text not null`, `created_at` | PK `user_id` | Admin membership; changes only via migration/manual by owner. **No `authenticated`-readable RLS policies** (recursion avoidance) — all policy membership checks go through the `SECURITY DEFINER` function `public.is_app_admin()` (hardened `search_path`, EXECUTE to `authenticated` only); grants: `service_role` only |
| `business_config` | `id uuid pk`, `category text not null check in ('business_info','hours','services','faqs','appointment_types','escalation')`, `content jsonb not null`, `version int not null`, `updated_by uuid null` | Unique (`category`,`version`) | Business content (owner-supplied); PII-free by policy |
| `customers` | `id uuid pk`, `display_name text not null`, `contact_email text null`, `contact_phone text null`, `notes text null` | — | PII; deletion honored (retention rules, Q4) |
| `conversations` | `id uuid pk`, `customer_id uuid null fk→customers`, `channel text not null check in ('text','voice')`, `status text not null default 'active' check in ('active','ended','escalated','expired')`, `access_token_hash text not null`, `consent_recording boolean not null default false`, `summary text null`, `summary_expires_at timestamptz null` (retention sweep tombstones `summary` when passed — condition F), `context_snapshot jsonb null`, `started_at`, `ended_at null` | FK customers | PII-lite; token keyed-hash (AUTH §2); summary derived + expirable |
| `messages` | `id uuid pk`, `conversation_id uuid not null fk→conversations on delete cascade`, `role text not null check in ('customer','assistant','system')`, `content text not null`, `content_type text not null default 'text' check in ('text','transcript')`, `corrected boolean not null default false`, `expires_at timestamptz null` (set at insert from approved retention policy; null = policy not yet approved), `created_at` | FK conversations (cascade) | Transcripts are untrusted text; corrections flagged (FR-8); expiry handled by sweep (ADR-0006) |
| `booking_state` | `conversation_id uuid pk fk→conversations on delete cascade`, `state text not null default 'COLLECT_DETAILS' check in ('COLLECT_DETAILS','VALIDATE','CHECK_AVAILABILITY','OFFER_SLOT','AWAIT_CONFIRMATION','RECHECK_AVAILABILITY','CREATE_EVENT','VERIFY_RESULT','CONFIRMED','UNRESOLVED','CANCELLED','REJECTED','EXPIRED','FAILED')`, `extracted jsonb not null default '{}'`, `offered_slot timestamptz null`, `offer_expires_at timestamptz null`, `confirmation_token_hash text null`, `calendar_idempotency_key uuid null` (**durable original identity — never regenerated while UNRESOLVED**), `unresolved_since timestamptz null`, `reconciliation_attempts int not null default 0`, `last_reconciled_at timestamptz null`, `escalated_at timestamptz null`, `attempts int not null default 0`, `last_error text null`, `updated_at` | FK conversations (cascade) | One booking flow per conversation; `UNRESOLVED` = explicit pending-verification state (ADR-0004 v0.2), restart-safe via persisted identity/fields |
| `appointments` | `id uuid pk`, `conversation_id uuid null fk→conversations set null`, `customer_id uuid null fk→customers set null`, `service_type text null`, `purpose text null`, `scheduled_start timestamptz not null`, `scheduled_end timestamptz not null`, `duration_minutes int not null`, `meeting_type text null`, `timezone text not null`, `status text not null default 'pending_confirmation' check in ('pending_confirmation','confirmed','cancelled','completed','expired','failed','unresolved')`, `google_calendar_id text null`, `google_event_id text null`, `idempotency_key uuid not null unique default gen_random_uuid()` (matches `booking_state.calendar_idempotency_key`; Google extended private property), `notes text null`, `created_at`, `updated_at` | FKs above | PII; check (`scheduled_end > scheduled_start`); `unresolved` status mirrors ADR-0004 v0.2 (event existence being verified) |
| `model_providers` | `id uuid pk`, `kind text not null check in ('local','cloud')`, `adapter text not null check in ('ollama','openai_compatible')`, `display_name text not null`, `base_url text null` (cloud only; validated SSRF-safe), `model_id text null` (active model), `capabilities jsonb not null default '{}'`, `status text not null default 'unverified' check in ('unverified','ok','error')`, `last_error text null`, `credential_ref text null` (**secret reference only — never the key**), `is_active boolean not null default false`, `created_at`, `updated_at` | — | One active provider enforced app-side |
| `consent_decisions` | `id uuid pk`, `conversation_id uuid null fk→conversations **on delete set null**`, `conversation_ref uuid null` (**plain column, no FK** — preserves the originating conversation id after deletion), `decision boolean not null`, `scope text not null default 'recording'`, `decided_at timestamptz not null default now()`, `valid_until timestamptz null` (null = no expiry until withdrawn/superseded; expired consent never authorizes), `decision_text text null`, `retention_until timestamptz null` (3-year evidence lifetime per approved Q4) | FK conversations (set null) | **Append-only consent evidence; survives conversation deletion**; ordering `decided_at DESC, id DESC` — **the latest applicable decision governs** (grant requires latest = affirmative AND unexpired AND not withdrawn) |
| `recordings` | `id uuid pk`, `conversation_id uuid null fk→conversations **on delete set null**` (**never cascade** — a conversation deletion cannot orphan the Storage object), `conversation_ref uuid null` (plain column), `storage_path text not null`, `duration_seconds int null`, `retention_until timestamptz not null` (30 d per approved Q4), `deletion_state text not null default 'active' check in ('active','deletion_pending','deleted')`, `deletion_attempts int not null default 0`, `last_deletion_error text null`, `created_at` | FK conversations (set null) | **Dormant until bucket activated post-G02**; consent required (dual-layer); lifecycle: `active` → (retention/withdrawal) `deletion_pending` → Storage object delete attempted **first** → only on confirmed object deletion does the row reach `deleted`/hard-delete; failed storage delete keeps `deletion_pending` + bounded retry + audit + escalation — **denied/failed Storage deletion never masquerades as successful record deletion** (condition B) |
| `audit_log` | `id uuid pk`, `actor_type text not null check in ('customer','admin','system')`, `actor_id text null`, `action text not null`, `entity_type text not null`, `entity_id text null`, `detail jsonb not null default '{}'` (redacted), `created_at` | — | Append-only: no UPDATE/DELETE grants for any role |

**Deletion behavior:** conversation cascade deletes messages + booking_state only; **consent evidence survives** (`consent_decisions` set-null + `conversation_ref`, per ADR-0006); **recordings never silently cascade** (`recordings.conversation_id` is `ON DELETE SET NULL` — the row survives with its `deletion_state` lifecycle until the Storage object is confirmed deleted; orphaned objects are impossible by design, see §3); customers set-null from appointments (records kept for business history per FR-10/11). Customer deletion (admin) sets `customer_id` null and anonymizes display/contact fields — irreversible-deletion semantics recorded per RULES.

## 3. [REQUIRED] Integrity and access

| Invariant / requirement | Enforcement | Roles/grants/RLS | Proving case |
| --- | --- | --- | --- |
| Only admins read business data (SEC-2/3) | RLS policies call **`private.is_app_admin()`** — a `SECURITY DEFINER` function in the **non-Data-API-exposed `private` schema** (hardened per condition E: `SET search_path = ''`, fully qualified names, `REVOKE EXECUTE FROM PUBLIC` + `anon`, `GRANT USAGE`/`EXECUTE` to `authenticated` only, definer = migration owner with `bypassrls` so `app_admins` is read without triggering its (absent) policies — no recursion, filters on `(select auth.uid())`) | `anon`: zero grants; `authenticated`: SELECT (scoped INSERT/UPDATE where matrix allows) + function EXECUTE; `service_role`: full, server-only | TC-11/TC-28/TC-35 real-role tests incl. recursion-freedom |
| No customer direct DB access | No anon policies; customer path is backend-only (service_role server-side) | `anon` zero | TC-11 anon zero-rows + zero-grants |
| Booking transition atomicity (FR-5/SEC-9) | Single-transaction `FOR UPDATE` lock on `booking_state`; legal-state CHECK constraint | service_role only | TC-05/TC-16 |
| Duplicate event prevention | `appointments.idempotency_key` UNIQUE; partial UNIQUE index on `google_event_id WHERE google_event_id IS NOT NULL` | — | TC-06/TC-16 |
| Consent before recording (FR-9) — **dual-layer, latest-decision-aware** | Layer 1 (DB, role-independent): `enforce_recording_consent()` BEFORE INSERT trigger on `recordings` evaluates the **latest applicable consent decision** for the conversation (`ORDER BY decided_at DESC, id DESC`): insert is allowed **only** if that latest decision is affirmative, `valid_until` is null or in the future, and no later withdrawal exists — historical "any yes" never authorizes; rejected inserts (including from service_role, which bypasses RLS) raise a typed error. Layer 2 (trusted backend boundary): domain code re-evaluates the same latest-decision rule before invoking recording persistence, independent of DB behavior | Trigger + RLS + backend guard | TC-33: no consent / explicit denial / granted-then-withdrawn / expired-or-superseded / service-role insert after withdrawal — all denied |
| Recording deletion integrity (condition B) | `recordings.conversation_id ON DELETE SET NULL` (no cascade orphaning); `deletion_state` lifecycle: Storage object deleted **before** row leaves `deletion_pending`; failed/denied storage delete → bounded retry (≤ 3) + `last_deletion_error` + audit + escalation; `deleted` only after confirmed object removal | FK semantics + lifecycle columns + sweep procedure | TC-10 variant: conversation delete → recording row survives (`conversation_ref`), storage object still reachable for sweep; storage-fault test proves no false "deleted" |
| Append-only audit | No UPDATE/DELETE grants on `audit_log` to any role incl. admins | grants only INSERT (service_role), SELECT (admin) | TC-11 variant |
| Secrets never in `model_providers` | `credential_ref` holds Vault/secret id only; value lives in secrets store | — | TC-29 |

Full allow/deny matrix: `AUTH.md` §3.

## 4. [REQUIRED] Query and index design

| Workload | Query shape | Index |
| --- | --- | --- |
| Conversation transcript load | `messages WHERE conversation_id = ? ORDER BY created_at` | PK-order covered by index on `(conversation_id, created_at)` |
| Active-conversation lookup | `conversations WHERE id = ?` (token verified app-side against hash) | PK |
| Admin appointment list | `appointments ORDER BY scheduled_start DESC LIMIT 50` (cursor = `(scheduled_start,id)`) | `(scheduled_start DESC, id)` |
| Escalated queue | `conversations WHERE status='escalated' ORDER BY started_at DESC` | partial index `WHERE status='escalated'` |
| FAQ retrieval | `business_config WHERE category='faqs' ORDER BY version DESC LIMIT 1` | unique (`category`,`version`) covers |
| Availability overlap check (mock/verification) | `appointments WHERE status IN ('confirmed','pending_confirmation') AND scheduled_start < ? AND scheduled_end > ?` | `(scheduled_start)` (+ small data; verify with EXPLAIN at implementation) |
| Retention sweep (post-Q4) | `recordings WHERE retention_until < now()` | `(retention_until)` |

Data volume is small (single business, one active conversation); no partitioning.

## 5. [REQUIRED] Evolution and recovery

- Proposed migration sequence (all pending — none applied): `0001_extensions` (pgcrypto if needed), `0002_core_tables` (admins, config, customers, conversations, messages, booking_state **+ `public.is_app_admin()` SECURITY DEFINER function**), `0003_booking_and_calendar` (appointments + indexes/constraints), `0004_ai_providers` (model_providers), `0005_consent_and_records` (consent_decisions with set-null FK, recordings, audit_log, **`enforce_recording_consent()` trigger**), `0006_rls_policies_grants` (policies via `is_app_admin()`, zero anon grants, append-only audit grants). Each reviewed (G07) before application; applied **only** via the Supabase CLI path (SUPABASE §5) — never ad-hoc SQL.
- Replay: clean replay on empty database = TC-20. Forward-only; no down-migrations — repair via new migration (RULES: never rewrite history).
- Lock budgets: trivial at this scale (empty/low-volume tables); note online-rebuild concerns N/A.
- Recovery scope: Supabase managed backups (provider-side; verify actual coverage/retention at implementation — SUPABASE.md §6) + migration replay for schema; RPO/RTO targets deferred to deployment stage (no production target yet, Q6).

## 6. [OPTIONAL] Specialized data features

- Supabase Vault: used as secret store (proposed, ADR-0002) — `vault.create_secret`/decrypted read via service_role only; schema owned by provider.
- Full-text/JSON search, partitioning, replication: NOT_APPLICABLE (scale does not justify).

## 7. [REQUIRED] Decisions, unknowns and verification

- **Decisions:** AD-9 transactional pattern (`pg` transactions for booking); conversation-token stored hashed; one-active-provider app-side constraint; audit append-only.
- **Unknowns:** exact Postgres major version (read-only check at implementation); Supabase Vault availability on this project (verified at implementation; AES-GCM fallback if absent); Supabase backup retention settings (verify — recovery evidence G16).
- **Verification:** TC-10/TC-11/TC-20/TC-28 real-database evidence; TC-16 concurrency; drift check after each migration (intended vs catalog).
- **Review dependency:** this schema proposal is part of **G02-DESIGN**; application requires that approval + first-migration action authorization (PLAN §4).
