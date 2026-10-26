import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/20261025000007_google_integration.sql", "utf8").replace(/--[^\n]*/g, "");

describe("migration 0007 security contract (static; live role evidence recorded separately)", () => {
  it("creates only the integration singleton with an auth.users UUID FK and Vault reference", () => {
    expect([...sql.matchAll(/create table\s+([\w.]+)/gi)].map((m) => m[1])).toEqual(["public.google_integration"]);
    expect(sql).toMatch(/id uuid primary key check \(id = '00000000-0000-0000-0000-000000000001'\)/i);
    expect(sql).toMatch(/connected_by uuid references auth\.users \(id\) on delete set null/i);
    expect(sql).toMatch(/credential_ref text/i);
    expect(sql).not.toMatch(/\b(?:refresh_token|access_token|client_secret)\s+(?:text|varchar)/i);
    expect(sql).not.toMatch(/\b(?:drop|truncate|delete from|insert into|update public\.)\b/i);
  });

  it("enables RLS with no public policies; explicitly grants only backend SELECT/INSERT/UPDATE", () => {
    expect(sql).toMatch(/alter table public\.google_integration enable row level security/i);
    expect(sql).toMatch(/revoke all on public\.google_integration from public, anon, authenticated, service_role/i);
    expect(sql).toMatch(/grant select, insert, update on public\.google_integration to service_role/i);
    expect(sql).not.toMatch(/create policy|grant .* to (?:anon|authenticated|public)\s*;/i);
  });
});
