import type {
  BusyInterval,
  CalendarEventDraft,
  CalendarProvider,
  CreateOutcome,
  IdempotencySearch,
} from "../types.js";
import { AppError } from "../../server/errors.js";
import { GoogleIntegrationService, GoogleNotConnectedError } from "./integration.js";

const CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3";
/** Settle window before a 404 on the deterministic event ID is trusted. */
const ABSENCE_SETTLE_MS = 1_000;

/**
 * GoogleCalendarAdapter (Stage 7, Q3-gated). Implements CalendarProvider
 * against one dedicated, pre-verified calendar through the owner's OAuth
 * connection. ADR-0004 v0.2 honesty contract per method:
 *
 * - createEvent: the durable idempotency key becomes a CLIENT-ASSIGNED event
 *   id (`cleardesk-<key>`) — Google's documented insert-dedupe mechanism. A
 *   409 "id already exists" is resolved by GETting that exact event and
 *   reporting it as created, so retries can never duplicate. Sent-but-lost
 *   requests (network error, 5xx, 429) return `unresolved` — never a guess.
 * - findByIdempotencyKey: events.get on the deterministic ID is a point read
 *   of our own ID-space. 404 after a settle window ⇒ `verified_absent`;
 *   anything else (transport, 5xx, not connected) ⇒ `inconclusive`.
 * - cancelEvent: DELETE is idempotent — 204/404/410 all mean "the event is
 *   gone", reported as `cancelled`; uncertainty stays `unresolved`.
 * - rescheduleEvent: PATCH 200 ⇒ rescheduled; the event missing is a
 *   definite `failed`; uncertainty stays `unresolved`.
 *
 * Definite rejections (4xx processed-and-refused) are `failed` with a safe
 * reason; never-sent or sent-but-unverified requests never claim an outcome.
 */
export class GoogleCalendarAdapter implements CalendarProvider {
  constructor(
    private readonly deps: {
      integration: GoogleIntegrationService;
      calendarId: string;
      fetchFn?: typeof fetch;
      now?: () => number;
    },
  ) {}

  /** Google event IDs: [a-z0-9_-]{5,1024}. UUID keys are already conformant. */
  private eventIdFor(idempotencyKey: string): string {
    const id = `cleardesk-${idempotencyKey.toLowerCase().replace(/[^a-z0-9_-]/g, "-")}`;
    return id.slice(0, 1024);
  }

  private async request(
    path: string,
    init: RequestInit,
    op: "read" | "write",
  ): Promise<{ status: number; body: unknown }> {
    let token = await this.deps.integration.getAccessToken();
    const url = `${CALENDAR_API_BASE}${path}`;
    const doFetch = async (t: string) =>
      (this.deps.fetchFn ?? fetch)(url, {
        ...init,
        headers: { ...init.headers, authorization: `Bearer ${t}` },
      });
    let res = await doFetch(token).catch((err: unknown) => {
      throw new TransportError(err instanceof Error ? err.message : "network error");
    });
    if (res.status === 401 && op === "write") {
      // Access token may have been revoked mid-flight: refresh once, retry once.
      this.deps.integration.invalidateAccessToken();
      token = await this.deps.integration.getAccessToken();
      res = await doFetch(token).catch((err: unknown) => {
        throw new TransportError(err instanceof Error ? err.message : "network error");
      });
    }
    if (res.status === 204) return { status: 204, body: null };
    const text = await res.text().catch(() => "");
    let body: unknown = null;
    try {
      body = text ? (JSON.parse(text) as unknown) : null;
    } catch {
      body = null;
    }
    return { status: res.status, body };
  }

