import type { FastifyInstance } from "fastify";
import { requireAdmin } from "../../../auth/adminGuard.js";
import { AppError } from "../../../server/errors.js";
import type { GoogleIntegrationService } from "../../../calendar/google/integration.js";
import { OAuthCallbackError } from "../../../calendar/google/callbackError.js";

/**
 * Owner-only Google Calendar integration routes (Stage 7). All require the
 * admin guard EXCEPT the OAuth callback, which authenticates via the
 * single-use `state` nonce (exempted in the guard hook in index.ts — the
 * browser arriving from accounts.google.com carries no bearer header).
 */
export function registerGoogleIntegrationRoutes(app: FastifyInstance, deps: { googleIntegration: GoogleIntegrationService | null }) {
  app.get("/api/v1/admin/integrations/google/status", async (request) => {
    requireAdmin(request);
    if (!deps.googleIntegration) {
      return { configured: false, connected: false, calendarId: null, accessRole: null, connectedAt: null, connectedBy: null, lastError: null, lastVerifiedAt: null };
    }
    return deps.googleIntegration.status();
  });

  app.post("/api/v1/admin/integrations/google/connect", async (request) => {
    const admin = requireAdmin(request);
    if (!deps.googleIntegration) throw new AppError("CALENDAR_UNAVAILABLE", "Google Calendar integration is not configured.");
    return deps.googleIntegration.beginConnect(admin.userId);
  });

  app.get("/api/v1/admin/integrations/google/callback", async (request, reply) => {
    reply.type("text/html; charset=utf-8").header("cache-control", "no-store").header("referrer-policy", "no-referrer");
    const { code, state, error } = request.query as { code?: string; state?: string; error?: string };
    try {
      if (!deps.googleIntegration) throw new OAuthCallbackError("configuration");
      await deps.googleIntegration.handleCallback({ code, state, error });
    } catch (err) {
      const failure = err instanceof OAuthCallbackError ? err : null;
      const stage = failure?.stage ?? "unknown";
      // Never log the error object, request query, code, nonce or token data.
      request.log.warn({ stage, cleanupIncomplete: failure?.cleanupIncomplete ?? false }, "Google OAuth callback failed");
      const message = failure?.message ?? "Unexpected OAuth error. Ask the administrator to check backend availability, then start a fresh connection from the admin console.";
      reply.code(400);
      return callbackPage(`Connection failed [${stage}]: ${message}`, false);
    }
    return callbackPage("Google Calendar connected. You can close this window and return to the Cleardesk console.", true);
  });

  app.post("/api/v1/admin/integrations/google/disconnect", async (request) => {
    const admin = requireAdmin(request);
    if (!deps.googleIntegration) throw new AppError("CALENDAR_UNAVAILABLE", "Google Calendar integration is not configured.");
    return deps.googleIntegration.disconnect(admin.userId);
  });
}

/** Minimal self-closing HTML page — no tokens or identifiers are echoed. */
function callbackPage(message: string, ok: boolean): string {
  const safe = message.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c] ?? c);
  return `<!doctype html><html><head><meta charset="utf-8"><title>Cleardesk — Google Calendar</title></head>
<body style="font-family:system-ui,sans-serif;background:#f3f0e9;color:#17251e;display:flex;min-height:100vh;align-items:center;justify-content:center">
<div style="max-width:24rem;text-align:center;padding:2rem"><h1 style="font-size:1.15rem">${ok ? "Connected" : "Not connected"}</h1><p style="font-size:0.9rem;line-height:1.5">${safe}</p></div>
</body></html>`;
}
