# PROJECT — Scope and Requirements

| Field | Value |
| --- | --- |
| Project ID | AI-RECEPTIONIST |
| Document ID | PROJECT |
| Version / date | v0.2 — 2026-10-24 |
| Owner | ZCode execution agent (maintainer); human decision authority: project owner |
| Scope | Requirements baseline for the AI Receptionist **backend + AI phase** (frontend out of scope this phase) |
| Document lifecycle | approved — G01-REQUIREMENTS (project owner, 2026-10-24) |
| Input provenance | Human master execution prompt (project owner, 2026-10-23); change instruction CH-1 — multi-provider AI model system (project owner, 2026-10-24); discovery facts in `PROGRESS.md` §8 |
| Related authoritative files | `docs/backend/PLAN.md`, `docs/backend/TESTING.md`, `docs/backend/PROGRESS.md` |
| Approval reference | G01-REQUIREMENTS APPROVED 2026-10-24 — scope v0.2 (FR-1…FR-18, SEC-1…SEC-16, CH-1) + Q1 Supabase + Q4 deferral; see `PROGRESS.md` §5 |

## 1. [REQUIRED] Document control and provenance

- **Human brief:** master execution prompt (2026-10-23) — build the complete backend and AI capabilities of an AI Receptionist application through staged, gated development; genuinely functional systems, not demonstrations.
- **Change CH-1 (2026-10-24, project owner instruction):** add a dynamic multi-provider AI model system — automatic local Ollama model discovery, configurable cloud API providers (OpenAI-compatible adapter first), one unified backend inference contract, secure API-key management, deliberate runtime switching/fallback, and a documented settings API contract for a future frontend page. Incorporated into this v0.2 baseline and **approved at G01 (2026-10-24)**.
- **Inspected baseline:** workspace was empty (greenfield); verified environment facts recorded in `PROGRESS.md` §8 (Node v24.15.0, Python 3.11.9, Ollama 0.40.9 with `qwen3:1.7b` smoke-tested OK, Supabase ref `ogxdszjypswutekqgorb` reachable and empty, host i3-1115G4 / 7.71 GB RAM).
- **Verified facts** are marked `[F]`; **proposed decisions/defaults** are marked `[P]`; unresolved questions are Q-IDs in §6. No product/business facts are invented; business content (name, services, FAQs, hours) is configuration data supplied by the owner.

## 2. [REQUIRED] Purpose, actors and boundaries

**Problem/outcome:** a backend + AI system that converses naturally with customers (text, and speech via local recognition), answers business-specific questions, identifies intent, extracts structured appointment details, checks real Google Calendar availability, obtains explicit confirmation, creates/cancels/reschedules real calendar events, and persists protected records — ready for subsequent frontend integration.

**Actors:**
- **Customer** — unauthenticated end user; converses via text or approved transcribed speech.
- **Business administrator** — authenticated; manages business config, customers, appointments, conversations, consent/records.
- **Backend system** — server processes; the only executor of privileged actions.
- **AI subsystem** — local LLM + speech recognition; output is untrusted data until backend validation.
- **External providers** — Google Calendar (OAuth 2.0), Supabase (PostgreSQL/Auth, pending Q1), Ollama (local HTTP, never internet-exposed), authorized cloud LLM providers (opt-in, server-side only).

**Scope:** conversation management, intent + structured extraction, booking state machine, calendar adapter abstraction with mock + real implementations, speech pipeline (STT in, response text out), configurable business knowledge, **multi-provider AI model system (local discovery + configurable cloud providers + unified inference contract + secure credentials + deliberate switching/fallback)**, consent-aware records, management APIs, security invariants, verification.

