import { describe, expect, it } from "vitest";
import { classifyPgAuthError, verify } from "./verify-live-db.mjs";

describe("classifyPgAuthError (repair finding 1: username vs password)", () => {
  it("classifies a plain-postgres attempt as a USERNAME format problem", () => {
    const result = classifyPgAuthError('password authentication failed for user "postgres"');
    expect(result.kind).toBe("username");
    expect(result.hint).toContain("postgres.ogxdszjypswutekqgorb");
  });

  it("classifies a correct-pooler-user attempt as a PASSWORD problem", () => {
    const result = classifyPgAuthError(
      'password authentication failed for user "postgres.ogxdszjypswutekqgorb"',
    );
    expect(result.kind).toBe("password");
    expect(result.hint).toContain("database password is incorrect");
  });

  it("never echoes credential values and handles unparseable messages", () => {
    const secretShaped = "password authentication failed for user \"postgres\" real=sup3rs3cret";
    const result = classifyPgAuthError(secretShaped);
    expect(result.hint).not.toContain("sup3rs3cret");
    const fallback = classifyPgAuthError("something entirely different");
    expect(fallback.kind).toBe("username");
    expect(fallback.hint).toContain("unknown");
  });
});

describe("verify() check contract (repair finding 1: no shared mutable state)", () => {
  const fakePool = (resultRows) => ({ query: async () => ({ rows: resultRows }) });

  const fullGreen = ["app_admins", "appointments", "audit_log", "booking_state", "business_config", "consent_decisions", "conversations", "customers", "google_integration", "messages", "model_providers", "recordings"]
    .map((name) => ({ name, rls: true }));

  it("verify() executes the check sequence against a pool-like client and returns independent results", async () => {
    // The sequence issues 7 queries; feed each a matching shape via a
    // call-counting pool. Contract: results are independent objects.
    const queries = [
      fullGreen,
      [
        { version: "20261024000001", name: "extensions_private_schema" },
        { version: "20261024000002", name: "core_tables" },
        { version: "20261024000003", name: "booking_and_calendar" },
        { version: "20261024000004", name: "ai_providers" },
        { version: "20261024000005", name: "consent_and_records" },
        { version: "20261024000006", name: "rls_policies_grants" },
        { version: "20261025000007", name: "google_integration" },
      ],
      [{ anon_select: false, auth_select: true, auth_insert_messages: false, svc_insert: true, svc_delete_audit: false }],
      [{ tgname: "enforce_recording_consent", tgenabled: "O" }],
      [{ proname: "is_app_admin", proconfig: ['search_path=""'] }, { proname: "enforce_recording_consent", proconfig: ['search_path=""'] }],
      [{ customers: 1, conversations: 37, appointments: 1, orphan_appointments: 0, confirmed_without_event: 0, duplicate_events: 0, unresolved_appointments: 0 }],
      [{ runtime_role: "cleardesk_runtime", bypass_rls: true, audit_mutation: false, schema_create: false, owns_app_tables: false }],
    ];
    let call = 0;
    const pool = { query: async (q) => ({ rows: queries[call++] }) };
    const checks = await verify(pool);
    expect(checks).toHaveLength(7);
    expect(checks.every((c) => c.ok)).toBe(true);
    // Independence: mutating one result must not affect another
    checks[0].detail = "mutated";
    expect(checks[1].detail).not.toBe("mutated");
  });

  it("a failing check reports FAIL with its detail without throwing", async () => {
    let call = 0;
    const badRows = [
      fullGreen.map((r) => ({ ...r, rls: false })), // RLS off -> FAIL
      [{ version: "1", name: "drifted" }],
      [{ anon_select: false, auth_select: true, auth_insert_messages: false, svc_insert: true, svc_delete_audit: false }],
      [{ tgname: "enforce_recording_consent", tgenabled: "O" }],
      [{ proname: "is_app_admin", proconfig: ['search_path=""'] }, { proname: "enforce_recording_consent", proconfig: ['search_path=""'] }],
      [{ customers: 1, conversations: 37, appointments: 1, orphan_appointments: 0, confirmed_without_event: 1, duplicate_events: 0, unresolved_appointments: 1 }],
      [{ runtime_role: "postgres", bypass_rls: true, audit_mutation: true, schema_create: true, owns_app_tables: true }],
    ];
    const pool = { query: async () => ({ rows: badRows[call++] }) };
    const checks = await verify(pool);
    expect(checks[0].ok).toBe(false);
    expect(checks[0].detail).toContain("0 with RLS");
    expect(checks[5].ok).toBe(false);
    expect(checks[5].detail).toContain("confirmed_without_event=1");
    expect(checks[6].ok).toBe(false);
    expect(checks[6].detail).toContain("audit_mutation=true");
  });
});
