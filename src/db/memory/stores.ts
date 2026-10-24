import { randomUUID } from "node:crypto";
import type { BookingEvent, BookingState } from "../../domain/booking/machine.js";
import { transition } from "../../domain/booking/machine.js";
import type {
  AuditEntry,
  AuditRepo,
  BookingStateRepo,
  BookingStateRow,
  BusinessConfigRepo,
  ConsentDecisionRow,
  ConsentRepo,
  ConversationRepo,
  ConversationRow,
  MessageRow,
} from "../ports.js";

/**
 * In-memory repository implementations (unit/dev scope). The pg implementations
 * in src/db/pg honor the same ports; live-DB contract tests run once runtime
 * credentials exist. Mock-based evidence is always labeled as such.
 */

export class MemoryConversationRepo implements ConversationRepo {
  readonly rows = new Map<string, ConversationRow>();
  readonly messages: MessageRow[] = [];

  async create(input: { channel: "text" | "voice"; accessTokenHash: string }): Promise<ConversationRow> {
    const row: ConversationRow = {
      id: randomUUID(),
      customerId: null,
      channel: input.channel,
      status: "active",
      accessTokenHash: input.accessTokenHash,
      consentRecording: false,
      startedAt: new Date(),
    };
    this.rows.set(row.id, row);
    return row;
  }

  async findByIdAndTokenHash(id: string, tokenHash: string): Promise<ConversationRow | null> {
    const row = this.rows.get(id);
    return row && row.accessTokenHash === tokenHash ? row : null;
  }

  async updateStatus(id: string, status: ConversationRow["status"]): Promise<void> {
    const row = this.rows.get(id);
    if (row) row.status = status;
  }

  async insertMessage(input: {
    conversationId: string;
    role: MessageRow["role"];
    content: string;
    contentType?: MessageRow["contentType"];
  }): Promise<MessageRow> {
    const row: MessageRow = {
      id: randomUUID(),
      conversationId: input.conversationId,
      role: input.role,
      content: input.content,
      contentType: input.contentType ?? "text",
      corrected: false,
      createdAt: new Date(),
    };
    this.messages.push(row);
    return row;
  }

  async listMessages(conversationId: string, limit = 50): Promise<MessageRow[]> {
    return this.messages.filter((m) => m.conversationId === conversationId).slice(-limit);
  }
}

export class MemoryBookingStateRepo implements BookingStateRepo {
  readonly rows = new Map<string, BookingStateRow>();
  readonly appointments: Array<Record<string, unknown>> = [];
  /** Simulates a concurrent-writer losing race in tests when set. */
  public conflictExpectedState: BookingState | null = null;

  async ensure(conversationId: string): Promise<BookingStateRow> {
    let row = this.rows.get(conversationId);
    if (!row) {
      row = {
        conversationId,
        state: "COLLECT_DETAILS",
        extracted: {},
        offeredSlot: null,
        offerExpiresAt: null,
        confirmationTokenHash: null,
        calendarIdempotencyKey: null,
        unresolvedSince: null,
        reconciliationAttempts: 0,
        lastReconciledAt: null,
        escalatedAt: null,
        attempts: 0,
        lastError: null,
        updatedAt: new Date(),
      };
      this.rows.set(conversationId, row);
    }
    return row;
  }

  async get(conversationId: string): Promise<BookingStateRow | null> {
    return (await this.ensure(conversationId)) ?? null;
  }

  async transition(input: {
    conversationId: string;
    expectedState: BookingState;
    event: BookingEvent;
    patch: Partial<BookingStateRow>;
  }): Promise<BookingStateRow> {
    const row = await this.ensure(input.conversationId);
    if (this.conflictExpectedState && row.state !== this.conflictExpectedState) {
      throw new Error("booking_conflict");
    }
    if (row.state !== input.expectedState) {
      throw new Error("booking_conflict");
    }
    const result = transition(row.state, input.event);
    if (!result.ok) throw new Error(`illegal_transition: ${row.state} --${input.event}--> ${result.next}`);
    Object.assign(row, input.patch, { state: result.next, updatedAt: new Date() });
    return row;
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
    const id = randomUUID();
    this.appointments.push({ id, ...input });
    return { id };
  }

