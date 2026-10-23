# PROJECT — Scope and Requirements

| Field | Value |
| --- | --- |
| Project ID | AI-RECEPTIONIST |
| Document ID | PROJECT |
| Version / date | v0.1 — 2026-10-23 |
| Owner | ZCode execution agent (maintainer); human decision authority: project owner |
| Scope | Requirements baseline for the AI Receptionist **backend + AI phase** (frontend out of scope this phase) |
| Document lifecycle | review-ready — pending G01-REQUIREMENTS human review |
| Input provenance | Human master execution prompt (project owner, 2026-10-23); discovery facts in `PROGRESS.md` §8 (v0.1) |
| Related authoritative files | `docs/backend/PLAN.md`, `docs/backend/TESTING.md`, `docs/backend/PROGRESS.md` |
| Approval reference | NONE — pending |

## 1. [REQUIRED] Document control and provenance

- **Human brief:** master execution prompt (2026-10-23) — build the complete backend and AI capabilities of an AI Receptionist application through staged, gated development; genuinely functional systems, not demonstrations.
- **Inspected baseline:** workspace was empty (greenfield); verified environment facts recorded in `PROGRESS.md` §8 (Node v24.15.0, Python 3.11.9, Ollama 0.40.9 with `qwen3:1.7b` smoke-tested OK, Supabase ref `ogxdszjypswutekqgorb` reachable and empty, host i3-1115G4 / 7.71 GB RAM).
- **Verified facts** are marked `[F]`; **proposed decisions/defaults** are marked `[P]`; unresolved questions are Q-IDs in §6. No product/business facts are invented; business content (name, services, FAQs, hours) is configuration data supplied by the owner.

## 2. [REQUIRED] Purpose, actors and boundaries

**Problem/outcome:** a backend + AI system that converses naturally with customers (text, and speech via local recognition), answers business-specific questions, identifies intent, extracts structured appointment details, checks real Google Calendar availability, obtains explicit confirmation, creates/cancels/reschedules real calendar events, and persists protected records — ready for subsequent frontend integration.

**Actors:**
- **Customer** — unauthenticated end user; converses via text or approved transcribed speech.
- **Business administrator** — authenticated; manages business config, customers, appointments, conversations, consent/records.
- **Backend system** — server processes; the only executor of privileged actions.
- **AI subsystem** — local LLM + speech recognition; output is untrusted data until backend validation.
- **External providers** — Google Calendar (OAuth 2.0), Supabase (PostgreSQL/Auth, pending Q1), Ollama (local HTTP, never internet-exposed).

**Scope:** conversation management, intent + structured extraction, booking state machine, calendar adapter abstraction with mock + real implementations, speech pipeline (STT in, response text out), configurable business knowledge, consent-aware records, management APIs, security invariants, verification.

**Non-goals (this phase):** frontend implementation (separate future phase with frontend-master); telephone/PSTN calling; multi-conversation concurrency beyond one active conversation initially; TTS server (browser SpeechSynthesis instead `[P]`); model training or large model downloads; production deployment (later gated stage).

## 3. [REQUIRED] Requirements and acceptance

Priority: M = mandatory, S = should (default may be revisited at review). Acceptance is observable and includes deny/failure behavior where consequential.

