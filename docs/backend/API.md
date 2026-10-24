# API — Operations and Wire Contract

| Field | Value |
| --- | --- |
| Project ID | AI-RECEPTIONIST |
| Document ID | API |
| Version / date | v0.2 — 2026-10-24 (G02 change-request revisions: CREDENTIAL_STORE_UNAVAILABLE fail-closed, BOOKING_UNRESOLVED code) |
| Owner | ZCode execution agent (maintainer); human decision authority: project owner |
| Scope | REST operations, wire rules, error contract, limits for backend phase |
| Document lifecycle | approved — G02-DESIGN (conditional approval, conditions satisfied 2026-10-24) |
| Input provenance | Approved `PROJECT.md` v0.2 (incl. FR-18 settings contract); `AUTH.md` v0.1; protocol 11 |
| Related authoritative files | `INTEGRATION.md`, `AUTH.md`, `SECURITY.md`, `BACKEND.md` |
| Approval reference | G02-DESIGN APPROVED WITH CONDITIONS 2026-10-24 — see PROGRESS.md §5 |

## 1. [REQUIRED] Control and contract authority

- **Transport/base:** HTTPS-ready REST over HTTP (localhost this phase), base path `/api/v1`. JSON bodies (UTF-8); audio upload `multipart/form-data`.
- **Schema authority:** Zod schemas in code (`http/schemas`, `ai/schemas`) — single authority; OpenAPI 3.1 document generated from them (generation tool selected at Stage 3; no hand-maintained duplicate). Generation direction: code → description.
- **Provider-native boundary:** Google/LLM provider wire formats exist only inside adapters; never leak to this contract.
- **Versioning:** `/api/v1` prefix; breaking changes → `/v2` or negotiation (no clients exist yet; rule recorded for frontend phase).

## 2. [REQUIRED] Operation inventory

### Public (customer) — unauthenticated HTTP, conversation-token scoped

| Operation / method / path | Requirement | Auth | Input → Output | Success / safe failures | Limits |
| --- | --- | --- | --- | --- | --- |
| `OP-01 POST /conversations` | FR-1 | none (rate-limited) | `{channel:'text'\|'voice'}` → `{conversationId, greeting, accessToken}` (token shown **once**) | 201 / 429 RATE_LIMITED, 503 RESOURCE_LIMIT | 5 creates/min/IP; 1 active conversation |
| `OP-02 POST /conversations/{id}/messages` | FR-1/2/3/4/5 | conversation token | `{text}` → `{reply, conversationState, booking?{state,missingFields[],offer?{slot,end,expiresAt,token}}, escalated?}` | 200 / 404 (bad token/id), 400 INVALID_INPUT, 429, 503, 500-safe | ≤ 4000 chars; 20 msg/min/conversation; inference semaphore |
| `OP-03 POST /conversations/{id}/audio` | FR-8 | conversation token | multipart audio → `{transcript, reply, …same as OP-02}` | 200 / 400 UNSUPPORTED_MEDIA_TYPE, 400 AUDIO_TOO_LARGE, 422 STT_FAILED, 404, 429 | ≤ 10 MB, ≤ 60 s, allowed: wav/webm/ogg/m4a (validated by magic bytes) |
| `OP-04 POST /conversations/{id}/transcript-corrections` | FR-8 | conversation token | `{messageId, correctedText}` → `{message}` | 200 / 404, 400 | only transcript-type messages |
| `OP-05 POST /conversations/{id}/confirm` | FR-5/7 | conversation token | `{offerToken, decision:'accept'\|'decline'}` → `{booking{state}, appointment?{id,start,end,status}}` | 200 / 404, 409 OFFER_EXPIRED, 409 SLOT_TAKEN (→ new offer), 503 CALENDAR_UNAVAILABLE | token single-use; retry-safe (same token → same result) |
| `OP-06 POST /conversations/{id}/cancel` | FR-1/11 | conversation token | `{}` → `{conversationState:'ended'}` (+ cancels pending booking) | 200 / 404 | idempotent |
| `OP-07 GET /conversations/{id}` | FR-1 | conversation token | → `{status, booking state, appointment summary (no PII beyond own), escalated}` | 200 / 404 | — |

### Admin — `Authorization: Bearer <Supabase JWT>` + `app_admins` membership

