import { describe, expect, it } from "vitest";
import { MockCalendarAdapter } from "../../calendar/mockAdapter.js";
import {
  MemoryAuditRepo,
  MemoryBookingStateRepo,
  MemoryBusinessConfigRepo,
  MemoryConsentRepo,
  MemoryConversationRepo,
} from "../../db/memory/stores.js";
import { toEnvelope } from "../../server/errors.js";
import { AppError } from "../../server/errors.js";
import { scriptedProvider } from "../conversation/testProvider.js";
import { BookingService } from "./service.js";
import { ConversationService } from "../conversation/service.js";

const SECRET = "0123456789abcdef0123456789abcdef";
const slot = new Date(Date.now() + 24 * 60 * 60_000);

function makeHarness(faults: { createTimeoutAfterSend?: boolean } = {}) {
  const conversations = new MemoryConversationRepo();
  const bookingState = new MemoryBookingStateRepo();
  const calendar = new MockCalendarAdapter([], faults);
  const booking = new BookingService({ bookingState, calendar, tokenHashSecret: SECRET, offerTtlMinutes: 15 });
  const conversation = new ConversationService({
    conversations,
    consent: new MemoryConsentRepo(),
    audit: new MemoryAuditRepo(),
    config: new MemoryBusinessConfigRepo(),
    provider: scriptedProvider([{ intent: "book_appointment" }]),
    tokenHashSecret: SECRET,
  });
  return { conversations, bookingState, calendar, booking, conversation };
}

async function startAndOffer(
  h: ReturnType<typeof makeHarness>,
): Promise<{ id: string; token: string; offerToken: string }> {
  const started = await h.conversation.start("text");
  const offer = await h.booking.offer(started.conversationId, slot);
  return { id: started.conversationId, token: offer.offerToken, offerToken: offer.offerToken };
}

describe("recovery across persisted failure windows (quality correction 2)", () => {
  it("VERIFY_RESULT crash (sent, response lost, transition missed): recovery finds the event → CONFIRMED", async () => {
    const h = makeHarness();
    const s = await startAndOffer(h);
    // Drive to VERIFY_RESULT with a real created event:
    const state = await h.bookingState.ensure(s.id);
    const key = "identity-verify-crash";
    const created = await h.calendar.createEvent({
      idempotencyKey: key,
      start: slot.toISOString(),
      end: new Date(slot.getTime() + 30 * 60_000).toISOString(),
      summary: "landed",
      timezone: "UTC",
    });
    expect(created.status).toBe("created");
    state.state = "VERIFY_RESULT";
    state.calendarIdempotencyKey = key;
    const appt = await h.bookingState.createAppointment({
      conversationId: s.id, idempotencyKey: key, scheduledStart: slot,
      scheduledEnd: new Date(slot.getTime() + 30 * 60_000), durationMinutes: 30, timezone: "UTC",
      status: "pending_confirmation",
    });
    const outcome = await h.booking.reconcile(s.id);
    expect(outcome).toBe("confirmed");
    expect((await h.bookingState.get(s.id))?.state).toBe("CONFIRMED");
    const repaired = await h.bookingState.findAppointmentByIdempotencyKey(key);
    expect(repaired?.status).toBe("confirmed");
    expect(repaired?.googleEventId).toBe((created as { eventId: string }).eventId);
    void appt;
  });

  it("CREATE_EVENT crash (registered, send never verified): re-sends with the SAME identity — never a fresh one", async () => {
    const h = makeHarness();
    const s = await startAndOffer(h);
    const state = await h.bookingState.ensure(s.id);
    const key = "identity-create-crash";
    state.state = "CREATE_EVENT";
    state.calendarIdempotencyKey = key;
    await h.bookingState.createAppointment({
      conversationId: s.id, idempotencyKey: key, scheduledStart: slot,
      scheduledEnd: new Date(slot.getTime() + 30 * 60_000), durationMinutes: 30, timezone: "UTC",
      status: "pending_confirmation",
    });
    const sendSpy = vi3spy(h.calendar);
    const outcome = await h.booking.reconcile(s.id);
    expect(outcome).toBe("confirmed");
    // The re-send must reuse the durable identity:
    expect(sendSpy.keys).toContain(key);
    expect((await h.bookingState.get(s.id))?.state).toBe("CONFIRMED");
  });

  it("missing identity after a crash is adopted from the conversation's open appointment", async () => {
    const h = makeHarness();
    const s = await startAndOffer(h);
    const state = await h.bookingState.ensure(s.id);
    const key = "identity-adopted";
    state.state = "VERIFY_RESULT";
    state.calendarIdempotencyKey = null;
    await h.calendar.createEvent({
      idempotencyKey: key,
      start: slot.toISOString(),
      end: new Date(slot.getTime() + 30 * 60_000).toISOString(),
      summary: "landed",
      timezone: "UTC",
    });
    await h.bookingState.createAppointment({
      conversationId: s.id, idempotencyKey: key, scheduledStart: slot,
      scheduledEnd: new Date(slot.getTime() + 30 * 60_000), durationMinutes: 30, timezone: "UTC",
      status: "pending_confirmation",
    });
    const outcome = await h.booking.reconcile(s.id);
    expect(outcome).toBe("confirmed");
    expect((await h.bookingState.get(s.id))?.calendarIdempotencyKey).toBe(key);
  });

  it("concurrent confirmations cannot create duplicate appointment rows", async () => {
    const h = makeHarness();
    const s = await startAndOffer(h);
    // First confirm transitions AWAIT → RECHECK; a racing second confirm that
    // already read AWAIT gets a conflict on the CAS transition:
    const stateBefore = await h.bookingState.get(s.id);
    expect(stateBefore?.state).toBe("AWAIT_CONFIRMATION");
    const first = h.booking.confirm(s.id, s.offerToken, "accept");
    const second = h.booking
      .confirm(s.id, s.offerToken, "accept")
      .catch((err) => ({ failed: true, message: String(err?.message ?? err) }));
    const results = await Promise.all([first, second]);
    const confirmed = results.filter((r) => !("failed" in r));
    const failed = results.filter((r) => "failed" in r);
    expect(confirmed.length).toBe(1);
    expect(failed.length).toBeLessThanOrEqual(1);
    if (failed.length === 1) {
      expect((failed[0] as { message: string }).message).toMatch(/concurrent|conflict|state/i);
    }
    expect(h.calendar["events"].size).toBe(1);
    expect(h.bookingState.appointments).toHaveLength(1);
  });

  it("CONFIRMED replay never fabricates an appointment id — repairs or errors honestly", async () => {
    const h = makeHarness();
    const s = await startAndOffer(h);
    const confirmed = await h.booking.confirm(s.id, s.offerToken, "accept");
    expect(confirmed.bookingState).toBe("CONFIRMED");
    const replay = await h.booking.confirm(s.id, s.offerToken, "accept");
    expect(replay).toMatchObject({ bookingState: "CONFIRMED" });
    expect((replay as { appointmentId: string }).appointmentId).not.toBe("unknown");
    expect((replay as { appointmentId: string }).appointmentId).toBe(
      (confirmed as { appointmentId: string }).appointmentId,
    );
  });
});

