# AUTH — Identity and Access Specification

| Field | Value |
| --- | --- |
| Project ID | AI-RECEPTIONIST |
| Document ID | AUTH |
| Version / date | v0.1 — 2026-10-24 |
| Owner | ZCode execution agent (maintainer); human decision authority: project owner |
| Scope | Identity, session lifecycle, access matrix, privileged boundaries |
| Document lifecycle | review-ready — pending **G02-DESIGN** |
| Input provenance | Approved `PROJECT.md` v0.2; protocols 09/10; `ARCHITECTURE.md` AD-3/AD-8 |
| Related authoritative files | `DATABASE.md` §3, `SUPABASE.md` §3, `API.md`, `SECURITY.md` |
| Approval reference | NONE — pending G02 |

## 1. [REQUIRED] Control and trust model

- **Identity provider:** Supabase Auth (managed) — A2 proposed, confirmed here as design proposal. No bespoke password/JWT infrastructure (STACK rule).
- **Actors/principals:**
  - **Admin** — human business administrator. Principal: Supabase `auth.users` id + `app_admins` membership (server-verified per request). Tenant = the single business.
  - **Customer** — unauthenticated. Principal: `conversation_id` + **conversation token** (32-byte random secret issued once at session creation; stored only as SHA-256 hash in `conversations.access_token_hash`; presented as `X-Conversation-Token` header). No customer accounts, no federated identity.
  - **Backend service** — `service_role` credential, server process only. Principal for all privileged DB writes and external effects.
- **Tenant/ownership authority:** server-derived only — membership from `app_admins` (DB), ownership from `conversations.access_token_hash` comparison. Never from client-asserted fields, model output, or transcripts (SEC-12, ai-capabilities RULES).

## 2. [REQUIRED] Session and credential lifecycle

| Flow | Design |
| --- | --- |
| Admin sign-in | Supabase Auth password grant (frontend later) → access JWT + refresh token; backend **API does not handle passwords** — it only verifies JWTs |
| Admin request verification | Verify JWT signature + `iss`/`aud`/`exp` via project JWKS/secret (`getClaims()`-equivalent local verification), then per-request membership check against `app_admins` (60s in-process cache — freshness policy; revocation effective ≤ 60s for membership, immediate for token expiry) |
| Admin refresh/logout/recovery | Supabase Auth standard flows, owned by future frontend + Supabase; backend exposes no session endpoints. Logout → token expiry ends access; membership row removal ends access within cache TTL |
| Customer session creation | `POST /conversations` → server generates token, returns it once, stores hash. Token loss = inaccessible session (by design; no recovery in v1 — documented) |
| Customer request auth | `conversation_id` + `X-Conversation-Token`; constant-time hash comparison; failure = 404 (existence hiding, no 403 enumeration signal) |
| Callback/redirect allowlists | NOT_APPLICABLE this phase (no browser flows in backend phase); Google OAuth callback (Stage 7) uses server-side redirect to `GOOGLE_OAUTH_REDIRECT_URI` (exact URI in env allowlist of one) |
| Transport | Backend phase: localhost HTTP. Production TLS deferred to deployment stage (no production target, Q6). Bearer/JWT + header token; no cookies v1 (no CSRF surface; revisit with frontend phase if cookie sessions adopted) |
| Credential isolation | `service_role` key and conversation tokens never logged, never sent to clients beyond the one-time issue, never in model prompts (SEC-4/8/14) |

## 3. [REQUIRED] Access matrix

| Actor / role | Resource / action | Condition (freshness) | Permitted | Enforcement / denial |
| --- | --- | --- | --- | --- |
| `anon` (unauthenticated HTTP) | Public conversation APIs (create/turn/audio/confirm/cancel/get) | Rate-limited; valid conversation token for session-scoped ops | Own conversation fields only (no admin fields, no other conversations) | Fastify guard + DB: zero `anon` grants (defense in depth) |
| Customer (token) | Own conversation: messages, booking, consent | Valid token (constant-time compare) | Own rows only — SQL always scoped `WHERE id = ? AND access_token_hash = ?` | 404 on mismatch; audit on failures |
| Admin (`authenticated`) | Business config, customers, appointments, conversations, transcripts, models/providers, consent, recordings | JWT valid + `app_admins` member (≤ 60s stale) | Per AUTH/API field lists; no `audit_log` write, no secret values | RLS policies + Fastify admin guard |
| Backend service (`service_role`) | All tables, calendar writes, inference orchestration | Server process only | Everything needed by domain | Key server-only (SEC-4); not usable from clients |
| STT sidecar | Transcribe audio only | localhost bind, no DB/calendar access | None (pure compute) | Process isolation; no credentials injected |
| Ollama / cloud LLM | Inference only | — | No tools, no SQL, no calendar (SEC-6): outputs are data | Output validated; tool calls not offered |

No caller-editable privilege authority: `app_admins` changes are migration/manual-owner operations, not API-writable; no writable role/tenant fields on any endpoint.

## 4. [REQUIRED] Database and privileged boundaries

- Roles/grants/RLS: `DATABASE.md` §3 — RLS on all tables; policies keyed to `app_admins` membership for `authenticated`; `service_role` bypasses RLS by design and is confined to the server process.
- SQL claim context: policies use `auth.uid()` (Supabase managed); backend `pg` transactions run as service role — they are the trusted path, and their callers are already guard-checked at HTTP.
- Privileged-path ledger (complete): (1) booking transitions (pg transaction), (2) calendar create/cancel/reschedule (adapter), (3) credential write/read (secrets store), (4) customer PII read (admin APIs + RLS), (5) migration application (owner-authorized). No other privileged paths exist; new ones require 21/05.
- Revocation behavior: membership removal → admin access ends ≤ 60s (cache); token expiry → immediate; conversation token invalidation = session end (status `ended`) → all customer access fails.
- Service-key use: single `service_role` client per process; never per-request user impersonation (no user-scoped privileged clients v1).

## 5. [OPTIONAL] Additional assurance

- MFA/SSO/invites: NOT_APPLICABLE v1 (single-admin business; invite via Supabase dashboard by owner). Revisit on requirement.
- Anonymous auth accounts: NOT_APPLICABLE (conversation token design replaces it).
- Channel authorization: the conversation token IS the channel authorization for voice/transcript paths.

## 6. [REQUIRED] Evidence, decisions and review

- Required evidence (mapped): valid login + expired-token denial + malformed/wrong-issuer denial + revoked-membership denial (≤ 60s) + cross-conversation 404 + anon DB zero-access + admin allow cases — TC-11, TC-28 + auth test suite at Stage 3/8 (G08/G09).
- Decisions: A2 Supabase Auth; AD-8 conversation token; 60s membership freshness cache; constant-time comparisons; 404 existence hiding.
- Unknowns: Google OAuth refresh-token storage per ADR-0002 (Stage 7); production TLS/session transport (Q6/deployment stage).
- Safe failure convention: 401 for bad/expired admin JWT, 403 for valid JWT without membership, 404 for customer token mismatch, 429 rate limits — all without secret/PII disclosure.
- Review dependency: **G02-DESIGN**; implementation then G08/G09 evidence.
