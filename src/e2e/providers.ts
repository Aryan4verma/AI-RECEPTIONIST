import { z } from "zod";
import type { DiscoveredModel, LLMProvider, StructuredOutcome, StructuredRequest } from "../ai/types.js";
import type { ExtractionResult, IntentResult } from "../ai/schemas.js";
import { emptyExtraction } from "../domain/extraction/service.js";

/** Test-only scripted intent provider (fixture scope). */
export function scriptedProvider(responses: Array<{ intent: string } | "malformed">): LLMProvider {
  let call = 0;
  return {
    kind: "local",
    adapter: "ollama",
    async discoverModels(): Promise<DiscoveredModel[]> {
      return [{ name: "qwen3:1.7b" }];
    },
    async structured<T extends z.ZodTypeAny>(request: StructuredRequest<T>): Promise<StructuredOutcome<T>> {
      const response = responses[Math.min(call, responses.length - 1)];
      call += 1;
      const schema = request.schema as unknown as z.ZodType<IntentResult>;
      const parsed = schema.safeParse(
        response === "malformed" ? { schema_version: 1, intent: "unknown" } : { schema_version: 1, ...response },
      );
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

/** Test-only scripted extraction provider (fixture scope). */
export function scriptedExtractionProvider(
  responses: Array<Partial<ExtractionResult> | "malformed">,
): LLMProvider {
  let call = 0;
  return {
    kind: "local",
    adapter: "ollama",
    async discoverModels(): Promise<DiscoveredModel[]> {
      return [{ name: "qwen3:1.7b" }];
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
