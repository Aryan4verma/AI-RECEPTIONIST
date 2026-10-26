import type { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { createSecretStore, type SecretStore, type VaultSecretAdapter } from "./store.js";

/**
 * Supabase Vault adoption verification (ADR-0002 v0.2): read-only checks that
 * the extension is installed and that ONLY the service role can read secrets
 * (plaintext or ciphertext) — anon/authenticated exposure fails the store to
 * disabled. Verified live 2026-10-24 on ogxdszjypswutekqgorb: PASS.
 */
export interface VaultVerification {
  ok: boolean;
  reasons: string[];
}

export async function verifyVault(pool: Pool): Promise<VaultVerification> {
  const reasons: string[] = [];
  const ext = await pool.query(`select 1 from pg_extension where extname = 'supabase_vault'`);
  if (!ext.rows[0]) reasons.push("supabase_vault extension not installed");
  const priv = await pool.query(`select
      has_table_privilege('service_role','vault.secrets','select') as svc,
      has_table_privilege('anon','vault.secrets','select') as anon,
      has_table_privilege('authenticated','vault.secrets','select') as auth,
      has_table_privilege('anon','vault.decrypted_secrets','select') as anon_dec,
      has_table_privilege('authenticated','vault.decrypted_secrets','select') as auth_dec`);
  const p = priv.rows[0];
  if (p?.svc !== true) reasons.push("service_role cannot read vault.secrets");
  if (p?.anon || p?.auth || p?.anon_dec || p?.auth_dec) {
    reasons.push("vault is readable by anon or authenticated — privilege posture insecure");
  }
  return { ok: reasons.length === 0, reasons };
}

/** Vault adapter over the pg pool (service-role path, server-only). */
export class PgVaultAdapter implements VaultSecretAdapter {
  constructor(private readonly pool: Pool) {}

  async create(secret: string, name: string): Promise<string> {
    // create_secret returns a scalar UUID, not a row with an id column.
    // Vault names are unique: reconnects/rotations must not collide with the
    // previous credential before its replacement has been persisted.
    const { rows } = await this.pool.query(`select vault.create_secret($1, $2) as id`, [secret, `${name}-${randomUUID()}`]);
    const id: unknown = rows[0]?.id;
    if (typeof id !== "string" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) {
      throw new Error("Vault did not return a valid secret reference");
    }
    return id;
  }

  async decrypt(secretId: string): Promise<string> {
    const { rows } = await this.pool.query(
      `select decrypted_secret from vault.decrypted_secrets where id = $1`,
      [secretId],
    );
    if (!rows[0]) throw new Error("secret not found");
    return String(rows[0].decrypted_secret);
  }

  async delete(secretId: string): Promise<void> {
    await this.pool.query(`delete from vault.secrets where id = $1::uuid`, [secretId]);
  }
}

/**
 * Fail-closed construction: a PASSING read-only verification activates the
 * Vault store; anything else yields the disabled store
 * (CREDENTIAL_STORE_UNAVAILABLE on every credential operation).
 */
export function secretStoreFromVerification(v: VaultVerification, pool: Pool): SecretStore {
  if (v.ok) {
    return createSecretStore({ kind: "vault", verify: async () => ({ ok: true }) }, new PgVaultAdapter(pool));
  }
  return createSecretStore({ kind: "disabled", reason: v.reasons.join("; ") });
}
