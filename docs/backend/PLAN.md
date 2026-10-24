# PLAN — Bounded Execution Plan

| Field | Value |
| --- | --- |
| Project ID | AI-RECEPTIONIST |
| Document ID | PLAN |
| Version / date | v0.2 — 2026-10-24 (CH-1 multi-provider AI model system incorporated; review-ready, not approved) |
| Owner | ZCode execution agent (maintainer); human decision authority: project owner |
| Scope | Bounded execution plan for the backend + AI phase (Stages 0–10 of the master roadmap) |
| Document lifecycle | approved — G01-REQUIREMENTS (project owner, 2026-10-24) |
| Input provenance | Human master execution prompt §8 roadmap (2026-10-23); `PROGRESS.md` §8 discovery facts |
| Related authoritative files | `PROJECT.md`, `TESTING.md`, `PROGRESS.md` |
| Approval reference | G01-REQUIREMENTS APPROVED 2026-10-24 — scope v0.2 + Q1 Supabase + Q4 deferral; see `PROGRESS.md` §5 |

## 1. [REQUIRED] Control and scope

- **Task:** execute the AI Receptionist backend + AI lifecycle in bounded stages with mandatory human gates.
- **Approved scope reference:** master execution prompt (standing authorization); this plan sequences it — it grants no approvals itself.
- **Baseline:** Stage 0 discovery complete (see `PROGRESS.md` §8); workspace greenfield; register initialized.
- **Non-goals:** frontend implementation; real Google Calendar access before Q3 authorization; any remote database mutation before design approval (Q1) and applicable gates; production deployment claims.
- **Planning assumptions:** autonomous advancement between stages; STOP only at mandatory gates (G01 requirements, G02 design, database/action authorizations, final review) or genuine blockers.

## 2. [REQUIRED] Dependency sequence

| Work item ID | Requirement IDs | Deliverable / owner | Prerequisites | Validation / exit | Review stop |
| --- | --- | --- | --- | --- | --- |
| WI-1 Stage 0 discovery | — | Environment/skill/Supabase verification + register | None | **DONE 2026-10-23** (`PROGRESS.md` §8) | G00-CONTEXT PASS |
| WI-2 Stage 1 requirements | FR-*, SEC-* | PROJECT/PLAN/TESTING drafts | WI-1 | Bundle internally consistent; acceptance observable | **G01-REQUIREMENTS** (current stop) |
| WI-3 Stage 2 architecture & contracts | FR-1..FR-14, SEC-1..13 | ARCHITECTURE, BACKEND, DATABASE, SUPABASE, AUTH, API, SECURITY, INTEGRATION, OBSERVABILITY, DEPLOYMENT, RUNBOOK, ENVIRONMENT drafts + ADRs; budgets (Q5); calendar adapter interface; state machine design | G01 PASS (Q1 resolved) | Cross-document consistency check (protocol 04 §11) | **G02-DESIGN** |
| WI-4 Stage 3 backend foundation & database | FR-10, SEC-1..4 | Scaffold (Fastify+TS+Zod), config/validation/error conventions, migrations, repos, auth, health endpoints | G02 PASS; authorized DB target | Migrations replay on real database; RLS/constraint tests | G06–G09 as applicable |
| WI-5 Stage 4 local LLM intelligence | FR-2, FR-3, FR-15, FR-16, FR-17, SEC-6/8/12/14/15/16 | Ollama integration + **provider abstraction layer (local discovery API + OpenAI-compatible cloud adapter + unified inference contract)**, structured intent/extraction, schema validation, injection/ambiguity tests, credential boundary | WI-4 (API skeleton) | Real-model evals vs mocks measured; malformed-output paths pass; provider negative cases (TC-21…TC-31) pass | G05 evidence; G13 measured |
| WI-6 Stage 5 conversation & appointment intelligence | FR-1, FR-4, FR-5, FR-12 | Session state, bounded context, booking state machine, FAQ retrieval, escalation | WI-5 | State machine success/denial/interruption/recovery tests pass | G05 |
| WI-7 Stage 6 speech & voice backend | FR-8 | Audio ingest + Faster-Whisper integration + latency/RAM measurement | WI-6 | Real-audio transcription measured; limits enforced | G05/G13 as applicable |
| WI-8 Stage 7 calendar integration | FR-6, FR-7, FR-11, SEC-7/9 | Mock adapter fully verified; then real Google OAuth + FreeBusy + writes on authorized test calendar | WI-6; **Q3 authorization** | Mock journey verified end-to-end; real adapter verified only on authorized target | G05; action authorization for real writes (05 stop) |
| WI-9 Stage 8 records, consent & management APIs | FR-9, FR-10, FR-13, FR-14, FR-18 | Management APIs, **AI Models & Providers settings API (per documented contract)**, consent-aware recording (Q4 retention), protected transcripts/summaries | WI-4, WI-6 | Access-control tests pass (admin vs unauthenticated); credential masking verified (TC-29) | G09/G10 evidence |
| WI-10 Stage 9 end-to-end verification | FR-1..FR-14 | Full authorized flow: request → inference → validated proposal → availability → confirmation → real event → persisted result; outage/duplicate/audio-error paths | WI-5..WI-9 | TESTING matrix executed; failures resolved in scope | G11 security checks; G13 measured budgets |
| WI-11 Stage 10 completion & frontend handoff | — | Feature inventory, API specs, integration guide, env docs, startup instructions, limitations | WI-10 | Handoff usable by frontend phase; PROGRESS resume state complete | **G18-FINAL** (final human review) |

