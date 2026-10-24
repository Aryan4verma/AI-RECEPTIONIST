import type {
  BusyInterval,
  CalendarEventDraft,
  CalendarProvider,
  CreateOutcome,
  IdempotencySearch,
} from "./types.js";

interface Faults {
  /** Throw a timeout after the send is assumed to have landed (tests unresolved flow). */
  createTimeoutAfterSend?: boolean;
  cancelTimeout?: boolean;
}

/**
 * Deterministic in-process mock calendar (prompt §5.D: verify the mock fully
 * before any real adapter). Persists created events keyed by idempotency key —
 * duplicate create attempts return the SAME event id (idempotent, TC-06).
 */
export class MockCalendarAdapter implements CalendarProvider {
  private readonly events = new Map<
    string,
    { eventId: string; start: string; end: string; cancelled: boolean }
  >();
  private readonly busy: BusyInterval[];
  private sequence = 0;

  constructor(busy: BusyInterval[] = [], private readonly faults: Faults = {}) {
    this.busy = busy;
  }

  async checkAvailability(windowStart: string, windowEnd: string): Promise<{ busy: BusyInterval[] }> {
    const wStart = Date.parse(windowStart);
    const wEnd = Date.parse(windowEnd);
    if (Number.isNaN(wStart) || Number.isNaN(wEnd) || wEnd <= wStart) {
      throw new Error("invalid availability window");
    }
    return {
      busy: [
        ...this.busy.filter((b) => Date.parse(b.end) > wStart && Date.parse(b.start) < wEnd),
        ...[...this.events.values()]
          .filter((e) => !e.cancelled)
          .map((e) => ({ start: e.start, end: e.end })),
      ],
    };
  }

  async createEvent(draft: CalendarEventDraft): Promise<CreateOutcome> {
    const existing = this.events.get(draft.idempotencyKey);
    if (existing) {
      // Idempotent replay: same identity → same event, never a second one (SEC-9).
      return existing.cancelled ? { status: "failed", reason: "idempotency key reuse after cancel" } : { status: "created", eventId: existing.eventId };
    }
    if (this.faults.createTimeoutAfterSend) {
      // Simulate: request sent, response lost. The event MAY exist — but in this
      // deterministic mock it deliberately does NOT land; the adapter records
      // nothing, so reconciliation search legitimately confirms absence later.
      throw new Error("timeout-after-send");
    }
    this.sequence += 1;
    const eventId = `mock-event-${this.sequence}`;
    this.events.set(draft.idempotencyKey, {
      eventId,
      start: draft.start,
      end: draft.end,
      cancelled: false,
    });
    return { status: "created", eventId };
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<IdempotencySearch> {
    const hit = this.events.get(idempotencyKey);
    // The in-memory map is authoritative: not-found here IS verified absence.
    return hit && !hit.cancelled ? { status: "found", eventId: hit.eventId } : { status: "verified_absent" };
  }

  async cancelEvent(eventId: string): Promise<{ status: "cancelled" | "unresolved" | "failed"; reason?: string }> {
    const entry = [...this.events.values()].find((e) => e.eventId === eventId);
    if (!entry) return { status: "failed", reason: "event not found" };
    if (this.faults.cancelTimeout) return { status: "unresolved" };
    entry.cancelled = true;
    return { status: "cancelled" };
  }

  async rescheduleEvent(eventId: string, newStart: string, newEnd: string): Promise<{ status: "rescheduled" | "unresolved" | "failed"; reason?: string }> {
    const entry = [...this.events.values()].find((e) => e.eventId === eventId);
    if (!entry) return { status: "failed", reason: "event not found" };
    if (this.faults.cancelTimeout) return { status: "unresolved" };
    entry.start = newStart;
    entry.end = newEnd;
    return { status: "rescheduled" };
  }

  async healthCheck(): Promise<{ ok: boolean; error?: string }> {
    return { ok: true };
  }
}
