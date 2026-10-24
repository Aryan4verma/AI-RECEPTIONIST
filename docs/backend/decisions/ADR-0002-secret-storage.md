# ADR-0002 — Provider credential secret storage (Q7)

| Field | Value |
| --- | --- |
| Project ID | AI-RECEPTIONIST |
| Document ID | ADR-0002 |
| Version / date | v0.1 — 2026-10-24 |
| Decision status | **PROPOSED** — requires G02-DESIGN human approval |
| Scope | Storage of cloud-provider API keys (SEC-14, FR-16); not service-role env handling |

## 1. [REQUIRED] Control and decision status

Proposed. Owner: decided at G02. Requirement source: SEC-14 (no weak custom crypto; server-side storage; masked display; replace/remove).

## 2. [REQUIRED] Context and requirements

Authorized admins configure cloud LLM providers with API keys (CH-1). Keys must never appear in git, plaintext records, client responses, logs, or model prompts; must support rotation and removal; the deployment is a single dev laptop + Supabase; Supabase Vault availability on project `ogxdszjypswutekqgorb` is unverified.

## 3. [REQUIRED] Alternatives and choice

| Alternative | Fit / cost / security / operational consequences | Reason selected or declined |
| --- | --- | --- |
| **A. Supabase Vault (proposed primary)** | Provider-native encrypted secret store; service-role-only read path; keys referenced by secret id in `model_providers.credential_ref`; no custom crypto | Cleanest fit if available on project; verification required at implementation |
| **B. AES-256-GCM envelope store (proposed fallback)** | Node built-in `crypto` (standard primitive, not custom); master key `SECRET_MASTER_KEY` server-only in `.env`; ciphertext in a dedicated table; simple, dependency-free | Fallback if Vault unavailable; adds master-key lifecycle duty |
| C. Plaintext `.env` per provider key | Simple but violates SEC-14 (plaintext records) | Declined |
| D. OS keychain (Windows DPAPI) | Machine-bound, awkward for service process + backup | Declined (portability) |

**Proposal:** implement behind a `SecretStore` port; adapter A if Vault verified, else B. Either way: write-only API surface, masked readback (`••••abcd`), immediate delete on removal, no key material in prompts/logs (enforced by redaction + prompt assembly rules).

## 4. [REQUIRED] Consequences and implementation impact

`secrets/` module + `model_providers.credential_ref` (DATABASE §2); TC-29/TC-32 evidence; mask rule in API OP-15/16. If B chosen: key-ceremony note (master key created by owner, stored only in `.env`), rotation invalidates stored keys (re-entry required). Invariants preserved: server-only secrets (SEC-4).

## 5. [OPTIONAL] Revisit triggers

Vault becomes available/withdrawn; multi-machine deployment; managed secret service requirement → protocol 21.

## 6. [REQUIRED] Unknowns, review and supersession

Unknown: Vault availability (verify at Stage 3 implementation — read-only check). Human review: **G02-DESIGN**. Related: ADR-0001 (platform). No superseded decisions.
