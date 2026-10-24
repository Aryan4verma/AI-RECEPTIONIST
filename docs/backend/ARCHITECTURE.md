# ARCHITECTURE — System Decisions

| Field | Value |
| --- | --- |
| Project ID | AI-RECEPTIONIST |
| Document ID | ARCHITECTURE |
| Version / date | v0.1 — 2026-10-24 |
| Owner | ZCode execution agent (maintainer); human decision authority: project owner |
| Scope | System topology, trust boundaries, technology and module decisions for the backend + AI phase |
| Document lifecycle | review-ready — pending **G02-DESIGN** |
| Input provenance | Approved `PROJECT.md` v0.2 (G01, 2026-10-24); `PROGRESS.md` §8 discovery facts; protocols 06/07/08/09/10/11/14 |
| Related authoritative files | `BACKEND.md`, `DATABASE.md`, `SUPABASE.md`, `AUTH.md`, `API.md`, `SECURITY.md`, `INTEGRATION.md`, `decisions/ADR-0001..0006.md` |
| Approval reference | NONE — pending G02 |

## 1. [REQUIRED] Control and drivers

- **Requirement base:** FR-1…FR-18, SEC-1…SEC-16 (`PROJECT.md` v0.2, approved). Approved platform decision: Supabase/PostgreSQL `ogxdszjypswutekqgorb` (Q1, platform-only approval).
- **Drivers:** resource-constrained host (i3-1115G4 2C/4T, 7.71 GB RAM — R4), local-first AI with opt-in cloud (SEC-15), one active conversation initially, unauthenticated customers + authenticated admins, real Google Calendar behind authorization (Q3), staged G02→implementation delivery.
- **Baseline:** greenfield; no existing implementation. No approved overrides beyond those recorded in the G01 ledger.

## 2. [REQUIRED] Topology and trust boundaries

Single Node.js application process; all privileged actions execute here.

| Component | Runtime | Trust role | Boundary |
| --- | --- | --- | --- |
| Fastify API server | Node 24 + TypeScript, single process, ESM | Only executor of privileged actions (DB writes, calendar ops, inference orchestration) | Validates all external input (Zod); issues safe errors |
| Ollama server | Separate local process (already installed, `localhost:11434`) | Untrusted inference provider | Localhost-only, never internet-exposed (SEC-5); output validated (SEC-12) |
| Whisper STT sidecar | Python 3.11 child process, localhost HTTP, on-demand lifecycle | Untrusted transcription service | localhost-only; audio in memory; transcripts are untrusted text (SEC-8) |
| Supabase (Postgres + Auth) | Cloud project `ogxdszjypswutekqgorb` | Data + admin identity authority | RLS on all tables; service-role key server-only (SEC-3/4) |
| Google Calendar API | External, behind OAuth 2.0 (Q3 authorization required) | External effect (events) | Adapter port + mock-first; recheck-before-create (SEC-7) |
| Cloud LLM providers | External, opt-in only | Untrusted inference provider | Explicit opt-in (SEC-15); SSRF-validated endpoints (SEC-16); keys in secret store (SEC-14) |

**Callers:** unauthenticated customers (conversation token scoped to their session); authenticated business administrators (Supabase Auth); no other callers. Browser SpeechSynthesis consumes plain response text — no TTS component exists (A1).

**Data paths:** Customer HTTP → API (validate) → domain services → repositories (service-role) → Supabase. Conversation text → AI provider (local default) → validated structured output → domain decision. Audio → STT sidecar → transcript (untrusted text) → conversation flow. Booking → calendar port → mock or authorized Google adapter.

## 3. [REQUIRED] Technology and ownership decisions

| Decision ID | Choice / existing constraint | Alternatives / rationale | Requirement IDs | Consequences / ADR |
| --- | --- | --- | --- | --- |
| AD-1 | Node.js 24 LTS, strict TypeScript, ESM, single Fastify process | Modular monolith per prompt §4; no Docker/K8s/Redis/Kafka (no requirement) | NFR-2, FR-1…18 | Simple ops, one memory budget; ADR-0003 context |
| AD-2 | Zod as the single runtime schema authority (requests, AI outputs, config) | Native JSON Schema rejected: duplicate definitions risk; Zod integrates with Fastify + AI validation | SEC-1, FR-2/3, FR-16 | One contract owner; OpenAPI generated from Zod (no duplicate DTO authority) |
| AD-3 | Supabase/PostgreSQL + Supabase Auth (Q1 approved; A2 proposed for admin identity) | SQLite declined at G01; bespoke auth forbidden beside managed Auth | FR-10, SEC-2/3 | ADR-0001 (accepted); AUTH.md |
| AD-4 | Unified `LLMProvider` port: `OllamaProvider` + `OpenAICompatibleProvider`; `ModelRegistry` for discovery/config | Domain logic provider-agnostic; adapters added without domain change (ai-capabilities guidance) | FR-15/16/17, SEC-14/15/16 | ADR-0003 |
| AD-5 | `CalendarProvider` port: `MockCalendarAdapter` (deterministic) + `GoogleCalendarAdapter` (googleapis, OAuth code flow) | Mock fully verified before real writes (prompt §5.D) | FR-6/7/11, SEC-7/9 | ADR-0004 |
| AD-6 | Python faster-whisper sidecar process, on-demand load/unload, localhost HTTP | In-process WASM/native Node STT rejected: immature + heavy; TTS server rejected (A1) | FR-8, R4 | ADR-0005 |
| AD-7 | Secrets: Supabase Vault primary; env-keyed AES-256-GCM store as fallback (Node `crypto`, standard primitive) | Plaintext DB columns, custom crypto rejected (SEC-14) | SEC-14, FR-16 | ADR-0002 (Q7 → G02) |
| AD-8 | Conversation-token authentication for unauthenticated customers (random secret issued at session creation, stored hashed) | Raw conversation-ID access is enumerable; cookie/JWT overkill for v1 | FR-1, SEC-2/3 | AUTH.md §3 |
| AD-9 | Atomic booking transitions via `pg` transaction + `SELECT … FOR UPDATE` on `booking_state`; supabase-js for simple CRUD | Supabase-js cannot run multi-statement transactions; RPC move of domain logic rejected (keeps decisions in domain code) | FR-5, SEC-9 | BACKEND.md §4, DATABASE.md §3 |

