import { describe, expect, it } from "vitest";
import { z } from "zod";
import { MemoryModelProviderRepo } from "../db/memory/stores.js";
import { createSecretStore } from "../secrets/store.js";
import { scriptedProvider } from "../domain/conversation/testProvider.js";
import { ModelRegistry } from "./registry.js";

function makeRegistry(opts: { storeDisabled?: boolean } = {}) {
  const repo = new MemoryModelProviderRepo();
  const local = {
    ...scriptedProvider([{ intent: "greeting" }]),
    discoverModels: async () => [{ name: "qwen3:1.7b" }, { name: "qwen3:0.6b" }],
  };
  const secretStore = opts.storeDisabled
    ? createSecretStore({ kind: "disabled", reason: "fixture" })
    : createSecretStore(
        { kind: "vault", verify: async () => ({ ok: true }) },
        {
          create: async (secret: string) => `vault-${secret.length}`,
          decrypt: async (id: string) => `decrypted-${id}`,
          delete: async () => undefined,
        },
      );
  const registry = new ModelRegistry({ repo, localProvider: local as never, secretStore });
  return { repo, registry };
}

describe("ModelRegistry (FR-15/16/17)", () => {
  it("lists actually discovered local models", async () => {
    const { registry } = makeRegistry();
    const models = await registry.listLocalModels();
    expect(models.map((m) => m.name)).toEqual(["qwen3:1.7b", "qwen3:0.6b"]);
  });

  it("rejects unsafe cloud endpoints at the configuration boundary (SEC-16)", async () => {
    const { registry } = makeRegistry();
    for (const bad of [
      "http://api.example.com", // not https
      "https://localhost:11434", // loopback
      "https://127.0.0.1/v1", // loopback IP
      "https://169.254.169.254/v1", // metadata
      "https://192.168.1.5/v1", // private
      "https://user:pass@api.example.com/v1", // embedded credentials
    ]) {
      await expect(
        registry.addProvider({ kind: "cloud", adapter: "openai_compatible", displayName: "x", baseUrl: bad }),
      ).rejects.toMatchObject({ code: "UNSAFE_ENDPOINT" });
    }
  });

  it("fails closed on credentials when the secret store is disabled — and persists NOTHING", async () => {
    const { repo, registry } = makeRegistry({ storeDisabled: true });
    await expect(
      registry.addProvider({
        kind: "cloud", adapter: "openai_compatible", displayName: "cloud",
        baseUrl: "https://api.example.com", credential: "sk-test",
      }),
    ).rejects.toMatchObject({ code: "CREDENTIAL_STORE_UNAVAILABLE" });
    expect(repo.rows).toHaveLength(0); // refusal happens before any row exists
  });

  it("stores credentials only through the verified secret store; refs never leak in listings", async () => {
    const { registry } = makeRegistry();
    const created = await registry.addProvider({
      kind: "cloud", adapter: "openai_compatible", displayName: "cloud",
      baseUrl: "https://api.example.com", credential: "sk-test",
    });
    expect(created.hasCredential).toBe(true);
    expect(JSON.stringify(created)).not.toContain("sk-test");
    expect(JSON.stringify(created)).not.toContain("vault-");
  });

  it("activates only installed local models; enforces a single active provider", async () => {
    const { repo, registry } = makeRegistry();
    const local = await registry.addProvider({ kind: "local", adapter: "ollama", displayName: "local", modelId: "qwen3:1.7b" });
    const other = await registry.addProvider({ kind: "local", adapter: "ollama", displayName: "other", modelId: "qwen3:0.6b" });
    await expect(registry.setActive(local.id, "not-installed")).rejects.toMatchObject({ code: "MODEL_UNAVAILABLE" });
    const first = await registry.setActive(local.id, "qwen3:1.7b");
    expect(first).toMatchObject({ appliesFrom: "next_turn" });
    await registry.setActive(other.id);
    expect((await repo.findById(local.id))?.isActive).toBe(false); // exclusive
    expect((await repo.findById(other.id))?.isActive).toBe(true);
  });

  it("cloud activation requires a model identifier somewhere", async () => {
    const { registry } = makeRegistry();
    const cloud = await registry.addProvider({ kind: "cloud", adapter: "openai_compatible", displayName: "cloud", baseUrl: "https://api.example.com" });
    await expect(registry.setActive(cloud.id)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const ok = await registry.setActive(cloud.id, "gpt-x");
    expect(ok.modelId).toBe("gpt-x");
  });

  it("connection test updates provider status honestly", async () => {
    const { repo, registry } = makeRegistry();
    const local = await registry.addProvider({ kind: "local", adapter: "ollama", displayName: "local" });
    const result = await registry.testProvider(local.id);
    expect(result.status).toBe("ok");
    expect((await repo.findById(local.id))?.status).toBe("ok");
  });
});
