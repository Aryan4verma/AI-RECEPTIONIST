# SECURITY — Threats, Controls and Findings

| Field | Value |
| --- | --- |
| Project ID | AI-RECEPTIONIST |
| Document ID | SECURITY |
| Version / date | v0.2 — 2026-10-24 (G02 change-request revisions: dual-layer consent, fail-closed store, migration integrity, SEC-F4/F5) |
| Owner | ZCode execution agent (maintainer); human decision authority: project owner |
| Scope | Threat model, control mapping for SEC-1…SEC-16, specialized surfaces, findings policy |
| Document lifecycle | approved — G02-DESIGN (conditional approval, conditions satisfied 2026-10-24) |
| Input provenance | Approved `PROJECT.md` v0.2 (SEC invariants); `ARCHITECTURE.md`; ai-capabilities `RULES.md`; protocol 16 |
| Related authoritative files | `AUTH.md`, `API.md`, `DATABASE.md`, `decisions/ADR-0002/0003/0004.md`, `RUNBOOK.md` |
| Approval reference | G02-DESIGN APPROVED WITH CONDITIONS 2026-10-24 — see PROGRESS.md §5 |

## 1. [REQUIRED] Control, assets and scope

- **Sensitive assets:** customer PII (names, contacts, conversation content, transcripts), consent records, Google OAuth tokens (Stage 7), cloud provider API keys, Supabase service credential, calendar data, recordings (dormant).
- **Actors:** anonymous internet (if ever exposed — currently localhost), customers (token-scoped), admins, backend process, AI providers (untrusted), external calendar.
- **Trust boundaries:** HTTP boundary; AI-provider boundary (all output untrusted data); STT sidecar boundary; DB boundary (RLS + service_role); external-effect boundary (calendar).
- **Scope note:** backend runs localhost-bound this phase; controls assume eventual exposure via frontend phase — no reliance on "not reachable" as a control.

## 2. [REQUIRED] Threat/control/evidence mapping

| Threat / requirement | Exposed path | Control / owner | Evidence / limitation | Owner |
| --- | --- | --- | --- | --- |
| Unauthenticated access to admin data (SEC-2/3) | Admin APIs, Supabase Data API | JWT verify + membership guard; RLS; zero anon grants | TC-11/TC-28 real-role tests | backend |
| Cross-customer access by ID guessing (SEC-2/3) | Public conversation APIs | Conversation token (hashed, constant-time) + 404 existence hiding | TC-11 negative cases | backend |
| Injection via customer text/transcript → model (SEC-8) | OP-02/03 | Instructions/data separation in prompts; model output is data; strict Zod output validation; no tool execution offered to models | TC-14 injection corpus, TC-27 | backend + ai |
| Model output driving privileged actions (SEC-6/12) | ai → domain | Booking/state changes only via deterministic state machine; calendar writes only after explicit confirm + recheck; models have no tools | TC-08, TC-05 | backend |
| Secret leakage: repo/logs/responses/prompts (SEC-4/11/14) | git, logs, errors, LLM input, settings API | Server-only env for service keys; provider keys via secrets store (ADR-0002); masked settings responses; redaction middleware; keys never in prompts | TC-29 sweep, TC-25 error-shape | backend |
| Cloud credential exposure in client (SEC-4) | future frontend | No secret ever delivered to client; settings endpoints return masked values only | TC-29 | backend |
| SSRF via configurable provider endpoints (SEC-16) | OP-15/16 config; adapter egress | Scheme must be https (cloud); DNS-resolve + block private/loopback/link-local/metadata (169.254.169.254) ranges; no redirects to private; fixed `OLLAMA_BASE_URL` from server env (not admin-settable) | TC-30 | backend |
| Unapproved cloud egress / paid fallback (SEC-15) | ai adapter selection | Default = local provider; cloud provider used only if admin configured AND active; fallback to cloud requires explicit approved fallback config; denial logged | TC-31 | backend |
| Resource abuse / cost (SEC-10, R5) | all endpoints, inference | Rate limits (per-IP/per-conversation), audio caps, token caps, inference semaphore, price-aware admission for cloud (per-call cost estimate refused above configured envelope — enforced before call) | TC-17, TC-19 | backend |
| Double-booking race (SEC-9) | calendar create | Recheck-before-create + idempotency key + unique event id + reconciliation; unresolved outcomes stay explicitly unresolved (never false success/failure, never blind re-create) | TC-06/TC-16/TC-36 | backend |
| Recording without consent (FR-9) — **dual-layer** | recording persistence | Trusted backend check **and** role-independent DB trigger `enforce_recording_consent()` (service_role bypasses RLS, so RLS alone cannot be the gate) | TC-10 + TC-33 | backend + data |
| Fail-closed credential storage (SEC-14 / ADR-0002 v0.2) | secrets store | Vault adopted only after availability **and privilege** verification; otherwise credential persistence disabled (`CREDENTIAL_STORE_UNAVAILABLE`) — no silent fallback; local Ollama unaffected | TC-32 | backend |
| Migration-history integrity (G07) | schema evolution | CLI-only application path; remote history ↔ committed files ↔ catalog drift verification; `execute_sql` success never treated as history proof | TC-34 | data |
| SQL injection (SEC-1) | DB layer | Parameterized queries only (supabase-js/pg parameterized); no dynamic SQL string building | code review + TC-05 | backend |
| PII in logs/telemetry (SEC-11) | logging | Redaction path list (authorization headers, tokens, message content logged as length+hash only by default); PII never in error responses | log inspection tests | backend |
| Malformed/oversized input (SEC-1/10) | all endpoints | Zod + Fastify body limits (1 MB JSON) + audio caps | TC-17 | backend |
| Audit integrity | `audit_log` | Append-only grants (no UPDATE/DELETE for any role) | TC-11 variant | backend |
| Supply chain (dependencies) | npm | Pinned lockfile; `npm audit` in pre-release checks; minimal deps | G11 dependency audit at release | backend |

