# ENVIRONMENT — Runtime, Configuration and Targets

| Field | Value |
| --- | --- |
| Project ID | AI-RECEPTIONIST |
| Document ID | ENVIRONMENT |
| Version / date | v0.1 — 2026-10-24 |
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
| `SUPABASE_URL` | public | yes | https URL of `ogxdszjypswutekqgorb` | `.env`; rotation n/a |
| `SUPABASE_SERVICE_ROLE_KEY` | **secret** | yes | non-empty JWT; server-only | `.env`; rotate on compromise (RUNBOOK) |
| `SUPABASE_ANON_KEY` | public | no | unused this phase | — |
| `OLLAMA_BASE_URL` | public | no | must be loopback URL, default `http://localhost:11434` | `.env`; never admin-settable via API |
| `WHISPER_SIDECAR_PORT` | public | no | int, default 8788; loopback only | `.env` |
| `WHISPER_MODEL` | public | no | `tiny-int8` default; `base-int8` allowed | `.env` |
| `TOKEN_HASH_SECRET` | **secret** | yes | ≥ 32 bytes; HMAC key for conversation-token hashing | `.env`; rotation invalidates active sessions |
| `SECRET_MASTER_KEY` | **secret** | no (required only if AES-GCM fallback store active) | ≥ 32 bytes; ADR-0002 | `.env` |
| `CALENDAR_MODE` | public | no | `mock` default; `google` only after Q3 authorization | `.env` |
| `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` / `GOOGLE_OAUTH_REDIRECT_URI` | public / **secret** / public | Stage 7 | exact redirect URI allowlist of one | `.env` |
| `CORS_ORIGIN` | public | no | future frontend origin; unset = CORS off | `.env` |
| `LOG_LEVEL` | public | no | `info` default | `.env` |
| `MAX_AUDIO_MB` / `MAX_AUDIO_SECONDS` | public | no | 10 / 60 defaults (upper bounds fixed in code) | `.env` |

Startup validation: Zod schema parses all of `.env`, fail-fast on missing/malformed secrets, refuses non-loopback `OLLAMA_BASE_URL`/`WHISPER_SIDECAR_PORT` binds. Build-time vs runtime: all secrets runtime-only.

## 4. [REQUIRED] Capacity and lifecycle

- **Connection budget:** `pg` pool ≤ 3 (transaction pooler) + supabase-js (REST, no pool) + Ollama HTTP keepalive ≤ 2 + sidecar ≤ 2. Total outbound DB connections ≤ 3.
- **Request bounds:** JSON body ≤ 1 MB; audio ≤ 10 MB / 60 s; LLM input ≤ 4 k tokens, output ≤ 512 tokens; inference concurrency = 1; active conversations = 1 (503 `RESOURCE_LIMIT` beyond).
- **RAM budget (proposed, measured at Stage 4/6):** Node ≤ 400 MB; whisper sidecar ≤ 900 MB (tiny-int8); Ollama qwen3:1.7b ≤ 2.5 GB; total ≤ 4 GB steady-state — headroom on 7.71 GB. STT and LLM loads are sequential per turn; sidecar unloads after 10 min idle.
- **Readiness/degradation:** `readyz` reflects DB + Ollama + sidecar; app starts degraded (no LLM) with explicit error states, never silent (FR-15).
- **Shutdown:** SIGTERM → stop listeners → abort in-flight external calls safely → close DB → stop sidecar (≤ 10 s).
- **Proxy/TLS:** none this phase (localhost); production TLS is a Q6/deployment-stage decision.

## 5. [OPTIONAL] Provider/capability settings

Supabase: exposed-schema + auth settings inspected at implementation (SUPABASE §2/§6 unknowns); Vault availability check (ADR-0002). Storage: dormant bucket (post-Q4). Drift inspection: types regenerated per migration.

## 6. [REQUIRED] Decisions, unknowns and proof

- **Decisions:** ESM single-process; `.env` delivery (no secret manager for service keys at dev scale); loopback-only enforcement at config validation.
- **Unknowns:** exact Supabase Postgres version; Vault availability; backup retention (SUPABASE §6); production target (Q6).
- **Required proof before release:** G03-CONFIG startup validation on real env; secret-isolation test (TC-29); `readyz` degradation behavior (TC-21-style); sidecar lifecycle under idle/RAM pressure (TC-24/TC-19).
