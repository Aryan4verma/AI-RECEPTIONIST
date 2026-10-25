import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SidecarLifecycle } from "./sidecar.js";

/**
 * REAL-PROCESS lifecycle validation (finding 4 — layer: REAL process, no
 * model load, RAM-light): the actual Python sidecar starts, answers /health,
 * and terminates cleanly on stop. Model loading/transcription remains gated
 * on free RAM by scripts/speech-live-test.mjs.
 */
const VENV_PY = "sidecar/whisper/.venv/Scripts/python.exe";
const hasVenv = existsSync(VENV_PY);

describe.skipIf(!hasVenv)("sidecar process lifecycle (real python, no model)", () => {
  it("starts the real sidecar, reports health, and stops cleanly", { timeout: 60_000 }, async () => {
    const lifecycle = new SidecarLifecycle({
      port: 8793,
      pythonCmd: VENV_PY,
      appPath: "sidecar/whisper/app.py",
      minFreeBytes: 200 * 1024 * 1024, // no model load: plain process floor
    });
    const url = await lifecycle.ensureStarted();
    expect(url).toBe("http://127.0.0.1:8793");
    const health = await lifecycle.isHealthy();
    expect(health).toBe(true);

    await lifecycle.stop();
    // The port must be released (process actually terminated):
    let stillUp = true;
    for (let i = 0; i < 10; i++) {
      stillUp = await lifecycle.isHealthy();
      if (!stillUp) break;
      await new Promise((r) => setTimeout(r, 300));
    }
    expect(stillUp).toBe(false);
  });

  it("refuses to spawn below the admission floor (fail-closed)", async () => {
    const lifecycle = new SidecarLifecycle({
      port: 8794, pythonCmd: VENV_PY, appPath: "sidecar/whisper/app.py",
      minFreeBytes: Number.MAX_SAFE_INTEGER, // impossible floor
    });
    await expect(lifecycle.ensureStarted()).rejects.toMatchObject({ code: "RESOURCE_LIMIT" });
    expect(await lifecycle.isHealthy()).toBe(false);
  });
});
