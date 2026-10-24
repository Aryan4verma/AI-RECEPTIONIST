import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Static SQL-contract test (quality correction 1): parses the committed
 * migration stream for the authoritative column set of every public table and
 * verifies every column referenced by the PostgreSQL repositories (INSERT
 * lists, UPDATE SET assignments, RETURNING lists, WHERE equality columns)
 * actually exists. Catches schema/code drift without live credentials.
 */

function extractBalanced(source: string, openIndex: number): string {
  let depth = 0;
  for (let i = openIndex; i < source.length; i++) {
    if (source[i] === "(") depth++;
    if (source[i] === ")") {
      depth--;
      if (depth === 0) return source.slice(openIndex + 1, i);
    }
  }
  return source.slice(openIndex + 1);
}

function tableColumns(): Map<string, Set<string>> {
  const migrationsDir = "supabase/migrations";
  const files = ["20261024000002_core_tables.sql", "20261024000003_booking_and_calendar.sql", "20261024000004_ai_providers.sql", "20261024000005_consent_and_records.sql"];
  const schema = new Map<string, Set<string>>();
  for (const file of files) {
    const sql = readFileSync(`${migrationsDir}/${file}`, "utf8").replace(/--[^\n]*/g, "");
    const re = /create table public\.(\w+)\s*\(/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(sql)) !== null) {
      const table = match[1]!;
      const body = extractBalanced(sql, match.index + match[0].length - 1);
      const columns = new Set<string>();
      let depth = 0;
      let current = "";
      const parts: string[] = [];
      for (const ch of body) {
        if (ch === "(") depth++;
        if (ch === ")") depth--;
        if (ch === "," && depth === 0) {
          parts.push(current);
          current = "";
        } else current += ch;
      }
      parts.push(current);
      for (const part of parts) {
        const first = part.trim().split(/\s+/)[0]?.toLowerCase().replace(/"/g, "") ?? "";
        if (!first || ["constraint", "unique", "primary", "foreign", "check", "exclude"].includes(first)) continue;
        columns.add(first);
      }
      schema.set(table, columns);
    }
  }
  return schema;
}

function repoSql(): { text: string; statements: string[] } {
  const text = readFileSync("src/db/pg/repos.ts", "utf8");
  const statements = [...text.matchAll(/`([^`]*(?:insert into|update|delete from|select)[^`]*)`/g)].map((m) => m[1]!);
  return { text, statements };
}

describe("SQL contract: repositories match the applied migration schema", () => {
  const schema = tableColumns();
  const { statements } = repoSql();

  it("parsed the expected tables from the migration stream", () => {
    for (const table of ["appointments", "conversations", "messages", "booking_state", "consent_decisions", "audit_log", "business_config", "app_admins", "model_providers"]) {
      expect(schema.has(table), `missing table ${table}`).toBe(true);
    }
  });

  it("appointments has no last_error column (regression: SEC-preflight mismatch)", () => {
    expect(schema.get("appointments")?.has("last_error")).toBe(false);
  });

  it("every INSERT column list matches the schema", () => {
    for (const stmt of statements) {
      const m = /insert into public\.(\w+)\s*\(([^)]*)\)/.exec(stmt);
      if (!m) continue;
      const table = m[1]!;
      const cols = m[2]!.split(",").map((c) => c.trim());
      for (const col of cols) {
        expect(schema.get(table)?.has(col), `insert into ${table}: column '${col}' not in schema`).toBe(true);
      }
    }
  });

  it("every UPDATE SET assignment matches the schema", () => {
    for (const stmt of statements) {
      const m = /update public\.(\w+)\s+set\s+([^;]+?)(?:\s+where|\s+returning|$)/is.exec(stmt);
      if (!m) continue;
      const table = m[1]!;
      const assignments = m[2]!.split(",").map((a) => a.trim().split(/\s*=/)[0]?.trim() ?? "");
      for (const col of assignments) {
        const clean = col.replace(/^\w+\./, "");
        if (!/^[a-z_]+$/.test(clean)) continue; // skip computed/qualified oddities caught by insert test
        expect(schema.get(table)?.has(clean), `update ${table}: column '${clean}' not in schema`).toBe(true);
      }
    }
  });

  it("every RETURNING column matches the schema", () => {
    for (const stmt of statements) {
      const m = /from public\.(\w+)\s*(?:where[\s\S]*?)?returning\s+([^;`]+)/is.exec(stmt)
        ?? /returning\s+([^;`]+)\s*$/im.exec(stmt);
      if (!m) continue;
      const table = m[1] && schema.has(m[1]) ? m[1] : null;
      if (!table) continue;
      const cols = m[2]!.split(",").map((c) => c.trim().split(/\s+as\s+/i)[0]?.trim() ?? "");
      for (const col of cols) {
        const clean = col.replace(`${table}.`, "");
        if (!/^[a-z_]+$/.test(clean) || ["case", "coalesce", "count", "now", "gen_random_uuid"].includes(clean)) continue;
        expect(schema.get(table)?.has(clean), `returning from ${table}: column '${clean}' not in schema`).toBe(true);
      }
    }
  });

  it("every WHERE equality column matches the schema of the statement's table", () => {
    for (const stmt of statements) {
      const tableMatch = /(?:insert into|update|from|delete from)\s+public\.(\w+)/.exec(stmt);
      if (!tableMatch) continue;
      const table = tableMatch[1]!;
      const whereMatch = /where\s+([\s\S]+?)(?:\s+returning|\s+order\s+by|for update|$)/i.exec(stmt);
      if (!whereMatch) continue;
      const colMatches = [...whereMatch[1]!.matchAll(/(?:and\s+|or\s+|^)?(\w+)\s*(?:=|in\b|like\b)/gi)];
      for (const cm of colMatches) {
        const col = cm[1]!.toLowerCase();
        if (["select", "where", "and", "or", "not"].includes(col)) continue;
        expect(schema.get(table)?.has(col), `where on ${table}: column '${col}' not in schema`).toBe(true);
      }
    }
  });
});
