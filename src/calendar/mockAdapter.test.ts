import { describe, expect, it } from "vitest";
import { MockCalendarAdapter } from "./mockAdapter.js";

const draft = (idempotencyKey: string) => ({
  idempotencyKey,
  start: "2026-10-27T10:00:00Z",
  end: "2026-10-27T10:30:00Z",
  summary: "Consultation",
  timezone: "UTC",
});

describe("MockCalendarAdapter", () => {
  it("reports busy intervals overlapping the window", async () => {
    const adapter = new MockCalendarAdapter([{ start: "2026-10-27T09:30:00Z", end: "2026-10-27T10:15:00Z" }]);
    const { busy } = await adapter.checkAvailability("2026-10-27T09:00:00Z", "2026-10-27T11:00:00Z");
    expect(busy).toHaveLength(1);
  });

  it("is idempotent: duplicate create with the same key returns the SAME event (TC-06)", async () => {
    const adapter = new MockCalendarAdapter();
    const first = await adapter.createEvent(draft("key-1"));
    const second = await adapter.createEvent(draft("key-1"));
    expect(first).toEqual({ status: "created", eventId: "mock-event-1" });
    expect(second).toEqual({ status: "created", eventId: "mock-event-1" });
  });

  it("supports the unresolved → confirmed-absent path (fault injection, TC-36)", async () => {
    const adapter = new MockCalendarAdapter([], { createTimeoutAfterSend: true });
    await expect(adapter.createEvent(draft("key-2"))).rejects.toThrow("timeout-after-send");
    // Reconciliation search by the durable identity finds nothing → confirmed absence.
    const search = await adapter.findByIdempotencyKey("key-2");
    expect(search).toEqual({ found: false });
  });

  it("supports the unresolved → found path when the event did land", async () => {
    const adapter = new MockCalendarAdapter();
    await adapter.createEvent(draft("key-3"));
    const search = await adapter.findByIdempotencyKey("key-3");
    expect(search).toEqual({ found: true, eventId: "mock-event-1" });
  });

  it("cancels events and excludes them from availability", async () => {
    const adapter = new MockCalendarAdapter();
    const created = await adapter.createEvent(draft("key-4"));
    const cancelled = await adapter.cancelEvent(created.status === "created" ? created.eventId : "x");
    expect(cancelled).toEqual({ status: "cancelled" });
    const { busy } = await adapter.checkAvailability("2026-10-27T09:00:00Z", "2026-10-27T11:00:00Z");
    expect(busy).toHaveLength(0);
  });
});
