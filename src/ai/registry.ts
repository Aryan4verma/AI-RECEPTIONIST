import { AppError } from "../server/errors.js";
import type { DiscoveredModel, LLMProvider } from "./types.js";
import type { ModelProviderRepo, ModelProviderRow } from "../db/ports.js";
import type { SecretStore } from "../secrets/store.js";
import { validateProviderEndpoint } from "../security/endpoint.js";

/** Admin-visible provider view — credential reference NEVER leaves the server. */
export interface PublicProvider {
  id: string;
  kind: "local" | "cloud";
  adapter: "ollama" | "openai_compatible";
  displayName: string;
  baseUrl: string | null;
  modelId: string | null;
  capabilities: Record<string, unknown>;
  status: "unverified" | "ok" | "error";
  lastError: string | null;
  isActive: boolean;
  hasCredential: boolean;
}

/**
 * Model registry (FR-15/16/17): live local discovery, DB-configured cloud
 * providers behind the SSRF guard, fail-closed credential storage, safe
 * switching (applies from the next turn). Cloud activation itself — real
 * credentials, paid inference, customer-data egress — still requires its own
 * separate authorization (SEC-15).
 */
export class ModelRegistry {
  constructor(
    private readonly deps: {
      repo: ModelProviderRepo;
      localProvider: LLMProvider;
      secretStore: SecretStore;
      fetchFn?: typeof fetch;
    },
  ) {}

  /** FR-15: actual installed models — never a fabricated list. */
  async listLocalModels(): Promise<DiscoveredModel[]> {
    return this.deps.localProvider.discoverModels(); // honest OLLAMA_UNAVAILABLE on failure
  }

  async listProviders(): Promise<PublicProvider[]> {
    const rows = await this.deps.repo.list();
    return rows.map(mask);
  }

  async addProvider(input: {
    kind: "local" | "cloud";
    adapter: "ollama" | "openai_compatible";
    displayName: string;
    baseUrl?: string;
    modelId?: string;
    capabilities?: Record<string, unknown>;
    credential?: string;
  }): Promise<PublicProvider> {
    if (input.kind === "cloud") {
      if (!input.baseUrl) {
        throw new AppError("INVALID_INPUT", "Cloud providers require a base URL.");
      }
      const check = validateProviderEndpoint(input.baseUrl);
      if (!check.ok) {
        throw new AppError("UNSAFE_ENDPOINT", "The configured endpoint is not allowed.", { reason: check.reason });
      }
    }
    const needsCredential = input.kind === "cloud" && input.credential !== undefined;
    if (needsCredential && this.deps.secretStore.state.kind !== "vault") {
      // Fail-closed BEFORE any row is created — nothing persists on refusal.
      throw new AppError(
        "CREDENTIAL_STORE_UNAVAILABLE",
        "Cloud credential persistence is disabled (fail-closed): no verified secure secret store is available. Local Ollama remains fully functional.",
      );
    }
    const row = await this.deps.repo.create(input);
    if (needsCredential && input.credential) {
      const stored = await this.deps.secretStore.put(row.id, input.credential);
      await this.deps.repo.update(row.id, { credentialRef: stored.ref });
      row.credentialRef = stored.ref;
    }
    return mask(row);
  }

  async updateProvider(
    id: string,
    patch: { displayName?: string; baseUrl?: string; modelId?: string; capabilities?: Record<string, unknown> },
  ): Promise<PublicProvider> {
    const existing = await this.deps.repo.findById(id);
    if (!existing) throw new AppError("NOT_FOUND", "Provider not found.");
    if (patch.baseUrl !== undefined && existing.kind === "cloud") {
      const check = validateProviderEndpoint(patch.baseUrl);
      if (!check.ok) {
        throw new AppError("UNSAFE_ENDPOINT", "The configured endpoint is not allowed.", { reason: check.reason });
      }
    }
    await this.deps.repo.update(id, patch);
    return mask((await this.deps.repo.findById(id))!);
  }

  async removeProvider(id: string): Promise<void> {
    const existing = await this.deps.repo.findById(id);
    if (!existing) throw new AppError("NOT_FOUND", "Provider not found.");
    if (existing.credentialRef && this.deps.secretStore.state.kind === "vault") {
      await this.deps.secretStore.remove(existing.credentialRef).catch(() => undefined);
    }
    await this.deps.repo.remove(id);
  }