## 3. [REQUIRED] Verification and evidence

- Proof matrix: `TESTING.md` (planned checks; executed results land in `PROGRESS.md` §4 ledger, not here).
- Current environment: discovery facts `PROGRESS.md` §8; runtime target identities re-verified before each stage that uses them.
- Inherited failures: none (greenfield). Unavailable prerequisites: GitHub remote (Q2), Google credentials (Q3), Faster-Whisper install (Stage 6), qwen3:0.6b fallback (only if needed).
- Planned ≠ executed: no check in this plan counts as PASS until its evidence is recorded in the register.

## 4. [REQUIRED] Review and authorization map

| Review / authorization | Concrete versions/actions/targets | Status | Invalidation triggers |
| --- | --- | --- | --- |
| G01-REQUIREMENTS | PROJECT/PLAN/TESTING v0.2 scope (incl. CH-1 multi-provider system) + Q1 decision | **NEEDS_HUMAN_APPROVAL** (current stop) | Material scope change (protocol 21) |
| G02-DESIGN | Stage 2 bundle + budgets (Q5) + platform confirmations (A1/A2/A3) + **provider architecture, unified inference contract, secret-storage strategy (Q7), SSRF validation design (SEC-16)** | Pending G01 | Material design change; requirement change |
| Database write authorization | First migration application to `ogxdszjypswutekqgorb` after Q1 + G02 | Not yet requested | Target change; schema redesign |
| Real Calendar action authorization | Account + test calendar + scopes (Q3), write/cancel/reschedule actions | Not yet requested (Stage 7) | Account/calendar/scope change |
| GitHub push authorization | Verified remote `Aryan4verma/AI-RECEPTIONIST` (Q2 resolved 2026-10-24) + ordinary stage commits | Remote verified empty; first push authorized by owner instruction | Remote/branch ambiguity; force-push never |
| Cloud provider activation authorization | Any real paid provider configuration with real credentials, spend, or real customer data transmission (SEC-15) | Not yet requested — separate 05 review per provider | Provider change; credential/data-scope change |
| G18-FINAL | Complete backend scope, disclosed limitations | Pending all above | Any unresolved mandatory gate |

## 5. [OPTIONAL] Independent work and incidents

- While a gate blocks dependent work, safe independent preparation continues (e.g., while G01 is pending: no design drafting is required to wait per protocol 04 — but design **documents** require approved requirements, so only review-ready prep of open questions occurs; while Q3 blocks Stage 7 real adapter: mock calendar work proceeds).
- Incident route: protocol 23 (recovery/rollback) — none active.

## 6. [REQUIRED] Risks, decisions and next action

- Risks R1–R5 live in `PROJECT.md` §6 (single source); ADRs will be created at design for consequential choices (platform Q1, auth A2, calendar adapter, speech lifecycle, **provider abstraction + unified inference contract, secret storage Q7**).
- **Next permitted action:** human decision on the G01-REQUIREMENTS bundle (Q1 + scope approval including CH-1). No design documents may be generated until G01 passes; no implementation until G02.
- **Must await human/prerequisite:** database writes (Q1 + gates), real Calendar actions (Q3), retention periods (Q4), **any paid cloud provider activation / real credential entry / real customer-data egress (SEC-15, separate authorization)**.
