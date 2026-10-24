# TESTING — Acceptance and Verification Plan

| Field | Value |
| --- | --- |
| Project ID | AI-RECEPTIONIST |
| Document ID | TESTING |
| Version / date | v0.5 — 2026-10-24 (v0.2 scope APPROVED at G01; TC-32…TC-37 APPROVED at G02 conditional approval; TC-38…TC-42 added as Stage 3 quality-correction regression tests) |
| Owner | ZCode execution agent (maintainer); human decision authority: project owner |
| Scope | Acceptance and verification plan for the backend + AI phase |
| Document lifecycle | approved (G01 for v0.2 scope; G02 conditional approval for TC-32…TC-37, conditions satisfied 2026-10-24) |
| Input provenance | `PROJECT.md` v0.1 requirements; master execution prompt §10 verification policy |
| Related authoritative files | `PROJECT.md`, `PLAN.md`, `PROGRESS.md` |
| Approval reference | G01-REQUIREMENTS APPROVED 2026-10-24 for v0.2 scope (TC-01…TC-31); TC-32 pending G02; see `PROGRESS.md` §5 |

## 1. [REQUIRED] Control and baseline

- **Native runner:** none exists yet (greenfield). `[P]` Vitest as the greenfield TypeScript runner (STACK default) — confirmed at G02. Commands to be defined at Stage 3 scaffold (planned shape: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`).
- **Repository/content identity:** git repo `C:\AI RECEPTIONIST` branch `main`; commits `aabe955` (register), `ef36fda` (register SHA update). Requirements bundle adds PROJECT/PLAN/TESTING v0.1.
- **Inherited failures:** none (greenfield).
- **Isolated environments available:** local Node/Python; Ollama at `localhost:11434` (verified); Supabase project `ogxdszjypswutekqgorb` (empty — safe target pending authorization); mock calendar adapter (in-process); real Google Calendar — **no access until Q3 authorization**.

## 2. [REQUIRED] Requirement-to-proof matrix

All rows are **PLANNED** — no check below has been executed. Statuses live in `PROGRESS.md` §4 when executed. Layers: UT unit (mocked), IT integration (real HTTP/service in-process), RM real-model (actual Ollama), RDB real database (authorized Supabase), RC real calendar (authorized test calendar only), E2E end-to-end.

| Test/check ID | Requirement / invariant | Scenario / asserted outcome | Layer / role / fixture | Command / evidence (planned) | Status / limitation |
| --- | --- | --- | --- | --- | --- |
| TC-01 | FR-1 | Session start returns configured greeting; termination leaves no orphaned state | IT | Vitest + HTTP client | PLANNED |
| TC-02 | FR-2 | Utterance → validated intent; malformed model JSON → explicit unknown path, no action | RM + UT (seeded Ollama) | Vitest + real Ollama | PLANNED |
| TC-03 | FR-3 | Extraction with missing date/contact → clarification, never a guess; ambiguous duration → explicit ambiguous state | RM + UT | Vitest + real Ollama | PLANNED |
| TC-04 | FR-4 | FAQ answer from configured knowledge; unknown topic → escalation path | IT | Vitest + seeded config | PLANNED |
| TC-05 | FR-5 | Full state machine happy path; each failure branch (invalid data, unavailable slot, expiry, rejection, external failure) reaches defined terminal/recovery state | IT | Vitest + mock calendar | PLANNED |
| TC-06 | FR-6/SEC-7 | Mock adapter: availability → offer → confirm → recheck → create → persisted ID; duplicate create attempt → idempotent same event, not a second | IT | Vitest + mock adapter | PLANNED |
| TC-07 | FR-6/SEC-7 | Real adapter: actual FreeBusy query and test event create/recheck/cancel on **authorized test calendar only** | RC (requires Q3) | Real Google API | PLANNED — BLOCKED until Q3 |
| TC-08 | FR-7/SEC-12 | Attempted event creation without explicit confirmation → denied; AI-proposed booking alone creates nothing | IT | Vitest | PLANNED |
| TC-09 | FR-8 | Real audio sample → real transcript (Tiny INT8); oversized/invalid/unsupported audio → safe rejection; STT failure → defined error path | IT + RM (audio fixtures) | Vitest + Faster-Whisper | PLANNED — requires Stage 6 install |
| TC-10 | FR-9/SEC-3 | No audio persisted without recorded consent; consent-off session produces transcript-only processing; deletion honored | IT + RDB | Vitest + Supabase | PLANNED |
| TC-11 | FR-10/SEC-2/SEC-3 | Unauthenticated request to admin API → 401/403; cross-actor access denied; RLS or equivalent enforced with real roles | RDB + IT | Vitest + Supabase roles | PLANNED |
| TC-12 | FR-11 | Authorized cancel/reschedule updates calendar + records; unavailable reschedule slot → explicit failure | IT (+RC for real) | Vitest + mock/real | PLANNED |
| TC-13 | FR-13/FR-14 | Management APIs CRUD with authenticated admin; config change reflected in next conversation | IT | Vitest | PLANNED |
| TC-14 | SEC-1/SEC-8 | Injection attempts via customer text/transcript cannot trigger tool execution or override constraints; prompt-injection corpus rejected as data | RM + IT | Injection fixtures | PLANNED |
| TC-15 | SEC-4/SEC-5/SEC-11 | No secret in repo/logs/client; Ollama bound to localhost only; error responses safe | IT + static | grep/audit + config test | PLANNED |
| TC-16 | SEC-9 | Concurrent double-booking race: two confirmations for one slot → one event, one reconciled loser | IT | Vitest + mock adapter concurrency | PLANNED |
| TC-17 | SEC-10 | Rate/resource limits: oversized audio, context overflow, request flood → bounded rejection | IT | Vitest | PLANNED |
| TC-18 | FR-5/FR-6 | Calendar outage simulation + LLM outage: defined degraded/escalation behavior, no fabricated success | IT | Fixture faults | PLANNED |
| TC-19 | NFR (host) | Measured: cold/warm LLM latency, STT latency, E2E conversation latency, RSS with LLM and STT (staged, not concurrent) | RM + IT | Instrumented runs, results in PROGRESS §4 | PLANNED |
| TC-20 | Migrations | Clean replay of full migration stream on empty database; constraint/policy checks | RDB | Supabase migration tooling | PLANNED — requires Q1 + write authorization |
| TC-21 | FR-15 | Ollama unreachable → explicit provider-unavailable error state; conversation fails safe; no fabricated model list | IT | Vitest + stopped/unreachable Ollama endpoint fixture | PLANNED |
| TC-22 | FR-15 | Ollama reachable but zero compatible installed models → explicit empty-capability state, never invented names | IT + RM | Vitest + real Ollama | PLANNED |
| TC-23 | FR-15/FR-17 | Selected model missing at inference time (e.g., removed between selection and use) → explicit model-unavailable error; no silent switch to another model | IT + RM | Vitest + real Ollama with configured-but-absent model name | PLANNED |
| TC-24 | FR-15/NFR (R4) | Model load exceeding available RAM → load failure reported clearly; concurrent heavy-model activation prevented by staged loading policy | IT + RM (measured) | Vitest + instrumented load on real host | PLANNED |
| TC-25 | FR-16/SEC-14 | Invalid cloud API key → provider auth failure surfaced as safe PROVIDER_FAILURE-class error; no secret in message/logs; bounded retries only | IT | Vitest + local OpenAI-compatible fixture server (no real key) | PLANNED |
| TC-26 | FR-16 | Provider timeout and cancellation → TIMEOUT / CANCELLED statuses; in-flight request aborted; no partial output adopted; no external effects | IT | Vitest + fixture server with induced delay/abort | PLANNED |
| TC-27 | FR-16/SEC-8/SEC-12 | Malformed structured output from any provider (invalid JSON, extra keys, wrong types) → INVALID_OUTPUT rejection by trusted backend validation — provider-agnostic, local and cloud alike | UT + RM | Vitest schema tests + real Ollama | PLANNED |
| TC-28 | FR-18/SEC-2/SEC-3 | Model/provider settings API: unauthenticated → 401; non-admin → 403; only authorized admin boundary mutates configuration | IT + RDB | Vitest + Supabase roles | PLANNED |
| TC-29 | SEC-14 | Secret disclosure sweep: API keys absent from all HTTP responses (masked display), application logs, error bodies, git history; replacement/removal honored | IT + static | Vitest response assertions + repo grep/log review | PLANNED |
| TC-30 | SEC-16 | Invalid/unsafe custom endpoint rejected at configuration boundary: internal/private addresses, localhost metadata targets, non-HTTP(S) schemes — SSRF attempts never stored or fetched | IT | Vitest endpoint-validation cases | PLANNED |
| TC-31 | SEC-15/FR-17 | Unapproved fallback: selected local model fails with no approved cloud fallback configured → safe error, zero cloud egress, denial logged; fallback attempt without explicit approval is denied | IT | Vitest + fixture provider asserting zero outbound calls | PLANNED |
| TC-32 | SEC-14/FR-16 (ADR-0002 v0.2) | **Fail-closed secret storage:** when Vault is verified available+secure → credential round-trip, no plaintext at rest, masked readback, replace/remove honored; when Vault is unavailable or privilege-insecure → OP-16 returns `CREDENTIAL_STORE_UNAVAILABLE`, **no fallback silently activates**, cloud credential persistence disabled, local Ollama path fully operational | IT | Vitest + Vault verification checks + disabled-state behavior tests | PLANNED (approved at G02) |
| TC-33 | FR-9 (dual-layer consent, latest-decision) | `enforce_recording_consent()` trigger denies a `recordings` insert in ALL of: **no consent; explicit denial; granted-then-withdrawn (latest decision governs); expired (`valid_until` passed) or superseded consent; service_role (RLS-bypassing) insert after withdrawal**; insert succeeds only when the latest applicable decision is affirmative and unexpired; backend boundary refuses independently first | RDB | Vitest + real DB role tests | PLANNED (approved at G02) |
| TC-34 | G07 migration integrity | Remote `supabase_migrations.schema_migrations` history matches committed migration files (name+hash); clean replay on empty DB; intended-vs-catalog drift zero after each migration; any out-of-stream schema change is flagged as drift, never adopted | RDB | CLI history query + replay + catalog comparison | PLANNED (approved at G02) |
| TC-35 | SEC-3 RLS correctness (hardened definer) | `private.is_app_admin()` lives in the **non-Data-API-exposed `private` schema** (not callable via Data API); EXECUTE revoked from PUBLIC/anon, granted to `authenticated` only; hardened `search_path` verified (unqualified-name hijack fails); no recursive-policy errors (`42P17` absent); admin allow + non-admin deny + revoked-membership deny as **real roles**; membership removal revokes within freshness bound | RDB | Vitest + real-role tests + Data-API call attempt + policy EXPLAIN | PLANNED (approved at G02) |
| TC-36 | FR-6/SEC-9/SEC-13 (uncertain outcomes) | Timeout-after-send on create → state `unresolved` persisted with original idempotency identity; search-by-`privateExtendedProperty` finds the event → adopted, no second create; confirmed absent → explicit `confirmed_absent`; **exhausted reconciliation leaves `unresolved` + escalation, never auto-FAILED**; restart sweep resumes recovery; customer never told success/failure while unresolved | IT (+RC real branch) | Vitest + mock adapter fault injection + restart-cycle test | PLANNED (approved at G02) |
| TC-37 | NFR/Q5 (evidence-driven budgets) | Memory-admission check refuses model load under low free RAM with `RESOURCE_LIMIT` (no thrash); STT and LLM strictly sequential per turn; cold vs warm model latency and RSS measured and reported separately; sidecar reload-on-demand works; readiness does not require model residency | IT + RM (measured on real host) | Instrumented Vitest runs + measured evidence in PROGRESS §4 | PLANNED (approved at G02) |
| TC-43 | DB contract (Stage 3 correction 1) | Static SQL-contract test: migration-parsed column sets vs every pg-repo INSERT/UPDATE-SET/RETURNING/WHERE column reference; regression for the appointments.last_error mismatch (live catalog verified: column absent) | Static + catalog | schema-contract.test.ts + MCP read-only catalog check 2026-10-24 | PASS (static scope) — live-DB execution BLOCKED pending credentials |
| TC-44 | Booking recovery windows (correction 2) | Recovery across CREATE_EVENT (re-send with SAME identity after search), VERIFY_RESULT (found→CONFIRMED / absent→UNRESOLVED), missing-identity adoption from open appointment, idempotent CONFIRMED replay without fabricated ids | IT (fixture) | recovery.test.ts | PASS (fixture scope) — restart on real process BLOCKED pending credentials |
| TC-45 | Concurrency (correction 2) | Concurrent confirmations serialize on the atomic registerAppointment CAS — exactly one appointment row and one event; loser gets a conflict | IT (fixture) + RDB later | recovery.test.ts | PASS (fixture) — real concurrent-DB test pending credentials |
| TC-46 | Error envelope (correction 3) | AppError details server-only unless explicitly exposed; non-AppError → generic INTERNAL envelope; provider text never reaches clients; full diagnostics server-side with requestId | IT | recovery.test.ts envelope cases | PASS |
| TC-47 | FR-3 extraction | Multi-turn merge with sticky known values; malformed output keeps prior state (never guesses); follow-up per first missing field; resolution uses business-config defaults (duration/timezone); past-time rejection; strict schema rejection (unknown keys/oversize) | IT (fixture) + RM later | extraction/service.test.ts | PASS (fixture) — real-model accuracy evals are Stage 4 |
| TC-48 | FR-4 FAQ grounding | Keyword retrieval returns configured answers VERBATIM; no-match → safe fallback; missing config safe; no model in the answer path (fabrication structurally impossible) | IT | knowledge/service.test.ts | PASS |
| TC-49 | Admin APIs (FR-13/14) | 401 unauthenticated / 403 non-member on all admin routes; config versioning + audit; customer create/patch/anonymize with audit; unknown category 404; transcript view authorized | IT (fixture guard) + RDB later | admin/index.test.ts | PASS (fixture) — live role evidence TC-28 RDB branch pending credentials |
| TC-50 | Turn orchestration | handleCustomerTurn routes booking→extraction, question→FAQ, human→escalation; replies backend-authored | IT | via conversation routes | PASS (fixture) |
| TC-53 | E2E integration (fixture scope) | Full journey over HTTP: greeting → booking turns with follow-ups (incomplete extraction never advances the state machine) → extraction-complete offer (config duration/timezone) → explicit confirm → CONFIRMED with persisted event id → customer record linked → admin list + calendar-safe cancel (calendarCancelled=true) → truthful replay; FAQ verbatim; injection text creates nothing | E2E (fixture) | e2e/receptionist.e2e.test.ts | PASS (fixture) — real-DB E2E pending credentials |
| TC-54 | Timezone correctness | Offset-qualified RFC 3339 used as-is (no double shift); naive wall-clock interpreted once in the business timezone via DST-safe two-pass conversion; non-IANA timezone refused at recovery | IT | extraction/service.test.ts + recovery tests | PASS (fixture) — DST boundary cases extend at Stage 6 measurement |
| TC-55 | FAQ weak-match rejection | Single-token overlap in a multi-keyword entry is rejected (score < 0.5) → safe fallback instead of an irrelevant answer | IT | knowledge/service.test.ts | PASS |
| TC-56 | Production composition (hardening 1) | The REAL createProductionApp factory builds with lazy clients; ConversationService deps include the same BookingService instance + extraction/knowledge/bookingState; BookingService carries audit/customers/conversations/escalate; routes live (validation 400 before any infrastructure call) | Composition (fixture clients) | e2e/hardening.test.ts | PASS |
| TC-57 | Timezone determinism (hardening 3) | Offset-qualified RFC 3339 used as-is; naive wall-clock converted once via DST-safe two-pass independent of server TZ (verified across two business timezones); DST gap resolves forward; overlap deterministic (later occurrence, documented); invalid input fails safely | IT | e2e/hardening.test.ts | PASS |
| TC-58 | Cancellation ↔ status/replay sync (hardening 4/5) | Customer cancel cancels the actual calendar event and syncs the appointment record; replay after cancel → CANCELLED (never an active confirmed booking); publicStatus → 'cancelled'; customer↔conversation↔appointment linkage with dedupe | IT (fixture) | e2e/hardening.test.ts | PASS (fixture) — real-DB branch pending credentials |

Negative/failure cases are explicit above (TC-02, TC-07, TC-08, TC-10, TC-11, TC-14, TC-16, TC-17, TC-18). Real database, real-model, and real-calendar boundaries use their actual services (RDB/RM/RC) — mocks never substitute where the column names them.

## 3. [REQUIRED] Fixtures and safety

- **Synthetic data:** seeded business config (fictional test business, clearly labeled), synthetic customer records, scripted audio samples (recorded by project owner or clearly synthetic tones/samples — no real customer PII in fixtures). **Cloud-provider tests use a local OpenAI-compatible fixture server with dummy keys — no real provider, no real credentials, no external calls (SEC-15).**
- **State isolation:** tests run against local services; Supabase tests use the authorized project `ogxdszjypswutekqgorb` (empty; no destructive reset without explicit authorization); mock calendar is in-process.
- **Destructive-command authorization:** any Supabase mutation beyond creating project-owned schema requires recorded authorization (PLAN §4); no reset of unknown/shared state; real Google writes only on the authorized test calendar after Q3.
- **Injection corpus:** adversarial prompt fixtures kept in-repo, clearly marked as test data (never runtime instructions).

## 4. [OPTIONAL] Specialized assurance

- **Load:** light scripted concurrency for SEC-10/TC-17 only; no invented load targets (budgets from Q5 at G02).
- **Browser:** NOT_APPLICABLE this phase (no frontend).
- **Restore/recovery rehearsal:** migration replay (TC-20) now; full recovery rehearsal activates at deployment stage (protocol 19/23).

## 5. [REQUIRED] Execution and freshness

- **Actual results:** recorded in `PROGRESS.md` §4 (gate evidence ledger) with command, timestamp, code/config/target identity, and evidence path; this file holds intent only and links there — no duplicated outcome ledgers.
- **Rerun policy:** changes to requirements, schema, contracts, prompts, model version, or calendar adapter invalidate affected TC rows; unrelated valid evidence is preserved with an equivalence note where the enclosing revision changes.
- **No local-only claim inflation:** local pass results are labeled with their scope; production/live claims require the production verification stage.

## 6. [REQUIRED] Gaps and review

| Gap / blocked item | Requirement | Owner / next proof |
| --- | --- | --- |
| No runner/scaffold yet | All TCs | Stage 3 establishes commands |
| Real-model behavior unmeasured (extraction quality risk R1) | FR-2/FR-3 | Stage 4 evals; fallback decision if measured failure |
| Real Calendar inaccessible (Q3) | TC-07/TC-12 real branch | Owner authorization before Stage 7 |
| Retention policy values (Q4) | FR-9 retention ops | Owner decision; consent gating testable without it |
| Latency/memory budgets unset (Q5) | TC-19 thresholds | G02 design decision |
| Faster-Whisper not installed | TC-09 | Stage 6 install + fixture tests |
| Secret-storage mechanism undecided (Q7 — fail-closed proposal in ADR-0002 v0.2) | TC-32 | G02 decision; Vault availability + privilege verification at implementation before any adoption |
| Supabase Vault privilege posture unverified | TC-32/SEC-F4 | Read-only verification at Stage 3 |
| Network IPv6 availability unknown (direct vs session-pooler) | G03 connectivity check | Stage 3 verification records the chosen path |
| Provisional budgets unmeasured (Q5) | TC-19/TC-37 | Honest cold/warm measurement at implementation; no performance PASS claims before evidence |
| No real cloud provider authorized | TC-25/TC-26/TC-31 real-provider branch | Permanently fixture-based unless owner separately authorizes a provider (SEC-15) |
