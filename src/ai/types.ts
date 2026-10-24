import type { z } from "zod";
import type { AppError } from "../server/errors.js";

/**
 * Unified LLM provider port (ADR-0003). Domain logic depends on this port
 * only; adapters are added without domain change. Provider capability
 * differences (structured output support etc.) are declared per adapter and
 * verified — never assumed identical (CH-1.B).
 */
export interface StructuredRequest<T extends z.ZodTypeAny> {
  /** System-level instructions — kept strictly separate from untrusted data (SEC-8). */
  system: string;
  /** Untrusted user/conversation content — data, never instructions. */
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  schema: T;
  schemaName: string;
  timeoutMs: number;
  maxOutputTokens: number;
}

export type StructuredOutcome<T extends z.ZodTypeAny> =
  | { status: "ok"; value: z.infer<T>; raw: string }
  | { status: "invalid_output"; reason: string; raw: string }
  | { status: "refused"; raw: string }
  | { status: "error"; error: AppError };

export interface DiscoveredModel {
  name: string;
  sizeBytes?: number;
  family?: string;
  parameterSize?: string;
}

export interface LLMProvider {
  readonly kind: "local" | "cloud";
  readonly adapter: "ollama" | "openai_compatible";
  /** FR-15: discovery reflects ACTUAL models — never a fabricated list. */
  discoverModels(): Promise<DiscoveredModel[]>;
  structured<T extends z.ZodTypeAny>(request: StructuredRequest<T>): Promise<StructuredOutcome<T>>;
  healthCheck(): Promise<{ ok: boolean; error?: string }>;
}
