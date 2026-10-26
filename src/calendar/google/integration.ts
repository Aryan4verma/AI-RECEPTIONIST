import { randomUUID } from "node:crypto";
import type { AuditRepo } from "../../db/ports.js";
import { AppError } from "../../server/errors.js";
import type { SecretStore } from "../../secrets/store.js";
import {
  buildAuthUrl,
  exchangeCode,
  refreshAccessToken,
  revokeToken,
  STATE_TTL_MS,
} from "./oauth.js";
import {
  EMPTY_RECORD,
  type GoogleIntegrationRecord,
  type GoogleIntegrationStore,
} from "./store.js";
import { OAuthCallbackError, type CallbackStage } from "./callbackError.js";
import type { TokenSet } from "./oauth.js";

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
  connectedBy: string;
}

interface PendingState {
  expiresAtMs: number;
  /** The authenticated admin who initiated connect — bound into the record. */
  adminUserId: string;
}

/**
 * Owner-only Google Calendar connection lifecycle (Stage 7, corrective
 * review). Refresh tokens live ONLY in the approved SecretStore (Vault;
 * fail-closed disabled store refuses the connect flow). State persists
 * through the isolated GoogleIntegrationStore (migration-0007 table — no
 * DDL from application code; the store fails honestly until approved).
 *
 * Security properties:
 * - CSRF: single-use 10-minute state nonces, each BOUND to the
 *   authenticated admin UUID that initiated connect; the callback persists
 *   that identity, never free text.
 * - Fail-closed tokens: a consent response without a refresh token aborts
 *   the connection (nothing stored, token revoked).
 * - No orphaned credentials: a persistence failure after the secret was
 *   stored removes the secret and revokes the token before rethrowing.
 */
export class GoogleIntegrationService {
  private cachedAccessToken: { token: string; expiresAtMs: number } | null = null;
  /** Single-use CSRF nonces: state → expiry + initiating admin. */
  private readonly pendingStates = new Map<string, PendingState>();

  constructor(
    private readonly deps: {
      store: GoogleIntegrationStore;
      secretStore: SecretStore;
      audit: AuditRepo;
      creds: GoogleIntegrationConfig;
      fetchFn?: typeof fetch;
      now?: () => number;
    },
  ) {}

  isConfigured(): boolean {
    return Boolean(this.deps.creds.clientId && this.deps.creds.clientSecret && this.deps.creds.redirectUri && this.deps.creds.calendarId);
  }

