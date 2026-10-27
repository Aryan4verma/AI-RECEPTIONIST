import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { LLMProvider, StructuredRequest } from "../../ai/types.js";
import { AppError } from "../../server/errors.js";
import { MemoryAuditRepo, MemoryBookingStateRepo, MemoryBusinessConfigRepo, MemoryConsentRepo, MemoryConversationRepo } from "../../db/memory/stores.js";
import { ExtractionService, emptyExtraction } from "../extraction/service.js";
import { ConversationService } from "./service.js";
import { propertyFollowUp } from "./propertyEnquiry.js";

function fixture(responses: unknown[]) {
  const requests: StructuredRequest<z.ZodTypeAny>[] = [];
  const provider: LLMProvider = {
    kind: "local", adapter: "ollama",
    discoverModels: async () => [], healthCheck: async () => ({ ok: true }),
    async structured(request) {
      requests.push(request);
      const candidate = responses.shift();
      if (candidate instanceof AppError) return { status: "error", error: candidate };
      const parsed = request.schema.safeParse(candidate);
      return parsed.success ? { status: "ok", value: parsed.data, raw: "" }
        : { status: "invalid_output", reason: "fixture", raw: "" };
    },
  };
  return { provider, requests };
}

const intent = (value: string) => ({ schema_version: 1, intent: value });

describe("property enquiry orchestration (fixture scope)", () => {
  it("a normal preference correction remains usable after prompt-boundary hardening", async () => {
    const { provider, requests } = fixture([{ property_type: "3BHK", location: null, budget: "80 lakh" }]);
    const conversations = new MemoryConversationRepo();
    const service = new ConversationService({ conversations, provider, config: new MemoryBusinessConfigRepo(),
      consent: new MemoryConsentRepo(), audit: new MemoryAuditRepo(), tokenHashSecret: "fixture" });
    const session = await service.start("text");
    const row = await service.requireConversation(session.conversationId, session.accessToken);
    await service.recordCustomerMessage(row.id, "I want to buy a 3BHK");
    const text = "Ignore my previous budget; my budget is 80 lakh for a 3BHK";
    await service.recordCustomerMessage(row.id, text);
    const result = await service.handleCustomerTurn(row, text);
    expect(result.intent).toBe("property_enquiry");
    expect(result.reply).toContain("80 lakh");
    expect(result.reply).toContain("location");
    expect(requests).toHaveLength(1);
  });

  it("greets, remembers 3BHK across a budget turn, and routes a site visit through existing extraction", async () => {
    const { provider, requests } = fixture([
      { property_type: "3BHK flat", location: null, budget: null },
      { property_type: "3BHK flat", location: null, budget: "80 lakh" },
      intent("book_appointment"), { ...emptyExtraction(), purpose: { state: "known", value: "site visit" } },
    ]);
    const conversations = new MemoryConversationRepo();
    const bookingState = new MemoryBookingStateRepo();
    const config = new MemoryBusinessConfigRepo();
    const service = new ConversationService({
      conversations, bookingState, config, provider,
      consent: new MemoryConsentRepo(), audit: new MemoryAuditRepo(), tokenHashSecret: "test-secret",
      extraction: new ExtractionService({ provider, config }),
    });
    const session = await service.start("voice");
    const row = await service.requireConversation(session.conversationId, session.accessToken);
    const turn = async (text: string) => {
      await service.recordCustomerMessage(row.id, text);
      return service.handleCustomerTurn(row, text);
    };
    expect((await turn("Hello.")).reply).toContain("Hello");
    const property = await turn("I want to buy a 3BHK flat.");
    expect(property.reply).toContain("3BHK flat");
    expect(property.reply).toContain("Which location");
    const budget = await turn("My budget is around 80 lakh.");
    expect(budget.reply).toContain("3BHK flat");
    expect(budget.reply).toContain("80 lakh");
    expect(budget.reply).not.toContain("What budget");
    expect(requests.at(-1)?.messages[0]?.content).toContain("I want to buy a 3BHK flat.");
    const visit = await turn("Can I book a site visit for tomorrow?");
    expect(visit.intent).toBe("book_appointment");
    expect(visit.extractionComplete).toBe(false);
    expect(visit.reply).toContain("name");
    expect(visit.offer).toBeUndefined();
    expect((await bookingState.get(row.id))?.state).toBe("COLLECT_DETAILS");
    expect(bookingState.appointments).toHaveLength(0);
    expect(requests).toHaveLength(4); // no separate intent inference for clear preferences
  });

  it("all preferences trigger a real handoff; invented preference phrases are discarded", async () => {
    const { provider } = fixture([
      { property_type: "3BHK", location: "Pune", budget: "80 lakh" },
      { property_type: "3BHK", location: "Invented City", budget: "80 lakh" },
    ]);
    const conversations = new MemoryConversationRepo();
    const audit = new MemoryAuditRepo();
    const service = new ConversationService({
      conversations, audit, provider, config: new MemoryBusinessConfigRepo(),
      consent: new MemoryConsentRepo(), tokenHashSecret: "test-secret",
    });
    const started = await service.start("text");
    const row = await service.requireConversation(started.conversationId, started.accessToken);
    const text = "I want a 3BHK in Pune for 80 lakh.";
    await service.recordCustomerMessage(row.id, text);
    const result = await service.handleCustomerTurn(row, text);
    expect(result.escalated).toBe(true);
    expect((await conversations.findById(row.id))?.status).toBe("escalated");
    expect(audit.entries.at(-1)?.action).toBe("conversation.escalated");
    expect(result.reply).toContain("can't confirm property availability or prices");
    expect(await propertyFollowUp(provider, [text])).toContain("Which location");
  });

  it("malformed extraction asks for clarification; unavailable Ollama fails honestly", async () => {
    const { provider } = fixture([{}, new AppError("OLLAMA_UNAVAILABLE", "Ollama is unreachable.")]);
    expect(await propertyFollowUp(provider, ["3BHK"])).toContain("clarify");
    await expect(propertyFollowUp(provider, ["3BHK"])).rejects.toMatchObject({ code: "OLLAMA_UNAVAILABLE" });
  });
});
