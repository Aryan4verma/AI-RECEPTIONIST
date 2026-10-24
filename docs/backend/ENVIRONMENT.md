# ENVIRONMENT — Runtime, Configuration and Targets

| Field | Value |
| --- | --- |
| Project ID | AI-RECEPTIONIST |
| Document ID | ENVIRONMENT |
| Version / date | v0.2 — 2026-10-24 (G02 change-request revisions: credential-class separation, session-pooler mode, provisional budgets + admission checks) |
| Owner | ZCode execution agent (maintainer); human decision authority: project owner |
| Scope | Runtime identity, targets, configuration schema, capacity/lifecycle |
| Document lifecycle | review-ready — pending **G02-DESIGN** |
| Input provenance | `PROGRESS.md` §8 discovery facts; `ARCHITECTURE.md` v0.1 |
| Related authoritative files | `DEPLOYMENT.md`, `SUPABASE.md` §5, `SECURITY.md` |
| Approval reference | NONE — pending G02 |

## 1. [REQUIRED] Control and runtime identity

- **Runtime:** Node.js v24.15.0 (verified), strict TypeScript 5.x, pure ESM, single build via `tsc` → `dist/`; npm 11.12.1; lockfile-frozen installs.
- **Sidecar runtime:** Python 3.11.9 (verified) with dedicated venv (`sidecar/whisper/requirements.txt`: faster-whisper, uvicorn/starlette or stdlib http.server — final selection at Stage 6).
- **External runtimes:** Ollama 0.40.9 (verified, `localhost:11434`); Supabase cloud.
- **Hosting constraint:** 7.71 GB RAM total (0.77 GB free at 2026-10-23 inspection) — capacity rules in §4 are hard constraints, not aspirations.

## 2. [REQUIRED] Target matrix

| Environment | Safe identity / topology | Data / reset policy | Access / authorization | Known differences |
| --- | --- | --- | --- | --- |
| Local dev (only runtime) | This laptop: Node app (localhost:$PORT) + Ollama + sidecar | Supabase = shared persistent; local = stateless | Filesystem + localhost only | No TLS, no public exposure |
| Supabase `ogxdszjypswutekqgorb` | Cloud Postgres + Auth (sole "staging+production-equivalent") | **Non-disposable**; mutations only via approved migrations | MCP read + authorized writes; service_role server-side | Single environment — no staging isolation (accepted risk, dev scale) |
| GitHub `Aryan4verma/AI-RECEPTIONIST` | Private repo, `main` | Source of truth for code/docs/migrations | Owner push only | — |

No production environment exists (Q6 unknown — never invented).

## 3. [REQUIRED] Configuration schema

| Variable / setting | Class | Required | Constraint / default | Owner / delivery / rotation |
| --- | --- | --- | --- | --- |
| `PORT` | public | no | int 1024–65535, default 8787 | `.env` |
| `SUPABASE_URL` | public | yes | https URL of `ogxdszjypswutekqgorb` — **Data API base, not a DB credential** | `.env`; rotation n/a |
| `SUPABASE_PUBLISHABLE_KEY` | public | no | publishable/anon API key; unused by backend this phase (no client-direct Data API calls) | `.env` |
| `SUPABASE_SERVICE_ROLE_KEY` | **secret** (server-only) | yes | secret API key for the Data API used by supabase-js — **NOT a PostgreSQL password**; never valid as a `pg` credential | `.env`; rotate on compromise (RUNBOOK) |
| `SUPABASE_DB_URL` | **secret** (server-only) | yes (from Stage 3) | Full PostgreSQL connection string for the shared **session pooler** (`…pooler.supabase.com:5432`, user `postgres.<project-ref>`, contains the **separate DB password**). Sourced from the Supabase dashboard Connect string; values never committed | `.env`; rotate with DB password |
| `OLLAMA_BASE_URL` | public | no | must be loopback URL, default `http://localhost:11434` | `.env`; never admin-settable via API |
| `WHISPER_SIDECAR_PORT` | public | no | int, default 8788; loopback only | `.env` |
| `WHISPER_MODEL` | public | no | `tiny-int8` default; `base-int8` allowed | `.env` |
| `TOKEN_HASH_SECRET` | **secret** | yes | ≥ 32 bytes; HMAC key for conversation-token hashing | `.env`; rotation invalidates active sessions |
| `SECRET_MASTER_KEY` | **secret** | no | **Unused unless a fallback secret store is separately approved (ADR-0002 fail-closed)** — presence alone activates nothing | `.env` |
| `CALENDAR_MODE` | public | no | `mock` default; `google` only after Q3 authorization | `.env` |
| `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` / `GOOGLE_OAUTH_REDIRECT_URI` | public / **secret** / public | Stage 7 | exact redirect URI allowlist of one | `.env` |
| `CORS_ORIGIN` | public | no | future frontend origin; unset = CORS off | `.env` |
| `LOG_LEVEL` | public | no | `info` default | `.env` |
| `MAX_AUDIO_MB` / `MAX_AUDIO_SECONDS` | public | no | 10 / 60 defaults (upper bounds fixed in code) | `.env` |

