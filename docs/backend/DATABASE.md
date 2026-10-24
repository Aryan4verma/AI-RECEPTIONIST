# DATABASE — Intended Data and Security Model

| Field | Value |
| --- | --- |
| Project ID | AI-RECEPTIONIST |
| Document ID | DATABASE |
| Version / date | v0.1 — 2026-10-24 |
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
| `app_admins` | `user_id uuid` (references `auth.users`), `display_name text not null`, `created_at` | PK `user_id` | Admin membership; changes only via migration/manual by owner |
| `business_config` | `id uuid pk`, `category text not null check in ('business_info','hours','services','faqs','appointment_types','escalation')`, `content jsonb not null`, `version int not null`, `updated_by uuid null` | Unique (`category`,`version`) | Business content (owner-supplied); PII-free by policy |
| `customers` | `id uuid pk`, `display_name text not null`, `contact_email text null`, `contact_phone text null`, `notes text null` | — | PII; deletion honored (retention rules, Q4) |
| `conversations` | `id uuid pk`, `customer_id uuid null fk→customers`, `channel text not null check in ('text','voice')`, `status text not null default 'active' check in ('active','ended','escalated','expired')`, `access_token_hash text not null`, `consent_recording boolean not null default false`, `summary text null`, `context_snapshot jsonb null`, `started_at`, `ended_at null` | FK customers | PII-lite; token hashed; summary derived |
| `messages` | `id uuid pk`, `conversation_id uuid not null fk→conversations on delete cascade`, `role text not null check in ('customer','assistant','system')`, `content text not null`, `content_type text not null default 'text' check in ('text','transcript')`, `corrected boolean not null default false`, `created_at` | FK conversations (cascade) | Transcripts are untrusted text; corrections flagged (FR-8) |
| `booking_state` | `conversation_id uuid pk fk→conversations on delete cascade`, `state text not null default 'COLLECT_DETAILS' check in (state machine states incl. terminals)`, `extracted jsonb not null default '{}'`, `offered_slot timestamptz null`, `offer_expires_at timestamptz null`, `confirmation_token_hash text null`, `attempts int not null default 0`, `last_error text null`, `updated_at` | FK conversations (cascade) | One booking flow per conversation |
| `appointments` | `id uuid pk`, `conversation_id uuid null fk→conversations set null`, `customer_id uuid null fk→customers set null`, `service_type text null`, `purpose text null`, `scheduled_start timestamptz not null`, `scheduled_end timestamptz not null`, `duration_minutes int not null`, `meeting_type text null`, `timezone text not null`, `status text not null default 'pending_confirmation' check in ('pending_confirmation','confirmed','cancelled','completed','expired','failed')`, `google_calendar_id text null`, `google_event_id text null`, `idempotency_key uuid not null unique default gen_random_uuid()`, `notes text null`, `created_at`, `updated_at` | FKs above | PII; check (`scheduled_end > scheduled_start`) |
| `model_providers` | `id uuid pk`, `kind text not null check in ('local','cloud')`, `adapter text not null check in ('ollama','openai_compatible')`, `display_name text not null`, `base_url text null` (cloud only; validated SSRF-safe), `model_id text null` (active model), `capabilities jsonb not null default '{}'`, `status text not null default 'unverified' check in ('unverified','ok','error')`, `last_error text null`, `credential_ref text null` (**secret reference only — never the key**), `is_active boolean not null default false`, `created_at`, `updated_at` | — | One active provider enforced app-side |
| `consent_decisions` | `id uuid pk`, `conversation_id uuid not null fk→conversations on delete cascade`, `decision boolean not null`, `scope text not null default 'recording'`, `decided_at timestamptz not null default now()`, `decision_text text null` | FK conversations (cascade) | Append-only audit of consent (FR-9) |
| `recordings` | `id uuid pk`, `conversation_id uuid not null fk→conversations on delete cascade`, `storage_path text not null`, `duration_seconds int null`, `retention_until timestamptz null` (policy value pending Q4), `created_at` | FK conversations (cascade) | **Dormant until Q4 policy approved**; consent required |
| `audit_log` | `id uuid pk`, `actor_type text not null check in ('customer','admin','system')`, `actor_id text null`, `action text not null`, `entity_type text not null`, `entity_id text null`, `detail jsonb not null default '{}'` (redacted), `created_at` | — | Append-only: no UPDATE/DELETE grants for any role |

**Deletion behavior:** conversation cascade deletes messages/booking/consent; customers set-null from appointments (records kept for business history per FR-10/11); recordings deleted per retention job/ops (Q4). Customer deletion (admin) sets `customer_id` null and anonymizes display name — irreversible-deletion semantics recorded per RULES.

## 3. [REQUIRED] Integrity and access

| Invariant / requirement | Enforcement | Roles/grants/RLS | Proving case |
| --- | --- | --- | --- |
| Only admins read business data (SEC-2/3) | RLS `USING (EXISTS (SELECT 1 FROM app_admins a WHERE a.user_id = auth.uid()))` on business tables for `authenticated` | `anon`: zero grants; `authenticated`: SELECT (scoped INSERT/UPDATE where matrix allows); `service_role`: full, server-only | TC-11/TC-28 real-role tests |
| No customer direct DB access | No anon policies; customer path is backend-only (service_role server-side) | `anon` zero | TC-11 anon zero-rows + zero-grants |
| Booking transition atomicity (FR-5/SEC-9) | Single-transaction `FOR UPDATE` lock on `booking_state`; legal-state CHECK constraint | service_role only | TC-05/TC-16 |
| Duplicate event prevention | `appointments.idempotency_key` UNIQUE; partial UNIQUE index on `google_event_id WHERE google_event_id IS NOT NULL` | — | TC-06/TC-16 |
| Consent before recording (FR-9) | App-enforced (recording writes only when `consent_decisions` yes exists) + `recordings` insert guarded by policy checking consent row | RLS insert policy on `recordings` | TC-10 |
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

- Proposed migration sequence (all pending — none applied): `0001_extensions` (pgcrypto if needed), `0002_core_tables` (admins, config, customers, conversations, messages, booking_state), `0003_booking_and_calendar` (appointments + indexes/constraints), `0004_ai_providers` (model_providers), `0005_consent_and_records` (consent_decisions, recordings, audit_log), `0006_rls_policies_grants`. Each reviewed (G07) before application.
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
