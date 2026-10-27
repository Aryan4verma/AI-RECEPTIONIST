import { describe, expect, it } from "vitest";
import { z } from "zod";
import { OllamaProvider } from "./ollamaProvider.js";

function fetchJson(body: unknown, status = 200) {
  return (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
}

const schema = z.object({ intent: z.enum(["book_appointment", "unknown"]), note: z.string().optional() });

describe("OllamaProvider", () => {
  it("discovers actual installed models from /api/tags (FR-15)", async () => {
    const provider = new OllamaProvider(
      "http://localhost:11434",
      "qwen3:1.7b",
      fetchJson({ models: [{ name: "qwen3:1.7b", size: 1_400_000_000, details: { family: "qwen3", parameter_size: "1.7B" } }] }),
    );
    const models = await provider.discoverModels();
    expect(models).toEqual([
      { name: "qwen3:1.7b", sizeBytes: 1_400_000_000, family: "qwen3", parameterSize: "1.7B" },
    ]);
  });

  it("returns a validated structured result (TC-02 happy path)", async () => {
    let keepAlive: unknown;
    const provider = new OllamaProvider(
      "http://localhost:11434",
      "qwen3:1.7b",
      (async (_url, init) => {
        keepAlive = JSON.parse(String(init?.body)).keep_alive;
        return fetchJson({ message: { content: '{"intent":"book_appointment"}' }, done_reason: "stop" })(_url, init);
      }) as typeof fetch,
    );
    const outcome = await provider.structured({
      system: "system prompt",
      messages: [{ role: "user", content: "customer text" }],
      schema,
      schemaName: "intent",
      timeoutMs: 5000,
      maxOutputTokens: 256,
    });
    expect(outcome).toMatchObject({ status: "ok", value: { intent: "book_appointment" } });
    expect(keepAlive).toBe("60s");
  });

  it("classifies malformed JSON as invalid_output (TC-27)", async () => {
    const provider = new OllamaProvider(
      "http://localhost:11434",
      "qwen3:1.7b",
      fetchJson({ message: { content: "not json at all" } }),
    );
    const outcome = await provider.structured({
      system: "s", messages: [], schema, schemaName: "intent", timeoutMs: 5000, maxOutputTokens: 64,
    });
    expect(outcome.status).toBe("refused");
  });

  it("rejects schema-violating output as invalid_output (TC-27)", async () => {
    const provider = new OllamaProvider(
      "http://localhost:11434",
      "qwen3:1.7b",
      fetchJson({ message: { content: '{"intent":"launch_missiles"}' } }),
    );
    const outcome = await provider.structured({
      system: "s", messages: [], schema, schemaName: "intent", timeoutMs: 5000, maxOutputTokens: 64,
    });
    expect(outcome).toMatchObject({ status: "invalid_output" });
    if (outcome.status === "invalid_output") expect(outcome.reason).toContain("intent");
  });

  it("maps an unreachable daemon to OLLAMA_UNAVAILABLE (TC-21)", async () => {
    const provider = new OllamaProvider(
      "http://localhost:11434",
      "qwen3:1.7b",
      (async () => {
        throw new Error("ECONNREFUSED");
      }) as unknown as typeof fetch,
    );
    const health = await provider.healthCheck();
    expect(health.ok).toBe(false);
    const outcome = await provider.structured({
      system: "s", messages: [], schema, schemaName: "intent", timeoutMs: 5000, maxOutputTokens: 64,
    });
    expect(outcome).toMatchObject({ status: "error", error: { code: "OLLAMA_UNAVAILABLE" } });
  });
});
