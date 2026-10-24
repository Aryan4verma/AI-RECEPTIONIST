# ADR-0006 — Privacy, retention, deletion and consent policy (Q4)

| Field | Value |
| --- | --- |
| Project ID | AI-RECEPTIONIST |
| Document ID | ADR-0006 |
| Version / date | v0.2 — 2026-10-24 (G02 change-request revision: consent-evidence consistency, deletion mechanics) |
| Decision status | **ACCEPTED** — approved at G02-DESIGN with initial development-policy durations (2026-10-24; production or legal changes revisit via protocol 21) |
| Scope | Recording consent, retention durations, deletion rules for transcripts/recordings/customer data |

## 1. [REQUIRED] Control and decision status

Proposed. G01 condition binding this proposal: **no persistent recording or customer-personal-data storage proceeds until these policy decisions and required permissions are established.**

## 2. [REQUIRED] Context and requirements

FR-9 (consent-gated recording, disabled by default), FR-10 (protected records), CH-1 privacy posture; irreversible deletion semantics need authoritative values (RULES §2); no external compliance regime has been stated by the owner (none invented).

## 3. [REQUIRED] Alternatives and choice (proposal for G02 decision)

| Data class | Proposed policy | Rationale / alternatives for the owner to choose |
| --- | --- | --- |
| Transcripts (messages) | Retained while conversation active + **90 days** default, then deleted/anonymized; correctable by customer (OP-04) | Alternatives: 30 days (minimal) / 180 days (history-rich) / indefinite-with-anonymization |
| Audio recordings (dormant until this ADR approved) | Created **only** with explicit yes consent (recorded verbatim + timestamp); retention **30 days** default then hard delete (DB row + storage object); owner can disable recording entirely per config | Alternatives: no-recording-ever (simplest) / 7 days / 90 days |
| Conversation summaries | Derived, retained with transcript lifetime | — |
| Customer records | Retained until owner-initiated deletion; deletion = anonymize + set-null (appointments preserved as business history) | Owner may choose hard-delete |
| Audit log | Append-only, retained **1 year** | Longer if owner prefers |
| Consent decisions | Retained **3 years** (evidence of consent must outlive the recording) | Legal-hold instinct; owner may shorten |

**Consistency rules (v0.2, resolving the G02 change request):**
- **Consent evidence outlives conversations:** `consent_decisions` no longer cascade-deletes with the conversation (`ON DELETE SET NULL` + plain `conversation_ref` column preserves provenance). The proposed 3-year consent lifetime is enforceable independently of conversation deletion. (Durations remain proposals until the owner decides.)
- **Consent withdrawal, expiration and ordering (condition D):** the consent gate evaluates the **latest applicable decision** (`ORDER BY decided_at DESC, id DESC`) — withdrawal is a new append-only decision row (`decision = false`); expired consent (`valid_until` passed) never authorizes; a historical "yes" under a later "no" never authorizes. Enforced twice: role-independent DB trigger `enforce_recording_consent()` (fires even for RLS-bypassing service_role) and the trusted backend boundary applying the same rule. Negative cases (TC-33): no consent, explicit denial, granted-then-withdrawn, expired/superseded, service-role insert after withdrawal.
- **Storage objects, not just rows:** recording deletion = Supabase Storage object deletion **and** DB row deletion, with the storage delete attempted first; `recordings.conversation_id` is `ON DELETE SET NULL` (never cascade — conversation deletion cannot orphan the object); a partial failure leaves the row in `deletion_state = 'deletion_pending'` with `deletion_attempts`/`last_deletion_error`, retried (bounded, ≤ 3, with failure audit + escalation) — `deleted`/row removal only after **confirmed** object deletion, so denied/failed Storage deletion never masquerades as successful record deletion (condition B).
- **Deletion failures and retries:** sweeps (transcript expiry, recording retention, audit purge) run as bounded maintenance operations with per-item retry (≤ 3), explicit failure states, audit entries, and escalation to the owner on exhausted retries; a failed deletion never silently "succeeds".
- **Customer deletion/anonymization:** admin delete → `display_name` → `'[deleted customer]'`, contact fields nulled, notes cleared, row retained with FK set-nulls (scoped history retention per the owner's decision below); consent evidence and audit rows unaffected.
- **Transcript/summary expiry:** `messages.expires_at` + `conversations.summary` expiry set at write time from the approved policy; the expiry sweep replaces content with a tombstone marker (`'[expired per retention policy]'`), preserving message counts/structure without customer content.
- **Audit log vs append-only:** the 1-year audit purge is a **privileged maintenance path** (service-role, recorded in the privileged-path ledger, owner-authorized); append-only applies to all application/admin roles — no UPDATE ever, DELETE only by the authorized purge path.

## 4. [REQUIRED] Consequences and implementation impact

`recordings.retention_until`, sweep procedure (RUNBOOK §5), consent ledger already designed (DATABASE §2); TC-10 extended with retention cases at implementation; Storage bucket activation gate = this ADR accepted at G02 + consent enforcement. If the owner selects "no-recording-ever", `recordings`/Storage stay NOT_APPLICABLE and the consent API still records refusals.

## 5. [OPTIONAL] Revisit triggers

Owner compliance requirements (GDPR-adjacent, sector rules), production deployment (Q6) → protocol 21 review.

## 6. [REQUIRED] Unknowns, review and supersession

Unknown: owner's preferred durations (this ADR's decision table) — **the decision request at G02**. No superseded decisions. Related: ADR-0005 (transient vs persistent audio).