**Credential-class separation (mandatory):** (1) project URL + publishable key = public; (2) secret key / service-role = server-only **Data API** credential for supabase-js; (3) `SUPABASE_DB_URL` = server-only **PostgreSQL** credential for `pg` (separate password — the service-role key never authenticates to Postgres); (4) **Supabase MCP credentials = development-agent-side configuration in ZCode, never present in application `.env`, code, or runtime.** Startup validation: Zod parses all of `.env`, fail-fast on missing/malformed secrets, refuses non-loopback `OLLAMA_BASE_URL`/`WHISPER_SIDECAR_PORT` binds, and validates `SUPABASE_DB_URL` uses the pooler host + `sslmode=require` (or `verify-full`). All secrets runtime-only.

## 4. [REQUIRED] Capacity and lifecycle

- **Connection mode (design decision, doc-grounded):** `pg` connects via the **shared pooler in session mode (port 5432)** — IPv4-compatible on every plan and supports server-side prepared statements + session state, which the long-running Node service needs for transactions. Direct connection (`db.<ref>.supabase.co:5432`) is IPv6-by-default (IPv4 is a paid add-on) — if Stage 3 connectivity verification proves working IPv6, direct connection is the preferred replacement (recorded then). Transaction mode (6543) is rejected: no prepared statements/session state. TLS: `sslmode=require` minimum; `verify-full` with the downloaded Supabase root certificate preferred (owner supplies cert at implementation). supabase-js uses the Data API (HTTPS) independently of `pg`.
- **Connection budget:** `pg` session-pooler Pool ≤ 3 + supabase-js (REST, no pool) + Ollama HTTP keepalive ≤ 2 + sidecar ≤ 2.
- **Request bounds:** JSON body ≤ 1 MB; audio ≤ 10 MB / 60 s; LLM input ≤ 4 k tokens, output ≤ 512 tokens; inference concurrency = 1; active conversations = 1 (503 `RESOURCE_LIMIT` beyond).
- **Resource budgets — PROVISIONAL MEASUREMENT TARGETS, NOT VERIFIED CAPABILITIES** (host had only ~0.77 GB free at discovery; the implementation must measure and may not declare G13 PASS until honest cold/warm measurements exist): Node ≤ 400 MB; whisper sidecar ≤ 900 MB (tiny-int8); Ollama qwen3:1.7b ≤ 2.5 GB; total ≤ 4 GB steady-state. **Admission checks (required by design):** before any model load (sidecar load or LLM warm-up), the service checks available system memory and refuses/queues with `RESOURCE_LIMIT` instead of thrashing; STT and LLM operation is strictly sequential per turn (enforced by the inference semaphore spanning both); sidecar unloads its model after 10 min idle and reloads on demand; OOM/load-failure recovery = safe error + retry policy + audit log, never a silent retry loop.
- **Readiness/degradation:** `readyz` = DB reachable + Ollama reachable (+ sidecar **process** healthy when enabled — model residency is NOT required for readiness, since loading is on-demand). Cloud providers unconfigured → fully graceful local-only mode (no errors, settings API marks cloud as "not configured"); Ollama down → degraded with explicit error states, never silent (FR-15).
- **Shutdown:** SIGTERM → stop listeners → abort in-flight external calls safely → close DB pool → stop sidecar (≤ 10 s).
- **Proxy/TLS:** none this phase (localhost); production TLS is a Q6/deployment-stage decision.

## 5. [OPTIONAL] Provider/capability settings

Supabase: exposed-schema + auth settings inspected at implementation (SUPABASE §2/§6 unknowns); Vault availability check (ADR-0002). Storage: dormant bucket (post-Q4). Drift inspection: types regenerated per migration.

## 6. [REQUIRED] Decisions, unknowns and proof

- **Decisions:** ESM single-process; `.env` delivery (no secret manager for service keys at dev scale); loopback-only enforcement at config validation; **session-pooler connection mode with IPv6-direct as a verified-at-implementation alternative**; credential-class separation per §3.
- **Unknowns:** exact Supabase Postgres version; Vault availability AND privilege security (ADR-0002); backup retention (SUPABASE §6); production target (Q6); whether this network has working IPv6 (verified by connectivity test at Stage 3 before choosing direct vs session-pooler).
- **Required proof before release:** G03-CONFIG startup validation on real env; secret-isolation test (TC-29); `readyz` degradation behavior (TC-21-style); sidecar lifecycle under idle/RAM pressure (TC-24/TC-19/TC-37); **provisional budgets measured cold + warm before any performance claim (owner instruction — no false performance-gate declarations)**.
