# INTEGRATION — Clients and External Boundaries

| Field | Value |
| --- | --- |
| Project ID | AI-RECEPTIONIST |
| Document ID | INTEGRATION |
| Version / date | v0.1 — 2026-10-24 |
| Owner | ZCode execution agent (maintainer); human decision authority: project owner |
| Scope | Future-frontend contract (incl. AI Models & Providers page), journey mapping, identity/cache/retry, external providers |
| Document lifecycle | review-ready — pending **G02-DESIGN** (design mode only — no frontend work this phase) |
| Input provenance | Approved `PROJECT.md` v0.2 (FR-18); protocols 11/14; ai-capabilities `contracts/ai-handoff.md` |
| Related authoritative files | `API.md`, `AUTH.md`, `SECURITY.md`, `BACKEND.md` |
| Approval reference | NONE — pending G02 |

## 1. [REQUIRED] Control and boundary inventory

- **Frontend owner (future phase):** frontend-master (UI/UX, rendered verification). **Backend owner (this phase):** API/data/Auth/RLS/server security. This document is the shared boundary contract; both phases reference it (no second register).
- **Authoritative schema source:** `API.md` v0.1 (Zod → OpenAPI generated types; drift command defined at Stage 3 build).
- **Targets/authorization:** backend localhost (this phase); Supabase Auth for admin sessions; no browser-facing Supabase direct access for customers.
- **Requirement IDs:** FR-1…FR-18; AI feature handoff (below) bound to FR-2/FR-3/FR-15…FR-18.

## 2. [REQUIRED] Journey mapping

| Journey / requirement | Client action | Backend/provider operation | Success / empty / denied / failure behavior | Evidence (later) |
| --- | --- | --- | --- | --- |
| Start conversation (FR-1) | POST /conversations | OP-01 | Greeting rendered; token stored client-side (memory/sessionStorage, never localStorage persistence requirement recorded for frontend phase) | TC-01 |
| Text turn (FR-1/2/3/4/5) | POST messages | OP-02 | Reply + booking state rendered; clarification questions shown as prompts | TC-02…TC-05 |
| Voice turn (FR-8) | Record → POST audio | OP-03 → STT → same turn flow | Transcript shown for review/correction (OP-04); browser SpeechSynthesis reads `reply` (A1) | TC-09 |
| Offer + confirm (FR-5/7) | Show offer → POST confirm | OP-05 | Accepted → confirmation view; expired/taken → re-offer flow; decline → polite close | TC-05/TC-06 |
| Cancel (FR-11) | Cancel button / utterance | OP-06 / intent | Ended state; appointment cancelled if existed | TC-12 |
| Admin sign-in (future) | Supabase Auth login | JWT → admin APIs | 401/403 surfaced as re-auth/forbidden | TC-28 |
| Admin business config (FR-14) | Forms → OP-10 | versioned config | Validation errors inline | TC-13 |
| **AI Models & Providers page (FR-15…18)** | Settings UI → OP-14…OP-18 | live discovery, provider CRUD, masked credential entry, connection test, active-model switch | Local model list from real Ollama; cloud provider form validates endpoint (UNSAFE_ENDPOINT surfaced); keys **write-only + masked** (`••••abcd`); connection test result + status; active-model switch states "applies from next turn"; errors shown per error code | TC-21…TC-31 |
| Admin conversations/records (FR-13) | Lists → OP-11…OP-13, OP-19 | PII-protected views | Empty states; forbidden = 403 page | TC-11/TC-28 |

Asynchronous states: every journey has loading (bounded request), empty, error-envelope presentation (codes from API §3), and retry guidance (safe retries only: GETs and OP-05 same-token).

## 3. [REQUIRED] Identity, cache and retry

- **Session/refresh/logout:** Supabase Auth standard client flows (frontend phase) with SSR-safe cookie handling per Supabase guidance; backend verifies JWTs statelessly + membership check (AUTH §2). Refresh handled by Supabase client; logout ends access at token expiry.
- **Token/refresh owners:** refresh token = Supabase client (browser); conversation token = client memory per session; **permitted browser variable names** (frontend phase): `sb-access-token`, `sb-refresh-token` (Supabase cookie names), `conversationToken`. **Server-only names (never client values):** `SUPABASE_SERVICE_ROLE_KEY`, provider API keys, `GOOGLE_OAUTH_CLIENT_SECRET`, `TOKEN_HASH_SECRET`.
- **CORS:** `CORS_ORIGIN` env allowlist (single future frontend origin; set at frontend phase). No credentials-in-CORS v1.
- **Cache invalidation:** identity-scoped — no shared caching of conversation/admin responses; `Cache-Control: no-store` on all authenticated/customer endpoints (default middleware).
- **Idempotent retry:** GETs safe; OP-05 same-offer-token retry-safe (same result); non-idempotent writes NOT auto-retried by clients on network failure without the token mechanism (documented for frontend).
- **Stale in-flight responses:** abort on navigation (AbortSignal client-side, frontend phase); backend discards stale results server-side (BACKEND §4).
- **Transport proof vs production:** localhost proof this phase; TLS/CDN/callback evidence deferred to deployment + frontend phases.

## 4. [OPTIONAL] Files, live updates and external providers

- **Files:** audio upload only (OP-03); recordings download for admins post-Q4 via scoped signed URLs (designed, dormant).
- **Live updates:** NOT_APPLICABLE (polling; no Realtime).
- **External providers (AI handoff, schema mapped from ai-handoff.md):** feature = receptionist inference; requirement IDs FR-2/FR-3/FR-15…18; output schema = `ai/schemas` v1 (Zod; `known/unknown/ambiguous` states, explicit nulls, schema_version field); failure codes = API §3 set (PROVIDER_FAILURE/PROVIDER_TIMEOUT/INVALID_OUTPUT/RESOURCE_LIMIT/CANCELLED/OLLAMA_UNAVAILABLE/MODEL_UNAVAILABLE); limits = input 4k chars, output 512 tokens, time 30 s, concurrency 1, retries ≤ 1 idempotent; cancellation = AbortSignal end-to-end; side effects = **none from inference** (calendar/database writes are separate backend-authorized steps); evidence = per-stage eval records. Provider assumptions (model capabilities, structured-output support) are per-provider capability flags verified before use — never assumed identical across providers.

## 5. [REQUIRED] Compatibility and verification

- **Generated client/type owner:** backend repo contract build (OpenAPI → types); frontend consumes generated package — drift checked per build (API §6).
- **Old-client rollout:** N/A pre-frontend; recorded rule: breaking change → new version prefix.
- **Fixtures:** browser/integration fixtures deferred to frontend phase; backend contract tests (TC-01…TC-32) are the journey acceptance for this phase.
- **Safe dependency-failure tests:** Ollama down (TC-21), sidecar down (TC-09 path), Supabase unreachable (readiness 503), provider timeout (TC-26).
- **Decisions/unknowns:** CORS origin (frontend phase); Supabase cookie/session details (frontend phase per protocol 14); recording UI (post-Q4). Review dependency: **G02-DESIGN**.
