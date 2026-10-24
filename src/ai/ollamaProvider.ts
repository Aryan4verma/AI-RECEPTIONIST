import { z } from "zod";
import { AppError } from "../server/errors.js";
import type { DiscoveredModel, LLMProvider, StructuredOutcome, StructuredRequest } from "./types.js";

const tagsResponseSchema = z.object({
  models: z.array(
    z.object({
      name: z.string(),
      size: z.number().optional(),
      details: z
        .object({
          family: z.string().optional(),
          parameter_size: z.string().optional(),
        })
        .optional(),
    }),
  ),
});

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatResponse {
  message?: { content?: string };
  done_reason?: string;
  error?: string;
}

/**
 * Local Ollama provider (localhost-only, SEC-5). Discovery uses Ollama's
 * supported /api/tags endpoint — actual installed models with metadata; an
 * unreachable daemon or empty list is reported honestly (FR-15, TC-21/TC-22).
 * Structured output: instructions separate from data; response validated
 * against the caller's Zod schema; malformed output → invalid_output (TC-27).
 */
export class OllamaProvider implements LLMProvider {
  readonly kind = "local" as const;
  readonly adapter = "ollama" as const;

  constructor(
    private readonly baseUrl: string,
    private readonly model: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async discoverModels(): Promise<DiscoveredModel[]> {
    const res = await this.request("/api/tags", { method: "GET" }, 10_000);
    const parsed = tagsResponseSchema.parse(res);
    return parsed.models.map((m) => ({
      name: m.name,
      sizeBytes: m.size,
      family: m.details?.family,
      parameterSize: m.details?.parameter_size,
    }));
  }

  async structured<T extends z.ZodTypeAny>(request: StructuredRequest<T>): Promise<StructuredOutcome<T>> {
    const messages: ChatMessage[] = [
      { role: "system", content: request.system },
      ...request.messages,
    ];
    let raw: string;
    try {
      const body = {
        model: this.model,
        messages,
        stream: false,
        think: false,
        options: { num_predict: request.maxOutputTokens },
        format: jsonSchemaFor(request.schemaName, request.schema),
      };
      const res = await this.request("/api/chat", { method: "POST", body: JSON.stringify(body) }, request.timeoutMs);
      const parsed = ChatResponseShape.safeParse(res);
      if (!parsed.success) {
        return { status: "invalid_output", reason: "unrecognized provider envelope", raw: "" };
      }
      if (parsed.data.error) {
        // Provider error text stays server-side; the client sees a safe message.
        return { status: "error", error: new AppError("MODEL_UNAVAILABLE", "The language model is currently unavailable.", { providerError: parsed.data.error }) };
      }
      raw = parsed.data.message?.content ?? "";
    } catch (err) {
      return { status: "error", error: toProviderError(err) };
    }

    const jsonStart = raw.indexOf("{");
    const jsonEnd = raw.lastIndexOf("}");
    if (jsonStart === -1 || jsonEnd === -1) {
      return { status: "refused", raw };
    }
    let candidate: unknown;
    try {
      candidate = JSON.parse(raw.slice(jsonStart, jsonEnd + 1));
    } catch {
      return { status: "invalid_output", reason: "response is not parseable JSON", raw };
    }
    const validated = request.schema.safeParse(candidate);
    if (!validated.success) {
      return {
        status: "invalid_output",
        reason: validated.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
        raw,
      };
    }
    return { status: "ok", value: validated.data, raw };
  }

  async healthCheck(): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await this.fetchFn(new URL("/api/version", this.baseUrl), {
        signal: AbortSignal.timeout(3000),
      });
      return res.ok ? { ok: true } : { ok: false, error: `status ${res.status}` };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "unreachable" };
    }
  }

  private async request(path: string, init: RequestInit, timeoutMs: number): Promise<unknown> {
    let res: Response;
    try {
      res = await this.fetchFn(new URL(path, this.baseUrl), {
        ...init,
        headers: { "content-type": "application/json", ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      if (err instanceof Error && err.name === "TimeoutError") {
        throw new AppError("PROVIDER_TIMEOUT", "Ollama request timed out.");
      }
      throw new AppError("OLLAMA_UNAVAILABLE", "Ollama is unreachable.");
    }
    if (!res.ok) {
      throw new AppError("OLLAMA_UNAVAILABLE", "The language model service returned an error.", { status: res.status });
    }
    return res.json();
  }
}

const ChatResponseShape = z.object({
  message: z.object({ content: z.string().optional() }).optional(),
  done_reason: z.string().optional(),
  error: z.string().optional(),
});

function toProviderError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof Error && err.name === "TimeoutError") {
    return new AppError("PROVIDER_TIMEOUT", "Ollama request timed out.");
  }
  return new AppError("OLLAMA_UNAVAILABLE", "Ollama is unreachable.");
}

/**
 * JSON-schema projection of a Zod schema for Ollama's `format` parameter,
 * using zod ≥4's native converter (replaces the earlier hand-rolled `_def`
 * walker that broke across zod majors — SEC-F6 remediation).
 */
function jsonSchemaFor(name: string, schema: z.ZodTypeAny): Record<string, unknown> {
  const converted = z.toJSONSchema(schema, { io: "output", unrepresentable: "any" }) as Record<string, unknown>;
  return { title: name, ...converted };
}

/** Minimal JSON-schema projection of a Zod object for Ollama's `format`. */
function zodToJsonSchema(name: string, schema: z.ZodTypeAny): Record<string, unknown> {
  return toSchema(schema, { $schema: "http://json-schema.org/draft-07-schema#", title: name });
}

function toSchema(node: z.ZodTypeAny, base: Record<string, unknown> = {}): Record<string, unknown> {
  const inner = node as unknown as { _def?: { typeName?: string; innerType?: z.ZodTypeAny; values?: readonly string[]; value?: unknown; shape?: () => Record<string, z.ZodTypeAny> } };
  const def = inner._def ?? {};
  switch (def.typeName) {
    case "ZodObject": {
      const shape = def.shape?.() ?? {};
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const [key, child] of Object.entries(shape)) {
        properties[key] = toSchema(child);
        if (!(child as unknown as { isOptional?: () => boolean }).isOptional?.()) required.push(key);
      }
      return { ...base, type: "object", properties, required, additionalProperties: false };
    }
    case "ZodString":
      return { ...base, type: "string" };
    case "ZodNumber":
      return { ...base, type: "number" };
    case "ZodBoolean":
      return { ...base, type: "boolean" };
    case "ZodLiteral":
      return { ...base, const: def.value };
    case "ZodEnum":
    case "ZodNativeEnum":
      return { ...base, type: "string", enum: def.values ? [...def.values] : [] };
    case "ZodArray":
      return { ...base, type: "array", items: toSchema(def.innerType!) };
    case "ZodOptional":
    case "ZodNullable":
      return toSchema(def.innerType!, base);
    case "ZodEffects":
    case "ZodDefault":
    case "ZodCatch":
      return toSchema(def.innerType!, base);
    default:
      return { ...base };
  }
}
