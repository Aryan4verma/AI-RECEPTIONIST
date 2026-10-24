import { describe, expect, it } from "vitest";
import { MockCalendarAdapter } from "../../calendar/mockAdapter.js";
import {
  MemoryAuditRepo,
  MemoryBookingStateRepo,
  MemoryBusinessConfigRepo,
  MemoryConsentRepo,
  MemoryConversationRepo,
  MemoryCustomerRepo,
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

describe("durable cancellation intent (live-DB correction)", () => {
  async function confirmedHarness() {
    const conversations = new MemoryConversationRepo();
    const bookingState = new MemoryBookingStateRepo();
    const calendar = new MockCalendarAdapter();
    const audit = new MemoryAuditRepo();
    const escalated: Array<{ id: string; reason: string }> = [];
    const booking = new BookingService({
      bookingState, calendar, tokenHashSecret: SECRET, offerTtlMinutes: 15,
      audit, customers: new MemoryCustomerRepo(), conversations,
      escalate: (id, reason) => {
        escalated.push({ id, reason });
        return Promise.resolve();
      },
    });
    const started = await conversations.create({ channel: "text", accessTokenHash: "h" });
    const offer = await booking.offer(started.id, slot);
    const confirmed = await booking.confirm(started.id, offer.offerToken, "accept");
    expect(confirmed.bookingState).toBe("CONFIRMED");
    return { conversations, bookingState, calendar, audit, booking, escalated, id: started.id };
  }

  it("cancel-unresolved records durable intent; reconciliation RETRIES the cancellation, never re-confirms", async () => {
    const h = await confirmedHarness();
    // Provider loses the cancel response:
    const originalCancel = h.calendar.cancelEvent.bind(h.calendar);
    h.calendar.cancelEvent = async () => ({ status: "unresolved" });
    await expect(h.booking.cancel(h.id)).rejects.toMatchObject({ code: "CALENDAR_UNAVAILABLE" });
    const identity = (await h.bookingState.get(h.id))?.calendarIdempotencyKey ?? "";
    expect((await h.bookingState.findAppointmentByIdempotencyKey(identity))?.status).toBe("unresolved");
    // PROCESS RESTART: fresh service instance + healthy provider; the durable
    // cancel intent survives in booking_state.
    h.calendar.cancelEvent = originalCancel;
    const fresh = new BookingService({
      bookingState: h.bookingState, calendar: h.calendar, tokenHashSecret: SECRET,
      offerTtlMinutes: 15, audit: h.audit,
    });
    const outcome = await fresh.reconcile(h.id);
    // The event was found — but the durable cancel intent means it is CANCELLED
    // again (idempotent), never re-confirmed:
    expect(outcome).toBe("confirmed"); // event existed
    const appt = await h.bookingState.findAppointmentByIdempotencyKey(identity);
    expect(appt?.status).toBe("cancelled"); // cancellation intent honored
    // The external status honors the cancellation even though the machine's
    // CONFIRMED state is terminal:
    expect(await fresh.publicStatus(h.id)).toBe("cancelled");
  });

  it("cancel-unresolved + verified-absent event -> cancellation completes as CANCELLED on reconcile", async () => {
    const h = await confirmedHarness();
    h.calendar.cancelEvent = async () => ({ status: "unresolved" });
    await expect(h.booking.cancel(h.id)).rejects.toBeInstanceOf(AppError);
    const identity = (await h.bookingState.get(h.id))?.calendarIdempotencyKey ?? "";
    // Restart: the provider never received an effective cancel AND the event
    // never landed (verified absence) — the cancel completes as CANCELLED:
    h.calendar["events"].clear();
    const fresh = new BookingService({
      bookingState: h.bookingState, calendar: h.calendar, tokenHashSecret: SECRET,
      offerTtlMinutes: 15, audit: h.audit,
    });
    const outcome = await fresh.reconcile(h.id);
    expect(outcome).toBe("confirmed_absent");
    // The machine's CONFIRMED state is terminal and cannot transition; the
    // cancellation truth lives in the appointment record and external status:
    expect((await h.bookingState.get(h.id))?.state).toBe("CONFIRMED");
    expect((await h.bookingState.findAppointmentByIdempotencyKey(identity))?.status).toBe("cancelled");
    expect(await fresh.publicStatus(h.id)).toBe("cancelled");
  });

  it("cancel-unresolved + inconclusive lookup stays unresolved with escalation (no false completion)", async () => {
    const h = await confirmedHarness();
    h.calendar.cancelEvent = async () => ({ status: "unresolved" });
    await expect(h.booking.cancel(h.id)).rejects.toBeInstanceOf(AppError);
    const identity = (await h.bookingState.get(h.id))?.calendarIdempotencyKey ?? "";
    h.calendar.findByIdempotencyKey = async () => ({ status: "inconclusive" });
    const fresh = new BookingService({
      bookingState: h.bookingState, calendar: h.calendar, tokenHashSecret: SECRET,
      offerTtlMinutes: 15, audit: h.audit,
    });
    const outcome = await fresh.reconcile(h.id);
    expect(outcome).toBe("unresolved");
    expect((await h.bookingState.findAppointmentByIdempotencyKey(identity))?.status).toBe("unresolved");
    expect(h.escalated.length).toBeGreaterThan(0);
  });

  it("creation-unresolved WITHOUT cancel intent still re-confirms on found (unchanged behavior)", async () => {
    const h = await confirmedHarness();
    // Simulate a CREATION uncertainty (no cancel marker):
    const identity = (await h.bookingState.get(h.id))?.calendarIdempotencyKey ?? "";
    const state = await h.bookingState.get(h.id);
    state!.state = "UNRESOLVED";
    await h.calendar.cancelEvent((await h.bookingState.findAppointmentByIdempotencyKey(identity))!.googleEventId ?? "");
    // Remove the event (creation uncertainty: may or may not exist):
    h.calendar["events"].clear();
    // It did land though — re-register it under the same identity:
    await h.calendar.createEvent({
      idempotencyKey: identity, start: slot.toISOString(),
      end: new Date(slot.getTime() + 30 * 60_000).toISOString(),
      summary: "landed", timezone: "UTC",
    });
    const fresh = new BookingService({
      bookingState: h.bookingState, calendar: h.calendar, tokenHashSecret: SECRET,
      offerTtlMinutes: 15, audit: h.audit,
    });
    const outcome = await fresh.reconcile(h.id);
    expect(outcome).toBe("confirmed");
    expect((await h.bookingState.findAppointmentByIdempotencyKey(identity))?.status).toBe("confirmed");
  });
});

describe("recovery safety addendum: blocked recovery escalates honestly", () => {
  async function harnessWithAudit() {
    const conversations = new MemoryConversationRepo();
    const bookingState = new MemoryBookingStateRepo();
    const calendar = new MockCalendarAdapter();
    const audit = new MemoryAuditRepo();
    const booking = new BookingService({ bookingState, calendar, tokenHashSecret: SECRET, offerTtlMinutes: 15, audit });
    const conversation = new ConversationService({
      conversations,
      consent: new MemoryConsentRepo(),
      audit,
      config: new MemoryBusinessConfigRepo(),
      provider: scriptedProvider([{ intent: "book_appointment" }]),
      tokenHashSecret: SECRET,
    });
    const started = await conversation.start("text");
    const offer = await booking.offer(started.conversationId, slot);
    return { bookingState, calendar, audit, booking, conversationId: started.conversationId, offerToken: offer.offerToken };
  }

  it("missing authoritative appointment data → no send, state preserved, audit escalation", async () => {
    const h = await harnessWithAudit();
    const state = await h.bookingState.ensure(h.conversationId);
    state.state = "CREATE_EVENT";
    state.calendarIdempotencyKey = "identity-blocked-no-data";
    const spy = vi3spy(h.calendar);
    const outcome = await h.booking.reconcile(h.conversationId);
    expect(outcome).toBe("unresolved");
    expect(spy.keys).toHaveLength(0);
    expect((await h.bookingState.get(h.conversationId))?.state).toBe("CREATE_EVENT");
    expect(h.audit.entries.some((e) => e.action === "booking.recovery_blocked")).toBe(true);
  });

  it("non-IANA timezone in persisted data → no send, no UTC fallback", async () => {
    const h = await harnessWithAudit();
    const state = await h.bookingState.ensure(h.conversationId);
    state.state = "CREATE_EVENT";
    state.calendarIdempotencyKey = "identity-blocked-bad-tz";
    await h.bookingState.createAppointment({
      conversationId: h.conversationId, idempotencyKey: "identity-blocked-bad-tz", scheduledStart: slot,
      scheduledEnd: new Date(slot.getTime() + 30 * 60_000), durationMinutes: 30, timezone: "not-a-tz",
      status: "pending_confirmation",
    });
    const spy = vi3spy(h.calendar);
    const outcome = await h.booking.reconcile(h.conversationId);
    expect(outcome).toBe("unresolved");
    expect(spy.keys).toHaveLength(0);
  });

  it("inconclusive provider absence → no re-create, unresolved preserved", async () => {
    const h = await harnessWithAudit();
    const state = await h.bookingState.ensure(h.conversationId);
    state.state = "CREATE_EVENT";
    state.calendarIdempotencyKey = "identity-inconclusive";
    await h.bookingState.createAppointment({
      conversationId: h.conversationId, idempotencyKey: "identity-inconclusive", scheduledStart: slot,
      scheduledEnd: new Date(slot.getTime() + 30 * 60_000), durationMinutes: 30, timezone: "Europe/Berlin",
      status: "pending_confirmation",
    });
    h.calendar.findByIdempotencyKey = async () => ({ status: "inconclusive" });
    const spy = vi3spy(h.calendar);
    const outcome = await h.booking.reconcile(h.conversationId);
    expect(outcome).toBe("unresolved");
    expect(spy.keys).toHaveLength(0);
    expect((await h.bookingState.get(h.conversationId))?.state).toBe("CREATE_EVENT");
  });

  it("verified absence + complete authoritative data → re-send with the SAME identity", async () => {
    const h = await harnessWithAudit();
    const state = await h.bookingState.ensure(h.conversationId);
    state.state = "CREATE_EVENT";
    state.calendarIdempotencyKey = "identity-verified-absent";
    await h.bookingState.createAppointment({
      conversationId: h.conversationId, idempotencyKey: "identity-verified-absent", scheduledStart: slot,
      scheduledEnd: new Date(slot.getTime() + 30 * 60_000), durationMinutes: 45, timezone: "Europe/Berlin",
      status: "pending_confirmation",
    });
    const spy = vi3spy(h.calendar);
    const outcome = await h.booking.reconcile(h.conversationId);
    expect(outcome).toBe("confirmed");
    expect(spy.keys).toEqual(["identity-verified-absent"]);
    expect((await h.bookingState.get(h.conversationId))?.state).toBe("CONFIRMED");
    const appt = await h.bookingState.findAppointmentByIdempotencyKey("identity-verified-absent");
    expect(appt?.status).toBe("confirmed");
    expect(appt?.googleEventId).toBe("mock-event-1");
  });
});
