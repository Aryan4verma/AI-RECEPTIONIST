import type { Pool, PoolClient } from "pg";
import type { BookingEvent, BookingState } from "../../domain/booking/machine.js";
import { transition } from "../../domain/booking/machine.js";
import { AppError } from "../../server/errors.js";
import type {
  AuditEntry,
  AuditRepo,
  BookingStateRepo,
  BookingStateRow,
  BusinessConfigRepo,
  ConsentRepo,
  ConversationRepo,
  ConversationRow,
  MessageRow,
} from "../ports.js";

/**
 * PostgreSQL repository implementations (service-role, server-side only).
 * Live-DB contract tests run once runtime credentials exist; until then these
 * paths are typechecked but not executed against the real database.
 */

export class PgConversationRepo implements ConversationRepo {
  constructor(private readonly pool: Pool) {}

  async create(input: { channel: "text" | "voice"; accessTokenHash: string }): Promise<ConversationRow> {
    const { rows } = await this.pool.query(
      `insert into public.conversations (channel, access_token_hash)
       values ($1, $2) returning id, customer_id, channel, status, access_token_hash, consent_recording, started_at`,
      [input.channel, input.accessTokenHash],
    );
    return mapConversation(rows[0]);
  }

  async findByIdAndTokenHash(id: string, tokenHash: string): Promise<ConversationRow | null> {
    const { rows } = await this.pool.query(
      `select id, customer_id, channel, status, access_token_hash, consent_recording, started_at
       from public.conversations where id = $1 and access_token_hash = $2`,
      [id, tokenHash],
    );
    return rows[0] ? mapConversation(rows[0]) : null;
  }

  async updateStatus(id: string, status: ConversationRow["status"]): Promise<void> {
    await this.pool.query(`update public.conversations set status = $2, ended_at = now() where id = $1`, [id, status]);
  }

  async insertMessage(input: {
    conversationId: string;
    role: MessageRow["role"];
    content: string;
    contentType?: MessageRow["contentType"];
  }): Promise<MessageRow> {
    const { rows } = await this.pool.query(
      `insert into public.messages (conversation_id, role, content, content_type)
       values ($1, $2, $3, $4) returning id, conversation_id, role, content, content_type, corrected, created_at`,
      [input.conversationId, input.role, input.content, input.contentType ?? "text"],
    );
    return mapMessage(rows[0]);
  }

  async listMessages(conversationId: string, limit = 50): Promise<MessageRow[]> {
    const { rows } = await this.pool.query(
      `select id, conversation_id, role, content, content_type, corrected, created_at
       from public.messages where conversation_id = $1 order by created_at desc limit $2`,
      [conversationId, limit],
    );
    return rows.map(mapMessage).reverse();
  }
}

const BOOKING_PATCH_COLUMNS: Partial<Record<string, string>> = {
  extracted: "extracted",
  offeredSlot: "offered_slot",
  offerExpiresAt: "offer_expires_at",
  confirmationTokenHash: "confirmation_token_hash",
  calendarIdempotencyKey: "calendar_idempotency_key",
  unresolvedSince: "unresolved_since",
  reconciliationAttempts: "reconciliation_attempts",
  lastReconciledAt: "last_reconciled_at",
  escalatedAt: "escalated_at",
  attempts: "attempts",
  lastError: "last_error",
};

export class PgBookingStateRepo implements BookingStateRepo {
  constructor(private readonly pool: Pool) {}

  async ensure(conversationId: string): Promise<BookingStateRow> {
    const { rows } = await this.pool.query(
      `insert into public.booking_state (conversation_id) values ($1)
       on conflict (conversation_id) do nothing
       returning ${BOOKING_STATE_SELECT}`,
      [conversationId],
    );
    if (rows[0]) return mapBookingState(rows[0]);
    const existing = await this.pool.query(
      `select ${BOOKING_STATE_SELECT} from public.booking_state where conversation_id = $1`,
      [conversationId],
    );
    return mapBookingState(existing.rows[0]);
  }

  async get(conversationId: string): Promise<BookingStateRow | null> {
    const { rows } = await this.pool.query(
      `select ${BOOKING_STATE_SELECT} from public.booking_state where conversation_id = $1`,
      [conversationId],
    );
    return rows[0] ? mapBookingState(rows[0]) : null;
  }

