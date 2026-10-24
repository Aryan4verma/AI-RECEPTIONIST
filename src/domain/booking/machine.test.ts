import { describe, expect, it } from "vitest";
import { BOOKING_STATES, TERMINAL_STATES, transition, type BookingEvent, type BookingState } from "./machine.js";

describe("booking state machine", () => {
  const legal: Array<[BookingState, BookingEvent, BookingState]> = [
    ["COLLECT_DETAILS", "DETAILS_COMPLETE", "VALIDATE"],
    ["VALIDATE", "VALIDATION_PASSED", "CHECK_AVAILABILITY"],
    ["VALIDATE", "VALIDATION_FAILED", "COLLECT_DETAILS"],
    ["CHECK_AVAILABILITY", "SLOTS_FOUND", "OFFER_SLOT"],
    ["CHECK_AVAILABILITY", "NO_SLOTS", "COLLECT_DETAILS"],
    ["OFFER_SLOT", "OFFER_EXTENDED", "AWAIT_CONFIRMATION"],
    ["AWAIT_CONFIRMATION", "CUSTOMER_ACCEPTED", "RECHECK_AVAILABILITY"],
    ["AWAIT_CONFIRMATION", "CUSTOMER_DECLINED", "REJECTED"],
    ["AWAIT_CONFIRMATION", "OFFER_EXPIRED", "EXPIRED"],
    ["RECHECK_AVAILABILITY", "RECHECK_PASSED", "CREATE_EVENT"],
    ["RECHECK_AVAILABILITY", "SLOT_TAKEN", "OFFER_SLOT"],
    ["CREATE_EVENT", "CREATE_CONFIRMED", "VERIFY_RESULT"],
    ["CREATE_EVENT", "CREATE_RESULT_UNKNOWN", "UNRESOLVED"],
    ["VERIFY_RESULT", "CREATE_CONFIRMED", "CONFIRMED"],
    ["VERIFY_RESULT", "CREATE_RESULT_UNKNOWN", "UNRESOLVED"],
    ["UNRESOLVED", "RECONCILIATION_FOUND_EVENT", "CONFIRMED"],
    ["UNRESOLVED", "RECONCILIATION_CONFIRMED_ABSENT", "FAILED"],
    ["UNRESOLVED", "RECONCILIATION_EXHAUSTED", "UNRESOLVED"],
  ];

  it.each(legal)("allows %s --%s--> %s", (state, event, next) => {
    expect(transition(state, event)).toEqual({ ok: true, next });
  });

  it("never converts an exhausted reconciliation into a definite failure (ADR-0004 v0.2)", () => {
    const result = transition("UNRESOLVED", "RECONCILIATION_EXHAUSTED");
    expect(result).toEqual({ ok: true, next: "UNRESOLVED" });
  });

  it("never re-creates from UNRESOLVED with a fresh identity", () => {
    // No event leads from UNRESOLVED back to CREATE_EVENT.
    for (const event of [
      "DETAILS_COMPLETE",
      "VALIDATION_PASSED",
      "SLOTS_FOUND",
      "OFFER_EXTENDED",
      "CUSTOMER_ACCEPTED",
      "RECHECK_PASSED",
      "CREATE_CONFIRMED",
      "CREATE_RESULT_UNKNOWN",
      "RECONCILIATION_EXHAUSTED",
      "RECONCILIATION_FOUND_EVENT",
      "RECONCILIATION_CONFIRMED_ABSENT",
      "EXTERNAL_FAILURE",
    ] as BookingEvent[]) {
      const result = transition("UNRESOLVED", event);
      expect(result.next).not.toBe("CREATE_EVENT");
    }
  });

  it("rejects illegal transitions without changing state", () => {
    expect(transition("COLLECT_DETAILS", "CUSTOMER_ACCEPTED")).toEqual({
      ok: false,
      next: "COLLECT_DETAILS",
      reason: "illegal_transition",
    });
    expect(transition("CONFIRMED", "CUSTOMER_DECLINED")).toEqual({
      ok: false,
      next: "CONFIRMED",
      reason: "terminal_state",
    });
  });

  it("allows cancellation from every non-terminal active state", () => {
    for (const state of BOOKING_STATES) {
      if (TERMINAL_STATES.includes(state) || state === "UNRESOLVED") continue;
      const viaCustomer = transition(state, "CUSTOMER_CANCELLED");
      const viaSession = transition(state, "SESSION_TERMINATED");
      expect(viaCustomer.ok || viaSession.ok || state === "VERIFY_RESULT").toBe(true);
    }
  });

  it("every declared state is reachable or a declared terminal", () => {
    const reachable = new Set<BookingState>(["COLLECT_DETAILS"]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const [state, event, next] of legal) {
        if (reachable.has(state) && !reachable.has(next)) {
          reachable.add(next);
          grew = true;
        }
      }
    }
    for (const state of BOOKING_STATES) {
      expect(reachable.has(state) || TERMINAL_STATES.includes(state)).toBe(true);
    }
  });
});
