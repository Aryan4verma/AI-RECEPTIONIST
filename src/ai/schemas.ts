import { z } from "zod";

/**
 * AI output schemas (FR-2/FR-3, ai-handoff contract). Every provider response
 * is validated HERE by trusted backend code before any domain use (SEC-12).
 * Fields carry known/unknown/ambiguous states — the model never causes a guess.
 */
export const AI_SCHEMA_VERSION = 1;

export const INTENTS = [
  "book_appointment",
  "cancel_appointment",
  "reschedule_appointment",
  "ask_question",
  "property_enquiry",
  "greeting",
  "chitchat",
  "request_human",
  "unknown",
] as const;

export const intentSchema = z.strictObject({
  schema_version: z.literal(AI_SCHEMA_VERSION),
  intent: z.enum(INTENTS),
  confidence_note: z.string().max(200).optional(), // free text, never a fabricated score
});

export type IntentResult = z.infer<typeof intentSchema>;

/** Field states per FR-3: missing/ambiguous are explicit, never guessed. */
export const fieldState = <T extends z.ZodTypeAny>(value: T) =>
  z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("known"), value }),
    z.strictObject({ state: z.literal("unknown"), reason: z.string().max(200) }),
    z.strictObject({ state: z.literal("ambiguous"), reason: z.string().max(200), candidates: z.array(z.string().max(200)).max(5) }),
  ]);

export const knownDate = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), "must be an RFC 3339 timestamp");

export const extractionSchema = z.strictObject({
  schema_version: z.literal(AI_SCHEMA_VERSION),
  customer_name: fieldState(z.string().min(1).max(200)),
  contact: fieldState(z.string().min(3).max(200)),
  purpose: fieldState(z.string().min(1).max(500)),
  requested_time: fieldState(knownDate),
  duration_minutes: fieldState(z.coerce.number().int().min(5).max(480)),
  meeting_type: fieldState(z.string().min(1).max(100)),
  notes: z.string().max(2000).optional(),
});

export type ExtractionResult = z.infer<typeof extractionSchema>;