  /**
   * Atomic transition: one transaction, row locked with FOR UPDATE, current
   * state validated against the caller's expected snapshot, transition
   * re-validated server-side, then patched. Conflict → typed 409.
   */
  async transition(input: {
    conversationId: string;
    expectedState: BookingState;
    event: BookingEvent;
    patch: Partial<BookingStateRow>;
  }): Promise<BookingStateRow> {
    const client: PoolClient = await this.pool.connect();
    try {
      await client.query("begin");
      const current = await client.query(
        `select ${BOOKING_STATE_SELECT} from public.booking_state where conversation_id = $1 for update`,
        [input.conversationId],
      );
      if (!current.rows[0]) throw new AppError("NOT_FOUND", "Booking state not found.");
      const row = mapBookingState(current.rows[0]);
      if (row.state !== input.expectedState) {
        throw new AppError("SLOT_TAKEN", "Booking state changed concurrently, retry the flow.");
      }
      const result = transition(row.state, input.event);
      if (!result.ok) {
        throw new AppError("INVALID_INPUT", `Illegal booking transition ${row.state} --${input.event}.`);
      }
      const sets: string[] = ["state = $2", "updated_at = now()"];
      const values: unknown[] = [input.conversationId, result.next];
      let param = 3;
      for (const [key, column] of Object.entries(BOOKING_PATCH_COLUMNS)) {
        if (input.patch[key as keyof BookingStateRow] !== undefined) {
          sets.push(`${column} = $${param}`);
          values.push(input.patch[key as keyof BookingStateRow]);
          param += 1;
        }
      }
      const updated = await client.query(
        `update public.booking_state set ${sets.join(", ")} where conversation_id = $1 returning ${BOOKING_STATE_SELECT}`,
        values,
      );
      await client.query("commit");
      return mapBookingState(updated.rows[0]);
    } catch (err) {
      await client.query("rollback").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async createAppointment(input: {
    conversationId: string;
    idempotencyKey: string;
    scheduledStart: Date;
    scheduledEnd: Date;
    durationMinutes: number;
    timezone: string;
    status: string;
    googleEventId?: string;
    serviceType?: string;
    purpose?: string;
    meetingType?: string;
    notes?: string;
  }): Promise<{ id: string }> {
    const { rows } = await this.pool.query(
      `insert into public.appointments
        (conversation_id, idempotency_key, scheduled_start, scheduled_end, duration_minutes,
         timezone, status, google_event_id, service_type, purpose, meeting_type, notes)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       returning id`,
      [
        input.conversationId, input.idempotencyKey, input.scheduledStart, input.scheduledEnd,
        input.durationMinutes, input.timezone, input.status, input.googleEventId ?? null,
        input.serviceType ?? null, input.purpose ?? null, input.meetingType ?? null, input.notes ?? null,
      ],
    );
    return { id: rows[0].id };
  }

  async updateAppointmentOutcome(
    appointmentId: string,
    outcome: { status: "confirmed" | "unresolved" | "failed"; googleEventId?: string; lastError?: string },
  ): Promise<void> {
    await this.pool.query(
      `update public.appointments
       set status = $2,
           google_event_id = coalesce($3, google_event_id),
           last_error = coalesce($4, last_error),
           updated_at = now()
       where id = $1`,
      [appointmentId, outcome.status, outcome.googleEventId ?? null, outcome.lastError ?? null],
    );
  }

  async findAppointmentByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<{ id: string; status: string; googleEventId: string | null } | null> {
    const { rows } = await this.pool.query(
      `select id, status, google_event_id from public.appointments where idempotency_key = $1`,
      [idempotencyKey],
    );
    if (!rows[0]) return null;
    return {
      id: rows[0].id as string,
      status: rows[0].status as string,
      googleEventId: (rows[0].google_event_id as string | null) ?? null,
    };
  }
}

export class PgConsentRepo implements ConsentRepo {
  constructor(private readonly pool: Pool) {}

  async record(input: {
    conversationId: string;
    conversationRef: string;
    decision: boolean;
    decisionText?: string;
    scope?: string;
  }): Promise<void> {
    await this.pool.query(
      `insert into public.consent_decisions (conversation_id, conversation_ref, decision, scope, decision_text)
       values ($1, $2, $3, $4, $5)`,
      [input.conversationId, input.conversationRef, input.decision, input.scope ?? "recording", input.decisionText ?? null],
    );
  }

  async latest(conversationRef: string): Promise<{
    id: string; conversationId: string | null; conversationRef: string | null;
    decision: boolean; scope: string; decidedAt: Date; validUntil: Date | null; decisionText: string | null;
  } | null> {
    const { rows } = await this.pool.query(
      `select id, conversation_id, conversation_ref, decision, scope, decided_at, valid_until, decision_text
       from public.consent_decisions
       where conversation_id = $1 or conversation_ref = $1
       order by decided_at desc, id desc limit 1`,
      [conversationRef],
    );
    if (!rows[0]) return null;
    const r = rows[0];
    return {
      id: r.id as string,
      conversationId: (r.conversation_id as string | null) ?? null,
      conversationRef: (r.conversation_ref as string | null) ?? null,
      decision: r.decision as boolean,
      scope: r.scope as string,
      decidedAt: new Date(r.decided_at as string),
      validUntil: r.valid_until ? new Date(r.valid_until as string) : null,
      decisionText: (r.decision_text as string | null) ?? null,
    };
  }
}

export class PgAuditRepo implements AuditRepo {
  constructor(private readonly pool: Pool) {}

  async append(entry: AuditEntry): Promise<void> {
    await this.pool.query(
      `insert into public.audit_log (actor_type, actor_id, action, entity_type, entity_id, detail)
       values ($1, $2, $3, $4, $5, $6)`,
      [entry.actorType, entry.actorId, entry.action, entry.entityType, entry.entityId, JSON.stringify(entry.detail)],
    );
  }
}

export class PgBusinessConfigRepo implements BusinessConfigRepo {
  constructor(private readonly pool: Pool) {}

  async latest(category: string): Promise<{ content: Record<string, unknown>; version: number } | null> {
    const { rows } = await this.pool.query(
      `select content, version from public.business_config where category = $1 order by version desc limit 1`,
      [category],
    );
    if (!rows[0]) return null;
    return { content: rows[0].content as Record<string, unknown>, version: rows[0].version as number };
  }
}

const BOOKING_STATE_SELECT =
  "conversation_id, state, extracted, offered_slot, offer_expires_at, confirmation_token_hash, " +
  "calendar_idempotency_key, unresolved_since, reconciliation_attempts, last_reconciled_at, " +
  "escalated_at, attempts, last_error, updated_at";

function mapConversation(r: Record<string, unknown>): ConversationRow {
  return {
    id: r.id as string,
    customerId: (r.customer_id as string | null) ?? null,
    channel: r.channel as ConversationRow["channel"],
    status: r.status as ConversationRow["status"],
    accessTokenHash: r.access_token_hash as string,
    consentRecording: r.consent_recording as boolean,
    startedAt: new Date(r.started_at as string),
  };
}

function mapMessage(r: Record<string, unknown>): MessageRow {
  return {
    id: r.id as string,
    conversationId: r.conversation_id as string,
    role: r.role as MessageRow["role"],
    content: r.content as string,
    contentType: r.content_type as MessageRow["contentType"],
    corrected: r.corrected as boolean,
    createdAt: new Date(r.created_at as string),
  };
}

function mapBookingState(r: Record<string, unknown>): BookingStateRow {
  return {
    conversationId: r.conversation_id as string,
    state: r.state as BookingState,
    extracted: (r.extracted as Record<string, unknown>) ?? {},
    offeredSlot: r.offered_slot ? new Date(r.offered_slot as string) : null,
    offerExpiresAt: r.offer_expires_at ? new Date(r.offer_expires_at as string) : null,
    confirmationTokenHash: (r.confirmation_token_hash as string | null) ?? null,
    calendarIdempotencyKey: (r.calendar_idempotency_key as string | null) ?? null,
    unresolvedSince: r.unresolved_since ? new Date(r.unresolved_since as string) : null,
    reconciliationAttempts: r.reconciliation_attempts as number,
    lastReconciledAt: r.last_reconciled_at ? new Date(r.last_reconciled_at as string) : null,
    escalatedAt: r.escalated_at ? new Date(r.escalated_at as string) : null,
    attempts: r.attempts as number,
    lastError: (r.last_error as string | null) ?? null,
    updatedAt: new Date(r.updated_at as string),
  };
}
