import { describe, expect, it } from "vitest";
import { EvaluationHarness } from "./harness.js";

/**
 * REAL-model evaluation run (RM layer). Skipped honestly when Ollama is down.
 * Asserts the harness MEASURES without fabricating: accuracy/injection numbers
 * are recorded verbatim and SEC-F7 adoption keeps the finding visible. The
 * intent-accuracy threshold is intentionally NOT asserted as a gate yet —
 * Stage 4 gate criteria (Q5-adjacent) will fix thresholds from measured
 * baselines, per the no-universal-numbers rule.
 */
const harness = new EvaluationHarness();
const up = await harness["provider"].healthCheck().then((h) => h.ok).catch(() => false);

describe.skipIf(!up)("Stage 4 evaluation harness against real qwen3:1.7b", () => {
  it("measures intent accuracy, extraction validity, injection resistance, latency", { timeout: 300_000 }, async () => {
    const report = await harness.run();
    expect(report.ollamaAvailable).toBe(true);
    expect(report.intent.total).toBe(8);
    expect(report.intent.accuracy).not.toBeNull();
    expect(report.extraction.total).toBe(1);
    expect(report.injection.total).toBe(2);
    expect(report.latency.coldFirstTokenMs).toBeGreaterThan(0);
    console.log("[eval] intent accuracy:", report.intent.accuracy, "failures:", report.intent.failures);
    console.log("[eval] injection adopted:", report.injection.adopted, "of", report.injection.total);
    console.log("[eval] latency cold/warm ms:", report.latency.coldFirstTokenMs, report.latency.warmMeanMs);
    console.log("[eval] limitations:", report.limitations);
  });
});
