# ADR-0002 — Provider credential secret storage (Q7) — FAIL-CLOSED

| Field | Value |
| --- | --- |
| Project ID | AI-RECEPTIONIST |
| Document ID | ADR-0002 |
| Version / date | v0.2 — 2026-10-24 (G02 change-request revision: fail-closed policy) |
| Decision status | **PROPOSED** — requires G02-DESIGN human approval |
| Scope | Storage of cloud-provider API keys (SEC-14, FR-16); not service-role env handling |

## 1. [REQUIRED] Control and decision status

Proposed. Owner: decided at G02. Requirement source: SEC-14 (no weak custom crypto; server-side storage; masked display; replace/remove). **v0.2 revision per G02 change-request: storage is fail-closed — no automatic fallback.**

## 2. [REQUIRED] Context and requirements

Authorized admins configure cloud LLM providers with API keys (CH-1). Keys must never appear in git, plaintext records, client responses, logs, or model prompts; must support rotation and removal. Deployment is a single dev laptop + Supabase. **Supabase Vault availability AND privilege security on project `ogxdszjypswutekqgorb` are unverified** — service-role access alone does not establish that decrypted-secret reads are safe (grants on `vault.decrypted_secrets`, Data API exposure, and list endpoints must be verified).

## 3. [REQUIRED] Alternatives and choice

| Alternative | Fit / cost / security / operational consequences | Reason selected or declined |
| --- | --- | --- |
| **A. Supabase Vault — adopted only when verified available AND secure (proposed primary)** | Verification gate at implementation: (a) extension available; (b) `vault.decrypted_secrets` readable by service role only — no grants/policies leak plaintext or ciphertext to `anon`/`authenticated` or via Data API; (c) secret creation/listing privileges audited. Keys referenced by secret id in `model_providers.credential_ref` | Provider-native encryption, no custom crypto; adoption is conditional on evidence, not assumption |
| **B. CREDENTIAL PERSISTENCE DISABLED (fail-closed default when Vault fails verification)** | Provider configuration API accepts metadata but **credential entry (OP-16) returns `CREDENTIAL_STORE_UNAVAILABLE`**; no cloud provider can be made operational; **local Ollama remains fully functional** (unaffected by credential storage) | Safe state that cannot degrade into silent plaintext storage; explicitly the owner's preferred proposal |
| C. AES-256-GCM envelope store (env master key) | Technically sound standard primitive, but only acceptable after a **separate explicit reviewed choice** covering: key generation & access, backup & restoration, rotation without data loss, ciphertext storage & tamper protection, least-privilege access, secret migration & removal, and negative/failure tests | NOT auto-activated — deferred behind an explicit future 05 decision |
| D. Plaintext `.env` / OS keychain | Violates SEC-14 / machine-bound | Declined |

**Decision proposal for G02: Vault when verified available and secure; otherwise cloud-provider credential persistence stays disabled pending a separately approved alternative. Local Ollama remains operational regardless.**

## 4. [REQUIRED] Consequences and implementation impact

`secrets/` module with a `SecretStore` port and two explicit states: `vault-active` (post-verification) or `disabled` (fail-closed). OP-15/16 behavior per state; API error code `CREDENTIAL_STORE_UNAVAILABLE` added. Verification evidence lands as TC-32 (fail-closed behavior included); migration: none (no keys exist yet). If the disabled state persists, cloud providers remain metadata-only until the owner approves an alternative (C with the full review list, or another mechanism). Invariants preserved: SEC-4/14; no silent degradation.

## 5. [OPTIONAL] Revisit triggers

Vault verified available+secure (activates A); owner separately approves fallback C after reviewing the seven listed concerns; multi-machine deployment → protocol 21.

## 6. [REQUIRED] Unknowns, review and supersession

Unknowns: Vault availability; Vault grant/privilege posture on this project (both verified read-only at implementation before activation). Human review: **G02-DESIGN** (this revision supersedes ADR-0002 v0.1's "auto-fallback" posture per the G02 change request; v0.1 preserved in git history).
