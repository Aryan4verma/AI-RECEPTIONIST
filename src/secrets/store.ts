import { AppError } from "../server/errors.js";

/**
 * SecretStore port — fail-closed (ADR-0002 v0.2).
 * Exactly two states:
 *  - "vault": Supabase Vault VERIFIED available and privilege-secure
 *    (decrypted_secrets reachable by service role only; no anon/authenticated
 *    exposure) — verified at implementation, not assumed.
 *  - "disabled": cloud credential persistence DISABLED (fail-closed). All
 *    credential operations throw CREDENTIAL_STORE_UNAVAILABLE. Local Ollama is
 *    unaffected. The AES-256-GCM fallback exists ONLY behind a separate
 *    explicit human decision — it can never self-activate.
 */
export type SecretStoreState =
  | { kind: "vault"; verify: () => Promise<{ ok: boolean; error?: string }> }
  | { kind: "disabled"; reason: string };

export interface ProviderCredential {
  /** Opaque reference persisted in model_providers.credential_ref (never the key). */
  ref: string;
  masked: string;
}

export interface SecretStore {
  readonly state: SecretStoreState;
  put(providerId: string, apiKey: string): Promise<ProviderCredential>;
  get(ref: string): Promise<string>;
  remove(ref: string): Promise<void>;
}

export function maskKey(apiKey: string): string {
  const tail = apiKey.slice(-4);
  return `••••${tail}`;
}

export function createSecretStore(state: SecretStoreState, vaultAdapter?: VaultSecretAdapter): SecretStore {
  if (state.kind === "vault") {
    if (!vaultAdapter) throw new Error("vault state requires a vault adapter");
    return new VaultBackedStore(state, vaultAdapter);
  }
  return new DisabledStore(state);
}

export interface VaultSecretAdapter {
  /** Store secret; return its Vault-assigned id/uuid reference. */
  create(secret: string, name: string): Promise<string>;
  /** Decrypt via vault.decrypted_secrets (service-role only, verified). */
  decrypt(secretId: string): Promise<string>;
  delete(secretId: string): Promise<void>;
}

class VaultBackedStore implements SecretStore {
  constructor(
    readonly state: SecretStoreState,
    private readonly vault: VaultSecretAdapter,
  ) {}

  async put(providerId: string, apiKey: string): Promise<ProviderCredential> {
    const ref = await this.vault.create(apiKey, `provider-${providerId}`);
    return { ref, masked: maskKey(apiKey) };
  }

  async get(ref: string): Promise<string> {
    return this.vault.decrypt(ref);
  }

  async remove(ref: string): Promise<void> {
    await this.vault.delete(ref);
  }
}

class DisabledStore implements SecretStore {
  constructor(readonly state: Extract<SecretStoreState, { kind: "disabled" }>) {}

  private denied(): never {
    throw new AppError(
      "CREDENTIAL_STORE_UNAVAILABLE",
      "Cloud credential persistence is disabled (fail-closed): no verified secure secret store is available. Local Ollama remains fully functional.",
    );
  }

  async put(): Promise<ProviderCredential> {
    this.denied();
  }

  async get(): Promise<string> {
    this.denied();
  }

  async remove(): Promise<void> {
    this.denied();
  }
}
