import { randomUUID, createHmac } from "node:crypto";
import { AppError } from "../../server/errors.js";
import type { BookingStateRepo } from "../../db/ports.js";
import type { CalendarProvider } from "../../calendar/types.js";
import { isTerminal } from "./machine.js";

export interface BookingServiceDeps {
  bookingState: BookingStateRepo;
  calendar: CalendarProvider;
  tokenHashSecret: string;
  offerTtlMinutes: number;
}

export interface OfferedSlot {
  start: string;
  end: string;
  expiresAt: string;
  offerToken: string;
}

const DEFAULT_DURATION_MINUTES = 30;

/**
 * Booking orchestration (BACKEND.md §3, ADR-0004 v0.2). The domain decides;
 * the AI proposes. Every state change goes through the atomic transition
 * (row-locked in pg, machine-validated everywhere). Confirm = recheck-before-
 * create; uncertain creates persist UNRESOLVED with the durable identity and
 * are never re-created blindly.
 */
export class BookingService {
  constructor(private readonly deps: BookingServiceDeps) {}

  async offer(
    conversationId: string,
    requestedStart: Date,
    durationMinutes = DEFAULT_DURATION_MINUTES,
  ): Promise<OfferedSlot> {
    const start = await this.deps.bookingState.ensure(conversationId);
    if (isTerminal(start.state) || start.state === "AWAIT_CONFIRMATION" || start.state === "UNRESOLVED") {
      throw new AppError("INVALID_INPUT", `No booking offer possible from state ${start.state}.`);
    }
    // Walk the approved machine to the offer point: collection → validate →
    // availability → offer. Each hop is an atomic transition.
    if (start.state === "COLLECT_DETAILS") {
      await this.deps.bookingState.transition({
        conversationId, expectedState: "COLLECT_DETAILS", event: "DETAILS_COMPLETE", patch: {},
      });
    }
    const afterValidate = await this.deps.bookingState.ensure(conversationId);
    if (afterValidate.state === "VALIDATE") {
      await this.deps.bookingState.transition({
        conversationId, expectedState: "VALIDATE", event: "VALIDATION_PASSED", patch: {},
      });
    }
    const afterCheck = await this.deps.bookingState.ensure(conversationId);
    if (afterCheck.state === "CHECK_AVAILABILITY") {
      await this.deps.bookingState.transition({
        conversationId, expectedState: "CHECK_AVAILABILITY", event: "SLOTS_FOUND", patch: {},
      });
    }

    const end = new Date(requestedStart.getTime() + durationMinutes * 60_000);
    let busy: Array<{ start: string; end: string }>;
    try {
      ({ busy } = await this.deps.calendar.checkAvailability(
        new Date(requestedStart.getTime() - 60 * 60_000).toISOString(),
        new Date(end.getTime() + 60 * 60_000).toISOString(),
      ));
    } catch {
      await this.deps.bookingState.transition({
        conversationId,
        expectedState: "OFFER_SLOT",
        event: "EXTERNAL_FAILURE",
        patch: { lastError: "availability check failed" },
      }).catch(() => undefined);
      throw new AppError("CALENDAR_UNAVAILABLE", "Availability check failed.");
    }
    const overlaps = busy.some((b) => new Date(b.start) < end && new Date(b.end) > requestedStart);
    if (overlaps) {
      throw new AppError("SLOT_TAKEN", "The requested time is no longer available.");
    }
    const expiresAt = new Date(Date.now() + this.deps.offerTtlMinutes * 60_000);
    const offerToken = randomUUID();
    await this.deps.bookingState.transition({
      conversationId,
      expectedState: "OFFER_SLOT",
      event: "OFFER_EXTENDED",
      patch: {
        offeredSlot: requestedStart,
        offerExpiresAt: expiresAt,
        confirmationTokenHash: this.hashOfferToken(offerToken),
      },
    });
    return { start: requestedStart.toISOString(), end: end.toISOString(), expiresAt: expiresAt.toISOString(), offerToken };
  }