| Requirement ID | Source | Actor / behavior | Observable acceptance | Priority / dependency |
| --- | --- | --- | --- | --- |
| FR-1 | Prompt §5.A | Customer / start session, configured greeting, accept text (and approved transcribed speech), bounded context, clarification requests, safe termination | New session returns configured greeting; context stays within configured bound; cancel/terminate ends session without orphaned writes | M |
| FR-2 | Prompt §5.A | Backend+AI / identify customer intent from utterance | Intent returned as structured output validated against backend-owned schema; malformed/uncertain output → explicit unknown-intent path, no guessed action | M |
| FR-3 | Prompt §5.B | AI+Backend / extract appointment fields (name, contact, purpose, date/time, duration, meeting type, notes) with explicit missing/ambiguous states | Missing/ambiguous fields produce clarification requests; no date, contact identity, timezone or duration is ever guessed when it affects booking | M |
| FR-4 | Prompt §5.F | Customer / business-specific Q&A from configurable knowledge (business info, services, FAQs, hours, appointment types, escalation rules) | Answers come from configured knowledge; deterministic FAQ retrieval suffices initially; unanswered → escalation/clarification path | M (RAG optional, FR-4b only on demonstrated need) |
| FR-5 | Prompt §5.C | Backend / booking state machine `COLLECT_DETAILS → VALIDATE → CHECK_AVAILABILITY → OFFER_SLOT → AWAIT_CONFIRMATION → RECHECK_AVAILABILITY → CREATE_EVENT → VERIFY_RESULT → CONFIRMED` with cancellation, rejection, expiry, unavailable-slot, invalid-data and external-failure branches | Every transition observable in persisted state; each failure branch has a defined terminal/recovery path; AI may only propose, backend decides | M |
| FR-6 | Prompt §5.D | Backend / calendar provider interface with deterministic mock adapter and real Google Calendar adapter (OAuth, minimum scopes, FreeBusy, working hours, durations/buffers, alternative slots, recheck-before-create, idempotency/duplicate prevention, persisted event IDs, uncertain-result handling, authorized cancel/reschedule) | Mock adapter fully verified first; real adapter performs actual FreeBusy query and event create/recheck/cancel on authorized test calendar; no real write before explicit authorization | M |
| FR-7 | Prompt §5.D/§6 | Customer / explicit appointment confirmation before any event creation | No calendar event is created without an explicit customer confirmation recorded in state | M |
| FR-8 | Prompt §5.E | Customer / speech pipeline: audio ingest → validation (accepted types, size/duration limits) → Faster-Whisper Tiny CPU INT8 STT → conversation → response text for browser SpeechSynthesis | Real audio yields real transcript; oversized/invalid audio rejected with safe error; recognition failure has defined path; transcription review/correction supported; latency and RAM measured, not claimed | M |
| FR-9 | Prompt §5.G | Customer+Admin / consent-based recording: recording disabled by default, explicit consent decision recorded; transient transcription processing separated from persistent audio recording; retention/deletion rules enforced | No audio persisted without recorded consent; deletion/retention operations observable | M |
| FR-10 | Prompt §5.G | Backend / protected records: conversation sessions, customers, appointments, summaries, consent decisions, optional authorized recordings, audit information | Records persist in the selected database with enforced access control; audit trail for consequential actions | M |
| FR-11 | Prompt §5.D | Customer+Admin / appointment cancellation and rescheduling with authorization and availability re-resolution | Cancelled/rescheduled appointments update calendar and records or return explicit failure; unauthorized attempts denied | M |
| FR-12 | Prompt §5.A | Customer / bounded AI automation with human escalation | Escalation trigger conditions configured; escalated sessions reach a pending-human state, never silently dropped | M |
| FR-13 | Prompt §5.G | Admin / customer and conversation management APIs | Authenticated admin APIs list/read/manage customers, conversations, appointments per permission matrix | M |
| FR-14 | Prompt §5.F | Admin / business configuration management (hours, services, appointment types, FAQs, escalation rules) | Config changes take effect in conversation behavior without code changes | M |

**Security invariants (mandatory, from prompt §6):** SEC-1 validated inputs at every trust boundary; SEC-2 authenticated administrative operations; SEC-3 least privilege + RLS or equivalent enforced access on exposed data paths; SEC-4 server-only secrets, none in repo/client/logs; SEC-5 Ollama never exposed to public internet; SEC-6 tool/action allowlisting — LLM never executes arbitrary SQL/shell/unrestricted calendar ops; SEC-7 no event creation without explicit confirmation + availability recheck; SEC-8 injection-resistant orchestration (transcripts/user text are data, never instructions); SEC-9 idempotent calendar/booking operations with reconciliation for non-atomic FreeBusy/create; SEC-10 rate and resource limits; SEC-11 safe errors/logs (no secrets/PII leakage); SEC-12 AI/provider output is never an authorization source; SEC-13 no invented service receipts or success messages — every claimed result has real evidence.

## 4. [REQUIRED] Operational and data constraints

