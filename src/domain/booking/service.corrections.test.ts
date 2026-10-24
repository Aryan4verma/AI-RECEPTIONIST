import { describe, expect, it, vi } from "vitest";
import { AppError } from "../../server/errors.js";
import { MockCalendarAdapter } from "../../calendar/mockAdapter.js";
import {
  MemoryAuditRepo,
  MemoryBookingStateRepo,
  MemoryBusinessConfigRepo,
  MemoryConsentRepo,
  MemoryConversationRepo,
  MemoryCustomerRepo,
} from "../../db/memory/stores.js";
import { scriptedProvider } from "../conversation/testProvider.js";
import { BookingService } from "./service.js";

const SECRET = "0123456789abcdef0123456789abcdef";
const slot = new Date(Date.now() + 24 * 60 * 60_000);

interface Faults {
  createTimeoutAfterSend?: boolean;
  cancelTimeout?: boolean;
}

function makeHarness(faults: Faults = {}) {
  const conversations = new MemoryConversationRepo();
  const bookingState = new MemoryBookingStateRepo();
  const calendar = new MockCalendarAdapter([], faults);
  const booking = new BookingService({
    bookingState,
    calendar,
    tokenHashSecret: SECRET,
    offerTtlMinutes: 15,
  });
  const conversation = new ConversationServiceStub(conversations);
  return { conversations, bookingState, calendar, booking, conversation };
}

// Minimal conversation bootstrap for booking-only tests.
class ConversationServiceStub {
  constructor(private readonly conversations: MemoryConversationRepo) {}
  async start(): Promise<{ conversationId: string; accessToken: string }> {
    const { generateConversationToken, hashConversationToken } = await import("../../auth/conversationToken.js");
    const token = generateConversationToken();
    const row = await this.conversations.create({ channel: "text", accessTokenHash: hashConversationToken(token, SECRET) });
    return { conversationId: row.id, accessToken: token };
  }
}

describe("TC-38: truthful appointment outcome persistence", () => {
  it("persists status='confirmed' AND the event id on successful creation", async () => {
    const h = makeHarness();
    const started = await h.conversation.start();
    const offer = await h.booking.offer(started.conversationId, slot, 45, "Europe/Berlin");
    const confirmed = await h.booking.confirm(started.conversationId, offer.offerToken, "accept");
    expect(confirmed.bookingState).toBe("CONFIRMED");
    const appt = await h.bookingState.findAppointmentByIdempotencyKey(
      (await h.bookingState.get(started.conversationId))?.calendarIdempotencyKey ?? "",
    );
    expect(appt?.status).toBe("confirmed");
    expect(appt?.googleEventId).toBe("mock-event-1");
  });

  it("persists status='unresolved' truthfully on an uncertain create (never 'confirmed')", async () => {
    const h = makeHarness({ createTimeoutAfterSend: true });
    const started = await h.conversation.start();
    const offer = await h.booking.offer(started.conversationId, slot);
    const result = await h.booking.confirm(started.conversationId, offer.offerToken, "accept");
    expect(result).toEqual({ bookingState: "UNRESOLVED" });
    const appt = await h.bookingState.findAppointmentByIdempotencyKey(
      (await h.bookingState.get(started.conversationId))?.calendarIdempotencyKey ?? "",
    );
    expect(appt?.status).toBe("unresolved");
    expect(appt?.googleEventId).toBeNull();
  });

  it("reconciliation-found backfills the event id and confirmed status (restart-safe repair)", async () => {
    const h = makeHarness();
    const started = await h.conversation.start();
    // Simulate: calendar event landed but the outcome persistence failed —
    // booking row unresolved, appointment row unresolved without event id.
    const key = "durable-identity-1";
    await h.calendar.createEvent({
      idempotencyKey: key,
      start: slot.toISOString(),
      end: new Date(slot.getTime() + 30 * 60_000).toISOString(),
      summary: "landed despite the lost response",
      timezone: "UTC",
    });
    const row = await h.bookingState.ensure(started.conversationId);
    row.state = "UNRESOLVED";
    row.calendarIdempotencyKey = key;
    row.unresolvedSince = new Date();
    const appt = await h.bookingState.createAppointment({
      conversationId: started.conversationId,
      idempotencyKey: key,
      scheduledStart: slot,
      scheduledEnd: new Date(slot.getTime() + 30 * 60_000),
      durationMinutes: 30,
      timezone: "UTC",
      status: "unresolved",
    });
    const outcome = await h.booking.reconcile(started.conversationId);
    expect(outcome).toBe("confirmed");
    const repaired = await h.bookingState.findAppointmentByIdempotencyKey(key);
    expect(repaired?.status).toBe("confirmed");
    expect(repaired?.googleEventId).toBe("mock-event-1");
    void appt;
  });

  it("confirm replay after success returns the same truthful result with no second event (SEC-9)", async () => {
    const h = makeHarness();
    const started = await h.conversation.start();
    const offer = await h.booking.offer(started.conversationId, slot);
    const first = await h.booking.confirm(started.conversationId, offer.offerToken, "accept");
    const replay = await h.booking.confirm(started.conversationId, offer.offerToken, "accept");
    expect(first).toMatchObject({ bookingState: "CONFIRMED" });
    expect(replay).toMatchObject({ bookingState: "CONFIRMED", appointmentId: (first as { appointmentId: string }).appointmentId });
    expect(h.calendar["events"].size).toBe(1);
  });
});

