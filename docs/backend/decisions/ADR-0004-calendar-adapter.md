# ADR-0004 — Calendar provider interface, idempotency and reconciliation

| Field | Value |
| --- | --- |
| Project ID | AI-RECEPTIONIST |
| Document ID | ADR-0004 |
| Version / date | v0.2 — 2026-10-24 (G02 change-request revision: explicit unresolved-outcome semantics) |
| Decision status | **ACCEPTED** — approved at G02-DESIGN (conditional approval, 2026-10-24; see PROGRESS.md section 5) |
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

**Idempotency and uncertain-outcome design (v0.2):** server-generated `idempotency_key` (uuid) created at confirmation; sent as a Google extended **private** property on every event; partial unique index on `google_event_id`; FreeBusy recheck immediately pre-insert. Every create resolves to exactly one of three terminal observability states — **`created`** (event id persisted), **`confirmed_absent`** (verified the event does not exist), or **`unresolved`** (creation may or may not have happened; see below). Nothing else may be reported (SEC-13).

**Uncertain-outcome handling (`unresolved`):**
1. A timeout/unknown error **after the request was sent** persists `state = 'unresolved'` in `booking_state` **with the original `idempotency_key` and appointment row retained** — it is **never** converted to `FAILED` merely because reconciliation attempts were exhausted, and the system **never issues a second create with a fresh identity** (duplicate-event risk).
2. Reconciliation uses supported Google APIs to **search for the existing event**: `events.list` filtered by `privateExtendedProperty=bookingIdempotencyKey:<key>` on the configured calendar (plus `getEvent` when an id is suspected). Bounded attempts (≤ 3, exponential backoff) within the request; if still unresolved, the state remains `unresolved` and the case is **escalated for safe human review** (conversation escalated per FR-12; audit entry).
3. **Restart-safe recovery:** `unresolved` state and the idempotency key live in the database, so recovery is not tied to the original HTTP request. Reconciliation resumes on (a) application startup sweep of `unresolved` booking rows, and (b) any subsequent access to the conversation. A human can also trigger reconciliation via admin API.
4. Resolution outcomes: event found → adopt its `eventId`, mark `created`, persist id, confirm to customer; verified absent (search exhausted with API confirmation) → `confirmed_absent` → offer retry as a NEW confirmation flow (new key, explicit customer re-confirmation); still ambiguous → remains `unresolved`, escalated, customer told honestly that the booking state is being verified — never told it failed or succeeded (SEC-13).

Reschedule = cancel-and-recreate guarded by the same key discipline; availability re-resolution required (FR-11). Race window (recheck→insert) is narrowed, not eliminated — reconciliation + search-by-identity is the compensating control.

**Provider-level idempotency design (recovery safety addendum, 2026-10-24):** a
`privateExtendedProperty` is searchable metadata, NOT a uniqueness constraint —
Google provides no server-side create idempotency. The `CalendarProvider`
search contract therefore distinguishes `found` / `verified_absent` /
`inconclusive`. A create retry (same identity, never fresh) is permitted only
on `verified_absent` plus complete authoritative appointment data (original
start/end/duration/IANA timezone — no fallbacks). For the real Google adapter
(Stage 7): `events.list` not-found is `inconclusive` under eventual
consistency — the adapter must implement a stronger verification strategy
(e.g., delayed double-probe before declaring absence) and return
`inconclusive` otherwise; inconclusive keeps the booking UNRESOLVED with an
audit escalation instead of re-creating. The mock adapter's in-memory index is
authoritative and returns `verified_absent`.

**Scopes (minimum necessary, finalized with Q3):** `calendar.events` (event read/write) + `calendar.readonly` (FreeBusy). Refresh token stored via SecretStore (ADR-0002); `CALENDAR_MODE=google` only after authorization.

## 4. [REQUIRED] Consequences and implementation impact

`calendar/` module + `appointments` columns (`google_event_id`, `idempotency_key`, status machine); TC-05/06/07/12/16/18; working-hours/duration/buffer logic server-side in `calendar/slots.ts` from `business_config`. Race window (recheck→insert) is documented and narrowed, not eliminated — reconciliation is the compensating control. Invariants preserved: SEC-7/9.

## 5. [OPTIONAL] Revisit triggers

Multiple calendars/resources per business; Google scope changes; second provider (e.g., Outlook) → protocol 21.

## 6. [REQUIRED] Unknowns, review and supersession

Unknowns: authorized Google account/test calendar (Q3 — BLOCKED for real-adapter work); scope confirmation with owner at Stage 7. Human review: **G02-DESIGN** (+ separate action authorization before real writes). Related: ADR-0002.