describe("error envelope protection (quality correction 3)", () => {
  it("AppError details are server-only unless explicitly marked client-safe", () => {
    const internal = new AppError("INTERNAL", "Safe user-facing text.", {
      cause: "password=hunter2; host=internal.db.example",
    });
    const envelope = toEnvelope(internal, "req-1");
    expect(envelope.error.message).toBe("Safe user-facing text.");
    expect(envelope.error.details).toBeUndefined();
    expect(JSON.stringify(envelope)).not.toContain("hunter2");

    const explicit = new AppError("INVALID_INPUT", "Field must be a date.", { field: "date" }, true);
    expect(toEnvelope(explicit, "req-2").error.details).toEqual({ field: "date" });
  });

  it("non-AppError exceptions produce a generic envelope with no diagnostics", () => {
    const leak = new Error("PGError: relation secret_table does not exist at character 42");
    const envelope = toEnvelope(leak, "req-3");
    expect(envelope.error.code).toBe("INTERNAL");
    expect(envelope.error.message).toBe("An unexpected error occurred.");
    expect(JSON.stringify(envelope)).not.toContain("secret_table");
  });

  it("provider error text stays server-side (MODEL_UNAVAILABLE path)", () => {
    const err = new AppError("MODEL_UNAVAILABLE", "The language model is currently unavailable.", {
      providerError: "model overloaded, internal queue id 88123",
    });
    expect(toEnvelope(err, "req-4").error.details).toBeUndefined();
    expect(toEnvelope(err, "req-4").error.message).not.toContain("88123");
  });
});

// -- helpers --
import { vi } from "vitest";
function vi3spy(calendar: MockCalendarAdapter) {
  const keys: string[] = [];
  const original = calendar.createEvent.bind(calendar);
  calendar.createEvent = async (draft) => {
    keys.push(draft.idempotencyKey);
    return original(draft);
  };
  return { keys };
}
