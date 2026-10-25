import { randomUUID } from "node:crypto";
import type { AuditRepo, BusinessConfigRepo } from "../../db/ports.js";
import { AppError } from "../../server/errors.js";
import type { SecretStore } from "../../secrets/store.js";
import {
  buildAuthUrl,
  exchangeCode,
  refreshAccessToken,
  revokeToken,
  STATE_TTL_MS,
} from "./oauth.js";

const STATE_CATEGORY = "google_calendar_integration";
const SECRET_NAMESPACE = "google-calendar";
/** Clock skew guard on cached access tokens. */
const TOKEN_EXPIRY_SKEW_MS = 60_000;

export interface GoogleIntegrationConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** Dedicated Calendar ID — every operation targets exactly this calendar. */
  calendarId: string;
}

/** Persisted (non-secret) connection state — business_config, never tokens. */
interface IntegrationState {
  connected: boolean;
  calendarId: string;
  /** Opaque Vault reference for the refresh token — never the token itself. */
  credentialRef: string | null;
  connectedBy: string | null;
  connectedAt: string | null;
  accessRole: string | null;
  lastError: string | null;
  lastVerifiedAt: string | null;
}

/** business_config content is Record<string, unknown> — index-compatible shape. */
type StateContent = IntegrationState & Record<string, unknown>;

const EMPTY_STATE: IntegrationState = {
  connected: false,
  calendarId: "",
  credentialRef: null,
  connectedBy: null,
  connectedAt: null,
  accessRole: null,
  lastError: null,
  lastVerifiedAt: null,
};

export class GoogleNotConnectedError extends Error {
  constructor(message = "Google Calendar is not connected") {
    super(message);
    this.name = "GoogleNotConnectedError";
  }
}

interface CallbackResult {
  connected: true;
  calendarId: string;
  accessRole: string;
}

/**
 * Owner-only Google Calendar connection lifecycle. Refresh tokens live ONLY
 * in the approved SecretStore (Vault; fail-closed disabled store refuses the
 * connect flow — CREDENTIAL_STORE_UNAVAILABLE). Everything else persists as
 * non-secret JSON in business_config (existing table — no DDL, migration
 * 0007 gate untouched).
 */
export class GoogleIntegrationService {
  private cachedAccessToken: { token: string; expiresAtMs: number } | null = null;
  /** Single-use CSRF nonces: state → expiresAtMs. Server-memory only. */
  private readonly pendingStates = new Map<string, number>();

  constructor(
    private readonly deps: {
      config: BusinessConfigRepo;
      secretStore: SecretStore;
      audit: AuditRepo;
      creds: GoogleIntegrationConfig;
      fetchFn?: typeof fetch;
      now?: () => number;
    },
  ) {}

  private async readState(): Promise<IntegrationState> {
    const latest = await this.deps.config.latest(STATE_CATEGORY);
    return latest ? { ...EMPTY_STATE, ...(latest.content as Partial<IntegrationState>) } as IntegrationState : EMPTY_STATE;
  }

  private async writeState(state: IntegrationState, updatedBy: string | null): Promise<void> {
    const current = await this.deps.config.latest(STATE_CATEGORY);
    const content: StateContent = { ...state };
    await this.deps.config.insertVersion(STATE_CATEGORY, content, (current?.version ?? 0) + 1, updatedBy);
  }

  isConfigured(): boolean {
    return Boolean(this.deps.creds.clientId && this.deps.creds.clientSecret && this.deps.creds.redirectUri && this.deps.creds.calendarId);
  }

  /** Step 1 of connect: issue an authorization URL with a fresh CSRF state. */
  async beginConnect(adminUserId: string): Promise<{ authUrl: string }> {
    this.assertConfigured();
    const state = randomUUID();
    this.pendingStates.set(state, this.now() + STATE_TTL_MS);
    // Bound memory: drop expired nonces opportunistically.
    for (const [k, exp] of this.pendingStates) if (exp < this.now()) this.pendingStates.delete(k);
    const authUrl = buildAuthUrl({
      clientId: this.deps.creds.clientId,
      redirectUri: this.deps.creds.redirectUri,
      state,
    });
    await this.deps.audit.append({
      actorType: "admin", actorId: adminUserId, action: "google_calendar.connect_started",
      entityType: "integration", entityId: "google_calendar", detail: {},
    });
    return { authUrl };
  }

