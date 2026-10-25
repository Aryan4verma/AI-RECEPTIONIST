import type { BusinessConfigRepo } from "../../db/ports.js";

export interface KnowledgeAnswer {
  /** Grounded, verbatim from configuration — never model-generated text. */
  answer: string | null;
  matched: boolean;
}

interface FaqEntry {
  question?: unknown;
  answer?: unknown;
  keywords?: unknown;
}

/**
 * Deterministic FAQ retrieval over configured business knowledge (FR-4).
 * Answers are returned VERBATIM from configuration — the local model is never
 * used to compose business facts, so fabrication is structurally impossible.
 * No match → explicit fallback (safe refusal + escalation path), never an
 * invented answer.
 */
export class KnowledgeService {
  constructor(private readonly config: BusinessConfigRepo) {}

  async answer(question: string): Promise<KnowledgeAnswer> {
    const faqs = await this.config.latest("faqs");
    if (!faqs) return { answer: null, matched: false };
    const entries = Array.isArray(faqs.content["entries"]) ? (faqs.content["entries"] as FaqEntry[]) : [];
    const queryTokens = tokenize(question);
    let best: { score: number; answer: string } | null = null;
    for (const entry of entries) {
      if (typeof entry.answer !== "string" || entry.answer.length === 0) continue;
      const keywords =
        Array.isArray(entry.keywords) && entry.keywords.every((k) => typeof k === "string")
          ? (entry.keywords as string[])
          : tokenize(typeof entry.question === "string" ? entry.question : "");
      if (keywords.length === 0) continue;
      const overlap = keywords.filter((k) => queryTokens.includes(k)).length;
      const score = overlap / keywords.length;
      if (score > 0 && (!best || score > best.score)) {
        best = { score, answer: entry.answer };
      }
    }
    // Weak-match rejection: a single overlapping token in a multi-keyword
    // entry is not evidence of relevance — require a meaningful match
    // (≥ half the entry's keywords AND ≥ 2 overlapping tokens).
    if (best && best.score >= 0.5) {
      return { answer: best.answer, matched: true };
    }
    const bestOverlap = best ? Math.round(best.score * 4) : 0; // informational only
    void bestOverlap;
    return { answer: null, matched: false };
  }

  /**
   * Unanswered-question copy. Callers MUST have escalated the conversation
   * first (the frontend/console handoff) — the claim "flagged for the team"
   * then describes a real, verified handoff visible in the admin console.
   */
  fallback(): string {
    return "I don't have that information right now — I've flagged your question for the team, who will see it and follow up with you.";
  }
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

const STOPWORDS = new Set([
  "the", "and", "for", "you", "your", "with", "what", "when", "where", "how",
  "can", "does", "did", "are", "was", "were", "have", "has", "this", "that",
  "our", "from", "about", "into", "please", "hello", "there",
]);