  /** Credential entry (OP-16): fail-closed when the store is not verified active. */
  async setCredential(id: string, apiKey: string): Promise<{ masked: string }> {
    const existing = await this.deps.repo.findById(id);
    if (!existing) throw new AppError("NOT_FOUND", "Provider not found.");
    if (this.deps.secretStore.state.kind !== "vault") {
      throw new AppError(
        "CREDENTIAL_STORE_UNAVAILABLE",
        "Cloud credential persistence is disabled (fail-closed): no verified secure secret store is available. Local Ollama remains fully functional.",
      );
    }
    const stored = await this.deps.secretStore.put(id, apiKey);
    await this.deps.repo.update(id, { credentialRef: stored.ref });
    return { masked: stored.masked };
  }

  /** Connection test (OP-17): bounded, no customer data, no paid inference. */
  async testProvider(id: string): Promise<{ status: "ok" | "error"; latencyMs: number; detail?: string }> {
    const existing = await this.deps.repo.findById(id);
    if (!existing) throw new AppError("NOT_FOUND", "Provider not found.");
    const started = Date.now();
    if (existing.kind === "local" || existing.adapter === "ollama") {
      try {
        await this.deps.localProvider.discoverModels();
        await this.deps.repo.update(id, { status: "ok", lastError: null });
        return { status: "ok", latencyMs: Date.now() - started };
      } catch (err) {
        const reason = err instanceof Error ? err.message : "unreachable";
        await this.deps.repo.update(id, { status: "error", lastError: reason });
        return { status: "error", latencyMs: Date.now() - started, detail: "local provider unreachable" };
      }
    }
    if (!existing.baseUrl) {
      throw new AppError("INVALID_INPUT", "Cloud provider has no base URL configured.");
    }
    const fetchFn = this.deps.fetchFn ?? fetch;
    try {
      const res = await fetchFn(new URL("/models", existing.baseUrl), { signal: AbortSignal.timeout(10_000) });
      const ok = res.ok;
      await this.deps.repo.update(id, {
        status: ok ? "ok" : "error",
        lastError: ok ? null : `endpoint returned status ${res.status}`,
      });
      return { status: ok ? "ok" : "error", latencyMs: Date.now() - started, detail: ok ? undefined : `status ${res.status}` };
    } catch {
      await this.deps.repo.update(id, { status: "error", lastError: "endpoint unreachable" });
      return { status: "error", latencyMs: Date.now() - started, detail: "endpoint unreachable" };
    }
  }

  /** Active-model switch (OP-18/FR-17): validated, exclusive, applies next turn. */
  async setActive(providerId: string, modelId?: string): Promise<{ providerId: string; modelId: string; appliesFrom: "next_turn" }> {
    const row = await this.deps.repo.findById(providerId);
    if (!row) throw new AppError("NOT_FOUND", "Provider not found.");
    const target = modelId ?? row.modelId;
    if (!target) {
      throw new AppError("INVALID_INPUT", "A model identifier is required to activate this provider.");
    }
    if (row.kind === "local") {
      const models = await this.deps.localProvider.discoverModels();
      if (!models.some((m) => m.name === target)) {
        throw new AppError("MODEL_UNAVAILABLE", "The selected model is not installed on the local provider.", {
          requested: target,
        });
      }
    }
    for (const p of await this.deps.repo.list()) {
      if (p.isActive && p.id !== providerId) {
        await this.deps.repo.update(p.id, { isActive: false });
      }
    }
    await this.deps.repo.update(providerId, { isActive: true, modelId: target });
    return { providerId, modelId: target, appliesFrom: "next_turn" };
  }

  /** Selection point for the (next) inference wiring — documented, single authority. */
  async resolveActive(): Promise<ModelProviderRow | null> {
    return (await this.deps.repo.list()).find((p) => p.isActive) ?? null;
  }
}

function mask(row: ModelProviderRow): PublicProvider {
  const { credentialRef, ...rest } = row;
  void credentialRef;
  return { ...rest, hasCredential: row.credentialRef !== null };
}
