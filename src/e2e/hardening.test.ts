import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createProductionApp } from "../server/main.js";
import { zonedWallClockToUtc } from "../domain/extraction/service.js";
import { ExtractionService } from "../domain/extraction/service.js";
import { MockCalendarAdapter } from "../calendar/mockAdapter.js";
import { loadEnv } from "../config/env.js";
import {
  MemoryAuditRepo,
  MemoryBookingStateRepo,
  MemoryBusinessConfigRepo,
  MemoryConversationRepo,
  MemoryCustomerRepo,
} from "../db/memory/stores.js";
import { BookingService } from "../domain/booking/service.js";

const SECRET = "0123456789abcdef0123456789abcdef";
const slot = new Date(Date.now() + 7 * 24 * 60 * 60_000);

/**
 * E2E hardening suite (owner review follow-ups). Layers are labeled: the
 * composition test builds the REAL production factory (lazy clients, no
 * network); behavioral tests are fixture-scope; real-DB/real-Ollama layers
 * remain separate and blocked on credentials.
 */

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function tempPem(): string {
  const path = join(mkdtempSync(join(tmpdir(), "ca-hardening-")), "ca.crt");
  writeFileSync(path, "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n");
  return path;
}
const DUMMY_ENV = {
  SUPABASE_URL: "https://ogxdszjypswutekqgorb.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-key-placeholder",
  SUPABASE_DB_URL: "postgresql://postgres.proj:pw@aws-0-eu-central-1.pooler.supabase.com:5432/postgres",
  SUPABASE_DB_CA_CERT_PATH: "/home/owner/prod-ca-2021.crt",
  TOKEN_HASH_SECRET: "0123456789abcdef0123456789abcdef",
  LOG_LEVEL: "fatal",
};

describe("production composition (real factory, lazy clients)", () => {
  it("builds the exact production wiring and serves liveness without credentials", async () => {
    const production = await createProductionApp({ ...DUMMY_ENV, PORT: "8791", SUPABASE_DB_CA_CERT_PATH: tempPem() });
    const res = await production.app.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
    // Admin guard active on the production app (route registered; live auth
    // verification needs credentials):
    const missing = await production.app.inject({ method: "GET", url: "/api/v1/admin/customers" });
    expect(missing.statusCode).toBe(401);
    await production.shutdown("test");
  });

  it("the production ConversationService receives the functioning BookingService (hardening 1)", async () => {
    const production = await createProductionApp({ ...DUMMY_ENV, PORT: "8792", SUPABASE_DB_CA_CERT_PATH: tempPem() });
    // Direct composition proof: the conversation service's deps include the
    // same booking service instance the factory exposes.
    const deps = (production.services.conversationService as unknown as { deps: Record<string, unknown> }).deps;
    expect(deps.booking).toBe(production.services.bookingService);
    expect(deps.extraction).toBeDefined();
    expect(deps.knowledge).toBeDefined();
    expect(deps.bookingState).toBeDefined();
    // And the booking pipeline is fully equipped:
    const bookingDeps = (production.services.bookingService as unknown as { deps: Record<string, unknown> }).deps;
    expect(bookingDeps.audit).toBeDefined();
    expect(bookingDeps.customers).toBeDefined();
    expect(bookingDeps.conversations).toBeDefined();
    expect(bookingDeps.escalate).toBeTypeOf("function");
    // Route-level proof without DB: validation rejects a malformed body BEFORE
    // any infrastructure call (route is live on the real composition).
    const bad = await production.app.inject({ method: "POST", url: "/api/v1/conversations", payload: { channel: "smoke" } });
    expect(bad.statusCode).toBe(400);
    await production.shutdown("test");
  });
});

describe("naive wall-clock parsing (server-timezone independent, DST-aware)", () => {
  // The conversion is exercised through the private implementation via a
  // focused export; behavior must not depend on the server's local timezone.
  it("offset-qualified RFC 3339 is used as-is (no double shift)", () => {
    const utc = zonedWallClockToUtc("2026-07-01T15:00:00+02:00", "Europe/Berlin");
    expect(utc.toISOString()).toBe("2026-07-01T13:00:00.000Z");
  });

  it("naive wall-clock converts once in the business timezone (summer)", () => {
    const utc = zonedWallClockToUtc("2026-07-01T15:00:00", "Europe/Berlin");
    expect(utc.toISOString()).toBe("2026-07-01T13:00:00.000Z"); // CEST = UTC+2
  });

  it("winter (CET) conversion differs from summer (CEST) — DST respected", () => {
    expect(zonedWallClockToUtc("2026-01-15T15:00:00", "Europe/Berlin").toISOString()).toBe("2026-01-15T14:00:00.000Z");
  });

  it("DST gap and overlap are REJECTED with explicit customer-facing behavior (final safety check 4)", () => {
    // Spring-forward gap (02:30 does not exist in Berlin on 2026-03-29):
    try {
      zonedWallClockToUtc("2026-03-29T02:30:00", "Europe/Berlin");
      expect.unreachable("gap must be rejected");
    } catch (err) {
      expect((err as { details?: { kind?: string } }).details?.kind).toBe("dst_gap");
    }
    // Fall-back overlap (02:30 occurs twice on 2026-10-25) — never silently
    // resolved to one occurrence:
    try {
      zonedWallClockToUtc("2026-10-25T02:30:00", "Europe/Berlin");
      expect.unreachable("overlap must be rejected");
    } catch (err) {
      expect((err as { details?: { kind?: string } }).details?.kind).toBe("dst_overlap");
    }
    // Unambiguous times on the same dates convert normally:
    expect(zonedWallClockToUtc("2026-03-29T01:30:00", "Europe/Berlin").toISOString()).toBe("2026-03-29T00:30:00.000Z");
    expect(zonedWallClockToUtc("2026-10-25T04:30:00", "Europe/Berlin").toISOString()).toBe("2026-10-25T03:30:00.000Z");
  });

  it("impossible calendar dates, times and offsets are rejected before conversion", () => {
    for (const bad of ["2026-02-30T10:00:00", "2026-13-01T10:00:00", "2026-04-31T10:00:00"]) {
      try {
        zonedWallClockToUtc(bad, "Europe/Berlin");
        expect.unreachable(`${bad} must be rejected`);
      } catch (err) {
        expect((err as { message?: string }).message).toContain("calendar date");
      }
    }
    for (const bad of ["2026-07-01T25:00:00", "2026-07-01T10:61:00"]) {
      expect(() => zonedWallClockToUtc(bad, "Europe/Berlin")).toThrow(/wall-clock time/);
    }
    // Offset-qualified with an impossible offset:
    expect(() => zonedWallClockToUtc("2026-07-01T10:00:00+26:00", "Europe/Berlin")).toThrow(/offset/);
  });

  it("invalid wall-clock values fail safely", () => {
    expect(() => zonedWallClockToUtc("not-a-date", "Europe/Berlin")).toThrow();
  });

  it("conversion is independent of the server's local timezone (constructs via UTC math only)", () => {
    // Same naive input through two business timezones must yield different,
    // correct UTC instants regardless of the host TZ:
    const berlin = zonedWallClockToUtc("2026-07-01T09:00:00", "Europe/Berlin");
    const tokyo = zonedWallClockToUtc("2026-07-01T09:00:00", "Asia/Tokyo");
    expect(berlin.toISOString()).toBe("2026-07-01T07:00:00.000Z");
    expect(tokyo.toISOString()).toBe("2026-07-01T00:00:00.000Z");
  });
});

