import { describe, expect, it } from "vitest";
import { GoogleIntegrationService, GoogleNotConnectedError } from "./integration.js";
import { GOOGLE_CALENDAR_SCOPES, GOOGLE_REVOKE_ENDPOINT, GOOGLE_TOKEN_ENDPOINT } from "./oauth.js";
import { MemoryAuditRepo, MemoryBusinessConfigRepo } from "../../db/memory/stores.js";
import { createSecretStore } from "../../secrets/store.js";
import { AppError } from "../../server/errors.js";

/**
 * Google integration lifecycle tests with an injected fetchFn — no network.
 * Covers CSRF state (single-use, expiry, forgery), least-privilege scopes,
 * the unwritable-calendar rejection, fail-closed credential storage, token
 * refresh + rotation, revoked-access handling, and disconnect cleanup.
 */

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

interface DepsOpts {
  secretState?: "vault" | "disabled";
  calendarListRole?: string;
  calendarListStatus?: number;
  /** Token-endpoint responses in call order; the last one repeats. */
  tokenResponses?: Array<{ status: number; body: Record<string, unknown> }>;
}

function makeDeps(opts: DepsOpts = {}) {
  const config = new MemoryBusinessConfigRepo();
  const audit = new MemoryAuditRepo();
  const stored: Array<{ id: string; secret: string }> = [];
  const secretStore =
    opts.secretState === "disabled"
      ? createSecretStore({ kind: "disabled", reason: "test-disabled" })
      : createSecretStore(
          { kind: "vault", verify: async () => ({ ok: true }) },
          {
            create: async (secret) => {
              const id = `vault-${stored.length + 1}`;
              stored.push({ id, secret });
              return id;
            },
            decrypt: async (id) => stored.find((s) => s.id === id)?.secret ?? (() => { throw new Error("secret not found"); })(),
            delete: async (id) => {
              const i = stored.findIndex((s) => s.id === id);
              if (i >= 0) stored.splice(i, 1);
            },
          },
        );
  const tokenResponses = opts.tokenResponses ?? [{ status: 200, body: { access_token: "at-1", expires_in: 3600, refresh_token: "rt-1" } }];
  let tokenCall = 0;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchFn = (async (url: string | URL, init: RequestInit = {}) => {
    const u = String(url);
    calls.push({ url: u, init });
    if (u === GOOGLE_TOKEN_ENDPOINT) {
      const r = tokenResponses[Math.min(tokenCall, tokenResponses.length - 1)] as { status: number; body: Record<string, unknown> };
      tokenCall += 1;
      return jsonResponse(r.status, r.body);
    }
    if (u.includes("/users/me/calendarList/")) {
      return jsonResponse(opts.calendarListStatus ?? 200, { accessRole: opts.calendarListRole ?? "owner" });
    }
    return jsonResponse(500, {});
  }) as typeof fetch;
  const service = new GoogleIntegrationService({
    config,
    secretStore,
    audit,
    creds: {
      clientId: "cid",
      clientSecret: "csec",
      redirectUri: "http://localhost:8787/api/v1/admin/integrations/google/callback",
      calendarId: "test-cal@group.calendar.google.com",
    },
    fetchFn,
    now: () => 1_000_000,
  });
  return { service, config, audit, stored, calls };
}

async function connectThrough(service: GoogleIntegrationService): Promise<string> {
  const { authUrl } = await service.beginConnect("admin-1");
  return new URL(authUrl).searchParams.get("state") as string;
}