  /**
   * Step 2: the redirect target. Authenticates via the single-use state
   * nonce (the browser carries no admin bearer header here). Verifies the
   * dedicated calendar exists AND is writable before storing anything.
   */
  async handleCallback(params: { code?: string; state?: string; error?: string }, adminHint: string | null): Promise<CallbackResult> {
    this.assertConfigured();
    const { code, state, error } = params;
    if (error) throw new AppError("INVALID_INPUT", `Google authorization failed: consent was not granted.`);
    if (!code || !state) throw new AppError("INVALID_INPUT", "Malformed OAuth callback.");
    const expiresAt = this.pendingStates.get(state);
    if (expiresAt === undefined || expiresAt < this.now()) {
      this.pendingStates.delete(state);
      throw new AppError("FORBIDDEN", "Unknown or expired OAuth state — start the connection again.");
    }
    this.pendingStates.delete(state); // single use — replays are rejected

    const tokens = await exchangeCode({
      clientId: this.deps.creds.clientId,
      clientSecret: this.deps.creds.clientSecret,
      redirectUri: this.deps.creds.redirectUri,
      code,
      fetchFn: this.deps.fetchFn,
    });

    // Verify the dedicated calendar BEFORE persisting credentials.
    const calendarInfo = await this.fetchCalendarMeta(tokens.accessToken).catch((err) => {
      throw new AppError("CALENDAR_UNAVAILABLE", "Connected to Google, but the dedicated calendar could not be verified.", {
        cause: err instanceof Error ? err.message : "unknown",
      });
    });
    if (!["owner", "writer"].includes(calendarInfo.accessRole)) {
      await revokeToken(tokens.refreshToken ?? tokens.accessToken, this.deps.fetchFn);
      throw new AppError("FORBIDDEN", "The configured calendar is not writable with this Google account (access role: reader).");
    }

    // Fail-closed credential storage: a disabled store refuses the whole connect.
    const stored = await this.deps.secretStore.put(SECRET_NAMESPACE, tokens.refreshToken ?? "");
    const connectedAt = new Date(this.now()).toISOString();
    await this.writeState(
      {
        ...EMPTY_STATE,
        connected: true,
        calendarId: this.deps.creds.calendarId,
        credentialRef: stored.ref,
        connectedBy: adminHint,
        connectedAt,
        accessRole: calendarInfo.accessRole,
        lastVerifiedAt: connectedAt,
        lastError: null,
      },
      adminHint,
    );
    this.cachedAccessToken = { token: tokens.accessToken, expiresAtMs: this.now() + tokens.expiresInSec * 1000 - TOKEN_EXPIRY_SKEW_MS };
    await this.deps.audit.append({
      actorType: "admin", actorId: adminHint, action: "google_calendar.connected",
      entityType: "integration", entityId: "google_calendar",
      detail: { calendarId: this.deps.creds.calendarId, accessRole: calendarInfo.accessRole },
    });
    return { connected: true, calendarId: this.deps.creds.calendarId, accessRole: calendarInfo.accessRole };
  }

  async status(): Promise<
    { configured: boolean; connected: false; calendarId: string | null; accessRole: null; connectedAt: null; connectedBy: null; lastError: string | null; lastVerifiedAt: null }
    | { configured: boolean; connected: true; calendarId: string; accessRole: string; connectedAt: string; connectedBy: string | null; lastError: string | null; lastVerifiedAt: string | null }
  > {
    if (!this.isConfigured()) {
      return { configured: false, connected: false, calendarId: null, accessRole: null, connectedAt: null, connectedBy: null, lastError: null, lastVerifiedAt: null };
    }
    const s = await this.readState();
    if (!s.connected) {
      return { configured: true, connected: false, calendarId: null, accessRole: null, connectedAt: null, connectedBy: null, lastError: s.lastError, lastVerifiedAt: null };
    }
    return {
      configured: true,
      connected: true,
      calendarId: s.calendarId,
      accessRole: s.accessRole ?? "unknown",
      connectedAt: s.connectedAt ?? "",
      connectedBy: s.connectedBy,
      lastError: s.lastError,
      lastVerifiedAt: s.lastVerifiedAt ?? "",
    };
  }

