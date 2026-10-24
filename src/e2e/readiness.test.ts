import { describe, expect, it } from "vitest";
import { AppError } from "../server/errors.js";
import { MockCalendarAdapter } from "../calendar/mockAdapter.js";
import { loadEnv } from "../config/env.js";
import {
  MemoryAuditRepo,
  MemoryBookingStateRepo,
  MemoryConversationRepo,
  MemoryCustomerRepo,
} from "../db/memory/stores.js";
import { BookingService } from "../domain/booking/service.js";

const SECRET = "0123456789abcdef0123456789abcdef";
const slot = new Date(Date.now() + 7 * 24 * 60 * 60_000);

function harness() {
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
  return { conversations, bookingState, calendar, audit, booking, escalated };
}

async function confirmedBooking(h: ReturnType<typeof harness>): Promise<{ id: string; offerToken: string }> {
  const started = await h.conversations.create({ channel: "text", accessTokenHash: "h" });
  const offer = await h.booking.offer(started.id, slot);
  const confirmed = await h.booking.confirm(started.id, offer.offerToken, "accept");
  expect(confirmed.bookingState).toBe("CONFIRMED");
  return { id: started.id, offerToken: offer.offerToken };
}

/**
 * Readiness-checkpoint regressions (live-DB preparation):
 * unresolved Calendar cancellations are never presented as active confirmed
 * bookings through either publicStatus or confirmation replay, uncertainty is
 * preserved with escalation, and blank optional secrets never fail startup.
 */
describe("unresolved cancellation reporting (readiness correction 1)", () => {
  it("customer cancel with an UNRESOLVED provider response preserves uncertainty", async () => {
    const h = harness();
    const { id } = await confirmedBooking(h);
    // Provider accepts the cancel request but the response is lost:
    h.calendar.cancelEvent = async () => ({ status: "unresolved" });
    await expect(h.booking.cancel(id)).rejects.toMatchObject({
      code: "CALENDAR_UNAVAILABLE",
      details: { retryable: true },
    });
    // The appointment row is truthfully unresolved — NOT cancelled:
    const identity = (await h.bookingState.get(id))?.calendarIdempotencyKey ?? "";
    const appt = await h.bookingState.findAppointmentByIdempotencyKey(identity);
    expect(appt?.status).toBe("unresolved");
    // Escalated for admin visibility:
    expect(h.escalated.some((e) => e.reason.includes("unresolved"))).toBe(true);
    expect(h.audit.entries.some((e) => e.action === "booking.cancel_unresolved")).toBe(true);
  });

  it("publicStatus reports 'pending' — never an active confirmed booking — while cancellation is unresolved", async () => {
    const h = harness();
    const { id } = await confirmedBooking(h);
    const identity = (await h.bookingState.get(id))?.calendarIdempotencyKey ?? "";
    // Simulate the persisted unresolved-cancellation outcome:
    await h.bookingState.updateAppointmentOutcome(
      (await h.bookingState.findAppointmentByIdempotencyKey(identity))!.id,
      { status: "unresolved" },
    );
    expect(await h.booking.publicStatus(id)).toBe("pending");
  });

  it("confirmation replay reports UNRESOLVED — never CONFIRMED — while cancellation is unresolved", async () => {
    const h = harness();
    const { id, offerToken } = await confirmedBooking(h);
    const identity = (await h.bookingState.get(id))?.calendarIdempotencyKey ?? "";
    const appt = await h.bookingState.findAppointmentByIdempotencyKey(identity);
    await h.bookingState.updateAppointmentOutcome(appt!.id, { status: "unresolved" });
    const replay = await h.booking.confirm(id, offerToken, "accept");
    expect(replay).toEqual({ bookingState: "UNRESOLVED" });
  });

  it("inconclusive lookup BLOCKS cancellation without persisting anything", async () => {
    const h = harness();
    const { id } = await confirmedBooking(h);
    const identity = (await h.bookingState.get(id))?.calendarIdempotencyKey ?? "";
    const apptBefore = (await h.bookingState.findAppointmentByIdempotencyKey(identity))!.status;
    h.calendar.findByIdempotencyKey = async () => ({ status: "inconclusive" });
    await expect(h.booking.cancel(id)).rejects.toMatchObject({
      code: "CALENDAR_UNAVAILABLE",
      details: { retryable: true },
    });
    // Nothing persisted: the appointment keeps its pre-cancel status.
    const apptAfter = (await h.bookingState.findAppointmentByIdempotencyKey(identity))!.status;
    expect(apptAfter).toBe(apptBefore);
    expect(h.escalated.some((e) => e.reason.includes("unverified"))).toBe(true);
    expect(h.audit.entries.some((e) => e.action === "booking.cancel_inconclusive")).toBe(true);
  });

  it("reconciliation never re-confirms a cancelled appointment (race guard)", async () => {
    const h = harness();
    const { id } = await confirmedBooking(h);
    const identity = (await h.bookingState.get(id))?.calendarIdempotencyKey ?? "";
    const appt = await h.bookingState.findAppointmentByIdempotencyKey(identity);
    await h.bookingState.updateAppointmentOutcome(appt!.id, { status: "cancelled" });
    // State machine still says CONFIRMED; the event exists; reconciliation runs:
    const outcome = await h.booking.reconcile(id);
    expect(outcome).toBe("confirmed");
    // ...but the cancelled appointment row is NOT resurrected:
    expect((await h.bookingState.findAppointmentByIdempotencyKey(identity))?.status).toBe("cancelled");
  });
});

describe("blank optional secrets never fail startup (readiness correction 2)", () => {
  it("SECRET_MASTER_KEY left blank parses to undefined", () => {
    const env = loadEnv({
      SUPABASE_URL: "https://ogxdszjypswutekqgorb.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-key-placeholder",
      SUPABASE_DB_URL: "postgresql://postgres.proj:pw@aws-0-eu-central-1.pooler.supabase.com:5432/postgres",
      SUPABASE_DB_CA_CERT_PATH: "/home/owner/prod-ca-2021.crt",
      TOKEN_HASH_SECRET: "0123456789abcdef0123456789abcdef",
      SECRET_MASTER_KEY: "",
    });
    expect(env.SECRET_MASTER_KEY).toBeUndefined();
  });

  it("still fails closed when a required secret is missing entirely", () => {
    expect(() =>
      loadEnv({
        SUPABASE_URL: "https://ogxdszjypswutekqgorb.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "",
        SUPABASE_DB_URL: "postgresql://postgres.proj:pw@aws-0-eu-central-1.pooler.supabase.com:5432/postgres",
        SUPABASE_DB_CA_CERT_PATH: "/home/owner/prod-ca-2021.crt",
        TOKEN_HASH_SECRET: "0123456789abcdef0123456789abcdef",
      }),
    ).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });
});
