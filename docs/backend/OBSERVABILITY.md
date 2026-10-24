# OBSERVABILITY — Signals and Response

| Field | Value |
| --- | --- |
| Project ID | AI-RECEPTIONIST | Document ID | OBSERVABILITY |
| Version / date | v0.1 — 2026-10-24 |
| Owner | ZCode execution agent (maintainer); human decision authority: project owner |
| Scope | Logs, metrics, health, correlation, privacy bounds |
| Document lifecycle | approved — G02-DESIGN (conditional approval, conditions satisfied 2026-10-24) |
| Input provenance | `ARCHITECTURE.md` v0.1; protocol 18 |
| Related authoritative files | `RUNBOOK.md`, `SECURITY.md` |
| Approval reference | G02-DESIGN APPROVED WITH CONDITIONS 2026-10-24 — see PROGRESS.md §5 |

## 1. [REQUIRED] Control and operational questions

- **Budgets served (Q5 proposals):** turn E2E p50 ≤ 6 s / p95 ≤ 12 s (local); STT ≤ 2 s per ≤10 s clip; LLM ≤ 4 s/turn. Critical failure modes: Ollama down, sidecar down, Supabase unreachable, calendar failure/uncertainty, model load failure, resource exhaustion.
- **Operational ownership:** project owner (sole operator); agent maintains runbook.

## 2. [REQUIRED] Signal specification

| Question / requirement | Signal | Safe dimensions / correlation | Destination / retention | Response owner |
| --- | --- | --- | --- | --- |
| Is a turn healthy? (Q5) | `turn_latency_ms` histogram by stage (stt/llm/calendar) | `requestId`, `conversationId` (uuid only), stage | pino JSON → stdout → file; 30 days | owner |
| Is STT working? | `stt_duration_ms`, `stt_failures_total{reason}` | reason enum only | logs | owner |
| Is LLM working / which provider? | `llm_duration_ms{provider,model}`, `llm_invalid_output_total`, `llm_refusals_total` | provider/model id (not content) | logs | owner |
| Calendar health (SEC-9) | `calendar_create_result{outcome=created\|unknown\|failed}`, `reconciliation_total` | appointment id | logs + `audit_log` | owner |
| Abuse/limits (SEC-10) | `rate_limited_total{scope}`, `resource_limit_rejections_total` | scope enum | logs | owner |
| Consequential actions (FR-10) | `audit_log` rows (append-only) | actor type/id, action, entity | DB | owner |
| Provider errors (FR-16) | `provider_errors_total{provider,code}` | code enum | logs | owner |

- **Tooling choice (proposed):** `pino` structured JSON logs (STACK default) + lightweight in-process counters logged periodically; no external APM (NOT_APPLICABLE — single-user dev scale; revisit if deployed). Exporter decision final at Stage 3.

## 3. [REQUIRED] Privacy and instrumentation ownership

- Middleware: request-id propagation (`X-Request-Id`), pino redaction paths (`req.headers.authorization`, `x-conversation-token`, `apiKey`, message content → log length + SHA-256 prefix only by default; full content never logged).
- Transcripts/audio: never logged; never sent to telemetry (no AI capture providers — NOT_APPLICABLE).
- Duplicate-capture prevention: single logger instance; adapters log via injected child loggers only.

## 4. [OPTIONAL] Provider and advanced signals

Sentry/profiling/replay: NOT_APPLICABLE (no requirement at this scale/provider). Supabase provider logs inspected ad-hoc via MCP during incidents (SUPABASE §6).

## 5. [REQUIRED] Health and received evidence

- `/healthz` (liveness: process up); `/readyz` (readiness: DB reachable + Ollama reachable + sidecar healthy when enabled; degraded modes reported as JSON statuses).
- Deployment proof (later stages): real requests produce correlated logs; readiness reflects actual dependency state (TC checks + G14 evidence at implementation). Planned instrumentation ≠ ingestion evidence.

## 6. [REQUIRED] Decisions, unknowns and review

- Decisions: pino + in-process metrics; redaction defaults; audit_log as durable action record.
- Unknowns: log file rotation policy (owner preference at implementation); alerting channel (none — single operator; RUNBOOK polling). Review dependency: **G02-DESIGN**; delivery evidence at implementation (G14).
