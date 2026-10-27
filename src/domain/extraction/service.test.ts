import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { LLMProvider, StructuredOutcome, StructuredRequest } from "../../ai/types.js";
import { extractionSchema, type ExtractionResult } from "../../ai/schemas.js";
import { MemoryBusinessConfigRepo } from "../../db/memory/stores.js";
import { emptyExtraction } from "./service.js";
import { ExtractionService } from "./service.js";

/** Scripted extraction provider: one structured response per call. */
function scriptedExtraction(responses: Array<Partial<ExtractionResult> | "malformed">): LLMProvider {
  let call = 0;
  return {
    kind: "local",
    adapter: "ollama",
    async discoverModels() {
      return [];
    },
    async structured<T extends z.ZodTypeAny>(request: StructuredRequest<T>): Promise<StructuredOutcome<T>> {
      const response = responses[Math.min(call, responses.length - 1)];
      call += 1;
      const schema = request.schema as unknown as z.ZodType<ExtractionResult>;
      const candidate =
        response === "malformed"
          ? { schema_version: 1 }
          : { ...emptyExtraction(), schema_version: 1, ...response };
      const parsed = schema.safeParse(candidate);
      if (!parsed.success) {
        return { status: "invalid_output", reason: "scripted", raw: "" } as StructuredOutcome<T>;
      }
      return { status: "ok", value: parsed.data as never, raw: "" } as StructuredOutcome<T>;
    },
    async healthCheck() {
      return { ok: true };
    },
  };
}

const config = new MemoryBusinessConfigRepo({
  hours: { content: { timezone: "Europe/Berlin" }, version: 1 },
  appointment_types: { content: { default_duration_minutes: 45 }, version: 1 },
});

const future = new Date(Date.now() + 7 * 24 * 60 * 60_000);
const futureIso = new Date(future.getTime() - tzOffset(future, "Europe/Berlin")).toISOString();

