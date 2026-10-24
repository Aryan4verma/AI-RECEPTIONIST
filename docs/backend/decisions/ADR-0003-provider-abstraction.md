# ADR-0003 — Unified LLM provider abstraction and runtime switching

| Field | Value |
| --- | --- |
| Project ID | AI-RECEPTIONIST |
| Document ID | ADR-0003 |
| Version / date | v0.1 — 2026-10-24 |
| Decision status | **ACCEPTED** — approved at G02-DESIGN (conditional approval, 2026-10-24; see PROGRESS.md section 5) |
| Scope | FR-15/FR-16/FR-17 provider architecture (CH-1) |

## 1. [REQUIRED] Control and decision status

Proposed. Requirement source: CH-1 (owner instruction 2026-10-24) — dynamic local/cloud model selection with one stable backend contract.

## 2. [REQUIRED] Context and requirements

Local-first default (`qwen3:1.7b` preserved) with opt-in OpenAI-compatible cloud providers; domain logic (conversation, intent, extraction, booking) must not couple to a provider; output always validated by trusted code; no silent local→cloud switching (SEC-15); host RAM constrained (R4); provider capabilities differ (structured output, tools, streaming).

## 3. [REQUIRED] Alternatives and choice

| Alternative | Fit / cost / security / operational consequences | Reason selected or declined |
| --- | --- | --- |
| **A. Provider port + two adapters + ModelRegistry (proposed)** | `LLMProvider` interface (`complete(structured request) → validated output`); `OllamaProvider` (local HTTP, JSON-schema-constrained where supported), `OpenAICompatibleProvider` (chat/completions; per-provider capability flags); `ModelRegistry` = live local discovery + DB-configured cloud providers; `InferenceService` = selection, limits, timeouts, validation, uncertainty | One contract owner; adapters addable without domain change (ai-capabilities llm guidance); switching is config-only (FR-17) |
| B. Vercel AI SDK multi-provider | Convenience, but adds framework dependency + abstraction mismatch for strict schema enforcement | Declined (keep deps minimal; direct adapters are small) |
| C. Per-feature direct SDK calls | Couples every feature to providers; switching would be code change | Declined (violates FR-17) |

**Capability honesty rule:** each provider row carries `capabilities` (jsonSchemaMode, tools, streaming…) verified per provider; unsupported features are named, never assumed (CH-1.B; ai-handoff rules).

## 4. [REQUIRED] Consequences and implementation impact

`ai/` module shape (ARCHITECTURE §4); `model_providers` table; OP-14…OP-18; switching applies from next turn; fallback only via explicitly approved config (TC-31); local discovery via Ollama supported APIs with no hardcoded names (TC-22). Testing: TC-21…TC-27, TC-31; real-model evals separate from mocks. Invariants preserved: SEC-12/14/15/16 enforcement points live in `InferenceService`.

## 5. [OPTIONAL] Revisit triggers

Need for a non-OpenAI-compatible provider (add specific adapter); streaming requirement; local model runtime other than Ollama → protocol 21.

## 6. [REQUIRED] Unknowns, review and supersession

Unknowns: which cloud provider(s) the owner will authorize (none authorized — fixture-only); qwen3 JSON-mode reliability (measured at Stage 4, R1). Human review: **G02-DESIGN**. Related: ADR-0002 (keys), CH-1 record.
