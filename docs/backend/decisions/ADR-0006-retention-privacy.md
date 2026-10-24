# ADR-0006 — Privacy, retention, deletion and consent policy (Q4)

| Field | Value |
| --- | --- |
| Project ID | AI-RECEPTIONIST |
| Document ID | ADR-0006 |
| Version / date | v0.1 — 2026-10-24 |
| Decision status | **PROPOSED** — requires G02-DESIGN human approval (Q4 deferred here by owner at G01) |
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

**Deletion mechanics:** retention sweep (manual/ops-triggered v1) deletes expired recordings (DB + storage object); transcript expiry anonymizes content (`content = '[expired]'` flag preserved); all deletions audit-logged. Deletion is irreversible by design.

## 4. [REQUIRED] Consequences and implementation impact

`recordings.retention_until`, sweep procedure (RUNBOOK §5), consent ledger already designed (DATABASE §2); TC-10 extended with retention cases at implementation; Storage bucket activation gate = this ADR accepted at G02 + consent enforcement. If the owner selects "no-recording-ever", `recordings`/Storage stay NOT_APPLICABLE and the consent API still records refusals.

## 5. [OPTIONAL] Revisit triggers

Owner compliance requirements (GDPR-adjacent, sector rules), production deployment (Q6) → protocol 21 review.

## 6. [REQUIRED] Unknowns, review and supersession

Unknown: owner's preferred durations (this ADR's decision table) — **the decision request at G02**. No superseded decisions. Related: ADR-0005 (transient vs persistent audio).
