import { describe, expect, it } from "vitest";
import { OllamaProvider } from "../../ai/ollamaProvider.js";
import { MemoryAuditRepo, MemoryBookingStateRepo, MemoryBusinessConfigRepo, MemoryConsentRepo, MemoryConversationRepo } from "../../db/memory/stores.js";
import { ConversationService } from "./service.js";
import { ExtractionService } from "../extraction/service.js";

/** Real local model, synthetic text, in-memory records; no microphone/STT/remote writes. */
describe.skipIf(process.env.CLEARDESK_LIVE !== "1")("real qwen3:1.7b property enquiry", () => {
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
      await service.recordCustomerMessage(row.id, text);
      const result = await service.handleCustomerTurn(row, text);
      console.log("[local-model synthetic]", { text, intent: result.intent, reply: result.reply });
      return result;
    };
    expect((await turn("Hello.")).intent).toBe("greeting");
    const property = await turn("I want to buy a 3BHK flat.");
    expect(property.intent).toBe("property_enquiry");
    expect(property.reply).toContain("3BHK");
    expect(property.reply).toContain("location");
    const budget = await turn("My budget is around 80 lakh.");
    expect(budget.intent).toBe("property_enquiry");
    expect(budget.reply).toContain("3BHK");
    expect(budget.reply).toContain("80 lakh");
    expect(budget.reply).not.toContain("What budget");
    const visit = await turn("Can I book a site visit for tomorrow?");
    expect(visit.intent).toBe("book_appointment");
    expect(visit.extractionComplete).toBe(false);
    expect(visit.reply).toContain("name");
    expect(visit.offer).toBeUndefined();
  });
});