**Non-goals (this phase):** frontend implementation (separate future phase with frontend-master — the AI Models & Providers settings page is a documented API contract only); telephone/PSTN calling; multi-conversation concurrency beyond one active conversation initially; TTS server (browser SpeechSynthesis instead `[P]`); model training or large model downloads; production deployment (later gated stage); activation of any paid cloud provider, spend of API credits, or transmission of real customer data to a cloud provider without separate explicit authorization; support for arbitrary model files outside Ollama without a separately implemented runtime adapter.

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
| FR-15 | CH-1.A | Backend+Admin / **local model discovery**: detect reachable Ollama instance; discover installed models via Ollama's supported APIs with actual names/metadata; refresh list when models are added; select compatible installed models without hardcoded names; validate basic availability/capabilities; report resource limits and model-loading failures clearly | Model list reflects actual installed models (e.g., `qwen3:1.7b` initially); detection never auto-activates a model; Ollama down / no compatible models / selected model missing / load failure each return explicit, distinct error states — never a fabricated list | M |
| FR-16 | CH-1.B/1.C | Admin+Backend / **cloud provider configuration + unified inference contract**: authorized admin configures provider identity, supported model identifier, endpoint (where applicable), credential, connection status; one stable backend-facing LLM interface covering provider/model selection, structured requests, normalized output, error handling, timeouts/cancellation, usage/resource limits, health checks, explicit uncertainty. Begin with an OpenAI-compatible adapter **only where the selected provider's API actually supports it**; add provider-specific adapters without replacing business logic; do not assume identical request parameters, tools, streaming or JSON-schema features across providers | Conversation, intent, extraction and booking logic run unchanged against local or configured cloud provider through one contract; cloud model list comes from supported provider APIs or explicit configuration — never invented; every provider output validated by trusted backend code before use | M |
| FR-17 | CH-1.E | Admin+Backend / **runtime switching and deliberate fallback**: switch active model/provider via configuration without modifying or rebuilding source; preserve domain contracts; fallback only when explicitly approved — never silently local→cloud, never automatic egress of private conversation data; failed selected model → safe error or explicitly approved fallback only; no mid-conversation switch to an incompatible model without an approved continuity strategy | Switching takes effect on new sessions (or documented continuity path); fallback attempts without approval are denied and logged; a failing model produces a safe error state, not a silent provider change | M |
| FR-18 | CH-1.F | Admin / **AI Models & Providers settings API contract** (contract documentation only — UI owned by future frontend phase): local model discovery listing, provider/model selection, add/remove supported API-provider configs, secure API-key entry, connection testing, availability/error status, persisted authorized selection | Contract documented in API/INTEGRATION specs at design; unauthorized settings access denied; credential values masked in all settings responses | M (contract) / UI NOT_APPLICABLE this phase |

**Security invariants (mandatory, from prompt §6 + CH-1.D):** SEC-1 validated inputs at every trust boundary; SEC-2 authenticated administrative operations; SEC-3 least privilege + RLS or equivalent enforced access on exposed data paths; SEC-4 server-only secrets, none in repo/client/logs; SEC-5 Ollama never exposed to public internet; SEC-6 tool/action allowlisting — LLM never executes arbitrary SQL/shell/unrestricted calendar ops; SEC-7 no event creation without explicit confirmation + availability recheck; SEC-8 injection-resistant orchestration (transcripts/user text are data, never instructions); SEC-9 idempotent calendar/booking operations with reconciliation for non-atomic FreeBusy/create; SEC-10 rate and resource limits; SEC-11 safe errors/logs (no secrets/PII leakage); SEC-12 AI/provider output is never an authorization source; SEC-13 no invented service receipts or success messages — every claimed result has real evidence; **SEC-14 (CH-1.D) API credentials accepted only through the authorized configuration boundary, stored in an appropriate server-side secret mechanism (no weak custom encryption — strategy evaluated at design review), never in Git commits, plaintext records, client responses or logs, never sent to a model as prompt content, supporting secure replacement/removal and masked display; SEC-15 (CH-1.D/1.E) cloud inference is explicit opt-in — no unapproved fallback to a paid/external provider, no automatic transmission of private conversation data off-device; SEC-16 (CH-1.D) configurable provider endpoints are validated against SSRF and unintended network access at the configuration boundary.**

## 4. [REQUIRED] Operational and data constraints