  async confirm(
    conversationId: string,
    offerToken: string,
    decision: "accept" | "decline",
  ): Promise<
    | { bookingState: "CONFIRMED"; appointmentId: string; eventId?: string }
    | { bookingState: "REJECTED" }
    | { bookingState: "UNRESOLVED" }
    | { bookingState: "EXPIRED" }
    | { bookingState: "SLOT_TAKEN"; reason: string }
  > {
    const state = await this.deps.bookingState.ensure(conversationId);

    if (state.state === "UNRESOLVED") {
      // Idempotent confirm replay while unresolved: honest status, never re-create.
      return { bookingState: "UNRESOLVED" };
    }
    if (state.state !== "AWAIT_CONFIRMATION") {
      throw new AppError("INVALID_INPUT", `No pending offer in state ${state.state}.`);
    }

    const expired = state.offerExpiresAt !== null && state.offerExpiresAt.getTime() <= Date.now();
    if (expired) {
      await this.deps.bookingState
        .transition({ conversationId, expectedState: "AWAIT_CONFIRMATION", event: "OFFER_EXPIRED", patch: {} })
        .catch(() => undefined);
      return { bookingState: "EXPIRED" };
    }
    const tokenOk =
      state.confirmationTokenHash !== null &&
      this.hashOfferToken(offerToken) === state.confirmationTokenHash;
    if (!tokenOk) {
      // Wrong token: reject without consuming the offer (bounded by rate limits).
      throw new AppError("OFFER_EXPIRED", "Invalid offer token.");
    }

    if (decision === "decline") {
      await this.deps.bookingState.transition({
        conversationId, expectedState: "AWAIT_CONFIRMATION", event: "CUSTOMER_DECLINED", patch: {},
      });
      return { bookingState: "REJECTED" };
    }

    const slot = state.offeredSlot;
    if (!slot) throw new AppError("INTERNAL", "Offered slot missing.");
    const durationMinutes = DEFAULT_DURATION_MINUTES;
    const end = new Date(slot.getTime() + durationMinutes * 60_000);

    // AWAIT_CONFIRMATION → RECHECK_AVAILABILITY (explicit customer acceptance).
    await this.deps.bookingState.transition({
      conversationId, expectedState: "AWAIT_CONFIRMATION", event: "CUSTOMER_ACCEPTED", patch: {},
    });

    // Recheck immediately before create (SEC-7).
    let busy: Array<{ start: string; end: string }>;
    try {
      ({ busy } = await this.deps.calendar.checkAvailability(
        new Date(slot.getTime() - 60 * 60_000).toISOString(),
        new Date(end.getTime() + 60 * 60_000).toISOString(),
      ));
    } catch {
      throw new AppError("CALENDAR_UNAVAILABLE", "Availability recheck failed.");
    }
    const taken = busy.some((b) => new Date(b.start) < end && new Date(b.end) > slot);
    if (taken) {
      await this.deps.bookingState.transition({
        conversationId, expectedState: "RECHECK_AVAILABILITY", event: "SLOT_TAKEN", patch: {},
      });
      return { bookingState: "SLOT_TAKEN", reason: "slot was taken while awaiting confirmation" };
    }

    const idempotencyKey = randomUUID();
    const appointment = await this.deps.bookingState.createAppointment({
      conversationId,
      idempotencyKey,
      scheduledStart: slot,
      scheduledEnd: end,
      durationMinutes,
      timezone: "UTC",
      status: "pending_confirmation",
      serviceType: typeof state.extracted["purpose"] === "string" ? String(state.extracted["purpose"]) : undefined,
      purpose: typeof state.extracted["purpose"] === "string" ? String(state.extracted["purpose"]) : undefined,
    });

    // RECHECK_AVAILABILITY → CREATE_EVENT → VERIFY_RESULT (pre-create registration).
    await this.deps.bookingState.transition({
      conversationId, expectedState: "RECHECK_AVAILABILITY", event: "RECHECK_PASSED",
      patch: { calendarIdempotencyKey: idempotencyKey },
    });
    await this.deps.bookingState.transition({
      conversationId, expectedState: "CREATE_EVENT", event: "CREATE_CONFIRMED", patch: {},
    });

    // A thrown transport error from the adapter means the request MAY have
    // landed — that is exactly the uncertain case (ADR-0004 v0.2): persist
    // UNRESOLVED with the durable identity, never re-create.
    let outcome: Awaited<ReturnType<CalendarProvider["createEvent"]>>;
    try {
      outcome = await this.deps.calendar.createEvent({
        idempotencyKey,
        start: slot.toISOString(),
        end: end.toISOString(),
        summary: "AI Receptionist appointment",
        timezone: "UTC",
      });
    } catch (err) {
      outcome = { status: "unresolved" };
      void err;
    }

    if (outcome.status === "created") {
      await this.deps.bookingState.setAppointmentEvent(appointment.id, outcome.eventId);
      await this.deps.bookingState.transition({
        conversationId, expectedState: "VERIFY_RESULT", event: "CREATE_CONFIRMED", patch: {},
      });
      return { bookingState: "CONFIRMED", appointmentId: appointment.id, eventId: outcome.eventId };
    }

    if (outcome.status === "unresolved") {
      await this.deps.bookingState.transition({
        conversationId, expectedState: "VERIFY_RESULT", event: "CREATE_RESULT_UNKNOWN",
        patch: { unresolvedSince: new Date(), calendarIdempotencyKey: idempotencyKey },
      });
      // Appointment stays status='unresolved' — event existence being verified.
      return { bookingState: "UNRESOLVED" };
    }

    await this.deps.bookingState.transition({
      conversationId, expectedState: "VERIFY_RESULT", event: "EXTERNAL_FAILURE",
      patch: { lastError: outcome.reason },
    });
    throw new AppError("CALENDAR_UNAVAILABLE", `Calendar event creation failed: ${outcome.reason}`);
  }

