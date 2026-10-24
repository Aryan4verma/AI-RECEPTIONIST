import type { BookingEvent, BookingState } from "../domain/booking/machine.js";

/** Conversation record as persisted. */
export interface ConversationRow {
  id: string;
  customerId: string | null;
  channel: "text" | "voice";
  status: "active" | "ended" | "escalated" | "expired";
  accessTokenHash: string;
  consentRecording: boolean;
  startedAt: Date;
}

export interface MessageRow {
  id: string;
  conversationId: string;
  role: "customer" | "assistant" | "system";
  content: string;
  contentType: "text" | "transcript";
  corrected: boolean;
  createdAt: Date;
}

export interface BookingStateRow {
  conversationId: string;
  state: BookingState;
  extracted: Record<string, unknown>;
  offeredSlot: Date | null;
  offerExpiresAt: Date | null;
  confirmationTokenHash: string | null;
  calendarIdempotencyKey: string | null;
  unresolvedSince: Date | null;
  reconciliationAttempts: number;
  lastReconciledAt: Date | null;
  escalatedAt: Date | null;
  attempts: number;
  lastError: string | null;
  updatedAt: Date;
}

export interface ConsentDecisionRow {
  id: string;
  conversationId: string | null;
  conversationRef: string | null;
  decision: boolean;
  scope: string;
  decidedAt: Date;
  validUntil: Date | null;
  decisionText: string | null;
}

export interface AuditEntry {
  actorType: "customer" | "admin" | "system";
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  detail: Record<string, unknown>;
}

export interface ConversationRepo {
  create(input: { channel: "text" | "voice"; accessTokenHash: string }): Promise<ConversationRow>;
  findByIdAndTokenHash(id: string, tokenHash: string): Promise<ConversationRow | null>;
  updateStatus(id: string, status: ConversationRow["status"]): Promise<void>;
  insertMessage(input: {
    conversationId: string;
    role: MessageRow["role"];
    content: string;
    contentType?: MessageRow["contentType"];
  }): Promise<MessageRow>;
  listMessages(conversationId: string, limit?: number): Promise<MessageRow[]>;
}

export interface BookingStateRepo {
  /** Get current booking state for a conversation (creates COLLECT_DETAILS row lazily). */
  ensure(conversationId: string): Promise<BookingStateRow>;
  get(conversationId: string): Promise<BookingStateRow | null>;
  /** Atomic transition: lock row, validate current state matches expected, apply patch. */
  transition(input: {
    conversationId: string;
    expectedState: BookingState;
    event: BookingEvent;
    patch: Partial<Pick<BookingStateRow, "extracted" | "offeredSlot" | "offerExpiresAt" | "confirmationTokenHash" | "calendarIdempotencyKey" | "unresolvedSince" | "reconciliationAttempts" | "lastReconciledAt" | "escalatedAt" | "attempts" | "lastError">>;
  }): Promise<BookingStateRow>;
  createAppointment(input: {
    conversationId: string;
    idempotencyKey: string;
    scheduledStart: Date;
    scheduledEnd: Date;
    durationMinutes: number;
    timezone: string;
    status: "pending_confirmation" | "confirmed" | "unresolved" | "failed";
    googleEventId?: string;
    serviceType?: string;
    purpose?: string;
    meetingType?: string;
    notes?: string;
  }): Promise<{ id: string }>;
  /**
   * Atomic registration: locks the booking-state row, validates the expected
   * state, applies the RECHECK_PASSED transition AND inserts the appointment
   * with the durable identity in one transaction — concurrent confirmations
   * cannot create orphaned or duplicate appointment rows.
   */
  registerAppointment(input: {
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
  }): Promise<{ appointmentId: string }>;
  /** Persist the truthful outcome of a calendar operation (SEC-13). */
  updateAppointmentOutcome(
    appointmentId: string,
    outcome: { status: "confirmed" | "unresolved" | "failed"; googleEventId?: string },
  ): Promise<void>;
  findAppointmentByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<{ id: string; status: string; googleEventId: string | null } | null>;
  findOpenAppointmentByConversation(
    conversationId: string,
  ): Promise<{ id: string; status: string; idempotencyKey: string } | null>;
  /** Recovery-path repair: adopt an identity discovered on an open appointment. */
  repairIdentity(conversationId: string, idempotencyKey: string): Promise<void>;
}

export interface ConsentRepo {
  record(input: {
    conversationId: string;
    conversationRef: string;
    decision: boolean;
    decisionText?: string;
    scope?: string;
  }): Promise<void>;
  latest(conversationRef: string): Promise<ConsentDecisionRow | null>;
}

export interface AuditRepo {
  append(entry: AuditEntry): Promise<void>;
}

export interface BusinessConfigRepo {
  latest(category: string): Promise<{ content: Record<string, unknown>; version: number } | null>;
}
