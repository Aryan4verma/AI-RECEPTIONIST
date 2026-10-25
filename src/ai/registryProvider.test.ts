import { describe, expect, it } from "vitest";
import { z } from "zod";
import { MemoryModelProviderRepo } from "../db/memory/stores.js";
import { createSecretStore } from "../secrets/store.js";
import { ModelRegistry } from "./registry.js";
import { RegistryBackedProvider } from "./registryProvider.js";
import type { LLMProvider, StructuredOutcome, StructuredRequest } from "./types.js";

function fakeLocal(model: string): LLMProvider {
  return {
    kind: "local", adapter: "ollama",
    async discoverModels() { return [{ name: model }]; },
    async structured<T extends z.ZodTypeAny>(request: StructuredRequest<T>): Promise<StructuredOutcome<T>> {
      return { status: "ok", value: { schema_version: 1, note: `from:${model}` } as never, raw: "" };
    },
    async healthCheck() { return { ok: true }; },
  };
}

function makeStack() {
  const repo = new MemoryModelProviderRepo();
  const registryLocal: LLMProvider = {
    ...fakeLocal("qwen3:1.7b"),
    discoverModels: async () => [{ name: "model-a" }, { name: "model-b" }, { name: "qwen3:1.7b" }],
  };
  const registry = new ModelRegistry({
    repo,
    localProvider: registryLocal,
    secretStore: createSecretStore({ kind: "disabled", reason: "fixture" }),
  });
  const backed = new RegistryBackedProvider({ registry, makeLocal: fakeLocal });
  return { repo, registry, backed };
}

describe("RegistryBackedProvider (FR-17 wiring)", () => {
  it("a model switch applies on the VERY NEXT inference call", async () => {
    const { repo, registry, backed } = makeStack();
    const a = await registry.addProvider({ kind: "local", adapter: "ollama", displayName: "a", modelId: "model-a" });
    await registry.setActive(a.id, "model-a");
    const first = await backed.structured({
      system: "s", messages: [], schema: z.object({ note: z.string() }), schemaName: "x",
      timeoutMs: 1000, maxOutputTokens: 8,
    });
    expect((first as { value?: { note?: string } }).value?.note).toBe("from:model-a");
    const b = await registry.addProvider({ kind: "local", adapter: "ollama", displayName: "b", modelId: "model-b" });
    await registry.setActive(b.id, "model-b");
    const second = await backed.structured({
      system: "s", messages: [], schema: z.object({ note: z.string() }), schemaName: "x",
      timeoutMs: 1000, maxOutputTokens: 8,
    });
    expect((second as { value?: { note?: string } }).value?.note).toBe("from:model-b");
    void repo;
  });

  it("an active CLOUD provider is refused loudly — never silent egress (SEC-15)", async () => {
    const { registry, backed } = makeStack();
    const cloud = await registry.addProvider({
      kind: "cloud", adapter: "openai_compatible", displayName: "cloud",
      baseUrl: "https://api.example.com", modelId: "gpt-x",
    });
    await registry.setActive(cloud.id, "gpt-x");
    const outcome = await backed.structured({
      system: "s", messages: [], schema: z.object({ note: z.string() }), schemaName: "x",
      timeoutMs: 1000, maxOutputTokens: 8,
    });
    expect(outcome).toMatchObject({ status: "error", error: { code: "PROVIDER_FAILURE" } });
    const health = await backed.healthCheck();
    expect(health.ok).toBe(false);
  });

  it("no active provider yields a typed error (no silent default guess)", async () => {
    const { backed } = makeStack();
    const outcome = await backed.structured({
      system: "s", messages: [], schema: z.object({ note: z.string() }), schemaName: "x",
      timeoutMs: 1000, maxOutputTokens: 8,
    });
    expect(outcome).toMatchObject({ status: "error", error: { code: "MODEL_UNAVAILABLE" } });
  });
});
