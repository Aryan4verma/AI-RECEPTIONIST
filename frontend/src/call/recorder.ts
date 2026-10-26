import type { RecorderHandle } from "./engine";

/** Each start/stop pair owns its bytes and completion promise. */
export function createRecorder(rec: MediaRecorder): RecorderHandle {
  let chunks: Blob[] = [];
  let stopping: Promise<Blob> | null = null;
  let pendingStop = false;
  let disposed = false;
  rec.ondataavailable = (event) => {
    if (!disposed && event.data.size > 0) chunks.push(event.data);
  };
  return {
    start() {
      if (disposed) throw new Error("Recorder is closed");
      if (pendingStop) throw new Error("Recorder is still stopping");
      if (rec.state !== "inactive") return;
      chunks = [];
      stopping = null;
      rec.start(250);
    },
    pause() { if (rec.state === "recording") rec.pause(); },
    resume() { if (rec.state === "paused") rec.resume(); },
    stop() {
      stopping ??= new Promise<Blob>((resolve, reject) => {
        const done = () => {
          pendingStop = false;
          rec.onstop = null;
          rec.onerror = null;
          const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
          chunks = [];
          resolve(blob);
        };
        if (rec.state === "inactive") { done(); return; }
        pendingStop = true;
        rec.onstop = done;
        rec.onerror = () => {
          pendingStop = false;
          chunks = [];
          reject(new Error("Audio capture failed"));
        };
        rec.stop();
      });
      return stopping;
    },
    dispose() {
      disposed = true;
      chunks = [];
      rec.ondataavailable = null;
      if (rec.state !== "inactive") rec.stop();
    },
    isSupported: () => !disposed,
  };
}