function tzOffset(instant: Date, timezone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, hour12: false, year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const parts = dtf.formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  return (Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second")) - instant.getTime()) / 60_000;
}

function makeService(responses: Array<Partial<ExtractionResult> | "malformed">): ExtractionService {
  return new ExtractionService({ provider: scriptedExtraction(responses), config });
}

const completeTurn: Partial<ExtractionResult> = {
  customer_name: { state: "known", value: "Asha Verma" },
  contact: { state: "known", value: "asha@example.com" },
  purpose: { state: "known", value: "Dentist consultation" },
  requested_time: { state: "known", value: futureIso },
  duration_minutes: { state: "known", value: 45 },
  meeting_type: { state: "known", value: "in-person" },
};

describe("FR-3 extraction service", () => {
  it("time shortcuts do not suppress an explicit source-checked identity correction", async () => {
    const svc = new ExtractionService({ provider: scriptedExtraction([{ customer_name: { state: "known", value: "Jane Doe" } }]), config, now: () => new Date("2026-10-27T08:00:00Z") });
    const current = { ...emptyExtraction(), ...completeTurn, requested_time: { state: "unknown", reason: "not supplied" } } as ExtractionResult;
    const result = await svc.mergeTurn(current, "My name is Jane Doe; 28 October at 3 pm.");
    expect(result.customer_name).toEqual({ state: "known", value: "Jane Doe" });
    expect(result.requested_time).toEqual({ state: "known", value: "2026-10-28T15:00:00" });
  });
  it("an exact site-visit request supplies only its stated purpose without expensive inference", async () => {
    const provider = scriptedExtraction(["malformed"]);
    provider.structured = async () => { throw new Error("unnecessary inference"); };
    const service = new ExtractionService({ provider, config });
    const result = await service.mergeTurn(null, "Can I book a site visit?");
    expect(result.purpose).toEqual({ state: "known", value: "site visit" });
    expect(service.missingFields(result)).toContain("customer_name");
    expect(service.missingFields(result)).toContain("contact");
    expect(service.missingFields(result)).toContain("requested_time");
  });
  it.each(["missing", "stale"])("a %s appointment time uses a trusted clock and cannot replace verified identity", async mode => {
    const requests: StructuredRequest<z.ZodTypeAny>[] = [];
    const provider: LLMProvider = {
      ...scriptedExtraction(["malformed"]),
      structured: async request => {
        requests.push(request);
        const value = request.schema.parse({ requested_time: { state: "known", value: "2026-10-28T15:00:00" } });
        return { status: "ok", value, raw: "" };
      },
    };
    const svc = new ExtractionService({ provider, config, businessDefaults: { defaultTimezone: "Asia/Kolkata", defaultDurationMinutes: 30 }, now: () => new Date("2026-10-27T08:00:00Z") });
    const current = { ...emptyExtraction(), ...completeTurn, requested_time: mode === "missing" ? { state: "unknown", reason: "not supplied" } : { state: "known", value: "2024-10-28T15:00:00" } } as ExtractionResult;
    const result = await svc.mergeTurn(current, "Book my site visit on 28 October at 3 pm.");
    expect(result.customer_name).toEqual(current.customer_name);
    expect(result.contact).toEqual(current.contact);
    expect((await svc.resolve(result))?.start.toISOString()).toBe("2026-10-28T09:30:00.000Z");
    expect(requests).toHaveLength(0); // the explicit date cannot be lost to model uncertainty
  });
  it("discards invented name/contact values rather than persisting model placeholders", async () => {
    const svc = makeService([{ customer_name: { state: "known", value: "John Doe" }, contact: { state: "known", value: "john@example.com" } }]);
    const result = await svc.mergeTurn(null, "Can I book a site visit for tomorrow?");
    expect(result.customer_name.state).toBe("unknown");
    expect(result.contact.state).toBe("unknown");
  });
  it("merges known values across turns; known values are sticky", async () => {
    const svc = makeService([
      { customer_name: { state: "known", value: "Asha Verma" } },
      { contact: { state: "known", value: "asha@example.com" } },
    ]);
    const turn1 = await svc.mergeTurn(null, "My name is Asha Verma");
    expect(turn1.customer_name.state).toBe("known");
    const turn2 = await svc.mergeTurn(turn1, "reach me at asha@example.com");
    expect(turn2.customer_name).toMatchObject({ state: "known", value: "Asha Verma" });
    expect(turn2.contact.state).toBe("known");
    const missing = svc.missingFields(turn2);
    expect(missing).toContain("purpose");
  });

  it("malformed model output keeps the prior state — never guesses", async () => {
    const svc = makeService(["malformed"]);
    const merged = await svc.mergeTurn(null, "book me tomorrow");
    expect(merged).toEqual({ ...emptyExtraction(), requested_time: expect.objectContaining({ state: "unknown" }) });
    expect(svc.isComplete(merged)).toBe(false);
  });

  it("produces a follow-up question for the first missing field", async () => {
    const svc = makeService([{ purpose: { state: "known", value: "checkup" } }]);
    const partial = await svc.mergeTurn(null, "I need a checkup");
    const missing = svc.missingFields(partial);
    expect(missing[0]).toBe("customer_name");
    expect(svc.followUp(missing)).toBe("May I have your full name?");
  });

  it("resolves a complete extraction with business-config defaults (duration/timezone)", async () => {
    const svc = makeService([completeTurn]);
    const merged = await svc.mergeTurn(null, "Asha Verma, asha@example.com, dentist consultation next week in person");
    const resolved = await svc.resolve(merged);
    expect(resolved).not.toBeNull();
    expect(resolved?.durationMinutes).toBe(45); // config default, not 30
    expect(resolved?.timezone).toBe("Europe/Berlin");
    expect(resolved?.start.getTime()).toBeGreaterThan(Date.now());
  });

  it("rejects a past requested time at resolution", async () => {
    const past = new Date(Date.now() - 24 * 60 * 60_000);
    const svc = makeService([
      { ...completeTurn, requested_time: { state: "known", value: past.toISOString() } },
    ]);
    const merged = await svc.mergeTurn(null, "Asha Verma, asha@example.com, yesterday please");
    await expect(svc.resolve(merged)).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("strict schema: unknown keys and oversized payloads are rejected by the provider path", async () => {
    expect(extractionSchema.safeParse({ ...emptyExtraction(), admin: true }).success).toBe(false);
    expect(
      extractionSchema.safeParse({
        ...emptyExtraction(),
        notes: "x".repeat(5000),
      }).success,
    ).toBe(false);
  });
});