describe("GoogleIntegrationService", () => {
  it("builds a least-privilege authorization URL with a state nonce and audits the attempt", async () => {
    const { service, audit } = makeDeps();
    const { authUrl } = await service.beginConnect("admin-1");
    const url = new URL(authUrl);
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("scope")?.split(" ")).toEqual([...GOOGLE_CALENDAR_SCOPES]);
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:8787/api/v1/admin/integrations/google/callback");
    expect(url.searchParams.get("state")).toBeTruthy();
    expect(audit.entries.some((e) => e.action === "google_calendar.connect_started")).toBe(true);
  });

  it("completes the callback: verifies the calendar is writable, stores the refresh token ONLY in the secret store", async () => {
    const { service, config, stored, calls } = makeDeps();
    const state = await connectThrough(service);
    const result = await service.handleCallback({ code: "auth-code", state }, "admin-1");
    expect(result).toEqual({ connected: true, calendarId: "test-cal@group.calendar.google.com", accessRole: "owner" });
    expect(stored).toHaveLength(1);
    expect(stored[0]?.secret).toBe("rt-1");
    // Persisted state carries only the opaque ref — never token material.
    const persisted = JSON.stringify((await config.latest("google_calendar_integration"))?.content);
    expect(persisted).not.toContain("rt-1");
    expect(persisted).not.toContain("at-1");
    expect(persisted).toContain('"credentialRef":"vault-1"');
    // The code exchange hit Google's FIXED token endpoint.
    expect(calls.some((c) => c.url === GOOGLE_TOKEN_ENDPOINT)).toBe(true);
  });

  it("rejects state replay (single use), forged states and expired states", async () => {
    const { service } = makeDeps();
    const state = await connectThrough(service);
    await service.handleCallback({ code: "c1", state }, null);
    await expect(service.handleCallback({ code: "c2", state }, null)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(service.handleCallback({ code: "c", state: "forged" }, null)).rejects.toMatchObject({ code: "FORBIDDEN" });

    const { service: svc2 } = makeDeps();
    const s2 = await connectThrough(svc2);
    // Expire the nonce: ttl is 10 minutes from the fixed clock.
    (svc2 as unknown as { pendingStates: Map<string, number> }).pendingStates.set(s2, 999_999);
    await expect(svc2.handleCallback({ code: "c", state: s2 }, null)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects the connection when the calendar is not writable — and revokes the issued token", async () => {
    const { service, config, calls } = makeDeps({ calendarListRole: "reader" });
    const state = await connectThrough(service);
    await expect(service.handleCallback({ code: "c", state }, null)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await config.latest("google_calendar_integration"))?.content?.["connected"]).toBeUndefined();
    expect(calls.some((c) => c.url === GOOGLE_REVOKE_ENDPOINT)).toBe(true);
  });

  it("fails the connect flow closed when credential storage is disabled", async () => {
    const { service, config } = makeDeps({ secretState: "disabled" });
    const state = await connectThrough(service);
    await expect(service.handleCallback({ code: "c", state }, null)).rejects.toMatchObject({ code: "CREDENTIAL_STORE_UNAVAILABLE" });
    expect((await config.latest("google_calendar_integration"))?.content?.["connected"]).toBeUndefined();
  });

  it("caches access tokens and re-stores rotated refresh tokens", async () => {
    const { service, stored, config } = makeDeps({
      tokenResponses: [
        { status: 200, body: { access_token: "at-exchange", expires_in: 3600, refresh_token: "rt-original" } },
        { status: 200, body: { access_token: "at-refreshed", expires_in: 3600, refresh_token: "rt-rotated" } },
      ],
    });
    const state = await connectThrough(service);
    await service.handleCallback({ code: "c", state }, null);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.secret).toBe("rt-original");
    service.invalidateAccessToken(); // the callback cached at-exchange — force refresh
    expect(await service.getAccessToken()).toBe("at-refreshed");
    expect(await service.getAccessToken()).toBe("at-refreshed"); // cached, no second refresh
    // Rotation: the new refresh token was stored and the state ref re-pointed.
    expect(stored).toHaveLength(2);
    expect(stored[1]?.secret).toBe("rt-rotated");
    const persisted = (await config.latest("google_calendar_integration"))?.content as Record<string, unknown>;
    expect(persisted?.["credentialRef"]).toBe(stored[1]?.id);
  });

  it("marks the integration disconnected when Google rejects the refresh (revoked access)", async () => {
    const { service, config, audit, stored } = makeDeps({
      tokenResponses: [
        { status: 200, body: { access_token: "at-exchange", expires_in: 3600, refresh_token: "rt-original" } },
        { status: 400, body: { error: "invalid_grant" } },
      ],
    });
    const state = await connectThrough(service);
    await service.handleCallback({ code: "c", state }, null);
    service.invalidateAccessToken(); // force the next call to refresh
    await expect(service.getAccessToken()).rejects.toBeInstanceOf(GoogleNotConnectedError);
    const s = (await config.latest("google_calendar_integration"))?.content as Record<string, unknown>;
    expect(s?.["connected"]).toBe(false);
    expect(String(s?.["lastError"])).toContain("revoked");
    expect(audit.entries.some((e) => e.action === "google_calendar.access_revoked")).toBe(true);
    void stored;
  });

  it("disconnect revokes at Google, deletes the stored secret, and clears state", async () => {
    const { service, config, stored, calls } = makeDeps();
    const state = await connectThrough(service);
    await service.handleCallback({ code: "c", state }, null);
    expect(stored).toHaveLength(1);
    await service.disconnect("admin-1");
    expect(stored).toHaveLength(0);
    const s = (await config.latest("google_calendar_integration"))?.content as Record<string, unknown>;
    expect(s?.["connected"]).toBe(false);
    expect(s?.["credentialRef"]).toBeNull();
    expect(calls.some((c) => c.url === GOOGLE_REVOKE_ENDPOINT)).toBe(true);
  });

  it("status reports configured/connected accurately and never exposes token material", async () => {
    const { service } = makeDeps();
    expect(await service.status()).toMatchObject({ configured: true, connected: false });
    const state = await connectThrough(service);
    await service.handleCallback({ code: "c", state }, null);
    const s = await service.status();
    expect(s).toMatchObject({ configured: true, connected: true, calendarId: "test-cal@group.calendar.google.com", accessRole: "owner" });
    expect(JSON.stringify(s)).not.toContain("rt-");
    expect(JSON.stringify(s)).not.toContain("at-");
  });

  it("reports a Google consent error parameter as an AppError without storing anything", async () => {
    const { service, config, stored } = makeDeps();
    const state = await connectThrough(service);
    await expect(service.handleCallback({ state, error: "access_denied" }, null)).rejects.toBeInstanceOf(AppError);
    expect(stored).toHaveLength(0);
    expect((await config.latest("google_calendar_integration"))?.content?.["connected"]).toBeUndefined();
  });
});
