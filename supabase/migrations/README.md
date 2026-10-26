# Migration stream — the single authoritative schema owner

One versioned stream (G07). Applied **only** via the Supabase CLI against
project `ogxdszjypswutekqgorb`, and only after the separate first-migration
action authorization (PLAN.md §4). MCP `execute_sql` is never a migration
application path (SUPABASE.md §5).

Plan-ID mapping (DATABASE.md §5 ↔ committed files):

| Plan ID | Committed file |
| --- | --- |
| 0001_extensions | `20261024000001_extensions_private_schema.sql` |
| 0002_core_tables | `20261024000002_core_tables.sql` |
| 0003_booking_and_calendar | `20261024000003_booking_and_calendar.sql` |
| 0004_ai_providers | `20261024000004_ai_providers.sql` |
| 0005_consent_and_records | `20261024000005_consent_and_records.sql` |
| 0006_rls_policies_grants | `20261024000006_rls_policies_grants.sql` |
| 0007_google_integration | `20261025000007_google_integration.sql` |

0001–0007 are applied to the linked project. Owner-authorized 0007 application
and live schema/grant/data-preservation evidence: PROGRESS §1 (2026-10-26).

Forward-only. Repair = new migration; never rewrite history. Every application
is followed by TC-34 verification (remote history ↔ files ↔ catalog drift).
