import { AppError } from "../server/errors.js";
import type { DiscoveredModel, LLMProvider, StructuredOutcome, StructuredRequest } from "./types.js";
import type { ModelRegistry } from "./registry.js";

/**
 * Registry-backed inference provider (FR-17 wiring): every structured call
 * resolves the CURRENT active provider/model from the registry — so an admin
 * model switch takes effect on the very next inference (verified by test).
 * Local models only for now: an active CLOUD provider returns a typed error
 * until cloud activation is separately authorized (SEC-15 — no silent egress,
 * no silent fallback).
 */
export class RegistryBackedProvider implements LLMProvider {
  readonly kind = "local" as const;
  readonly adapter = "ollama" as const;
  private readonly localCache = new Map<string, LLMProvider>();

  constructor(
    private readonly deps: {
      registry: ModelRegistry;
      makeLocal: (model: string) => LLMProvider;
      /**
       * Owner-controlled default (FR-15: detection is not activation): when
       * NO provider row is active — e.g. a fresh database — inference falls
       * back to THIS documented initial local model rather than failing.
       * Changing it requires the admin active-model API; cloud is never
       * activated implicitly.
       */
      defaultLocalModel: string;
    },
  ) {}

  private localFor(model: string): LLMProvider {
    let provider = this.localCache.get(model);
    if (!provider) {
      provider = this.deps.makeLocal(model);
      this.localCache.set(model, provider);
    }
    return provider;
  }

  async structured<T extends import("zod").ZodTypeAny>(
    request: StructuredRequest<T>,
  ): Promise<StructuredOutcome<T>> {
    const active = await this.deps.registry.resolveActive();
    const model = active?.modelId ?? this.deps.defaultLocalModel;
    if (active?.kind === "cloud") {
      // Explicit, loud refusal — never silent cloud egress (SEC-15).
      return {
        status: "error",
        error: new AppError(
          "PROVIDER_FAILURE",
          "A cloud provider is configured as active, but cloud inference has not been authorized. Using it would transmit data externally; refusing.",
          { providerId: active.id },
        ),
      };
    }
    return this.localFor(model).structured(request);
  }

  async discoverModels(): Promise<DiscoveredModel[]> {
    return this.deps.registry.listLocalModels();
  }

  async healthCheck(): Promise<{ ok: boolean; error?: string }> {
    const active = await this.deps.registry.resolveActive();
    const model = active?.modelId ?? this.deps.defaultLocalModel;
    if (active?.kind === "cloud") return { ok: false, error: "cloud provider active but unauthorized" };
    return this.localFor(model).healthCheck();
  }
}
