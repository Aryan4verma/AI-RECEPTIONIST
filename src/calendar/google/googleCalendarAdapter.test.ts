import { describe, expect, it } from "vitest";
import { GoogleCalendarAdapter, googleEventIdFor } from "./googleCalendarAdapter.js";
import { GoogleIntegrationService, GoogleNotConnectedError } from "./integration.js";
import { GOOGLE_TOKEN_ENDPOINT } from "./oauth.js";
import { MemoryAuditRepo } from "../../db/memory/stores.js";
import { MemoryGoogleIntegrationStore } from "./store.js";
import { createSecretStore } from "../../secrets/store.js";
import type { CalendarProvider } from "../types.js";

/**
 * Fault-injection tests for the Google adapter — honest outcome mapping
 * (created / unresolved / failed, found / verified_absent / inconclusive)
 * with a scripted fetchFn. No network.
 */

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

interface Route {
  match: (url: string, init: RequestInit) => boolean;
  respond: (init: RequestInit) => Response | Promise<Response>;
}

function makeAdapter(routes: Route[], opts: { dropNetwork?: boolean } = {}) {
  const store = new MemoryGoogleIntegrationStore();
  const audit = new MemoryAuditRepo();
  const stored: Array<{ id: string; secret: string }> = [];
  const secretStore = createSecretStore(
    { kind: "vault", verify: async () => ({ ok: true }) },
    {
      create: async (secret) => {
        stored.push({ id: `v${stored.length}`, secret });
        return `v${stored.length - 1}`;
      },
      decrypt: async (id) => stored.find((s) => s.id === id)?.secret ?? "rt",
      delete: async () => undefined,
    },
  );
  let tokenCall = 0;
  // Integration-layer fetch: token endpoints + a clean connect-phase
  // calendarList verification (per-test routes must not break connect()).
  const integrationFetch = (async (url: string | URL, init: RequestInit = {}) => {
    const u = String(url);
    if (u === GOOGLE_TOKEN_ENDPOINT) {
      tokenCall += 1;
      // First call: OAuth exchange; later: refresh.
      return jsonResponse(200, tokenCall === 1
        ? { access_token: "at-1", expires_in: 3600, refresh_token: "rt-1" }
        : { access_token: `at-${tokenCall}`, expires_in: 3600 });
    }
    if (u.includes("/users/me/calendarList/")) return jsonResponse(200, { accessRole: "owner" });
    return jsonResponse(500, { error: "unscripted" });
  }) as typeof fetch;
  // Adapter-layer fetch: per-test routes first; calendarList defaults to
  // owner/200 but can be overridden (healthCheck tests); dropNetwork hits
  // unscripted Calendar calls only.
  const fetchFn = (async (url: string | URL, init: RequestInit = {}) => {
    const u = String(url);
    for (const r of routes) if (r.match(u, init)) return r.respond(init);
    if (opts.dropNetwork) throw new Error("ECONNRESET");
    if (u.includes("/users/me/calendarList/")) return jsonResponse(200, { accessRole: "owner" });
    return jsonResponse(500, { error: "unscripted" });
  }) as typeof fetch;
  const integration = new GoogleIntegrationService({
    store,
    secretStore,
    audit,
    creds: { clientId: "cid", clientSecret: "csec", redirectUri: "http://localhost:8787/api/v1/admin/integrations/google/callback", calendarId: "cal@test" },
    fetchFn: integrationFetch,
    now: () => 1_000_000,
  });
  const adapter: CalendarProvider = new GoogleCalendarAdapter({ integration, calendarId: "cal@test", fetchFn });
  const connect = async () => {
    const { authUrl } = await integration.beginConnect("a");
    const state = new URL(authUrl).searchParams.get("state") as string;
    await integration.handleCallback({ code: "c", state });
  };
  return { adapter, integration, connect, routes, audit, store };
}

const draft = {
  idempotencyKey: "9f1d2a4b-1234-4abc-8def-001122334455",
  start: "2026-11-14T09:00:00.000Z",
  end: "2026-11-14T09:45:00.000Z",
  summary: "AI Receptionist appointment",
  timezone: "Europe/Berlin",
};