## 4. [REQUIRED] Module and data boundaries

Dependency direction: `http/routes → domain services → (repositories, ai ports, calendar port, speech port) → infrastructure (db clients, providers, sidecar)`. Domain never imports HTTP or provider SDKs directly; adapters implement ports.

| Module (path) | Owns | Notes |
| --- | --- | --- |
| `server/` | Fastify app, plugins (rate-limit, CORS, error envelope), route registration, health | Transport only |
| `http/routes/public` + `http/routes/admin` | Request validation (Zod), auth guards, delegation | No domain logic |
| `domain/conversation` | Session lifecycle, bounded context, turn orchestration, escalation | FR-1/2/12 |
| `domain/booking` | Booking state machine (pure transition function + persistence port) | FR-5/7/11 |
| `domain/knowledge` | Business config retrieval, deterministic FAQ matching | FR-4/14 |
| `ai/` | `LLMProvider` port, Ollama/OpenAI-compatible adapters, `ModelRegistry`, `InferenceService`, Zod AI schemas | FR-15/16/17; output always validated before domain use |
| `speech/` | Audio validation, `SpeechToText` port, sidecar lifecycle manager | FR-8 |
| `calendar/` | `CalendarProvider` port, mock + Google adapters, slot computation, idempotent operations | FR-6/7/11 |
| `secrets/` | Credential store port + Vault/AES-GCM adapters, masking helper | SEC-14 |
| `db/` | Client factories (supabase-js service client; `pg` transaction client), repositories | AD-9 |
| `config/` | Zod env schema, startup validation | G03-CONFIG target |
| `observability/` | Pino logger, redaction, correlation IDs, metrics | OBSERVABILITY.md |

**Schema/migration authority:** `supabase/migrations/` (single stream, versioned SQL) — DATABASE.md. **Schema authority:** Zod (`ai/schemas`, route schemas). **Auth ownership:** Supabase Auth + `AUTH.md` matrix. **Telemetry ownership:** `observability/`.

## 5. [OPTIONAL] Additional infrastructure

- Caches: NOT_APPLICABLE (no measured repeated cost; business config read per turn is trivial).
- Queues/workers: NOT_APPLICABLE (single conversation, synchronous turn flow; reconciliation is a bounded retry path, not a job system).
- Supabase Storage: designed-but-dormant for consent-gated recordings (FR-9) — bucket + policy created only after Q4 policy approval at/after G02; transcription itself never persists audio.
- Realtime / Edge Functions: NOT_APPLICABLE (turn-based polling; no client-direct DB access for customers).

## 6. [REQUIRED] Failure, evolution and review

- **Provider failure:** LLM/STT/calendar outages → typed safe errors (`PROVIDER_FAILURE`, `TIMEOUT`, `CANCELLED`); conversation continues or escalates (FR-12); no fabricated success (SEC-13). Uncertain calendar create result → persisted unknown state + bounded reconciliation (ADR-0004).
- **Model failure:** selected model missing/overloaded → explicit error, no silent switch (FR-17, TC-23); fallback only when explicitly configured and approved.
- **Resource pressure:** single-inference semaphore; STT and LLM never loaded/concurrent beyond budget; sidecar unloads on idle; 503 `RESOURCE_LIMIT` beyond one active conversation.
- **Graceful shutdown:** SIGTERM → stop accepting, finish in-flight turn or abort safely (no partial external effects), close DB clients, stop sidecar.
- **Evolution:** provider adapters and capability guides added without domain change (ai-handoff compatibility rules); migrations forward-only single stream.
- **Unknowns:** Q3 (Google credentials — BLOCKED for real adapter work only), Q4 retention policy (G02), cloud provider choice (none authorized — fixture-only until 05 authorization). Review dependency: **G02-DESIGN covers this document with all linked design docs.**
