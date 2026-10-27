import { useCallback, useEffect, useMemo, useState } from "react";
import { CallEngine, type CallState, type RecorderHandle, type AnalyserHandle, type SpeechHandle } from "./engine";
import { api, postAudio } from "../lib/api";
import { createRecorder } from "./recorder";

/* ---- Real browser adapters ---- */

function openMic(): Promise<{ stream: MediaStream; recorder: RecorderHandle; analyser: AnalyserHandle }> {
  return navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  }).then((stream) => {
    let ctx: AudioContext | undefined;
    try {
    const mime = typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "";
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const recorder = createRecorder(rec);

    const Ctx: typeof AudioContext = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new Ctx();
    const audioContext = ctx;
    const src = ctx.createMediaStreamSource(stream);
    const node = ctx.createAnalyser();
    node.fftSize = 512;
    src.connect(node);
    const buf = new Float32Array(node.fftSize);
    const analyser: AnalyserHandle = {
      level: () => {
        node.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) { const v = buf[i] ?? 0; sum += v * v; }
        return Math.sqrt(sum / buf.length);
      },
      close: () => { src.disconnect(); node.disconnect(); void audioContext.close().catch(() => undefined); },
    };
    return { stream, recorder, analyser };
    } catch (error) {
      stream.getTracks().forEach((track) => track.stop());
      void ctx?.close().catch(() => undefined);
      throw error;
    }
  });
}

export function makeSpeech(): SpeechHandle {
  let finish: (() => void) | null = null;
  return {
    speak: (text: string) =>
      new Promise<void>((resolve) => {
        if (typeof speechSynthesis === "undefined") {
          resolve();
          return;
        }
        const u = new SpeechSynthesisUtterance(text);
        u.rate = 1.03;
        let settled = false;
        const done = () => {
          if (!settled) {
            settled = true;
            finish = null;
            resolve();
          }
        };
        u.onend = done;
        u.onerror = done;
        finish?.();
        speechSynthesis.cancel();
        finish = done;
        speechSynthesis.speak(u);
      }),
    cancel: () => {
      if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
      finish?.(); // browsers do not consistently emit onend after cancel()
    },
  };
}

/* ---- Hook ---- */
export function useCallEngine() {
  const [state, setState] = useState<CallState | null>(null);

  const engine = useMemo(
    () =>
      new CallEngine({
        openMic,
        speech: makeSpeech(),
        api: {
          startConversation: (channel) => api.startConversation(channel),
          postAudio: (id, token, blob) => postAudio(id, token, blob, "call.webm"),
          endConversation: (id, token) => api.endConversation(id, token),
        },
      }),
    [],
  );

  const status = state?.status ?? "idle";
  const live = status !== "idle" && status !== "ended";

  // Single drive loop: VAD ticking, duration, and state sync (async speech/API
  // transitions are picked up on the next 90ms tick).
  useEffect(() => {
    if (!live) return;
    const t0 = performance.now();
    const h = setInterval(() => {
      engine.tick(performance.now());
      setState({ ...engine.getState(), durationSec: Math.floor((performance.now() - t0) / 1000) });
    }, 90);
    return () => clearInterval(h);
  }, [engine, live]);

  useEffect(() => {
    return () => {
      void engine.end();
    };
  }, [engine]);

  const start = useCallback(() => {
    // engine.start() flips to "connecting" synchronously — surface it at once
    // so the stage reflects the call beginning while permission is pending.
    const started = engine.start();
    setState({ ...engine.getState() });
    void started.then(() => setState({ ...engine.getState() }));
  }, [engine]);
  const end = useCallback(() => {
    void engine.end().then(() => setState({ ...engine.getState() }));
  }, [engine]);
  const handoffToText = useCallback(() => engine.end(true), [engine]);
  const toggleMute = useCallback(() => {
    engine.toggleMute();
    setState({ ...engine.getState() });
  }, [engine]);
  const setSpeaker = useCallback((on: boolean) => {
    engine.setSpeaker(on);
    setState({ ...engine.getState() });
  }, [engine]);
  const retryVoice = useCallback(() => {
    engine.retryVoice();
    setState({ ...engine.getState() });
  }, [engine]);

  return {
    state: state ?? engine.getState(),
    start,
    end,
    handoffToText,
    toggleMute,
    setSpeaker,
    retryVoice,
    isSecureContext: typeof window === "undefined" ? true : window.isSecureContext,
  };
}
