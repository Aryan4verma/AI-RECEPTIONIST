# ADR-0001 — Database platform: Supabase/PostgreSQL

| Field | Value |
| --- | --- |
| Project ID | AI-RECEPTIONIST |
| Document ID | ADR-0001 |
| Version / date | v1.0 — 2026-10-24 |
| Decision status | **ACCEPTED** — real human decision at G01-REQUIREMENTS (project owner, 2026-10-24, PROGRESS §5) |
| Scope | Platform selection only (Q1); not a blanket authorization for schema/destructive/deployment actions |

## 1. [REQUIRED] Control and decision status

Accepted (see header). Requirement source: FR-10 persistence; master prompt §4 Supabase intent; CH-1 unaffected.

## 2. [REQUIRED] Context and requirements

Greenfield persistence need: customers, conversations, appointments, consent/records, provider configuration; admin identity; RLS for exposed data (SEC-3); one migration stream (G07); MCP connected to verified empty project `ogxdszjypswutekqgorb`. Host is resource-constrained (R4) — self-hosting Postgres locally is undesirable.

## 3. [REQUIRED] Alternatives and choice

| Alternative | Fit / cost / security / operational consequences | Reason selected or declined |
| --- | --- | --- |
| **Supabase/PostgreSQL (selected)** | Managed Postgres + Auth + RLS + Vault; free tier fits dev; MCP verification path; RLS grants real DB-enforced isolation | Matches approved stack intent; managed auth avoids bespoke auth (STACK rule) |
| SQLite (earlier proposal) | Zero-infra, but no network auth/RLS; weaker fit for admin API + future frontend; diverges from prompt preference | Declined at G01 |
| Local Postgres (self-host) | Full control; consumes constrained RAM; manual backups/auth | Declined (R4 + ops burden) |

## 4. [REQUIRED] Consequences and implementation impact

`DATABASE.md`/`SUPABASE.md`/`AUTH.md` authored for Supabase; migrations single stream; types generated per migration; backup/recovery obligations tracked (SUPABASE §6 unknowns); service_role key server-only (SEC-4). No approvals invalidated (Q1 was the pending decision itself). Invariants preserved: RLS enforced on exposed paths, real-role evidence required (G06/G09).

## 5. [OPTIONAL] Revisit triggers

Supabase outage/unavailability, cost tier change, or a requirement for offline operation → re-enter via protocol 21.

## 6. [REQUIRED] Unknowns, review and supersession

Unknown: exact Postgres version, Vault availability, backup retention (verify at implementation). Supersedes: the earlier SQLite proposal recorded in the original master-prompt context. No prior ADR superseded.