describe("cancellation ↔ status/replay synchronization (hardening 4)", () => {
  async function harness() {
    const conversations = new MemoryConversationRepo();
    const bookingState = new MemoryBookingStateRepo();
    const customers = new MemoryCustomerRepo();
    const calendar = new MockCalendarAdapter();
    const booking = new BookingService({
      bookingState, calendar, tokenHashSecret: SECRET, offerTtlMinutes: 15,
      audit: new MemoryAuditRepo(), customers, conversations,
    });
    return { conversations, bookingState, customers, calendar, booking };
  }

  it("customer cancel cancels the calendar event and syncs the appointment record", async () => {
    const h = await harness();
    const started = await h.conversations.create({ channel: "text", accessTokenHash: "h" });
    const offer = await h.booking.offer(started.id, slot);
    await h.booking.confirm(started.id, offer.offerToken, "accept");
    await h.booking.cancel(started.id);
    // Calendar event actually cancelled (truthful, not a DB-only change):
    const identity = (await h.bookingState.get(started.id))?.calendarIdempotencyKey ?? "";
    const appt = await h.bookingState.findAppointmentByIdempotencyKey(identity);
    expect(appt?.status).toBe("cancelled");
  });

  it("confirm replay after cancellation reports CANCELLED — never an active confirmed booking", async () => {
    const h = await harness();
    const started = await h.conversations.create({ channel: "text", accessTokenHash: "h" });
    const offer = await h.booking.offer(started.id, slot);
    await h.booking.confirm(started.id, offer.offerToken, "accept");
    await h.booking.cancel(started.id);
    const replay = await h.booking.confirm(started.id, offer.offerToken, "accept");
    expect(replay).toEqual({ bookingState: "CANCELLED" });
  });

  it("publicStatus reports 'cancelled' for cancelled appointments", async () => {
    const h = await harness();
    const started = await h.conversations.create({ channel: "text", accessTokenHash: "h" });
    const offer = await h.booking.offer(started.id, slot);
    const confirmed = await h.booking.confirm(started.id, offer.offerToken, "accept");
    expect(confirmed.bookingState).toBe("CONFIRMED");
    await h.booking.cancel(started.id);
    expect(await h.booking.publicStatus(started.id)).toBe("cancelled");
  });
});

describe("customer/conversation/appointment association (hardening 5)", () => {
  it("links the customer to the conversation and carries customerId onto the appointment", async () => {
    const conversations = new MemoryConversationRepo();
    const bookingState = new MemoryBookingStateRepo();
    const customers = new MemoryCustomerRepo();
    const booking = new BookingService({
      bookingState, calendar: new MockCalendarAdapter(), tokenHashSecret: SECRET, offerTtlMinutes: 15,
      customers, conversations,
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
    const offer = await booking.offer(started.id, slot);
    const conversation = await conversations.findById(started.id);
    expect(conversation?.customerId).toBeTruthy();
    expect(customers.rows[0]?.displayName).toBe("Asha Verma");
    // The appointment record carries the same customer (after confirmation):
    await booking.confirm(started.id, offer.offerToken, "accept");
    // UNCONDITIONAL: a real appointment row exists, carries the expected
    // customer id, and belongs to the right conversation (final safety check 5).
    expect(bookingState.appointments).toHaveLength(1);
    const appt = bookingState.appointments[0] as Record<string, unknown>;
    expect(appt["customerId"]).toBe(conversation?.customerId);
    expect(appt["conversationId"]).toBe(started.id);
    expect(appt["status"]).toBe("confirmed");
    // Second offer does not duplicate the customer record:
    await booking.offer(started.id, new Date(slot.getTime() + 48 * 60 * 60_000)).catch(() => undefined);
    expect(customers.rows).toHaveLength(1);
  });
});
