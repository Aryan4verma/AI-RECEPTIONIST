# BACKEND — Domain and Implementation Specification

| Field | Value |
| --- | --- |
| Project ID | AI-RECEPTIONIST |
| Document ID | BACKEND |
| Version / date | v0.2 — 2026-10-24 (G02 change-request revisions: unresolved-outcome semantics, dual-layer consent, resource admission) |
| Owner | ZCode execution agent (maintainer); human decision authority: project owner |
| Scope | Domain modules, operations, invariants, concurrency and failure behavior |
| Document lifecycle | approved — G02-DESIGN (conditional approval, conditions satisfied 2026-10-24) |
| Input provenance | `ARCHITECTURE.md` v0.1; approved `PROJECT.md` v0.2 |
| Related authoritative files | `ARCHITECTURE.md`, `DATABASE.md`, `AUTH.md`, `API.md`, `decisions/ADR-0003..0006.md` |
| Approval reference | G02-DESIGN APPROVED WITH CONDITIONS 2026-10-24 — see PROGRESS.md §5 |

## 1. [REQUIRED] Control and requirement mapping

Implements approved FR-1…FR-18 within the architecture boundaries. Domain decisions are deterministic backend code; AI proposes, domain disposes (SEC-6/12).

## 2. [REQUIRED] Modules and boundaries

| Module / path | Responsibility | Inputs / outputs | Dependencies / owner |
| --- | --- | --- | --- |
| `server/` + `http/routes/*` | Transport, validation, auth guards, error envelope | HTTP in/out | domain services |
| `domain/conversation` | Session create/terminate, greeting, bounded context (≤ 12 recent turns + rolling summary), turn orchestration, escalation marking | Turn text/transcript → assistant reply + state | booking, knowledge, ai, db |
| `domain/booking` | Approved state machine, offer/confirmation tokens, expiry | State transitions | db (transactional), calendar port |
| `domain/knowledge` | Business config + deterministic FAQ retrieval (normalized keyword match) | Query → answer/refs or no-match | db |
| `ai/` | Provider abstraction, registry, inference with validation, limits, uncertainty | Utterance + context → validated structured output | provider ports; never domain decisions |
| `speech/` | Audio validation (type/size/duration), transcription port, sidecar lifecycle | Audio bytes → transcript | sidecar process |
| `calendar/` | Availability, offers, idempotent create/recheck, cancel, reschedule | Slot requests → calendar results | mock/google adapter |
| `secrets/` | Credential CRUD + masking | Secret refs ↔ values | Vault/AES-GCM store |
| `db/` | Repositories, transactions | Domain calls → persisted state | Supabase/pg |
| `config/`, `observability/` | Env validation; logging/metrics | — | — |

## 3. [REQUIRED] Domain operations and invariants

| Operation | Preconditions / access | Trusted decisions (backend-only) | Atomic changes / invariant | Outcome / conflict |
| --- | --- | --- | --- | --- |
| Start conversation | Public + rate limit | Greeting from config; conversation token issued (hashed at rest) | `conversations` + `booking_state` rows | 429 on flood (SEC-10) |
| Customer turn | Conversation token | Intent classification validated vs Zod schema; unknown → clarification (max 3 → escalate) | `messages` insert; `booking_state` update | Ambiguity → clarification, never guessed values (FR-3) |
| Extract appointment details | Validated intent | Extraction schema v1 with `known/unknown/ambiguous` per field; server-derived dates resolved against authoritative timezone from business config — never model-derived | `booking_state.extracted` | Missing/ambiguous → ask; INVALID_OUTPUT → retry ≤ 1 then safe error |
| FAQ answer | Any turn | Answer only from retrieved config; no-match → escalation path | none (read-only) | Out-of-knowledge → FR-12 |
| Offer slots | Valid extraction complete | Availability from calendar port; business hours/duration/buffers applied server-side; offer expires (config, default 15 min) | `booking_state`: OFFER_SLOT → AWAIT_CONFIRMATION + token + expiry | No slots → alternatives/declined path |
| Confirm booking | Valid confirmation token, unexpired | **Availability recheck immediately before create (SEC-7)**; explicit decision recorded | `booking_state` RECHECK → CREATE → VERIFY; `appointments` row with `idempotency_key` | Slot taken mid-flow → re-offer; create uncertain → **`UNRESOLVED`** (ADR-0004: identity preserved, search-based reconciliation, human escalation — never auto-FAILED, never re-created with a fresh identity) |
| Create calendar event | Confirmed + rechecked | Calendar adapter executes write (privileged, backend-only) | `appointments.google_event_id` persisted; audit entry | Duplicate prevented by idempotency key + unique event id (SEC-9) |
| Cancel / reschedule | Customer token or admin | Ownership check; reschedule re-runs availability | status transitions; calendar cancel/update | Already-cancelled → idempotent no-op result |
| Admin config changes | Supabase Auth + admin membership | Business config versioned | `business_config` new version row | Takes effect next turn (FR-14) |
| Model/provider settings | Admin only | Registry update; active model switch applies to **new turns**; connection test executes bounded provider call | `model_providers` rows; credentials via secrets port (never in table) | Unsafe endpoint → rejected (SEC-16, TC-30) |
| Consent decision | Customer turn or admin | Recorded verbatim decision + scope + timestamp | `consent_decisions` + `conversations.consent_recording` | Recording stays OFF without explicit yes (FR-9) |