  /** Step 1 of connect: issue an authorization URL with a fresh CSRF state
   *  bound to the authenticated admin. */
  async beginConnect(adminUserId: string): Promise<{ authUrl: string }> {
    this.assertConfigured();
    const state = randomUUID();
    this.pendingStates.set(state, { expiresAtMs: this.now() + STATE_TTL_MS, adminUserId });
    // Bound memory: drop expired nonces opportunistically.
    for (const [k, p] of this.pendingStates) if (p.expiresAtMs < this.now()) this.pendingStates.delete(k);
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
   * nonce and its bound admin identity (the browser carries no admin
   * bearer header here). Verifies the dedicated calendar exists AND is
   * writable BEFORE persisting credentials.
   */
  async handleCallback(params: { code?: string; state?: string; error?: string }): Promise<CallbackResult> {
    if (!this.isConfigured()) throw new OAuthCallbackError("configuration");
    const { code, state, error } = params;
    if (!state) throw new OAuthCallbackError("state", "INVALID_INPUT");
    const pending = this.pendingStates.get(state);
    if (!pending || pending.expiresAtMs < this.now()) {
      this.pendingStates.delete(state);
      throw new OAuthCallbackError("state", "FORBIDDEN");
    }
    this.pendingStates.delete(state); // single use — replays are rejected
    const adminUserId = pending.adminUserId;
    if (error) throw new OAuthCallbackError("consent", "INVALID_INPUT");
    if (!code) throw new OAuthCallbackError("state", "INVALID_INPUT");

    let stage: CallbackStage = "token_exchange";
    let tokens: TokenSet | null = null;
    const connectedAt = new Date(this.now()).toISOString();
    let ref: string | null = null;
    let previousRef: string | null = null;
    let persisted = false;
    try {
      tokens = await exchangeCode({
        clientId: this.deps.creds.clientId,
        clientSecret: this.deps.creds.clientSecret,
        redirectUri: this.deps.creds.redirectUri,
        code,
        fetchFn: this.deps.fetchFn,
      });
      if (!tokens.refreshToken) throw new OAuthCallbackError("refresh_token", "INVALID_INPUT");

      stage = "calendar_access";
      const calendarInfo = await this.fetchCalendarMeta(tokens.accessToken);
      if (!["owner", "writer"].includes(calendarInfo.accessRole)) throw new OAuthCallbackError(stage, "FORBIDDEN");

      stage = "integration_persistence";
      previousRef = (await this.deps.store.load())?.credentialRef ?? null;
      stage = "vault_storage";
      const stored = await this.deps.secretStore.put(SECRET_NAMESPACE, tokens.refreshToken);
      ref = stored.ref;
      stage = "integration_persistence";
      await this.deps.store.save({
        ...EMPTY_RECORD,
        connected: true,
        calendarId: this.deps.creds.calendarId,
        credentialRef: ref,
        connectedBy: adminUserId,
        connectedAt,
        accessRole: calendarInfo.accessRole,
        lastVerifiedAt: connectedAt,
        lastError: null,
      });
      persisted = true;
      stage = "audit";
      await this.deps.audit.append({
        actorType: "admin", actorId: adminUserId, action: "google_calendar.connected",
        entityType: "integration", entityId: "google_calendar",
        detail: { calendarId: this.deps.creds.calendarId, accessRole: calendarInfo.accessRole },
      });
      stage = "vault_storage";
      if (previousRef && previousRef !== ref) await this.deps.secretStore.remove(previousRef);
      this.cachedAccessToken = { token: tokens.accessToken, expiresAtMs: this.now() + tokens.expiresInSec * 1000 - TOKEN_EXPIRY_SKEW_MS };
      return { connected: true, calendarId: this.deps.creds.calendarId, accessRole: calendarInfo.accessRole, connectedBy: adminUserId };
    } catch (err) {
      let cleanupIncomplete = false;
      if (persisted) {
        try { await this.deps.store.save({ ...EMPTY_RECORD, lastError: `OAuth ${stage} failed; reconnect required` }); }
        catch { cleanupIncomplete = true; }
      }
      for (const cleanupRef of new Set([ref, persisted ? previousRef : null])) {
        if (!cleanupRef) continue;
        try { await this.deps.secretStore.remove(cleanupRef); }
        catch { cleanupIncomplete = true; }
      }
      if (tokens) await revokeToken(tokens.refreshToken || tokens.accessToken, this.deps.fetchFn);
      this.cachedAccessToken = null;
      throw new OAuthCallbackError(err instanceof OAuthCallbackError ? err.stage : stage,
        err instanceof AppError ? err.code : "CALENDAR_UNAVAILABLE", cleanupIncomplete);
    }
  }

  async status(): Promise<
    { configured: boolean; connected: false; calendarId: null; accessRole: null; connectedAt: null; connectedBy: null; lastError: string | null; lastVerifiedAt: null; storeAvailable: boolean }
    | { configured: boolean; connected: true; calendarId: string; accessRole: string; connectedAt: string; connectedBy: string | null; lastError: string | null; lastVerifiedAt: string; storeAvailable: true }
  > {
    if (!this.isConfigured()) {
      return { configured: false, connected: false, calendarId: null, accessRole: null, connectedAt: null, connectedBy: null, lastError: null, lastVerifiedAt: null, storeAvailable: false };
    }
    let record: GoogleIntegrationRecord;
    try {
      record = (await this.deps.store.load()) ?? EMPTY_RECORD;
    } catch {
      // Honest degraded status — storage not yet provisioned (0007 pending).
      return { configured: true, connected: false, calendarId: null, accessRole: null, connectedAt: null, connectedBy: null, lastError: "integration storage unavailable (migration 0007 pending approval)", lastVerifiedAt: null, storeAvailable: false };
    }
    if (!record.connected) {
      return { configured: true, connected: false, calendarId: null, accessRole: null, connectedAt: null, connectedBy: null, lastError: record.lastError, lastVerifiedAt: null, storeAvailable: true };
    }
    return {
      configured: true,
      connected: true,
      calendarId: record.calendarId,
      accessRole: record.accessRole ?? "unknown",
      connectedAt: record.connectedAt ?? "",
      connectedBy: record.connectedBy,
      lastError: record.lastError,
      lastVerifiedAt: record.lastVerifiedAt ?? "",
      storeAvailable: true,
    };
  }

  /** Disconnect: revoke at Google (best effort), delete the Vault secret, clear state. */
  async disconnect(adminUserId: string): Promise<{ disconnected: true }> {
    let record: GoogleIntegrationRecord = EMPTY_RECORD;
    try {
      record = (await this.deps.store.load()) ?? EMPTY_RECORD;
    } catch {
      /* storage unavailable — still clear cached token and report */
    }
    if (record.connected && record.credentialRef) {
      try {
        const refreshToken = await this.deps.secretStore.get(record.credentialRef);
        await revokeToken(refreshToken, this.deps.fetchFn);
      } catch {
        /* revoke is best-effort; local removal proceeds regardless */
      }
      await this.deps.secretStore.remove(record.credentialRef).catch(() => undefined);
    }
    this.cachedAccessToken = null;
    await this.deps.store.save({ ...EMPTY_RECORD, calendarId: this.deps.creds.calendarId, lastError: record.lastError, connectedBy: record.connectedBy });
    await this.deps.audit.append({
      actorType: "admin", actorId: adminUserId, action: "google_calendar.disconnected",
      entityType: "integration", entityId: "google_calendar", detail: {},
    });
    return { disconnected: true };
  }

  /**
   * Refresh-token lifecycle: cached in memory until near expiry, then
   * refreshed from the Vault-stored refresh token. A rotated refresh token
   * is re-stored (identity preserved). `invalid_grant` marks the
   * integration disconnected (revoked access) — every subsequent operation
   * fails honestly as not-connected.
   */
  async getAccessToken(): Promise<string> {
    const now = this.now();
    if (this.cachedAccessToken && this.cachedAccessToken.expiresAtMs > now) return this.cachedAccessToken.token;
    const record = await this.deps.store.load();
    if (!record?.connected || !record.credentialRef) throw new GoogleNotConnectedError();
    const refreshToken = await this.deps.secretStore.get(record.credentialRef);
    if (!refreshToken) {
      // Fail closed: an empty/missing secret can never be used as a token.
      await this.deps.store.save({ ...record, connected: false, lastError: "stored credential is missing or empty — reconnect required" });
      this.cachedAccessToken = null;
      throw new GoogleNotConnectedError("stored Google credential is missing — reconnect in the admin console");
    }
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
        await this.deps.store.save({ ...record, connected: false, lastError: "Google revoked access (invalid_grant) — reconnect required" });
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
      // Rotation: store the replacement; the initiating identity is preserved.
      const stored = await this.deps.secretStore.put(SECRET_NAMESPACE, tokens.refreshToken);
      await this.deps.store.save({ ...record, credentialRef: stored.ref });
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
      { headers: { authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(30_000) },
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
