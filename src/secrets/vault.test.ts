import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { PgVaultAdapter } from "./vault.js";

const id = "e4cb584a-6ef4-47a2-aefb-827f1c24b4f4";

describe("Postgres Vault adapter contract (fixtures; signatures verified live)", () => {
  it("selects the scalar UUID with an alias and gives replacement secrets distinct names", async () => {
    const query = vi.fn(async (sql: string) => {
      // Reproduces the connected project's 42703 for the former FROM query.
      if (sql !== "select vault.create_secret($1, $2) as id") throw new Error("undefined id column");
      return { rows: [{ id }] };
    });
    const adapter = new PgVaultAdapter({ query } as unknown as Pool);
    expect(await adapter.create("synthetic-secret", "provider-google-calendar")).toBe(id);
    await adapter.create("synthetic-replacement", "provider-google-calendar");
    const calls = query.mock.calls as unknown as Array<[string, string[]]>;
    expect(calls[0]![1][0]).toBe("synthetic-secret");
    expect(calls[0]![1][1]).toMatch(/^provider-google-calendar-[0-9a-f-]+$/);
    expect(calls[0]![1][1]).not.toBe(calls[1]![1][1]);
  });

  it.each([undefined, null, "undefined"])("rejects an invalid Vault reference (%s)", async (value) => {
    const adapter = new PgVaultAdapter({ query: async () => ({ rows: [{ id: value }] }) } as unknown as Pool);
    await expect(adapter.create("synthetic-secret", "test")).rejects.toThrow("valid secret reference");
  });

  it("deletes only the referenced Vault row with a bound UUID (no nonexistent delete_secret function)", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    await new PgVaultAdapter({ query } as unknown as Pool).delete(id);
    expect(query).toHaveBeenCalledWith("delete from vault.secrets where id = $1::uuid", [id]);
  });
});
