import type { Pool } from "pg";
import { AppError } from "../../server/errors.js";

/**
 * Persistence for the Google Calendar integration state (Stage 7 corrective
 * review): ISOLATED from business_config, whose CHECK constraint permits only
 * the six business-facing categories. The dedicated google_integration table
 * is created by migration 0007 — application code NEVER issues DDL, so this
 * store fails honestly (INTEGRATION_STORE_UNAVAILABLE) until the owner
 * approves and applies the migration through the authorized CLI workflow.
 */

export interface GoogleIntegrationRecord {
  connected: boolean;
  calendarId: string;
  /** Opaque Vault reference for the refresh token — never the token itself. */
  credentialRef: string | null;
  /** auth.users UUID of the admin who connected — FK, not free text. */
  connectedBy: string | null;
  connectedAt: string | null;
  accessRole: string | null;
  lastError: string | null;
  lastVerifiedAt: string | null;
}

export const EMPTY_RECORD: GoogleIntegrationRecord = {
  connected: false,
  calendarId: "",
  credentialRef: null,
  connectedBy: null,
  connectedAt: null,
  accessRole: null,
  lastError: null,
  lastVerifiedAt: null,
};

export interface GoogleIntegrationStore {
  load(): Promise<GoogleIntegrationRecord | null>;
  save(record: GoogleIntegrationRecord): Promise<void>;
}

/** In-memory store for tests (the shape the Pg store must honor). */
export class MemoryGoogleIntegrationStore implements GoogleIntegrationStore {
  record: GoogleIntegrationRecord | null = null;
  saveError: Error | null = null;
  async load(): Promise<GoogleIntegrationRecord | null> {
    return this.record ? { ...this.record } : null;
  }
  async save(record: GoogleIntegrationRecord): Promise<void> {
    if (this.saveError) throw this.saveError;
    this.record = { ...record };
  }
}

/** Missing-table detection (Postgres undefined_table). */
function isMissingTable(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "42P01";
}

export class PgGoogleIntegrationStore implements GoogleIntegrationStore {
  constructor(private readonly pool: Pool) {}

  async load(): Promise<GoogleIntegrationRecord | null> {
    try {
      const { rows } = await this.pool.query(
        `select connected, calendar_id, credential_ref, connected_by, connected_at,
                access_role, last_error, last_verified_at
         from public.google_integration
         where id = '00000000-0000-0000-0000-000000000001'`,
      );
      const r = rows[0] as Record<string, unknown> | undefined;
      if (!r) return null;
      return {
        connected: r.connected === true,
        calendarId: (r.calendar_id as string | null) ?? "",
        credentialRef: (r.credential_ref as string | null) ?? null,
        connectedBy: (r.connected_by as string | null) ?? null,
        connectedAt: r.connected_at ? new Date(r.connected_at as string).toISOString() : null,
        accessRole: (r.access_role as string | null) ?? null,
        lastError: (r.last_error as string | null) ?? null,
        lastVerifiedAt: r.last_verified_at ? new Date(r.last_verified_at as string).toISOString() : null,
      };
    } catch (err) {
      if (isMissingTable(err)) throw integrationStoreUnavailable();
      throw err;
    }
  }

  async save(record: GoogleIntegrationRecord): Promise<void> {
    try {
      await this.pool.query(
        `insert into public.google_integration
           (id, connected, calendar_id, credential_ref, connected_by, connected_at,
            access_role, last_error, last_verified_at, updated_at)
         values ('00000000-0000-0000-0000-000000000001', $1, $2, $3, $4, $5, $6, $7, $8, now())
         on conflict (id) do update set
           connected = excluded.connected,
           calendar_id = excluded.calendar_id,
           credential_ref = excluded.credential_ref,
           connected_by = excluded.connected_by,
           connected_at = excluded.connected_at,
           access_role = excluded.access_role,
           last_error = excluded.last_error,
           last_verified_at = excluded.last_verified_at,
           updated_at = now()`,
        [
          record.connected,
          record.calendarId,
          record.credentialRef,
          record.connectedBy,
          record.connectedAt,
          record.accessRole,
          record.lastError,
          record.lastVerifiedAt,
        ],
      );
    } catch (err) {
      if (isMissingTable(err)) throw integrationStoreUnavailable();
      throw err;
    }
  }
}

function integrationStoreUnavailable(): AppError {
  return new AppError(
    "CALENDAR_UNAVAILABLE",
    "Google Calendar integration storage is not provisioned — migration 0007 (google_integration table) awaits explicit DDL approval. The mock calendar remains active.",
  );
}