describe("TC-51: customer record linked from collected extraction details (FR-10)", () => {
  it("creates a customer with the collected name/contact when an offer is extended", async () => {
    const conversations = new MemoryConversationRepo();
    const bookingState = new MemoryBookingStateRepo();
    const customers = new MemoryCustomerRepo();
    const booking = new BookingService({
      bookingState, calendar: new MockCalendarAdapter(), tokenHashSecret: SECRET, offerTtlMinutes: 15,
      customers,
    });
    const started = await conversations.create({ channel: "text", accessTokenHash: "h" });
    const state = await bookingState.ensure(started.id);
    state.extracted = {
      customer_name: { state: "known", value: "Asha Verma" },
      contact: { state: "known", value: "asha@example.com" },
      purpose: { state: "known", value: "checkup" },
      requested_time: { state: "known", value: slot.toISOString() },
      duration_minutes: { state: "known", value: 30 },
      meeting_type: { state: "known", value: "in-person" },
    };
    await booking.offer(started.id, slot);
    expect(customers.rows).toHaveLength(1);
    expect(customers.rows[0]?.displayName).toBe("Asha Verma");
    expect(customers.rows[0]?.contactEmail).toBe("asha@example.com");
    // Second offer must not duplicate the customer record:
    await booking.offer(started.id, new Date(Date.now() + 48 * 60 * 60_000)).catch(() => undefined);
    expect(customers.rows).toHaveLength(1);
  });

  it("never creates a customer record when details were not collected", async () => {
    const conversations = new MemoryConversationRepo();
    const bookingState = new MemoryBookingStateRepo();
    const customers = new MemoryCustomerRepo();
    const booking = new BookingService({
      bookingState, calendar: new MockCalendarAdapter(), tokenHashSecret: SECRET, offerTtlMinutes: 15,
      customers,
    });
    const started = await conversations.create({ channel: "text", accessTokenHash: "h" });
    await bookingState.ensure(started.id);
    await booking.offer(started.id, slot);
    expect(customers.rows).toHaveLength(0);
  });
});

describe("TC-39: duration/timezone preserved from offer through event creation", () => {
  it("uses the offered duration and timezone at confirmation, not silent defaults", async () => {
    const h = makeHarness();
    const started = await h.conversation.start();
    const createSpy = vi.spyOn(h.calendar, "createEvent");
    const offer = await h.booking.offer(started.conversationId, slot, 45, "Europe/Berlin");
    expect(offer.durationMinutes).toBe(45);
    expect(offer.timezone).toBe("Europe/Berlin");
    await h.booking.confirm(started.conversationId, offer.offerToken, "accept");
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({ timezone: "Europe/Berlin" }),
    );
    const state = await h.bookingState.get(started.conversationId);
    expect(state?.extracted["duration_minutes"]).toBe(45);
    expect(state?.extracted["timezone"]).toBe("Europe/Berlin");
    const appt = h.bookingState.appointments[0];
    expect(appt?.["durationMinutes"]).toBe(45);
    expect(appt?.["timezone"]).toBe("Europe/Berlin");
    const end = new Date(appt?.["scheduledEnd"] as Date);
    expect(end.getTime() - (appt?.["scheduledStart"] as Date).getTime()).toBe(45 * 60_000);
  });
});

describe("TC-40: recoverable states on transient failures", () => {
  it("availability-recheck failure leaves RECHECK_AVAILABILITY and a retry succeeds", async () => {
    const h = makeHarness();
    const started = await h.conversation.start();
    const offer = await h.booking.offer(started.conversationId, slot);
    const spy = vi.spyOn(h.calendar, "checkAvailability").mockRejectedValueOnce(new Error("transient outage"));
    await expect(h.booking.confirm(started.conversationId, offer.offerToken, "accept")).rejects.toMatchObject({
      code: "CALENDAR_UNAVAILABLE",
      details: { retryable: true },
    });
    expect((await h.bookingState.get(started.conversationId))?.state).toBe("RECHECK_AVAILABILITY");
    spy.mockRestore();
    // Retry (no new state transition needed) — succeeds and confirms:
    const retry = await h.booking.confirm(started.conversationId, offer.offerToken, "accept");
    expect(retry).toMatchObject({ bookingState: "CONFIRMED" });
  });

  it("offer-time availability failure leaves the state recoverable, not FAILED", async () => {
    const h = makeHarness();
    const started = await h.conversation.start();
    vi.spyOn(h.calendar, "checkAvailability").mockRejectedValueOnce(new Error("transient"));
    await expect(h.booking.offer(started.conversationId, slot)).rejects.toMatchObject({
      code: "CALENDAR_UNAVAILABLE",
    });
    expect((await h.bookingState.get(started.conversationId))?.state).toBe("OFFER_SLOT");
    // Retry succeeds after the transient failure:
    vi.restoreAllMocks();
    const offer = await h.booking.offer(started.conversationId, slot);
    expect(offer.offerToken).toBeTruthy();
  });
});

describe("TC-41: cancellation errors are consequential, never silently suppressed", () => {
  it("propagates booking-cancel failures instead of swallowing them", async () => {
    const h = makeHarness();
    const started = await h.conversation.start();
    await h.booking.offer(started.conversationId, slot);
    // Simulate a concurrent writer having moved the row elsewhere:
    h.bookingState.conflictExpectedState = "CREATE_EVENT";
    await expect(h.booking.cancel(started.conversationId)).rejects.toThrow("booking_conflict");
  });

  it("an illegal cancellation state (VERIFY_RESULT) surfaces as an error", async () => {
    const h = makeHarness();
    const started = await h.conversation.start();
    const row = await h.bookingState.ensure(started.conversationId);
    row.state = "VERIFY_RESULT";
    await expect(h.booking.cancel(started.conversationId)).rejects.toThrow(/illegal_transition/);
  });
});
