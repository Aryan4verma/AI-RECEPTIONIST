/**
 * Google OAuth 2.0 — authorization-code flow with offline access, for the
 * OWNER-ONLY Google Calendar connection (Stage 7 / Q3-gated).
 *
 * Security posture:
 * - Endpoints are FIXED Google constants (never user input) — no SSRF surface.
 * - CSRF: every connect generates a single-use server-side state nonce with a
 *   10-minute expiry; the callback must present it back exactly once.
 * - Least privilege: calendar.events (manage events on the dedicated
 *   calendar), calendar.freebusy (availability), calendar.readonly (verify
 *   the calendar exists and its access role). Nothing broader.
 * - Tokens never enter logs, responses, or the audit trail — only opaque
 *   Vault references and masked metadata leave this module.
 */

export const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
export const GOOGLE_REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";

/** Least-privilege Calendar scopes — no full calendar read/write. */
export const GOOGLE_CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.freebusy",
  "https://www.googleapis.com/auth/calendar.readonly",
] as const;

export const STATE_TTL_MS = 10 * 60_000;

export function buildAuthUrl(opts: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL(GOOGLE_AUTH_ENDPOINT);
  url.searchParams.set("client_id", opts.clientId);
  url.searchParams.set("redirect_uri", opts.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_CALENDAR_SCOPES.join(" "));
  // Offline access + consent: a refresh token is issued (re-)every time.
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "false");
  url.searchParams.set("state", opts.state);
  return url.toString();
}

export interface TokenSet {
  accessToken: string;
  expiresInSec: number;
  /** Present on consent grants and refresh rotations — re-store when returned. */
  refreshToken?: string;
}

interface RawTokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  error?: string;
  error_description?: string;
}

async function parseTokenResponse(res: Response): Promise<TokenSet> {
  const body = (await res.json().catch(() => ({}))) as RawTokenResponse;
  if (!res.ok || !body.access_token) {
    // Never echo the body — it can contain token material.
    throw new Error(`google token endpoint returned ${res.status}${body.error ? ` (${body.error})` : ""}`);
  }
  return {
    accessToken: body.access_token,
    expiresInSec: body.expires_in ?? 3600,
    refreshToken: body.refresh_token,
  };
}

export async function exchangeCode(opts: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
  fetchFn?: typeof fetch;
}): Promise<TokenSet> {
  const fetchFn = opts.fetchFn ?? fetch;
  const res = await fetchFn(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      code: opts.code,
      grant_type: "authorization_code",
      redirect_uri: opts.redirectUri,
    }),
  });
  return parseTokenResponse(res);
}

export async function refreshAccessToken(opts: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  fetchFn?: typeof fetch;
}): Promise<TokenSet> {
  const fetchFn = opts.fetchFn ?? fetch;
  const res = await fetchFn(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      refresh_token: opts.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (res.status === 400 || res.status === 401) {
    // invalid_grant: the refresh token was revoked, expired, or rotated away.
    const body = (await res.json().catch(() => ({}))) as RawTokenResponse;
    const err = new Error(`refresh rejected (${body.error ?? res.status})`) as Error & { revoked?: boolean };
    err.revoked = body.error === "invalid_grant";
    throw err;
  }
  return parseTokenResponse(res);
}

export async function revokeToken(token: string, fetchFn?: typeof fetch): Promise<void> {
  const f = fetchFn ?? fetch;
  await f(GOOGLE_REVOKE_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
  }).catch(() => undefined); // best-effort: local credentials are removed regardless
}
