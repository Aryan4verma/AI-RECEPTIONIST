import { describe, expect, it } from "vitest";
import { OllamaProvider } from "../../ai/ollamaProvider.js";
import { MemoryAuditRepo, MemoryBookingStateRepo, MemoryBusinessConfigRepo, MemoryConsentRepo, MemoryConversationRepo } from "../../db/memory/stores.js";
import { ConversationService } from "./service.js";
import { ExtractionService, emptyExtraction } from "../extraction/service.js";
import { freemem } from "node:os";

/** Real local model, synthetic text, in-memory records; no microphone/STT/remote writes. */
describe.skipIf(process.env.CLEARDESK_LIVE !== "1")("real qwen3:1.7b property enquiry", () => {
  it("accepts the owner's natural date follow-up without inventing a past year", { timeout: 60_000 }, async () => {
    const service = new ExtractionService({ provider: new OllamaProvider("http://127.0.0.1:11434", "qwen3:1.7b"), config: new MemoryBusinessConfigRepo(), businessDefaults: { defaultTimezone: "Asia/Kolkata", defaultDurationMinutes: 30 }, now: () => new Date("2026-10-27T08:00:00Z") });
    const known = (value: string) => ({ state: "known" as const, value });
    const current = { ...emptyExtraction(), customer_name: known("Synthetic Test"), contact: known("test@example.invalid"), purpose: known("site visit"), meeting_type: known("in person") };
    const started = Date.now();
    const result = await service.mergeTurn(current, "Book my site visit on 28 October at 3 pm.");
    const resolved = await service.resolve(result);
    console.log("[backend natural date; no model needed]", { latencyMs: Date.now() - started, requestedTime: result.requested_time, utc: resolved?.start.toISOString() });
    expect(resolved?.start.toISOString()).toBe("2026-10-28T09:30:00.000Z");
  });
  it("greets, handles property interest and budget context, then identifies a site-visit request", { timeout: 180_000 }, async () => {
    const conversations = new MemoryConversationRepo();
    const provider = new OllamaProvider("http://127.0.0.1:11434", "qwen3:1.7b");
    const config = new MemoryBusinessConfigRepo();
    const service = new ConversationService({
      conversations, provider, config, audit: new MemoryAuditRepo(),
      bookingState: new MemoryBookingStateRepo(), extraction: new ExtractionService({ provider, config }),
      consent: new MemoryConsentRepo(), tokenHashSecret: "synthetic-live-test",
    });
    const session = await service.start("voice");
    const row = await service.requireConversation(session.conversationId, session.accessToken);
    const turn = async (text: string) => {
      const started = Date.now();
      const freeBefore = freemem();
      await service.recordCustomerMessage(row.id, text);
      const result = await service.handleCustomerTurn(row, text);
      console.log("[local-model synthetic]", { text, intent: result.intent, reply: result.reply, latencyMs: Date.now() - started, freeBeforeMB: Math.round(freeBefore / 1e6), freeAfterMB: Math.round(freemem() / 1e6) });
      return result;
    };
    expect((await turn("Hello.")).intent).toBe("greeting");
    const property = await turn("I want to buy a 3BHK flat.");
    expect(property.intent).toBe("property_enquiry");
    expect(property.reply).toContain("3BHK");
    expect(property.reply).toContain("location");
    const budget = await turn("My budget is 80 lakh.");
    expect(budget.intent).toBe("property_enquiry");
    expect(budget.reply).toContain("3BHK");
    expect(budget.reply).toContain("80 lakh");
    expect(budget.reply).not.toContain("What budget");
    const visit = await turn("Can I book a site visit?");
    expect(visit.intent).toBe("book_appointment");
    expect(visit.extractionComplete).toBe(false);
    expect(visit.reply).toContain("name");
    expect(visit.offer).toBeUndefined();
  });
});
