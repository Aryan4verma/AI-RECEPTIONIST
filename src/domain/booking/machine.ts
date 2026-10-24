/**
 * Booking state machine (BACKEND.md §3, ADR-0004 v0.2).
 * Pure transition table — the domain owns every decision; AI only proposes.
 * Illegal transitions are rejected; exhaustive tests in machine.test.ts.
 */
export const BOOKING_STATES = [
  "COLLECT_DETAILS",
  "VALIDATE",
  "CHECK_AVAILABILITY",
  "OFFER_SLOT",
  "AWAIT_CONFIRMATION",
  "RECHECK_AVAILABILITY",
  "CREATE_EVENT",
  "VERIFY_RESULT",
  "CONFIRMED",
  "UNRESOLVED",
  "CANCELLED",
  "REJECTED",
  "EXPIRED",
  "FAILED",
] as const;

export type BookingState = (typeof BOOKING_STATES)[number];

export const BOOKING_EVENTS = [
  "DETAILS_COMPLETE",
  "VALIDATION_PASSED",
  "VALIDATION_FAILED",
  "SLOTS_FOUND",
  "NO_SLOTS",
  "OFFER_EXTENDED",
  "OFFER_EXPIRED",
  "CUSTOMER_ACCEPTED",
  "CUSTOMER_DECLINED",
  "RECHECK_PASSED",
  "SLOT_TAKEN",
  "CREATE_CONFIRMED",
  "CREATE_RESULT_UNKNOWN",
  "RECONCILIATION_FOUND_EVENT",
  "RECONCILIATION_CONFIRMED_ABSENT",
  "RECONCILIATION_EXHAUSTED",
  "EXTERNAL_FAILURE",
  "CUSTOMER_CANCELLED",
  "SESSION_TERMINATED",
] as const;

export type BookingEvent = (typeof BOOKING_EVENTS)[number];

/** True terminal states. UNRESOLVED is a held state, not a failure (SEC-13). */
export const TERMINAL_STATES: readonly BookingState[] = [
  "CONFIRMED",
  "CANCELLED",
  "REJECTED",
  "EXPIRED",
  "FAILED",
];

type TransitionMap = Partial<Record<BookingState, Partial<Record<BookingEvent, BookingState>>>>;

const TRANSITIONS: TransitionMap = {
  COLLECT_DETAILS: {
    DETAILS_COMPLETE: "VALIDATE",
    CUSTOMER_CANCELLED: "CANCELLED",
    SESSION_TERMINATED: "CANCELLED",
  },
  VALIDATE: {
    VALIDATION_PASSED: "CHECK_AVAILABILITY",
    VALIDATION_FAILED: "COLLECT_DETAILS", // missing/ambiguous → clarification loop
    EXTERNAL_FAILURE: "FAILED",
    CUSTOMER_CANCELLED: "CANCELLED",
  },
  CHECK_AVAILABILITY: {
    SLOTS_FOUND: "OFFER_SLOT",
    NO_SLOTS: "COLLECT_DETAILS", // alternatives / decline path
    EXTERNAL_FAILURE: "FAILED",
    CUSTOMER_CANCELLED: "CANCELLED",
  },
  OFFER_SLOT: {
    OFFER_EXTENDED: "AWAIT_CONFIRMATION",
    EXTERNAL_FAILURE: "FAILED",
    CUSTOMER_CANCELLED: "CANCELLED",
  },
  AWAIT_CONFIRMATION: {
    CUSTOMER_ACCEPTED: "RECHECK_AVAILABILITY",
    CUSTOMER_DECLINED: "REJECTED",
    OFFER_EXPIRED: "EXPIRED",
    CUSTOMER_CANCELLED: "CANCELLED",
    SESSION_TERMINATED: "EXPIRED",
  },
  RECHECK_AVAILABILITY: {
    RECHECK_PASSED: "CREATE_EVENT",
    SLOT_TAKEN: "OFFER_SLOT", // re-offer flow
    EXTERNAL_FAILURE: "FAILED",
    CUSTOMER_CANCELLED: "CANCELLED",
  },
  CREATE_EVENT: {
    CREATE_CONFIRMED: "VERIFY_RESULT",
    CREATE_RESULT_UNKNOWN: "UNRESOLVED", // sent-but-unverified: identity preserved, never re-created (ADR-0004 v0.2)
    EXTERNAL_FAILURE: "FAILED",
    CUSTOMER_CANCELLED: "CANCELLED",
  },
  VERIFY_RESULT: {
    CREATE_CONFIRMED: "CONFIRMED",
    CREATE_RESULT_UNKNOWN: "UNRESOLVED",
    EXTERNAL_FAILURE: "FAILED",
  },
  UNRESOLVED: {
    RECONCILIATION_FOUND_EVENT: "CONFIRMED", // event adopted by idempotency-key search
    RECONCILIATION_CONFIRMED_ABSENT: "FAILED", // verified absent → new flow requires fresh confirmation
    RECONCILIATION_EXHAUSTED: "UNRESOLVED", // stays UNRESOLVED + escalated; NEVER auto-FAILED
    CUSTOMER_CANCELLED: "CANCELLED",
  },
};

export interface TransitionResult {
  ok: boolean;
  next: BookingState;
  reason?: "illegal_transition" | "terminal_state";
}

export function transition(current: BookingState, event: BookingEvent): TransitionResult {
  if (TERMINAL_STATES.includes(current)) {
    // Only UNRESOLVED-adjacent cancellation semantics live outside terminals.
    return { ok: false, next: current, reason: "terminal_state" };
  }
  const next = TRANSITIONS[current]?.[event];
  if (!next) {
    return { ok: false, next: current, reason: "illegal_transition" };
  }
  return { ok: true, next };
}

export function isTerminal(state: BookingState): boolean {
  return TERMINAL_STATES.includes(state);
}