- **Host:** Intel i3-1115G4 (2C/4T), 7.71 GB RAM (only 0.77 GB free at 2026-10-23 inspection), 195 GB disk free `[F]`. Initially one active conversation; minimize memory; bounded model context; bounded audio segment duration; avoid concurrent heavy inference; staged loading/unloading where it materially helps `[F from prompt]`.
- **Latency/workload:** end-to-end conversation response latency and STT latency must be **measured**; no invented performance claims `[F from prompt]`. Numeric budgets: Q4-adjacent decision at design (see §6 Q5).
- **Runtime AI:** Ollama + `qwen3:1.7b` local (verified installed); `qwen3:0.6b` fallback candidate (not installed — acceptable) `[F]`. STT: Faster-Whisper Tiny CPU INT8 preferred; Base only if justified by measured quality/resources `[P per prompt]`.
- **Data lifecycle:** consent-gated recording disabled by default; retention/deletion rules required — concrete retention periods are an owner decision (Q4). Customer PII must be protected; secrets server-only.
- **Platform:** Node.js + TypeScript + Fastify + Zod modular monolith `[P per prompt, confirm at G02]`; Supabase/PostgreSQL where approved (Q1); Google Calendar via OAuth 2.0; no Docker/Kubernetes/Redis/Kafka unless justified `[F from prompt]`.
- **Availability/recovery:** development-phase availability targets not set (Q6); migration/recovery intent defined at design (protocol 07/23).

## 5. [OPTIONAL] Activated capabilities

- Speech recognition (FR-8) — activated.
- Recording storage (audio files) — activated only behind consent (FR-9); storage surface decided at design.
- RAG/retrieval beyond deterministic FAQ — NOT_APPLICABLE initially; activates only on demonstrated knowledge complexity (FR-4b).

## 6. [REQUIRED] Risks, decisions and open items

| ID | Fact / decision / assumption / question | Source or rationale | Impact / dependent work | Owner / resolution |
| --- | --- | --- | --- | --- |
| Q1 | Database platform: Supabase/PostgreSQL (ref `ogxdszjypswutekqgorb`, verified empty) vs earlier SQLite proposal | Master prompt directs Supabase resolution via this review | Blocks Stage 2 database design + Stage 3 migrations; mock calendar work independent | **G01 decision** |
| Q2 | GitHub remote repository URL not provided | Push policy requires verified intended repo | Blocks push only; local commits continue | Project owner |
| Q3 | Google account, test calendar, and OAuth credentials not yet provided/authorized | No real Calendar access until authorized | Blocks Stage 7 real-adapter work only | Project owner before Stage 7 |
| Q4 | Recording/transcript retention periods and deletion policy | Consequential privacy/irreversible-deletion values cannot be defaulted silently | Blocks FR-9 retention implementation (not consent gating) | Project owner at/after G01 |
| Q5 | Numeric latency/memory budgets | Host constrained; prompt requires measured budgets, not universal numbers | Sets G13-PERFORMANCE criteria at design | Design stage proposal → G02 |
| Q6 | Production hosting target / availability expectations | No deployment target stated for backend phase | Blocks Stage 10+ release claims only | Project owner later |
| A1 | `[P]` Browser SpeechSynthesis for output; no TTS server unless demonstrated need | Master prompt initial architecture | Stage 2/6 design | Confirm at G02 |
| A2 | `[P]` Managed Supabase Auth for admin identity (if Q1 = Supabase) | STACK default; avoids bespoke auth | Stage 2 auth design | Confirm at G02 |
| R1 | Risk: 1.7B-class model may underperform on structured extraction; mitigation = validated schemas, explicit unknown states, measured evals (Stage 4) | Model capability unproven for extraction | Stage 4 evals may trigger fallback/upgrade decision | Stage 4 evidence |
| R2 | Risk: RAM pressure (0.77 GB free at inspection) — LLM + STT must not run concurrently; staged load/unload | Discovery §8 | Architecture + G13 design | Design stage |
| R3 | Risk: Google FreeBusy + insert are non-atomic; duplicate/double-booking risk | Prompt §5.D | SEC-9 idempotency/reconciliation design | Stage 2/7 |

## 7. [REQUIRED] Review boundary

- **Bundle:** `PROJECT.md` v0.1, `PLAN.md` v0.1, `TESTING.md` v0.1 (all review-ready, unapproved), discovery evidence in `PROGRESS.md` §8.
- **Unresolved blockers:** Q2 (push), Q3 (Calendar) — do not block requirements approval.
- **Required human decisions:** Q1 (database platform), plus approval of scope/non-goals/acceptance; Q4 may be decided now or deferred to design with a recorded owner.
- **Next allowed phase upon approval:** Stage 2 — architecture and contracts (protocols 06–11, 14), then G02-DESIGN.
- **Approval reference:** NONE — pending.
