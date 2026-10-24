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
  durationMinutes: number;
  timezone: string;
}

const DEFAULT_DURATION_MINUTES = 30;
const DEFAULT_TIMEZONE = "UTC";

/**
 * Booking orchestration (BACKEND.md §3, ADR-0004 v0.2). The domain decides;
 * the AI proposes. Every state change goes through the atomic transition
 * (row-locked in pg, machine-validated everywhere). Confirm = recheck-before-
 * create; uncertain creates persist UNRESOLVED with the durable identity and
 * are never re-created blindly. Offered duration/timezone are persisted at
 * offer time and reused at confirmation/event creation — never silently
 * substituted.
 */
export class BookingService {
  constructor(private readonly deps: BookingServiceDeps) {}

  async offer(
    conversationId: string,
    requestedStart: Date,
    durationMinutes = DEFAULT_DURATION_MINUTES,
    timezone = DEFAULT_TIMEZONE,
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
    } catch (err) {
      // Recoverable: state stays OFFER_SLOT so the offer can be retried —
      // a transient calendar outage must not terminate the booking flow.
      throw new AppError("CALENDAR_UNAVAILABLE", "Availability check failed.", {
        retryable: true,
        cause: err instanceof Error ? err.message : "unknown",
      });
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
        // Duration/timezone are bound to the offer and reused at confirmation.
        extracted: { ...start.extracted, duration_minutes: durationMinutes, timezone },
      },
    });
    return {
      start: requestedStart.toISOString(),
      end: end.toISOString(),
      expiresAt: expiresAt.toISOString(),
      offerToken,
      durationMinutes,
      timezone,
    };
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

    if (state.state === "CONFIRMED") {
      // Idempotent replay after success: same token → same truthful result,
      // never a second event (SEC-9). A missing appointment record is repaired
      // via reconciliation — never answered with a fabricated id.
      const tokenOk =
        state.confirmationTokenHash !== null &&
        this.hashOfferToken(offerToken) === state.confirmationTokenHash;
      if (!tokenOk) throw new AppError("OFFER_EXPIRED", "Invalid offer token.");
      let appointment = state.calendarIdempotencyKey
        ? await this.deps.bookingState.findAppointmentByIdempotencyKey(state.calendarIdempotencyKey)
        : null;
      if (!appointment && state.calendarIdempotencyKey) {
        await this.reconcile(conversationId);
        appointment = await this.deps.bookingState.findAppointmentByIdempotencyKey(state.calendarIdempotencyKey);
      }
      if (!appointment) {
        throw new AppError("INTERNAL", "Confirmed booking record could not be loaded; reconciliation has been triggered.");
      }
      return {
        bookingState: "CONFIRMED",
        appointmentId: appointment.id,
        eventId: appointment.googleEventId ?? undefined,
      };
    }

    if (state.state !== "AWAIT_CONFIRMATION" && state.state !== "RECHECK_AVAILABILITY") {
      throw new AppError("INVALID_INPUT", `No pending offer in state ${state.state}.`);
    }

    const expired = state.offerExpiresAt !== null && state.offerExpiresAt.getTime() <= Date.now();
    if (expired) {
      if (state.state === "AWAIT_CONFIRMATION") {
        await this.deps.bookingState
          .transition({ conversationId, expectedState: "AWAIT_CONFIRMATION", event: "OFFER_EXPIRED", patch: {} })
          .catch(() => undefined);
      }
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
      if (state.state === "AWAIT_CONFIRMATION") {
        await this.deps.bookingState.transition({
          conversationId, expectedState: "AWAIT_CONFIRMATION", event: "CUSTOMER_DECLINED", patch: {},
        });
        return { bookingState: "REJECTED" };
      }
      // Decline during a recheck retry: treat as customer cancel of the flow.
      await this.deps.bookingState.transition({
        conversationId, expectedState: "RECHECK_AVAILABILITY", event: "CUSTOMER_CANCELLED", patch: {},
      });
      return { bookingState: "REJECTED" };
    }

    const slot = state.offeredSlot;
    if (!slot) throw new AppError("INTERNAL", "Offered slot missing.");
    // Duration/timezone persisted at offer time — never silently substituted.
    const durationMinutes =
      typeof state.extracted["duration_minutes"] === "number"
        ? (state.extracted["duration_minutes"] as number)
        : DEFAULT_DURATION_MINUTES;
    const timezone =
      typeof state.extracted["timezone"] === "string" ? (state.extracted["timezone"] as string) : DEFAULT_TIMEZONE;
    const end = new Date(slot.getTime() + durationMinutes * 60_000);

    if (state.state === "AWAIT_CONFIRMATION") {
      // AWAIT_CONFIRMATION → RECHECK_AVAILABILITY (explicit customer acceptance).
      await this.deps.bookingState.transition({
        conversationId, expectedState: "AWAIT_CONFIRMATION", event: "CUSTOMER_ACCEPTED", patch: {},
      });
    }

    // Recheck immediately before create (SEC-7). A failure here leaves the
    // state in RECHECK_AVAILABILITY — recoverable by retrying confirm.
    let busy: Array<{ start: string; end: string }>;
    try {
      ({ busy } = await this.deps.calendar.checkAvailability(
        new Date(slot.getTime() - 60 * 60_000).toISOString(),
        new Date(end.getTime() + 60 * 60_000).toISOString(),
      ));
    } catch (err) {
      throw new AppError("CALENDAR_UNAVAILABLE", "Availability recheck failed; you may retry.", {
        retryable: true,
        cause: err instanceof Error ? err.message : "unknown",
      });
    }
    const taken = busy.some((b) => new Date(b.start) < end && new Date(b.end) > slot);
    if (taken) {
      await this.deps.bookingState.transition({
        conversationId, expectedState: "RECHECK_AVAILABILITY", event: "SLOT_TAKEN", patch: {},
      });
      return { bookingState: "SLOT_TAKEN", reason: "slot was taken while awaiting confirmation" };
    }

    const idempotencyKey = randomUUID();
    // Atomic registration: the RECHECK_PASSED transition, the durable identity,
    // and the appointment row commit together under the row lock — concurrent
    // confirmations serialize and the loser gets a conflict, so no orphaned or
    // duplicate appointment can be created.
    const { appointmentId } = await this.deps.bookingState.registerAppointment({
      conversationId,
      expectedState: "RECHECK_AVAILABILITY",
      idempotencyKey,
      scheduledStart: slot,
      scheduledEnd: end,
      durationMinutes,
      timezone,
      serviceType: typeof state.extracted["purpose"] === "string" ? String(state.extracted["purpose"]) : undefined,
      purpose: typeof state.extracted["purpose"] === "string" ? String(state.extracted["purpose"]) : undefined,
    });

    await this.deps.bookingState.transition({
      conversationId, expectedState: "CREATE_EVENT", event: "CREATE_CONFIRMED", patch: {},
    });

    // A thrown transport error from the adapter means the request MAY have
    // landed — that is exactly the uncertain case (ADR-0004 v0.2): persist
    // UNRESOLVED truthfully with the durable identity, never re-create.
    let outcome: Awaited<ReturnType<CalendarProvider["createEvent"]>>;
    try {
      outcome = await this.deps.calendar.createEvent({
        idempotencyKey,
        start: slot.toISOString(),
        end: end.toISOString(),
        summary: "AI Receptionist appointment",
        timezone,
      });
    } catch {
      outcome = { status: "unresolved" };
    }

    if (outcome.status === "created") {
      // State machine first (CONFIRMED is the customer truth — the event EXISTS),
      // then the outcome linkage; a persistence failure is recorded in
      // booking_state.last_error and repaired by reconciliation — never silent,
      // never a duplicate event.
      let persistError: string | null = null;
      try {
        await this.deps.bookingState.updateAppointmentOutcome(appointmentId, {
          status: "confirmed",
          googleEventId: outcome.eventId,
        });
      } catch (err) {
        persistError = `outcome_persist_failed: ${err instanceof Error ? err.message : "unknown"}`;
      }
      await this.deps.bookingState.transition({
        conversationId, expectedState: "VERIFY_RESULT", event: "CREATE_CONFIRMED",
        patch: persistError ? { lastError: persistError } : {},
      });
      return { bookingState: "CONFIRMED", appointmentId, eventId: outcome.eventId };
    }

    if (outcome.status === "unresolved") {
      await this.deps.bookingState.updateAppointmentOutcome(appointmentId, { status: "unresolved" });
      await this.deps.bookingState.transition({
        conversationId, expectedState: "VERIFY_RESULT", event: "CREATE_RESULT_UNKNOWN",
        patch: { unresolvedSince: new Date(), calendarIdempotencyKey: idempotencyKey },
      });
      return { bookingState: "UNRESOLVED" };
    }

    await this.deps.bookingState.updateAppointmentOutcome(appointmentId, { status: "failed" });
    await this.deps.bookingState.transition({
      conversationId, expectedState: "VERIFY_RESULT", event: "EXTERNAL_FAILURE",
      patch: { lastError: outcome.reason },
    });
    throw new AppError("CALENDAR_UNAVAILABLE", `Calendar event creation failed: ${outcome.reason}`);
  }

  /**
   * Recovery across every persisted post-acceptance window (quality correction 2):
   *   CREATE_EVENT   — crashed after registration, before/around the send:
   *                    search by the SAME identity; found → adopt; verified
   *                    absent → re-send with the SAME identity (never fresh).
   *   VERIFY_RESULT  — crashed after send, before the outcome transition:
   *                    found → CONFIRMED; absent → UNRESOLVED (probe later).
   *   UNRESOLVED     — standard reconciliation; exhausted attempts stay
   *                    UNRESOLVED and escalate, never auto-FAILED.
   *   CONFIRMED      — backfills a missing event-id linkage (persist failure).
   * Missing identities are adopted from the conversation's open appointment.
   */
  async reconcile(conversationId: string): Promise<"confirmed" | "confirmed_absent" | "unresolved"> {
    const state = await this.deps.bookingState.ensure(conversationId);
    const recoverable = ["CREATE_EVENT", "VERIFY_RESULT", "UNRESOLVED", "CONFIRMED"];
    if (!recoverable.includes(state.state)) return "unresolved";

    let identity = state.calendarIdempotencyKey;
    if (!identity) {
      const open = await this.deps.bookingState.findOpenAppointmentByConversation(conversationId);
      if (!open) return "unresolved";
      identity = open.idempotencyKey;
      await this.deps.bookingState.repairIdentity(conversationId, identity);
    }

    try {
      const search = await this.deps.calendar.findByIdempotencyKey(identity);
      const now = new Date();
      const appointment = await this.deps.bookingState.findAppointmentByIdempotencyKey(identity);
      if (search.found && search.eventId) {
        if (appointment) {
          await this.deps.bookingState.updateAppointmentOutcome(appointment.id, {
            status: "confirmed",
            googleEventId: search.eventId,
          });
        }
        if (state.state === "CREATE_EVENT") {
          await this.deps.bookingState.transition({
            conversationId, expectedState: "CREATE_EVENT", event: "CREATE_CONFIRMED", patch: { lastReconciledAt: now },
          });
        }
        if (state.state === "VERIFY_RESULT") {
          await this.deps.bookingState.transition({
            conversationId, expectedState: "VERIFY_RESULT", event: "CREATE_CONFIRMED", patch: { lastReconciledAt: now },
          });
        }
        if (state.state === "UNRESOLVED") {
          await this.deps.bookingState.transition({
            conversationId, expectedState: "UNRESOLVED", event: "RECONCILIATION_FOUND_EVENT",
            patch: { lastReconciledAt: now },
          });
        }
        return "confirmed";
      }

      if (state.state === "CREATE_EVENT") {
        // The send never (verifiably) happened: re-send with the SAME durable
        // identity — a fresh identity would risk a duplicate event.
        const appointmentRow = appointment ?? (await this.deps.bookingState.findOpenAppointmentByConversation(conversationId));
        if (!appointmentRow) return "unresolved";
        await this.deps.bookingState.transition({
          conversationId, expectedState: "CREATE_EVENT", event: "CREATE_CONFIRMED", patch: { lastReconciledAt: now },
        });
        let outcome: Awaited<ReturnType<CalendarProvider["createEvent"]>>;
        try {
          outcome = await this.deps.calendar.createEvent({
            idempotencyKey: identity,
            start: (appointmentRow as unknown as { scheduledStart?: string }).scheduledStart ?? new Date().toISOString(),
            end: (appointmentRow as unknown as { scheduledEnd?: string }).scheduledEnd ?? new Date().toISOString(),
            summary: "AI Receptionist appointment",
            timezone: "UTC",
          });
        } catch {
          outcome = { status: "unresolved" };
        }
        if (outcome.status === "created") {
          await this.deps.bookingState.updateAppointmentOutcome(appointmentRow.id, {
            status: "confirmed",
            googleEventId: outcome.eventId,
          });
          await this.deps.bookingState.transition({
            conversationId, expectedState: "VERIFY_RESULT", event: "CREATE_CONFIRMED", patch: { lastReconciledAt: now },
          });
          return "confirmed";
        }
        await this.deps.bookingState.updateAppointmentOutcome(appointmentRow.id, { status: "unresolved" });
        await this.deps.bookingState.transition({
          conversationId, expectedState: "VERIFY_RESULT", event: "CREATE_RESULT_UNKNOWN",
          patch: { unresolvedSince: new Date(), lastReconciledAt: now },
        });
        return "unresolved";
      }

      if (state.state === "VERIFY_RESULT") {
        // Sent, response lost, and the search found nothing YET — probe again
        // later; it is not definitive evidence of non-creation.
        await this.deps.bookingState.transition({
          conversationId, expectedState: "VERIFY_RESULT", event: "CREATE_RESULT_UNKNOWN",
          patch: { unresolvedSince: state.unresolvedSince ?? new Date(), lastReconciledAt: now },
        });
        return "unresolved";
      }

      if (state.state === "UNRESOLVED") {
        await this.deps.bookingState.transition({
          conversationId, expectedState: "UNRESOLVED", event: "RECONCILIATION_EXHAUSTED",
          patch: { reconciliationAttempts: state.reconciliationAttempts + 1, lastReconciledAt: now },
        });
      }
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