  async registerAppointment(input: {
    conversationId: string;
    expectedState: BookingState;
    idempotencyKey: string;
    scheduledStart: Date;
    scheduledEnd: Date;
    durationMinutes: number;
    timezone: string;
    serviceType?: string;
    purpose?: string;
    meetingType?: string;
    notes?: string;
  }): Promise<{ appointmentId: string }> {
    // Single-threaded memory store: the CAS check + insert are effectively atomic.
    const row = await this.transition({
      conversationId: input.conversationId,
      expectedState: input.expectedState,
      event: "RECHECK_PASSED",
      patch: { calendarIdempotencyKey: input.idempotencyKey },
    });
    const id = randomUUID();
    this.appointments.push({
      id,
      conversationId: input.conversationId,
      idempotencyKey: input.idempotencyKey,
      scheduledStart: input.scheduledStart,
      scheduledEnd: input.scheduledEnd,
      durationMinutes: input.durationMinutes,
      timezone: input.timezone,
      status: "pending_confirmation",
      serviceType: input.serviceType,
      purpose: input.purpose,
      meetingType: input.meetingType,
      notes: input.notes,
      stateAfterRegister: row.state,
    });
    return { appointmentId: id };
  }

  async updateAppointmentOutcome(
    appointmentId: string,
    outcome: { status: string; googleEventId?: string },
  ): Promise<void> {
    const appt = this.appointments.find((a) => a.id === appointmentId);
    if (!appt) throw new Error("appointment not found");
    appt["status"] = outcome.status;
    if (outcome.googleEventId !== undefined) appt["googleEventId"] = outcome.googleEventId;
  }

  async findAppointmentByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<{ id: string; status: string; googleEventId: string | null } | null> {
    const appt = this.appointments.find((a) => a["idempotencyKey"] === idempotencyKey);
    return appt
      ? {
          id: appt["id"] as string,
          status: appt["status"] as string,
          googleEventId: (appt["googleEventId"] as string | null) ?? null,
        }
      : null;
  }

  async findOpenAppointmentByConversation(
    conversationId: string,
  ): Promise<{
    id: string;
    status: string;
    idempotencyKey: string;
    scheduledStart: Date;
    scheduledEnd: Date;
    durationMinutes: number;
    timezone: string;
  } | null> {
    const appt = this.appointments.find(
      (a) =>
        a["conversationId"] === conversationId &&
        ["pending_confirmation", "unresolved"].includes(a["status"] as string),
    );
    return appt
      ? {
          id: appt["id"] as string,
          status: appt["status"] as string,
          idempotencyKey: appt["idempotencyKey"] as string,
          scheduledStart: appt["scheduledStart"] as Date,
          scheduledEnd: appt["scheduledEnd"] as Date,
          durationMinutes: appt["durationMinutes"] as number,
          timezone: appt["timezone"] as string,
        }
      : null;
  }

  async repairIdentity(conversationId: string, idempotencyKey: string): Promise<void> {
    const row = this.rows.get(conversationId);
    if (row) row.calendarIdempotencyKey = idempotencyKey;
  }
}

export class MemoryConsentRepo implements ConsentRepo {
  readonly rows: ConsentDecisionRow[] = [];

  async record(input: {
    conversationId: string;
    conversationRef: string;
    decision: boolean;
    decisionText?: string;
    scope?: string;
  }): Promise<void> {
    this.rows.push({
      id: randomUUID(),
      conversationId: input.conversationId,
      conversationRef: input.conversationRef,
      decision: input.decision,
      scope: input.scope ?? "recording",
      decidedAt: new Date(),
      validUntil: null,
      decisionText: input.decisionText ?? null,
    });
  }

  async latest(conversationRef: string): Promise<ConsentDecisionRow | null> {
    const matches = this.rows
      .filter((r) => r.conversationRef === conversationRef || r.conversationId === conversationRef)
      .sort((a, b) => b.decidedAt.getTime() - a.decidedAt.getTime());
    return matches[0] ?? null;
  }
}

export class MemoryAuditRepo implements AuditRepo {
  readonly entries: AuditEntry[] = [];
  async append(entry: AuditEntry): Promise<void> {
    this.entries.push(entry);
  }
}

export class MemoryBusinessConfigRepo implements BusinessConfigRepo {
  constructor(private readonly data: Record<string, { content: Record<string, unknown>; version: number }> = {}) {}
  async latest(category: string) {
    return this.data[category] ?? null;
  }
}
