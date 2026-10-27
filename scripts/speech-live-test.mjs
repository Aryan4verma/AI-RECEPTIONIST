// GATED LIVE STT measurement (ADR-0005): real audio → real Faster-Whisper
// tiny-int8 on this laptop. Runs ONLY when available RAM permits (the gate is
// the point — a thrashing measurement is worthless); otherwise reports
// BLOCKED honestly. Speech sample is generated locally via Windows SAPI
// (free, offline); no customer data, nothing persisted.
import { exec } from "node:child_process";
import { freemem } from "node:os";
import { promisify } from "node:util";
import { SidecarLifecycle, SidecarSpeechToText } from "../dist/speech/sidecar.js";
import { validateAudio, wavDurationSeconds } from "../dist/speech/audioValidation.js";
import { readFile, unlink } from "node:fs/promises";

const run = promisify(exec);
const MIN_FREE_BYTES = 1_500_000_000; // 1.5 GB gate (model + runtime headroom)
const VENV_PY = "sidecar/whisper/.venv/Scripts/python.exe";
const WAV = "sidecar/whisper/.live-sample.wav";
const TEXT = "Hello, I would like to book a dentist appointment on Friday morning.";

async function main() {
  const free = freemem();
  console.log(`[live-stt] available memory: ${(free / 1e9).toFixed(2)} GB (gate: ${(MIN_FREE_BYTES / 1e9).toFixed(1)} GB)`);
  if (free < MIN_FREE_BYTES) {
    console.log("[live-stt] BLOCKED: insufficient free memory — measurement deferred (honest BLOCKED, not PASS).");
    process.exit(0);
  }

  // Generate a real speech sample with Windows SAPI (offline, free).
  await run(
    `powershell -NoProfile -Command "Add-Type -AssemblyName System.Speech; ` +
      `$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; ` +
      `$s.SetOutputToWaveFile('${WAV.replace(/\\/g, "/")}', (New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000,[System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,[System.Speech.AudioFormat.AudioChannel]::Mono))); ` +
      `$s.Speak('${TEXT}'); $s.Dispose()"`,
  );
  const audio = new Uint8Array(await readFile(WAV));
  const kind = validateAudio(audio, { maxBytes: 10 * 1024 * 1024, maxSeconds: 60 });
  const duration = wavDurationSeconds(audio);

  const lifecycle = new SidecarLifecycle({
    port: 8790,
    pythonCmd: VENV_PY,
    appPath: "sidecar/whisper/app.py",
    minFreeBytes: MIN_FREE_BYTES,
  });
  try {
    await lifecycle.ensureStarted();
    const stt = new SidecarSpeechToText({ baseUrl: lifecycle.baseUrl, timeoutMs: 90_000 });

    const coldStart = Date.now();
    const cold = await stt.transcribe(audio, 60);
    const coldTotal = Date.now() - coldStart;
    const warm = await stt.transcribe(audio, 60);

    // Sidecar RSS (Windows): find python children via tasklist
    let rssMb = null;
    try {
      const { stdout } = await run('tasklist /FI "IMAGENAME eq python.exe" /FO CSV');
      const rows = stdout.trim().split("\n").slice(1);
      const kbs = rows
        .filter((r) => r.includes("python"))
        .map((r) => Number(r.split('","')[4]?.replace(/[", K]/g, "") || 0));
      if (kbs.length) rssMb = Math.round(Math.max(...kbs) / 1024);
    } catch {
      /* RSS probe best-effort */
    }

    const norm = (s) => s.toLowerCase().replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();
    const expected = norm(TEXT);
    const gotCold = norm(cold.transcript);

    console.log("[live-stt] RESULT (real audio, real tiny-int8 CPU):");
    console.log(`  transcript(cold): "${cold.transcript}"`);
    console.log(`  transcript(warm): "${warm.transcript}"`);
    console.log(`  normalized exact match: cold=${expected === gotCold}, warm=${expected === norm(warm.transcript)}`);
    console.log(`  latency: cold(incl. model load)=${coldTotal}ms  stt-cold=${cold.latencyMs}ms  stt-warm=${warm.latencyMs}ms`);
    console.log(`  sidecar RSS (max python proc): ${rssMb === null ? "probe unavailable" : `${rssMb} MB`}`);
    console.log(`  audio: ${kind}, ${audio.length} bytes, ${duration?.toFixed(2) ?? "unknown"}s (synthetic speech; NOT a microphone test)`);
  } finally {
    await lifecycle.stop();
    await unlink(WAV).catch(() => undefined);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("[live-stt] ERROR:", err instanceof Error ? err.message : err);
  process.exit(1);
});
