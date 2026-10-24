import { describe, expect, it } from "vitest";
import { AI_SCHEMA_VERSION, extractionSchema, intentSchema } from "./schemas.js";

const validExtraction = {
  schema_version: AI_SCHEMA_VERSION,
  customer_name: { state: "known", value: "Asha" },
  contact: { state: "unknown", reason: "not provided" },
  purpose: { state: "known", value: "Consultation" },
  requested_time: { state: "known", value: "2026-10-30T10:00:00Z" },
  duration_minutes: { state: "known", value: 30 },
  meeting_type: { state: "known", value: "in-person" },
};

describe("AI output schemas — bounded-input and malformed-payload defenses (SEC-F6 remediation)", () => {
  it("accepts a well-formed extraction with explicit unknown states", () => {
    const parsed = extractionSchema.safeParse(validExtraction);
    expect(parsed.success).toBe(true);
  });

  it("rejects an oversized string field (bounded inputs)", () => {
    const attack = { ...validExtraction, notes: "A".repeat(100_000) };
    expect(extractionSchema.safeParse(attack).success).toBe(false);
  });

  it("rejects oversized candidate lists in ambiguous states", () => {
    const attack = {
      ...validExtraction,
      customer_name: { state: "ambiguous", reason: "unclear", candidates: Array(50).fill("x") },
    };
    expect(extractionSchema.safeParse(attack).success).toBe(false);
  });

  it("rejects unknown top-level keys (no structure injection)", () => {
    const attack = { ...validExtraction, admin: true, sql: "drop table customers" };
    expect(extractionSchema.safeParse(attack).success).toBe(false);
  });

  it("rejects an unparseable/oversized intent payload", () => {
    expect(intentSchema.safeParse({ schema_version: AI_SCHEMA_VERSION, intent: "unknown", confidence_note: "x".repeat(500) }).success).toBe(false);
    expect(intentSchema.safeParse({ schema_version: AI_SCHEMA_VERSION, intent: "DELETE_ALL" }).success).toBe(false);
  });

  it("rejects deeply nested payloads (no unbounded recursion surface)", () => {
    let deep: Record<string, unknown> = { value: 1 };
    for (let i = 0; i < 5_000; i++) deep = { nested: deep };
    const attack = { ...validExtraction, purpose: { state: "known", value: deep } };
    expect(extractionSchema.safeParse(attack).success).toBe(false);
  });

  it("enforces the schema_version literal", () => {
    expect(extractionSchema.safeParse({ ...validExtraction, schema_version: 2 }).success).toBe(false);
  });
});
