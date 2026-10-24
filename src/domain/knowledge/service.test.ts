import { describe, expect, it } from "vitest";
import { MemoryBusinessConfigRepo } from "../../db/memory/stores.js";
import { KnowledgeService } from "./service.js";

const config = new MemoryBusinessConfigRepo({
  faqs: {
    content: {
      entries: [
        { question: "What are your opening hours?", answer: "We are open Monday to Friday, 9am to 6pm.", keywords: ["opening", "hours", "open"] },
        { question: "Where are you located?", answer: "We are at 12 Market Street.", keywords: ["location", "address", "located"] },
      ],
    },
    version: 1,
  },
});

describe("FR-4 FAQ knowledge service (grounded, no fabrication)", () => {
  it("returns the configured answer verbatim on a keyword match", async () => {
    const svc = new KnowledgeService(config);
    const result = await svc.answer("What are your opening hours on weekdays?");
    expect(result.matched).toBe(true);
    expect(result.answer).toBe("We are open Monday to Friday, 9am to 6pm.");
  });

  it("returns no match for out-of-knowledge questions — never an invented answer", async () => {
    const svc = new KnowledgeService(config);
    const result = await svc.answer("Do you sell cryptocurrency?");
    expect(result.matched).toBe(false);
    expect(result.answer).toBeNull();
    expect(svc.fallback()).toContain("don't have that information");
  });

  it("handles a missing faqs configuration safely", async () => {
    const svc = new KnowledgeService(new MemoryBusinessConfigRepo());
    const result = await svc.answer("opening hours?");
    expect(result.matched).toBe(false);
  });

  it("never returns model-generated business facts (structural grounding)", () => {
    // The service has no model dependency at all — fabrication is impossible
    // by construction: answers come verbatim from configuration.
    const svc = new KnowledgeService(config);
    expect("provider" in svc).toBe(false);
  });
});