  /** Disconnect: revoke at Google (best effort), delete the Vault secret, clear state. */
  async disconnect(adminUserId: string): Promise<{ disconnected: true }> {
    const s = await this.readState();
    if (s.connected && s.credentialRef) {
      try {
        const refreshToken = await this.deps.secretStore.get(s.credentialRef);
        await revokeToken(refreshToken, this.deps.fetchFn);
      } catch {
        /* revoke is best-effort; local removal proceeds regardless */
      }
      await this.deps.secretStore.remove(s.credentialRef).catch(() => undefined);
    }
    this.cachedAccessToken = null;
    await this.writeState({ ...EMPTY_STATE, calendarId: this.deps.creds.calendarId, lastError: s.lastError }, adminUserId);
    await this.deps.audit.append({
      actorType: "admin", actorId: adminUserId, action: "google_calendar.disconnected",
      entityType: "integration", entityId: "google_calendar", detail: {},
    });
    return { disconnected: true };
  }

  /**
   * Refresh-token lifecycle: cached in memory until near expiry, then
   * refreshed from the Vault-stored refresh token. A rotated refresh token is
   * re-stored. `invalid_grant` marks the integration disconnected (revoked
   * access) — every subsequent operation fails honestly as not-connected.
   */
  async getAccessToken(): Promise<string> {
    const now = this.now();
    if (this.cachedAccessToken && this.cachedAccessToken.expiresAtMs > now) return this.cachedAccessToken.token;
    const s = await this.readState();
    if (!s.connected || !s.credentialRef) throw new GoogleNotConnectedError();
    const refreshToken = await this.deps.secretStore.get(s.credentialRef);
    let tokens;
    try {
      tokens = await refreshAccessToken({
        clientId: this.deps.creds.clientId,
        clientSecret: this.deps.creds.clientSecret,
        refreshToken,
        fetchFn: this.deps.fetchFn,
      });
    } catch (err) {
      if ((err as { revoked?: boolean }).revoked) {
        await this.writeState({ ...s, connected: false, lastError: "Google revoked access (invalid_grant) — reconnect required" }, null);
        this.cachedAccessToken = null;
        await this.deps.audit.append({
          actorType: "system", actorId: null, action: "google_calendar.access_revoked",
          entityType: "integration", entityId: "google_calendar", detail: {},
        });
        throw new GoogleNotConnectedError("Google access was revoked — reconnect in the admin console");
      }
      throw new AppError("CALENDAR_UNAVAILABLE", "Google token refresh failed; the calendar is temporarily unreachable.", {
        cause: err instanceof Error ? err.message : "unknown",
      });
    }
    if (tokens.refreshToken && tokens.refreshToken !== refreshToken) {
      const stored = await this.deps.secretStore.put(SECRET_NAMESPACE, tokens.refreshToken);
      await this.writeState({ ...s, credentialRef: stored.ref }, null);
    }
    this.cachedAccessToken = { token: tokens.accessToken, expiresAtMs: now + tokens.expiresInSec * 1000 - TOKEN_EXPIRY_SKEW_MS };
    return tokens.accessToken;
  }

  /** Drop the cached access token (called after a 401 so the retry refreshes). */
  invalidateAccessToken(): void {
    this.cachedAccessToken = null;
  }

  private async fetchCalendarMeta(accessToken: string): Promise<{ accessRole: string }> {
    // calendarList.get proves BOTH existence and the authorized role in one
    // call (404 → the calendar is not accessible to this account).
    const listRes = await (this.deps.fetchFn ?? fetch)(
      `https://www.googleapis.com/calendar/v3/users/me/calendarList/${encodeURIComponent(this.deps.creds.calendarId)}`,
      { headers: { authorization: `Bearer ${accessToken}` } },
    );
    if (!listRes.ok) throw new Error(`calendarList.get returned ${listRes.status}`);
    const listBody = (await listRes.json()) as { accessRole?: string };
    return { accessRole: listBody.accessRole ?? "reader" };
  }

  private assertConfigured(): void {
    if (!this.isConfigured()) {
      throw new AppError("CALENDAR_UNAVAILABLE", "Google Calendar integration is not configured (set the Google OAuth environment variables first).");
    }
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }
}