describe("GoogleCalendarAdapter", () => {
  it("freeBusy parses the dedicated calendar's intervals", async () => {
    const { adapter, connect } = makeAdapter([
      {
        match: (u) => u.endsWith("/freeBusy"),
        respond: (_init: RequestInit) => jsonResponse(200, { calendars: { "cal@test": { busy: [{ start: "2026-11-14T08:00:00Z", end: "2026-11-14T08:30:00Z" }] } } }),
      },
    ]);
    await connect();
    const { busy } = await adapter.checkAvailability("2026-11-14T07:00:00Z", "2026-11-14T10:00:00Z");
    expect(busy).toEqual([{ start: "2026-11-14T08:00:00Z", end: "2026-11-14T08:30:00Z" }]);
  });

  it("checkAvailability surfaces transport failure as CALENDAR_UNAVAILABLE (BookingService keeps RECHECK_AVAILABILITY recoverable)", async () => {
    const { adapter, connect } = makeAdapter([], { dropNetwork: true });
    await connect();
    await expect(adapter.checkAvailability("2026-11-14T07:00:00Z", "2026-11-14T10:00:00Z")).rejects.toMatchObject({ code: "CALENDAR_UNAVAILABLE" });
  });

  it("createEvent returns created and reuses the SAME event id on replay (409 → GET → created, never a duplicate)", async () => {
    const getCalls: string[] = [];
    const { adapter, connect } = makeAdapter([
      {
        match: (u, init) => u.includes("/events") && init.method === "POST",
        respond: (_init: RequestInit) => jsonResponse(409, { error: { code: 409, message: "The requested identifier already exists" } }),
      },
      {
        match: (u) => {
          if (u.includes("/events/c1")) getCalls.push(u);
          return u.includes("/events/c1");
        },
        respond: (_init: RequestInit) => jsonResponse(200, { id: "c19f1d2a4b12344abc8def001122334455" }),
      },
    ]);
    await connect();
    const first = await adapter.createEvent(draft);
    const second = await adapter.createEvent(draft);
    expect(first).toEqual({ status: "created", eventId: "c19f1d2a4b12344abc8def001122334455" });
    expect(second).toEqual(first);
    expect(getCalls.length).toBeGreaterThanOrEqual(2);
  });

  it("createEvent THROWS on a lost response (network drop) — BookingService maps thrown transport errors to UNRESOLVED, matching the mock adapter contract", async () => {
    const { adapter, connect } = makeAdapter([], { dropNetwork: true });
    await connect();
    await expect(adapter.createEvent(draft)).rejects.toThrow("ECONNRESET");
  });

  it("createEvent maps 5xx and 429 to unresolved, definite 4xx rejections to failed", async () => {
    for (const status of [500, 503, 429]) {
      const { adapter, connect } = makeAdapter([{ match: (u, i) => i.method === "POST", respond: (_init: RequestInit) => jsonResponse(status, {}) }]);
      await connect();
      await expect(adapter.createEvent(draft)).resolves.toEqual({ status: "unresolved" });
    }
    const a2 = makeAdapter([{ match: (u, i) => i.method === "POST", respond: (_init: RequestInit) => jsonResponse(400, {}) }]);
    await a2.connect();
    await expect(a2.adapter.createEvent(draft)).resolves.toMatchObject({ status: "failed" });
  });

  it("createEvent without a connection reports a definite failed outcome (nothing was sent)", async () => {
    const { adapter } = makeAdapter([]);
    await expect(adapter.createEvent(draft)).resolves.toEqual({ status: "failed", reason: "Google Calendar is not connected" });
  });

  it("findByIdempotencyKey: found on 200; two consecutive 404s (settle window) → verified_absent; transport → inconclusive", async () => {
    const found = makeAdapter([
      { match: (u) => u.includes("/events/c1"), respond: (_init: RequestInit) => jsonResponse(200, { id: "c19f1d2a4b12344abc8def001122334455" }) },
    ]);
    await found.connect();
    await expect(found.adapter.findByIdempotencyKey(draft.idempotencyKey)).resolves.toEqual({
      status: "found",
      eventId: "c19f1d2a4b12344abc8def001122334455",
    });

    const absent = makeAdapter([{ match: (u) => u.includes("/events/c1"), respond: (_init: RequestInit) => jsonResponse(404, {}) }]);
    await absent.connect();
    await expect(absent.adapter.findByIdempotencyKey(draft.idempotencyKey)).resolves.toEqual({ status: "verified_absent" });

    const broken = makeAdapter([], { dropNetwork: true });
    await broken.connect();
    await expect(broken.adapter.findByIdempotencyKey(draft.idempotencyKey)).resolves.toEqual({ status: "inconclusive" });
  });

  it("cancelEvent: 204/404/410 all mean gone (cancelled); network drop stays unresolved", async () => {
    for (const status of [204, 404, 410]) {
      const { adapter, connect } = makeAdapter([{ match: (u, i) => i.method === "DELETE", respond: (_init: RequestInit) => jsonResponse(status, {}) }]);
      await connect();
      await expect(adapter.cancelEvent("evt-1")).resolves.toEqual({ status: "cancelled" });
    }
    const dropped = makeAdapter([], { dropNetwork: true });
    await dropped.connect();
    await expect(dropped.adapter.cancelEvent("evt-1")).resolves.toMatchObject({ status: "unresolved" });
  });

  it("rescheduleEvent: 200 rescheduled; 404 failed not-found; 5xx unresolved", async () => {
    const ok = makeAdapter([{ match: (u, i) => i.method === "PATCH", respond: (_init: RequestInit) => jsonResponse(200, {}) }]);
    await ok.connect();
    await expect(ok.adapter.rescheduleEvent("evt-1", "2026-11-15T09:00:00Z", "2026-11-15T09:45:00Z")).resolves.toEqual({ status: "rescheduled" });

    const missing = makeAdapter([{ match: (u, i) => i.method === "PATCH", respond: (_init: RequestInit) => jsonResponse(404, {}) }]);
    await missing.connect();
    await expect(missing.adapter.rescheduleEvent("evt-1", "2026-11-15T09:00:00Z", "2026-11-15T09:45:00Z")).resolves.toMatchObject({ status: "failed" });

    const down = makeAdapter([{ match: (u, i) => i.method === "PATCH", respond: (_init: RequestInit) => jsonResponse(500, {}) }]);
    await down.connect();
    await expect(down.adapter.rescheduleEvent("evt-1", "2026-11-15T09:00:00Z", "2026-11-15T09:45:00Z")).resolves.toEqual({ status: "unresolved" });
  });

  it("healthCheck proves read/write permission: owner ok, reader refused, missing calendar reported", async () => {
    const owner = makeAdapter([{ match: (u) => u.includes("/users/me/calendarList/"), respond: (_init: RequestInit) => jsonResponse(200, { accessRole: "owner" }) }]);
    await owner.connect();
    await expect(owner.adapter.healthCheck()).resolves.toEqual({ ok: true });

    const reader = makeAdapter([{ match: (u) => u.includes("/users/me/calendarList/"), respond: (_init: RequestInit) => jsonResponse(200, { accessRole: "reader" }) }]);
    await reader.connect();
    await expect(reader.adapter.healthCheck()).resolves.toMatchObject({ ok: false });

    const missing = makeAdapter([{ match: (u) => u.includes("/users/me/calendarList/"), respond: (_init: RequestInit) => jsonResponse(404, {}) }]);
    await missing.connect();
    await expect(missing.adapter.healthCheck()).resolves.toMatchObject({ ok: false });
  });

  it("a 401 on write triggers exactly one refresh + retry before reporting", async () => {
    let postCount = 0;
    const { adapter, connect, integration } = (() => {
      const store = new MemoryGoogleIntegrationStore();
      const audit = new MemoryAuditRepo();
      const secretStore = createSecretStore(
        { kind: "vault", verify: async () => ({ ok: true }) },
        { create: async () => "v0", decrypt: async () => "rt-1", delete: async () => undefined },
      );
      let tokenCall = 0;
      let connected = false;
      const integrationFetch = (async (url: string | URL, init: RequestInit = {}) => {
        const u = String(url);
        if (u === GOOGLE_TOKEN_ENDPOINT) {
          tokenCall += 1;
          return jsonResponse(200, tokenCall === 1
            ? { access_token: "stale", expires_in: 3600, refresh_token: "rt-1" }
            : { access_token: "fresh", expires_in: 3600 });
        }
        if (u.includes("/users/me/calendarList/")) return jsonResponse(200, { accessRole: "owner" });
        if (init.method === "POST") {
          postCount += 1;
          // First insert: stale token → 401. After refresh: 200.
          return jsonResponse(postCount === 1 ? 401 : 200, postCount === 1 ? {} : { id: "c19f1d2a4b12344abc8def001122334455" });
        }
        return jsonResponse(500, {});
      }) as typeof fetch;
      const integration = new GoogleIntegrationService({
        store, secretStore, audit,
        creds: { clientId: "cid", clientSecret: "csec", redirectUri: "http://localhost:8787/api/v1/admin/integrations/google/callback", calendarId: "cal@test" },
        fetchFn: integrationFetch,
        now: () => 1_000_000,
      });
      const adapter: CalendarProvider = new GoogleCalendarAdapter({ integration, calendarId: "cal@test", fetchFn: integrationFetch as typeof fetch });
      const connect = async () => {
        const { authUrl } = await integration.beginConnect("a");
        const state = new URL(authUrl).searchParams.get("state") as string;
        await integration.handleCallback({ code: "c", state });
        connected = true;
      };
      return { adapter, connect, integration, store, audit, connected };
    })() as { adapter: CalendarProvider; connect: () => Promise<void>; integration: GoogleIntegrationService };
    await connect();
    await expect(adapter.createEvent(draft)).resolves.toMatchObject({ status: "created" });
    expect(postCount).toBe(2);
    void integration;
  });

  it("every insert carries the deterministic event id and the idempotency extended property", async () => {
    let sentBody: Record<string, unknown> | null = null;
    const { adapter, connect } = makeAdapter([
      {
        match: (u, init) => u.includes("/events") && init.method === "POST",
        respond: (init: RequestInit) => {
          sentBody = JSON.parse(String(init.body)) as Record<string, unknown>;
          return jsonResponse(201, { id: sentBody?.["id"] });
        },
      },
    ]);
    await connect();
    const outcome = await adapter.createEvent(draft);
    expect(outcome).toEqual({ status: "created", eventId: "c19f1d2a4b12344abc8def001122334455" });
    const body = sentBody as unknown as Record<string, unknown>;
    expect(body?.["id"]).toBe("c19f1d2a4b12344abc8def001122334455");
    expect((body?.["extendedProperties"] as unknown as { private: { idempotencyKey: string } }).private.idempotencyKey).toBe(draft.idempotencyKey);
    expect((body?.["start"] as unknown as { timeZone: string }).timeZone).toBe("Europe/Berlin");
  });
});