## 3. [OPTIONAL] Specialized surfaces

- **Uploads:** audio magic-byte validation + caps (TC-09/TC-17); no audio persistence without consent (TC-10).
- **SSRF:** covered above (SEC-16) — the only admin-configurable network target.
- **CSRF:** N/A v1 (no cookie sessions; bearer/header tokens). Revisit at frontend phase with session design (protocol 14).
- **Abuse:** rate limits + single-conversation cap; no CAPTCHA (no public exposure yet).
- **Browser:** N/A this phase (no frontend).

## 4. [REQUIRED] Findings and residual decisions

| Finding ID | Claim / location / proof | Severity / exposure | Remediation / owner | Status |
| --- | --- | --- | --- | --- |
| SEC-F1 | Data API `public` schema exposure is provider-default; controls rely on zero grants/policies — must be verified at implementation, not assumed | Medium (if misconfigured) | Verify exposed-schema settings + real anon-role test at Stage 3 (TC-11) | Open — implementation evidence required |
| SEC-F2 | Localhost-only binding is an operational setting, not a code guarantee | Low this phase | Bind config validated at startup (G03); revisit at deployment | Open |
| SEC-F3 | Cloud provider egress transmits conversation content off-device by design when opted in | Medium (privacy) | Explicit opt-in flag + per-provider data-region recording + owner authorization before activation (SEC-15/PLAN §4) | Accepted-by-design pending owner authorization |
| SEC-F4 | Supabase Vault privilege posture on this project unverified — decrypted-secret reads could be over-granted | Medium (secret exposure) | Fail-closed per ADR-0002 v0.2: verify `vault.decrypted_secrets` grants/Data-API exposure before adoption; otherwise credential persistence disabled | Open — implementation verification (TC-32) |
| SEC-F5 | Proposed performance/resource budgets are unverified on this host (~0.77 GB free at discovery) | Low (operational honesty) | Treat as provisional measurement targets; admission checks + honest cold/warm measurement at implementation (TC-37/TC-19); no false performance-gate claims | Open — measurement required |
| SEC-F6 | `npm audit --omit=dev` (2026-10-24): zod <4.6.6 — high severity, memory exhaustion validating oversized constrained collections (GHSA-mrhx-c7xc-m3w5) | High advisory / limited current exposure (1 MB JSON body limit + bounded audio; inputs never unbounded) | **REMEDIATED 2026-10-24 (security preflight):** upgraded to zod 4.6.7; hand-rolled `_def` walker replaced with native `z.toJSONSchema`; AI output schemas now `strictObject` (unknown keys rejected, not stripped); bounded-input/deep-nesting/oversize rejection tests added (`schemas.test.ts`); `npm audit --omit=dev` = 0 vulnerabilities; typecheck + full suite (57/57) pass with no weakened validation | Closed — evidence in repo |
| SEC-F7 | LIVE eval finding (2026-10-24, real qwen3:1.7b): the 1.7B model **adopted an injected instruction at the intent-classification level** (attacker-demanded intent echoed; 1/1 probe run). Schema validity held; no execution path exists — the provider has no tools and booking actions are backend-controlled regardless of classified intent (SEC-6/12) | Medium (intent manipulation → wrong conversation routing; no privileged effect) | Structural mitigations already in place (no model tools; backend-owned decisions; strict output validation). Stage 4 evals track resistance across a corpus; candidate mitigations: stronger local model, hardened prompts, intent-confidence thresholds. Owner informed via register | Open — tracked eval risk (R1) |
| — | No fabricated clean scans: dependency/static audits are executed at release stage, not claimed now | — | — | — |

## 5. [REQUIRED] Change and incident boundaries

- **Credential compromise/rotation:** provider keys — replace via OP-16 + delete old secret (secrets port); service_role key — rotate in Supabase dashboard + env update + restart (RUNBOOK procedure); Google refresh token — revoke via Google account + re-auth (Stage 7).
- **Sensitive data handling:** PII accessed only via guarded paths; incident with suspected PII exposure → containment per RUNBOOK §3.
- **Active-probe scope:** security testing limited to local fixtures + owned Supabase project; no third-party probing.
- **Recovery escalation:** link `RUNBOOK.md` §3/§4.

## 6. [REQUIRED] Unknowns and review

- Q4 retention values (owner, G02) — affects deletion controls for recordings/transcripts.
- Q7 final secret mechanism (Vault vs AES-GCM fallback) — G02 decision; ADR-0002.
- Google OAuth scope finalization (Stage 7, with Q3 authorization).
- Production exposure/TLS (Q6, deployment stage).
- **G02 review dependency:** this document + AUTH/API/DATABASE/ARCHITECTURE constitute the security portion of the design review. Implementation requires G02 approval; G11 security evidence follows at implementation/release.
