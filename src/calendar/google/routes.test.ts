import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import { registerGoogleIntegrationRoutes } from "../../http/routes/admin/integrations.js";
import { createAdminGuard } from "../../auth/adminGuard.js";
import { GoogleIntegrationService } from "./integration.js";
import { MemoryAuditRepo, MemoryBusinessConfigRepo } from "../../db/memory/stores.js";
import { createSecretStore } from "../../secrets/store.js";

/**
 * Route-level checks: the admin guard covers status/connect/disconnect; the
 * OAuth callback is the ONLY admin-URL exemption (it authenticates via the
 * single-use state nonce) and returns plain HTML, never tokens.
 */

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
}

async function buildApp() {
  const app = Fastify();
  const integration = new GoogleIntegrationService({
    config: new MemoryBusinessConfigRepo(),
    secretStore: createSecretStore(
      { kind: "vault", verify: async () => ({ ok: true }) },
      { create: async () => "v0", decrypt: async () => "rt", delete: async () => undefined },
    ),
    audit: new MemoryAuditRepo(),
    creds: { clientId: "cid", clientSecret: "csec", redirectUri: "http://localhost:8787/api/v1/admin/integrations/google/callback", calendarId: "cal@test" },
    fetchFn: (async (url: string | URL) => {
      const u = String(url);
      if (u.includes("oauth2.googleapis.com/token")) return jsonResponse(200, { access_token: "at", expires_in: 3600, refresh_token: "rt" });
      if (u.includes("/users/me/calendarList/")) return jsonResponse(200, { accessRole: "owner" });
      return jsonResponse(500, {});
    }) as typeof fetch,
  });
  const guard = createAdminGuard({
    verify: async (token) => (token === "valid-admin-jwt" ? { userId: "admin-1" } : null),
    isMember: async () => true,
  });
  app.addHook("preHandler", async (request, reply) => {
    if (!request.url.startsWith("/api/v1/admin/") || request.url === "/api/v1/admin") return;
    if (request.url.startsWith("/api/v1/admin/integrations/google/callback")) return;
    await guard(request, reply);
  });
  registerGoogleIntegrationRoutes(app, { googleIntegration: integration });
  await app.ready();
  return app;
}

describe("Google integration routes", () => {
  it("status/connect/disconnect require the admin guard; unauthenticated requests get 401", async () => {
    const app = await buildApp();
    expect((await app.inject({ method: "GET", url: "/api/v1/admin/integrations/google/status" })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/v1/admin/integrations/google/connect" })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/v1/admin/integrations/google/disconnect" })).statusCode).toBe(401);
    const auth = { authorization: "Bearer valid-admin-jwt" };
    expect((await app.inject({ method: "GET", url: "/api/v1/admin/integrations/google/status", headers: auth })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/api/v1/admin/integrations/google/connect", headers: auth })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/api/v1/admin/integrations/google/disconnect", headers: auth })).statusCode).toBe(200);
    await app.close();
  });

  it("the callback is reachable WITHOUT a bearer header (state-authenticated) and returns HTML without token material", async () => {
    const app = await buildApp();
    const auth = { authorization: "Bearer valid-admin-jwt" };
    const { authUrl } = (await app.inject({ method: "POST", url: "/api/v1/admin/integrations/google/connect", headers: auth })).json() as { authUrl: string };
    const state = new URL(authUrl).searchParams.get("state") as string;
    const res = await app.inject({ method: "GET", url: `/api/v1/admin/integrations/google/callback?code=good&state=${state}` });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("Connected");
    expect(res.body).not.toContain("rt");
    expect(res.body).not.toContain("at");
    // A forged state is rejected with a safe error page, never a token.
    const bad = await app.inject({ method: "GET", url: "/api/v1/admin/integrations/google/callback?code=good&state=forged" });
    expect(bad.statusCode).toBe(400);
    expect(bad.body).toContain("Not connected");
    await app.close();
  });
});