| Operation / method / path | Requirement | Auth | Input → Output | Success / safe failures | Limits |
| --- | --- | --- | --- | --- | --- |
| `OP-10 GET/PUT /admin/business-config/{category}` | FR-14 | admin | content jsonb (per-category Zod schema) → config (+ `PUT` creates new version) | 200 / 400, 401, 403 | version immutable |
| `OP-11 GET/POST/PATCH/DELETE /admin/customers[/{id}]` | FR-13 | admin | standard CRUD → customer records | 200/201 / 400, 401, 403, 404 | DELETE = anonymize (DATABASE §2) |
| `OP-12 GET /admin/appointments`, `POST /admin/appointments/{id}/cancel`, `POST …/reschedule` | FR-11/13 | admin | list (cursor pagination); reschedule `{start,end}` | 200 / 400, 401, 403, 404, 409 SLOT_TAKEN | page ≤ 50 |
| `OP-13 GET /admin/conversations`, `GET /admin/conversations/{id}/transcript` | FR-13 | admin | list + full transcript | 200 / 401, 403, 404 | page ≤ 50 |
| `OP-14 GET /admin/models/local` | FR-15 | admin | → `{ollama:{reachable, models:[{name,size,details}]}}` (live discovery, no hardcoding) | 200 / 503 OLLAMA_UNAVAILABLE | refresh = fresh call |
| `OP-15 GET/POST /admin/providers`, `PATCH/DELETE /admin/providers/{id}` | FR-16/18 | admin | provider config (**`credential` write-only on POST/PATCH; responses masked**) | 200/201 / 400, 401, 403, 404, 422 UNSAFE_ENDPOINT, **503 CREDENTIAL_STORE_UNAVAILABLE** (fail-closed state, ADR-0002 — credential-bearing operations rejected; metadata-only config still readable) | — |
| `OP-16 PUT /admin/providers/{id}/credential` | FR-16/SEC-14 | admin | `{apiKey}` (write-only) → `{masked}` | 200 / 400, 401, 403, **503 CREDENTIAL_STORE_UNAVAILABLE** (secret store disabled/fail-closed — cloud credential persistence disabled, local Ollama unaffected) | stored via secrets port only; accepted **only** when the store is verified active |
| `OP-17 POST /admin/providers/{id}/test` | FR-18 | admin | → `{status, latencyMs, error?}` (bounded live call) | 200 (with status field) / 504 PROVIDER_TIMEOUT | ≤ 10 s |
| `OP-18 PUT /admin/settings/active-model` | FR-17 | admin | `{providerId, modelId}` → `{active:{providerId,modelId,appliesFrom:'next_turn'}}` | 200 / 400 UNKNOWN_MODEL, 401, 403 | validates model exists/reachable for local |
| `OP-19 GET /admin/consent`, `GET/DELETE /admin/recordings[/{id}]` | FR-9 | admin | consent ledger; recording list/delete (post-Q4 activation) | 200 / 401, 403, 404 | DELETE honored immediately |
| `OP-20 GET /healthz`, `GET /readyz` | ops | public | liveness; readiness (DB + Ollama checks) | 200 / 503 | no sensitive detail |

**Writable-field rule:** clients can never write `id`, `role`, `status` (appointment transitions only via OP-05/OP-06/OP-12), `access_token_hash`, `credential_ref`, or any `audit_log` field.

## 3. [REQUIRED] Shared conventions

- **Error envelope (single owner):** `{ "error": { "code": string, "message": string, "details"?: unknown, "requestId": string } }`. Codes: `INVALID_INPUT, UNSUPPORTED_MEDIA_TYPE, AUDIO_TOO_LARGE, STT_FAILED, UNAUTHORIZED, FORBIDDEN, NOT_FOUND, RATE_LIMITED, RESOURCE_LIMIT, PROVIDER_FAILURE, PROVIDER_TIMEOUT, INVALID_OUTPUT, OLLAMA_UNAVAILABLE, MODEL_UNAVAILABLE, CALENDAR_UNAVAILABLE, SLOT_TAKEN, OFFER_EXPIRED, UNSAFE_ENDPOINT, CREDENTIAL_STORE_UNAVAILABLE, BOOKING_UNRESOLVED, INTERNAL`. HTTP status mapping documented in code; `INTERNAL` never leaks stack/SQL. `BOOKING_UNRESOLVED` reports the explicitly-unresolved calendar outcome (ADR-0004 v0.2) — never a false success or false failure.
- **Timestamps:** RFC 3339 UTC. IDs: UUID v4. Nulls explicit. Existence hiding: customer-scoped 404 on token mismatch.
- **Validation:** all inputs Zod-parsed at boundary; parsed values only thereafter (SEC-1).
- **Correlation:** `X-Request-Id` accepted or generated; echoed in error envelope + logs.

## 4. [OPTIONAL] Collections and mutation concurrency

- Pagination: cursor-based (`?limit≤50&cursor=<opaque>`); deterministic order per endpoint (stated in list ops). Offsets N/A.
- Idempotency: OP-05 token single-use (cached result); OP-06 idempotent; calendar creates carry server-generated idempotency key (client unaware). No ETag/version fields v1 (single-writer semantics per conversation).

## 5. [OPTIONAL] Files, webhooks and asynchronous APIs

- **Uploads:** OP-03 audio multipart only, per limits; processed in memory; never persisted without consent (FR-9).
- **Webhooks:** NOT_APPLICABLE. **Streaming:** NOT_APPLICABLE v1 (turn-based, complete responses; recorded as future option — ai-capabilities treats streaming deltas as provisional and they are deliberately out of scope).
- **Async ops:** none; long operations (calendar create) bounded ≤ 15 s within request.

## 6. [REQUIRED] Description, clients and evidence

- **Description:** generated OpenAPI 3.1 at `docs/api/openapi.json` (build artifact; generator tool decided Stage 3); examples per endpoint in tests.
- **Client ownership:** future frontend consumes generated types (direction code → client, owner: this repo's contract build). Drift check: generated output committed + diffed in CI-equivalent local check.
- **Contract/negative tests:** TC-01…TC-32; every error code exercised by at least one negative test before G10.
- **Old-client strategy:** none needed pre-frontend; recorded for frontend phase.
- **Unknowns:** OpenAPI generator tool choice (Stage 3); CORS origin allowlist value (frontend phase; `CORS_ORIGIN` env reserved). Review dependency: **G02-DESIGN**.