- **Host:** Intel i3-1115G4 (2C/4T), 7.71 GB RAM (only 0.77 GB free at 2026-10-23 inspection), 195 GB disk free `[F]`. Initially one active conversation; minimize memory; bounded model context; bounded audio segment duration; avoid concurrent heavy inference; staged loading/unloading where it materially helps `[F from prompt]`.
- **Latency/workload:** end-to-end conversation response latency and STT latency must be **measured**; no invented performance claims `[F from prompt]`. Numeric budgets: Q4-adjacent decision at design (see §6 Q5).
- **Runtime AI:** Ollama + `qwen3:1.7b` local (verified installed) as the initial selected runtime model; any Ollama-registered compatible model is selectable (detection ≠ activation) `[F from CH-1]`. `qwen3:0.6b` fallback candidate (not installed — acceptable) `[F]`. STT: Faster-Whisper Tiny CPU INT8 preferred; Base only if justified by measured quality/resources `[P per prompt]`.
- **Cloud LLM providers (CH-1):** server-side only; explicit opt-in; price-aware cost admission, quotas and egress limits enforced by the backend (token caps are not dollar caps) `[F from ai-capabilities rules]`; data region/retention obligations for any chosen provider are recorded at configuration time; actual provider credentials come only from the authorized admin boundary — none exist yet `[F]`.
- **Data lifecycle:** consent-gated recording disabled by default; retention/deletion rules required — concrete retention periods are an owner decision (Q4). Customer PII must be protected; secrets server-only.
- **Platform:** Node.js + TypeScript + Fastify + Zod modular monolith `[P per prompt, confirm at G02]`; Supabase/PostgreSQL where approved (Q1); Google Calendar via OAuth 2.0; no Docker/Kubernetes/Redis/Kafka unless justified `[F from prompt]`.
- **Availability/recovery:** development-phase availability targets not set (Q6); migration/recovery intent defined at design (protocol 07/23).

## 5. [OPTIONAL] Activated capabilities

- Speech recognition (FR-8) — activated.
- Recording storage (audio files) — activated only behind consent (FR-9); storage surface decided at design.
- RAG/retrieval beyond deterministic FAQ — NOT_APPLICABLE initially; activates only on demonstrated knowledge complexity (FR-4b).
- Cloud LLM providers (FR-16/FR-17) — conditional, opt-in only: no provider is configured or activated until an authorized administrator deliberately adds one and cloud inference is enabled; local-only operation is the default and must remain fully functional without any cloud configuration.

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
| Q7 | Server-side secret-storage mechanism for provider API credentials (env/OS keystore/managed secret store — no weak custom encryption) | CH-1.D directs evaluation at architecture design | Blocks Stage 2 security design + FR-16 credential storage implementation | Design proposal → **G02** |
| A3 | `[P]` First cloud adapter is OpenAI-compatible, adopted only for providers whose actual API supports it; provider-specific adapters added per provider without changing the domain schema | CH-1.B + ai-capabilities llm guidance ("add provider adapters without changing the domain schema") | Stage 2/4 design | Confirm at G02 |
| R4 | Risk: multiple local models cannot co-load in 8 GB RAM (0.77 GB free at discovery); discovery listing many models invites accidental concurrent activation | CH-1.A + discovery §8 | Staged load/unload + one-active-model policy in design; TC-24 measures | Design + Stage 4 |
| R5 | Risk: cloud inference transmits customer data externally and incurs charges | CH-1.D/1.E | SEC-14/15/16 enforcement; explicit opt-in flag; cost admission bounds; separate authorization before any real provider activation | Design + Stage 4; activation authorization via 05 |

## 7. [REQUIRED] Review boundary

- **Bundle:** `PROJECT.md` v0.2, `PLAN.md` v0.2, `TESTING.md` v0.2 (all review-ready, **not approved** — CH-1 incorporated per change management protocol 21), discovery evidence in `PROGRESS.md` §8, change record CH-1 in `PROGRESS.md` §3.
- **Unresolved blockers:** Q3 (Calendar) — does not block requirements approval. Q2 (push) resolved 2026-10-24: remote `Aryan4verma/AI-RECEPTIONIST` verified reachable and empty.
- **Required human decisions:** Q1 (database platform), approval of scope/non-goals/acceptance **including the CH-1 multi-provider AI model system (FR-15…FR-18, SEC-14…SEC-16)**; Q4 may be decided now or deferred to design with a recorded owner. Secret-storage strategy (Q7) and adapter default (A3) are design-stage decisions (G02), not requirements blockers.
- **Next allowed phase upon approval:** Stage 2 — architecture and contracts (protocols 06–11, 14), then G02-DESIGN.
- **Approval reference:** NONE — pending.
