/**
 * CalendarProvider port (ADR-0004 v0.2). Implementations: MockCalendarAdapter
 * (deterministic, fully verified first) and GoogleCalendarAdapter (Q3-gated).
 * Every create resolves to exactly one of created / confirmed_absent /
 * unresolved — never a fabricated result (SEC-13).
 */
export interface BusyInterval {
  start: string; // RFC 3339 UTC
  end: string;
}

export interface Slot {
  start: string;
  end: string;
}

export interface CalendarEventDraft {
  idempotencyKey: string;
  start: string;
  end: string;
  summary: string;
  /** Business-configured working constraints applied before this call. */
  timezone: string;
}

export type CreateOutcome =
  | { status: "created"; eventId: string }
  | { status: "unresolved" } // sent-but-unverified: may exist; reconciliation required
  | { status: "failed"; reason: string }; // confirmed failure (e.g., rejected pre-send)

/**
 * Search result by durable idempotency identity. `verified_absent` means the
 * provider lookup is authoritative for absence (in-memory exact index, or a
 * consistency model the adapter can prove); `inconclusive` means absence
 * could NOT be established safely (e.g., Google events.list eventual
 * consistency) — callers must keep the booking unresolved rather than
 * re-create (recovery addendum, condition 2).
 */
export type IdempotencySearch =
  | { status: "found"; eventId: string }
  | { status: "verified_absent" }
  | { status: "inconclusive" };

export interface CalendarProvider {
  /** Actual availability (FreeBusy equivalent). */
  checkAvailability(windowStart: string, windowEnd: string): Promise<{ busy: BusyInterval[] }>;
  createEvent(draft: CalendarEventDraft): Promise<CreateOutcome>;
  /** Search for an existing event by the durable idempotency identity. */
  findByIdempotencyKey(idempotencyKey: string): Promise<IdempotencySearch>;
  cancelEvent(eventId: string): Promise<{ status: "cancelled" | "unresolved" | "failed"; reason?: string }>;
  rescheduleEvent(eventId: string, newStart: string, newEnd: string): Promise<{ status: "rescheduled" | "unresolved" | "failed"; reason?: string }>;
  healthCheck(): Promise<{ ok: boolean; error?: string }>;
}