**Intent taxonomy (v1):** `book_appointment, cancel_appointment, reschedule_appointment, ask_question, greeting, chitchat, request_human, unknown`. Booking state machine states exactly as approved in FR-5 plus `UNRESOLVED` (calendar-create verification pending; ADR-0004 v0.2) and terminals `CANCELLED, REJECTED, EXPIRED, FAILED`. `UNRESOLVED` exits only to `CONFIRMED` (event found/adopted via search) or `FAILED` (verified `confirmed_absent`); exhausted reconciliation keeps `UNRESOLVED` + escalation. Illegal transitions are rejected by the pure transition function (unit-tested exhaustive table).

## 4. [REQUIRED] Persistence, concurrency and failure

- **Transaction owner:** `db/` repositories using a `pg` client (transaction-pooler connection) for atomic operations; supabase-js for single-statement CRUD. Booking transition = one transaction: lock `booking_state` row (`FOR UPDATE`), validate transition, write state + related rows.
- **Concurrency:** one active conversation enforced by semaphore at HTTP layer (503 `RESOURCE_LIMIT` beyond); inference semaphore = 1; conversation-level writes serialized by row lock.
- **Idempotency:** customer confirm retried with same token → same result (token consumed once, response cached in state); calendar create carries `idempotency_key` (also stored as Google extended property) + partial unique index on `google_event_id`.
- **External-effect boundary:** calendar port only. Uncertain outcomes (timeout/error after the create request was sent) resolve to exactly one of `created` / `confirmed_absent` / **`unresolved`** — an exhausted reconciliation attempt leaves `unresolved` persisted with the original idempotency identity, escalates for human review, and resumes after process restart (startup sweep + next access + admin trigger); the system never blind-recreates with a fresh identity and never reports an unresolved case as success or failure (ADR-0004 v0.2, TC-36).
- **Consent enforcement (dual-layer):** the backend boundary refuses recording persistence without an affirmative consent row (trusted-code check) AND the DB trigger `enforce_recording_consent()` independently rejects such inserts even from service_role (DATABASE §3, TC-33).
- **Resource admission:** before any model load (STT sidecar load or LLM warm-up), an available-memory admission check refuses/queues with `RESOURCE_LIMIT` rather than thrashing the host; STT and LLM are strictly sequential per turn; cold vs warm model latency is measured and reported separately — proposed budgets are provisional measurement targets until measured (ENVIRONMENT §4, TC-37).
- **Unknown-outcome handling:** all external calls carry AbortSignal timeouts (LLM 30s, STT 30s, calendar 15s); cancellation discards stale results; no silent retries of non-idempotent effects.

## 5. [OPTIONAL] Jobs, cache and integrations

- No background job system. Reconciliation is an inline bounded retry on the failing request path + next-turn check. NOT_APPLICABLE: caches, scheduled jobs, webhooks, Realtime.
- Integrations: Ollama HTTP (`/api/chat` JSON mode or format schema where supported — adapter handles capability differences), OpenAI-compatible `/chat/completions` (structured output only where provider supports it; per-provider capability flags), Google Calendar REST via `googleapis`.

## 6. [REQUIRED] Runtime and proof

- Startup: Zod-validated config (fail-fast), DB connectivity check, Ollama reachability check (degrade to "no local model" if down), optional sidecar launch. Shutdown: graceful per ARCHITECTURE §6.
- Proof: TC-01…TC-32 (`TESTING.md`); exhaustive state-machine transition table tests; requirement-linked integration tests; real-model and real-calendar evidence separated from mocks. Command ownership established at Stage 3 scaffold.
- Unresolved: Q4 retention values (G02); cloud provider selection (separate authorization); Q3 Google credentials (Stage 7). Implementation waits for G02.
