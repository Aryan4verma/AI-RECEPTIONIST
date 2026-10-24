# ADR-0004 — Calendar provider interface, idempotency and reconciliation

| Field | Value |
| --- | --- |
| Project ID | AI-RECEPTIONIST |
| Document ID | ADR-0004 |
| Version / date | v0.1 — 2026-10-24 |
| Decision status | **PROPOSED** — requires G02-DESIGN human approval |
| Scope | FR-6/FR-7/FR-11 calendar design (mock-first, OAuth, concurrency, idempotency) |

## 1. [REQUIRED] Control and decision status

Proposed. Real Google Calendar writes additionally require Q3 authorization (separate 05 review) before Stage 7 activation.

## 2. [REQUIRED] Context and requirements

Real availability checks + event creation/cancel/reschedule on an authorized test calendar; Google FreeBusy and event insert are non-atomic (double-booking race, R3); explicit customer confirmation mandatory (SEC-7); mock adapter must be fully verified first (prompt §5.D); minimum scopes; stable idempotency; persisted event IDs.

## 3. [REQUIRED] Alternatives and choice

| Alternative | Fit / cost / security / operational consequences | Reason selected or declined |
| --- | --- | --- |
| **A. CalendarProvider port; deterministic Mock + Google adapter via `googleapis` OAuth2 code flow (proposed)** | Port methods: `checkAvailability`, `createEvent(idempotencyKey,…)` → `{status: created\|unknown\|failed, eventId?}`, `cancelEvent`, `rescheduleEvent`, `getEvent` (reconciliation); mock is pure in-process deterministic | Testable without credentials; single choke point for idempotency/recheck (SEC-9); replaceable per prompt |
| B. Direct googleapis calls from domain services | Faster to write, scattered security/idempotency logic | Declined (no single trust boundary) |
| C. CalDAV/other abstraction library | Extra dependency; Google-specific features (FreeBusy) anyway | Declined |

**Idempotency design:** server-generated `idempotency_key` (uuid) created at confirmation; sent as Google extended private property; partial unique index on `google_event_id`; recheck via FreeBusy immediately pre-insert; uncertain outcome (timeout after send) → persisted `unknown` → bounded reconciliation (`getEvent` by idempotency-key query ≤ 3 attempts) → resolved or FAILED + audit + escalation. Reschedule = cancel-and-recreate guarded by the same keys; availability re-resolution required (FR-11).

**Scopes (minimum necessary, finalized with Q3):** `calendar.events` (event read/write) + `calendar.readonly` (FreeBusy). Refresh token stored via SecretStore (ADR-0002); `CALENDAR_MODE=google` only after authorization.

## 4. [REQUIRED] Consequences and implementation impact

`calendar/` module + `appointments` columns (`google_event_id`, `idempotency_key`, status machine); TC-05/06/07/12/16/18; working-hours/duration/buffer logic server-side in `calendar/slots.ts` from `business_config`. Race window (recheck→insert) is documented and narrowed, not eliminated — reconciliation is the compensating control. Invariants preserved: SEC-7/9.

## 5. [OPTIONAL] Revisit triggers

Multiple calendars/resources per business; Google scope changes; second provider (e.g., Outlook) → protocol 21.

## 6. [REQUIRED] Unknowns, review and supersession

Unknowns: authorized Google account/test calendar (Q3 — BLOCKED for real-adapter work); scope confirmation with owner at Stage 7. Human review: **G02-DESIGN** (+ separate action authorization before real writes). Related: ADR-0002.