describe("googleEventIdFor (Google base32hex contract)", () => {
  it("produces IDs matching Google's base32hex rule: [a-v0-9], length 5-1024", () => {
    const keys = [
      "9f1d2a4b-1234-4abc-8def-001122334455",
      "00000000-0000-0000-0000-000000000000",
      "ffffffff-ffff-ffff-ffff-ffffffffffff",
      "a-b-c-d-e",
      "wxyz wxyz", // out-of-range letters and a space must be stripped
    ];
    for (const key of keys) {
      const id = googleEventIdFor(key);
      expect(id).toMatch(/^[0-9a-v]{5,1024}$/);
    }
  });

  it("is deterministic and injective for UUID-shaped keys", () => {
    const a = "9f1d2a4b-1234-4abc-8def-001122334455";
    const b = "9f1d2a4b-1234-4abc-8def-001122334456";
    expect(googleEventIdFor(a)).toBe(googleEventIdFor(a)); // stable across restarts
    expect(googleEventIdFor(a)).not.toBe(googleEventIdFor(b));
    // The BookingService UUID shape survives fully (32 hex chars + 2 prefix).
    expect(googleEventIdFor(a)).toHaveLength(34);
    expect(googleEventIdFor(a)).toBe("c1" + a.replace(/-/g, ""));
  });
});