  /** Reconciliation search using the durable identity — never re-creates. */
  async reconcile(conversationId: string): Promise<"confirmed" | "confirmed_absent" | "unresolved"> {
    const state = await this.deps.bookingState.ensure(conversationId);
    if (state.state !== "UNRESOLVED" || !state.calendarIdempotencyKey) return "unresolved";
    try {
      const search = await this.deps.calendar.findByIdempotencyKey(state.calendarIdempotencyKey);
      const now = new Date();
      if (search.found && search.eventId) {
        await this.deps.bookingState.transition({
          conversationId, expectedState: "UNRESOLVED", event: "RECONCILIATION_FOUND_EVENT",
          patch: { lastReconciledAt: now },
        });
        return "confirmed";
      }
      // Absent today is not yet definitive evidence — stay UNRESOLVED (escalation path).
      await this.deps.bookingState.transition({
        conversationId, expectedState: "UNRESOLVED", event: "RECONCILIATION_EXHAUSTED",
        patch: { reconciliationAttempts: state.reconciliationAttempts + 1, lastReconciledAt: now },
      });
      return "unresolved";
    } catch {
      return "unresolved";
    }
  }

  async cancel(conversationId: string): Promise<void> {
    const state = await this.deps.bookingState.ensure(conversationId);
    if (isTerminal(state.state) || state.state === "UNRESOLVED") return; // idempotent no-op
    await this.deps.bookingState.transition({
      conversationId, expectedState: state.state, event: "CUSTOMER_CANCELLED", patch: {},
    });
  }

  private hashOfferToken(token: string): string {
    return createHmac("sha256", this.deps.tokenHashSecret).update(token, "utf8").digest("hex");
  }
}