  async checkAvailability(windowStart: string, windowEnd: string): Promise<{ busy: BusyInterval[] }> {
    const wStart = Date.parse(windowStart);
    const wEnd = Date.parse(windowEnd);
    if (Number.isNaN(wStart) || Number.isNaN(wEnd) || wEnd <= wStart) {
      throw new Error("invalid availability window");
    }
    const { status, body } = await this.request(
      `/freeBusy`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          timeMin: new Date(wStart).toISOString(),
          timeMax: new Date(wEnd).toISOString(),
          items: [{ id: this.deps.calendarId }],
        }),
      },
      "read",
    ).catch((err: unknown) => wrapUnavailable(err));
    if (status !== 200) throw new AppError("CALENDAR_UNAVAILABLE", "Google FreeBusy query failed.", { status }, false);
    const calendars = (body as { calendars?: Record<string, { busy?: BusyInterval[] }> } | null)?.calendars;
    const intervals = calendars?.[this.deps.calendarId]?.busy ?? [];
    return {
      busy: intervals
        .filter((b) => typeof b?.start === "string" && typeof b?.end === "string")
        .map((b) => ({ start: b.start, end: b.end })),
    };
  }

  async createEvent(draft: CalendarEventDraft): Promise<CreateOutcome> {
    const eventId = this.eventIdFor(draft.idempotencyKey);
    const eventBody = {
      id: eventId,
      summary: draft.summary,
      start: { dateTime: draft.start, timeZone: draft.timezone },
      end: { dateTime: draft.end, timeZone: draft.timezone },
      extendedProperties: { private: { idempotencyKey: draft.idempotencyKey } },
      // Owner bookkeeping: the receptionist created this event.
      description: "Booked by the Cleardesk AI receptionist.",
    };
    const { status, body } = await this.request(
      `/calendars/${encodeURIComponent(this.deps.calendarId)}/events`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(eventBody),
      },
      "write",
    ).catch((err: unknown) => {
      if (err instanceof GoogleNotConnectedError) {
        // Definite: nothing was sent, so nothing exists — a failed outcome is
        // the honest report, not uncertainty.
        return { status: -1, body: null };
      }
      throw err; // transport error → caller (BookingService) records UNRESOLVED
    });
    if (status === 200 || status === 201) {
      return { status: "created", eventId: String((body as { id?: string })?.id ?? eventId) };
    }
    if (status === 409) {
      // Deterministic-ID collision: the event already exists from a previous
      // attempt — idempotent replay returns the SAME event, never a duplicate.
      const found = await this.findByIdempotencyKey(draft.idempotencyKey);
      if (found.status === "found") return { status: "created", eventId: found.eventId };
      return { status: "unresolved" };
    }
    if (status === -1) return { status: "failed", reason: "Google Calendar is not connected" };
    if (status === 401 || status === 403) return { status: "failed", reason: "Google Calendar authorization rejected the request" };
    if (status === 400 || status === 404) return { status: "failed", reason: "Google Calendar rejected the event (invalid request)" };
    // 5xx / 429 / anything else: the request MAY have landed → uncertain.
    return { status: "unresolved" };
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<IdempotencySearch> {
    const eventId = this.eventIdFor(idempotencyKey);
    const attempt = async (): Promise<{ status: number; body: unknown } | null> => {
      try {
        return await this.request(
          `/calendars/${encodeURIComponent(this.deps.calendarId)}/events/${encodeURIComponent(eventId)}`,
          { method: "GET" },
          "read",
        );
      } catch {
        return null;
      }
    };
    const t0 = this.now();
    const first = await attempt();
    if (first === null) return { status: "inconclusive" };
    if (first.status === 200) return { status: "found", eventId: String((first.body as { id?: string })?.id ?? eventId) };
    if (first.status === 404) {
      // Settle window: a just-inserted event can briefly 404 on point reads.
      // Wait out the remainder, then trust a second consecutive 404.
      const elapsed = this.now() - t0;
      if (elapsed < ABSENCE_SETTLE_MS) await sleep(ABSENCE_SETTLE_MS - elapsed);
      const second = await attempt();
      if (second !== null && second.status === 404) return { status: "verified_absent" };
      if (second !== null && second.status === 200) return { status: "found", eventId };
      return { status: "inconclusive" };
    }
    return { status: "inconclusive" };
  }

  async cancelEvent(eventId: string): Promise<{ status: "cancelled" | "unresolved" | "failed"; reason?: string }> {
    try {
      const { status } = await this.request(
        `/calendars/${encodeURIComponent(this.deps.calendarId)}/events/${encodeURIComponent(eventId)}`,
        { method: "DELETE" },
        "write",
      );
      // 204 deleted; 404/410 already gone or cancelled — the desired end state
      // is achieved in all three (idempotent cancel, never a false claim).
      if (status === 204 || status === 404 || status === 410) return { status: "cancelled" };
      if (status === 403) return { status: "failed", reason: "Google Calendar denied the cancellation" };
      return { status: "unresolved" };
    } catch (err) {
      if (err instanceof GoogleNotConnectedError) return { status: "unresolved", reason: "Google Calendar is not connected" };
      return { status: "unresolved" };
    }
  }

  async rescheduleEvent(eventId: string, newStart: string, newEnd: string): Promise<{ status: "rescheduled" | "unresolved" | "failed"; reason?: string }> {
    try {
      const { status } = await this.request(
        `/calendars/${encodeURIComponent(this.deps.calendarId)}/events/${encodeURIComponent(eventId)}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ start: { dateTime: newStart }, end: { dateTime: newEnd } }),
        },
        "write",
      );
      if (status === 200) return { status: "rescheduled" };
      if (status === 404) return { status: "failed", reason: "event not found on the calendar" };
      if (status === 403) return { status: "failed", reason: "Google Calendar denied the change" };
      return { status: "unresolved" };
    } catch (err) {
      if (err instanceof GoogleNotConnectedError) return { status: "unresolved", reason: "Google Calendar is not connected" };
      return { status: "unresolved" };
    }
  }

  /** Read/write permission proof: calendarList entry with an owner/writer role. */
  async healthCheck(): Promise<{ ok: boolean; error?: string }> {
    try {
      const { status, body } = await this.request(
        `/users/me/calendarList/${encodeURIComponent(this.deps.calendarId)}`,
        { method: "GET" },
        "read",
      );
      if (status === 404) return { ok: false, error: "the dedicated calendar is not accessible to this account" };
      if (status === 401 || status === 403) return { ok: false, error: "Google authorization does not cover this calendar" };
      if (status !== 200) return { ok: false, error: `Google Calendar API returned ${status}` };
      const role = String((body as { accessRole?: string })?.accessRole ?? "reader");
      if (!["owner", "writer"].includes(role)) return { ok: false, error: `calendar is not writable (role: ${role})` };
      return { ok: true };
    } catch (err) {
      if (err instanceof GoogleNotConnectedError) return { ok: false, error: "Google Calendar is not connected" };
      return { ok: false, error: "Google Calendar is unreachable" };
    }
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }
}

class TransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransportError";
  }
}

function wrapUnavailable(err: unknown): never {
  if (err instanceof AppError || err instanceof GoogleNotConnectedError) throw err;
  throw new AppError("CALENDAR_UNAVAILABLE", "Google Calendar is unreachable.", {
    cause: err instanceof Error ? err.message : "unknown",
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