describe("FreeBusy hardening (corrective review)", () => {
  const okWindow = ["2026-11-14T07:00:00Z", "2026-11-14T10:00:00Z"] as const;

  it("a missing calendar entry is an availability failure, never an empty calendar", async () => {
    const { adapter, connect } = makeAdapter([
      { match: (u) => u.endsWith("/freeBusy"), respond: (_init) => jsonResponse(200, { calendars: {} }) },
    ]);
    await connect();
    await expect(adapter.checkAvailability(...okWindow)).rejects.toMatchObject({ code: "CALENDAR_UNAVAILABLE" });
  });

  it("a per-calendar error entry is an availability failure", async () => {
    const { adapter, connect } = makeAdapter([
      {
        match: (u) => u.endsWith("/freeBusy"),
        respond: (_init) => jsonResponse(200, { calendars: { "cal@test": { errors: [{ domain: "calendar", reason: "notFound" }], busy: [] } } }),
      },
    ]);
    await connect();
    await expect(adapter.checkAvailability(...okWindow)).rejects.toMatchObject({ code: "CALENDAR_UNAVAILABLE" });
  });

  it("malformed busy intervals are rejected, not silently filtered", async () => {
    for (const busy of [
      [{ start: 12, end: "2026-11-14T08:00:00Z" }],
      [{ start: "2026-11-14T08:00:00Z", end: "not-a-date" }],
      "garbage",
    ]) {
      const { adapter, connect } = makeAdapter([
        { match: (u) => u.endsWith("/freeBusy"), respond: (_init) => jsonResponse(200, { calendars: { "cal@test": { busy } } }) },
      ]);
      await connect();
      await expect(adapter.checkAvailability(...okWindow)).rejects.toMatchObject({ code: "CALENDAR_UNAVAILABLE" });
    }
  });

  it("missing busy array is rejected (unverified availability)", async () => {
    const { adapter, connect } = makeAdapter([
      { match: (u) => u.endsWith("/freeBusy"), respond: (_init) => jsonResponse(200, { calendars: { "cal@test": {} } }) },
    ]);
    await connect();
    await expect(adapter.checkAvailability(...okWindow)).rejects.toMatchObject({ code: "CALENDAR_UNAVAILABLE" });
  });
});
