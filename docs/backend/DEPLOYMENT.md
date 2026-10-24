# DEPLOYMENT — Release Candidate and Execution Plan

| Field | Value |
| --- | --- |
| Project ID | AI-RECEPTIONIST |
| Document ID | DEPLOYMENT |
| Version / date | v0.1 — 2026-10-24 |
| Owner | ZCode execution agent (maintainer); human decision authority: project owner |
| Scope | Release candidate shape, preflight, release sequence for the development target |
| Document lifecycle | approved — G02-DESIGN (conditional approval; deployment execution separately gated) |
| Input provenance | `ARCHITECTURE.md` v0.1; `ENVIRONMENT.md` v0.1; protocols 19/23 |
| Related authoritative files | `RUNBOOK.md`, `ENVIRONMENT.md`, `PROGRESS.md` §5 authorization rows |
| Approval reference | G02-DESIGN APPROVED WITH CONDITIONS 2026-10-24 (PROGRESS §5); production target still open (Q6) |

## 1. [REQUIRED] Control and exact candidate

- **Artifact:** application source at a verified git revision (built via `npm ci && npm run build` → `dist/`), plus Python sidecar venv bootstrap script. No container images (AD-1).
- **Configuration:** `.env` (server-side, git-ignored) per `ENVIRONMENT.md` §3; migrations from `supabase/migrations/` at the same revision.
- **Target:** the development laptop (single Node process + Ollama + sidecar) + Supabase project `ogxdszjypswutekqgorb`. **Production target: UNKNOWN (Q6)** — explicit blocker for any production claim; this plan covers the dev target only.
- **Permitted action:** local deployment for development/verification only, after applicable gates.

## 2. [REQUIRED] Build and preflight

- Frozen install: `npm ci` (lockfile committed); typecheck/lint/test/build commands defined at Stage 3 scaffold (G04-NATIVE).
- Secret delivery: `.env` file created manually by owner/agent on the machine — never committed, never in CI.
- Preflight: `readyz` green (DB + Ollama + sidecar); `qwen3:1.7b` present (`ollama list`); disk/RAM headroom; `git status` clean at tagged revision.

## 3. [REQUIRED] Release sequence

| Step | Prerequisite / approval | Action / target | Evidence / abort condition | Recovery path |
| --- | --- | --- | --- | --- |
| 1. Verify revision | Applicable stage gates (G03–G11 as reached) | `git rev-parse HEAD` matches intended candidate | mismatch → abort | — |
| 2. Build | G04 evidence | `npm ci && npm run build` | build failure → abort | previous revision remains running |
| 3. Apply migrations | **Separate action authorization** (PLAN §4) + G06/G07 evidence | apply `supabase/migrations/` stream to `ogxdszjypswutekqgorb` | drift/verification-query failure → abort, escalate to protocol 23 | migration replay/repair per RUNBOOK §4 |
| 4. Configure env | G03 | write `.env` (no values in repo/logs) | validation failure at startup → abort | — |
| 5. Start stack | — | Node app; Ollama already resident; sidecar on-demand | `readyz` not green in 60 s → abort | rollback = stop + previous revision |
| 6. Smoke | — | TC-01 conversation + health checks | failure → stop, diagnose | — |
| 7. Record | — | revision, evidence paths into PROGRESS §4 | — | — |

Planned ≠ executed: no step above has run; all execution evidence lands in PROGRESS when performed.

## 4. [OPTIONAL] Rollout strategy

NOT_APPLICABLE — single dev target, no live traffic; simple stop/start replacement with rollback to previous revision.

## 5. [REQUIRED] Authorization and production proof

- Local deployment after applicable implementation gates: covered by the standing master-prompt authorization (dev work), **except** first-migration DDL which has its own authorization row (PLAN §4).
- Production deployment/claim: **requires Q6 decision + G15/G17/G18** — no such authorization exists; none will be inferred.

## 6. [REQUIRED] Recovery, unknowns and next action

- Recovery: `RUNBOOK.md` §4 — stop/start, migration repair via new forward migration, Supabase provider backups (coverage unverified — SUPABASE §6 unknown), artifact = git revision.
- Unknowns/blockers: Q6 production target; backup retention verification; log rotation preference.
- Next allowed operation: none until Stage 3 implementation is approved (G02) and gates G03+ produce evidence.
