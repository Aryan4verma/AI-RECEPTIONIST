# TESTING — Acceptance and Verification Plan

| Field | Value |
| --- | --- |
| Project ID | AI-RECEPTIONIST |
| Document ID | TESTING |
| Version / date | v0.2 — 2026-10-24 (CH-1: added TC-21…TC-31 provider-system tests; review-ready, not approved) |
| Owner | ZCode execution agent (maintainer); human decision authority: project owner |
| Scope | Acceptance and verification plan for the backend + AI phase |
| Document lifecycle | review-ready — pending G01-REQUIREMENTS human review |
| Input provenance | `PROJECT.md` v0.1 requirements; master execution prompt §10 verification policy |
| Related authoritative files | `PROJECT.md`, `PLAN.md`, `PROGRESS.md` |
| Approval reference | NONE — pending |

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
| Secret-storage mechanism undecided (Q7) | TC-25/TC-29 storage branch | G02 design decision; fixture-based credential tests independent of it |
| No real cloud provider authorized | TC-25/TC-26/TC-31 real-provider branch | Permanently fixture-based unless owner separately authorizes a provider (SEC-15) |
