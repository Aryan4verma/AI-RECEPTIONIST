# RUNBOOK — Operation and Recovery Procedures

| Field | Value |
| --- | --- |
| Project ID | AI-RECEPTIONIST |
| Document ID | RUNBOOK |
| Version / date | v0.1 — 2026-10-24 |
| Owner | ZCode execution agent (maintainer); operational owner: project owner (sole operator) |
| Scope | Routine ops, incident procedures, rollback/restore for the dev-laptop + Supabase topology |
| Document lifecycle | approved — G02-DESIGN (conditional approval, conditions satisfied 2026-10-24) |
| Input provenance | `ARCHITECTURE.md`/`ENVIRONMENT.md` v0.1; protocol 23 |
| Related authoritative files | `DEPLOYMENT.md`, `SECURITY.md` §5, `OBSERVABILITY.md` |
| Approval reference | G02-DESIGN APPROVED WITH CONDITIONS 2026-10-24 — see PROGRESS.md §5 |

## 1. [REQUIRED] Control and service ownership

- **Operational owner:** project owner (Aryan Verma). Contact route: direct ZCode session. No invented on-call roster.
- **Target identity lookup:** `git -C "C:/AI RECEPTIONIST" rev-parse HEAD`; Supabase project ref `ogxdszjypswutekqgorb`; `ollama list`.
- **Authorized incident scope:** local processes, this project's Supabase resources; never the skill repositories, never unrelated projects (e.g., Nexus OS).

## 2. [REQUIRED] Routine health and diagnosis

- Health: `curl localhost:$PORT/readyz` (expect DB+Ollama ok); `ollama list` (model present); sidecar `GET /health` when enabled; log file tail (redacted JSON).
- Diagnosis: correlate `requestId` in error envelope ↔ logs; check `provider_errors`/`stt_failures` counters in logs; Supabase logs via MCP `query_logs` for DB-side failures.

## 3. [REQUIRED] Incident procedures

| Trigger | First diagnosis / containment | Authorized actions / stop | Validation / recovery | Escalation owner |
| --- | --- | --- | --- | --- |
| Ollama down / model missing | `readyz` degraded; `ollama list` | Restart Ollama; re-pull model if missing (owner-approved download); conversation degrade path active | `readyz` green; TC-02 smoke | owner |
| STT sidecar failure | sidecar `/health` failing; logs | Restart sidecar; verify venv/model files; audio path returns STT_FAILED meanwhile | TC-09 smoke | owner |
| Supabase unreachable | `readyz` DB check failing; MCP `query_logs` | Check network/status; stop writes (app degrades read-only-safe); never attempt destructive repair | `readyz` green | owner |
| Calendar failure / uncertain create | `calendar_create_result=unknown/failed` logs | Run reconciliation path; **never** manually insert events outside adapter; escalate to human if reconciliation exhausts | appointment state resolved; audit row | owner |
| Suspected secret compromise (SEC §5) | — | Rotate: provider key via OP-16 + delete old; service_role key via Supabase dashboard + `.env` + restart; Google token revoke (Stage 7) | new credentials verified via OP-17/connection tests; old value dead | owner |
| RAM exhaustion / host thrash | slow turns, OOM logs | Stop sidecar (unload whisper) first, then restart app; do not run LLM+STT loads concurrently (R4) | `readyz` green; budgets re-measured | owner |
| Data integrity concern (booking anomaly) | compare `appointments` vs Google calendar | Freeze booking (disable via config), audit-log review; repair via new forward migration or adapter reconciliation — never ad-hoc SQL edits | audit trail shows resolution | owner |

## 4. [REQUIRED] Rollback, repair and restore

- **Code rollback:** stop app → `git checkout <previous-revision>` → rebuild → start (schema compatibility: forward-only migrations mean code rollbacks must tolerate current schema; migration+code rollback together = protocol 23 scoped operation with owner decision).
- **Schema repair:** new forward migration only (never rewrite history); failed partial migration → protocol 23 containment, inspect actual catalog state, then plan.
- **Restore:** Supabase managed backups (coverage/retention **unverified** — must be confirmed before relying; RPO/RTO targets not yet set — deployment-stage decision). Restore drill (isolated) required before G16 ever claims recovery readiness.
- **Writer coordination:** single process — stop before restore-type operations.
- **External-effect reconciliation:** appointments ↔ calendar drift resolved via adapter lookup; documented in BACKEND §4.

## 5. [OPTIONAL] Capability-specific procedures

- Recording retention sweep (post-Q4 activation): delete `recordings` rows + storage objects past `retention_until`; verify consent ledger preserved.
- Model management: `ollama pull/rm` (owner-approved downloads only); discovery refresh is automatic per FR-15.
- Whisper model change (Tiny→Base): config + sidecar restart + re-measure (G13).

## 6. [REQUIRED] Resumption and follow-up

- After any incident: run health + smoke checks, record evidence in PROGRESS §4, update specs if behavior changed (21), state next allowed action.
- Unresolved assumptions: backup coverage unverified; no alerting (manual polling); single-operator bus factor — accepted at dev scale, revisit at deployment.
