# ADR-0005 — Speech recognition architecture: Python faster-whisper sidecar

| Field | Value |
| --- | --- |
| Project ID | AI-RECEPTIONIST |
| Document ID | ADR-0005 |
| Version / date | v0.1 — 2026-10-24 |
| Decision status | **ACCEPTED** — approved at G02-DESIGN (conditional approval, 2026-10-24; see PROGRESS.md section 5) |
| Scope | FR-8 speech pipeline (STT in, response text out; no TTS server) |

## 1. [REQUIRED] Control and decision status

Proposed. Requirement source: FR-8; prompt §5.E; A1 (browser SpeechSynthesis for output — no TTS server unless demonstrated need).

## 2. [REQUIRED] Context and requirements

CPU-only transcription on 2-core/7.71 GB host (R4); preferred engine Faster-Whisper Tiny INT8; audio transient processing must be separate from consent-gated persistent recording (FR-9); turn-based flow with cancellation/timeouts; measured latency.

## 3. [REQUIRED] Alternatives and choice

| Alternative | Fit / cost / security / operational consequences | Reason selected or declined |
| --- | --- | --- |
| **A. Python sidecar process, localhost HTTP, on-demand model load + idle unload (proposed)** | faster-whisper runs natively (Python); process isolation contains memory + crashes; lifecycle manager spawns on demand, unloads after idle (default 10 min); never concurrent with peak LLM load where avoidable | Only mature CPU INT8 path; isolation matches R4; measured budgets enforced |
| B. Node-native whisper port (e.g., transformers.js/whisper.cpp bindings) | No Python dep, but immature/heavier on this host; INT8 support uncertain | Declined (risk on constrained host) |
| C. In-process Python embedding | Fragile runtime coupling | Declined |
| D. TTS server for output | Resource-heavy; A1 selects browser SpeechSynthesis | Declined (revisit only on demonstrated need) |

**Pipeline:** client audio (validated: magic bytes, ≤ 10 MB, ≤ 60 s) → sidecar `POST /transcribe` → transcript (untrusted text, SEC-8) → conversation flow (same as text turn). Transient processing: audio bytes memory-only, never persisted; recordings only via consent path post-Q4. Corrections via OP-04.

## 4. [REQUIRED] Consequences and implementation impact

`speech/` + `sidecar/whisper` (venv bootstrap documented in ENVIRONMENT/DEPLOYMENT); TC-09/TC-17/TC-19/TC-24; budgets: STT ≤ 2 s per ≤ 10 s clip (measured, Tiny INT8); RAM ≤ 900 MB sidecar. Failure: STT_FAILED safe error; transcription review/correction per FR-8. Invariants: SEC-8 (transcript = data), FR-9 (no persistence without consent).

## 5. [OPTIONAL] Revisit triggers

Base model justified by measured quality (G13 evidence); streaming ASR requirement; browser Web Speech API alternative → protocol 21.

## 6. [REQUIRED] Unknowns, review and supersession

Unknowns: measured Tiny accuracy on real samples (Stage 6 — evaluate before claiming accuracy per prompt §10); Base upgrade decision. Human review: **G02-DESIGN**. No superseded decisions.
