import { describe, expect, it } from "vitest";
import { CallEngine, type CallEngineDeps, type RecorderHandle, type AnalyserHandle } from "./engine";

/**
 * Deterministic lifecycle tests for the browser voice-call engine: the
 * repeatable turn loop, end-of-turn silence detection, the recorder-paused
 * TTS feedback guard, barge-in, STT-unavailable degradation and cleanup.
 * Time is driven by calling tick(now) with explicit clock values.
 */

interface World {
  levels: number[]; // analyser levels; last entry repeats
  recorder: { started: number; paused: number; resumed: number; stopped: number; blobSize: number };
  speakDone: (() => void) | null;
  micEnded: boolean;
  conversationEnded: boolean;
}

function makeWorld(opts?: { sttCode?: string; reply?: string; offerInTurn?: boolean }) {
  const w: World = {
    levels: [0],
    recorder: { started: 0, paused: 0, resumed: 0, stopped: 0, blobSize: 8000 },
    speakDone: null,
    micEnded: false,
    conversationEnded: false,
  };
  const recorder: RecorderHandle = {
    start: () => void w.recorder.started++,
    pause: () => void w.recorder.paused++,
    resume: () => void w.recorder.resumed++,
    stop: async () => {
      w.recorder.stopped++;
      return { size: w.recorder.blobSize } as unknown as Blob;
    },
    isSupported: () => true,
  };
  const analyser: AnalyserHandle = {
    level: () => w.levels[w.levels.length - 1] ?? 0,
    close: () => undefined,
  };
  const deps: CallEngineDeps = {
    openMic: async () => ({
      stream: {
        getTracks: () => [{ stop: () => (w.micEnded = true) }],
        getAudioTracks: () => [],
      } as unknown as MediaStream,
      recorder,
      analyser,
    }),
    speech: {
      speak: () =>
        new Promise<void>((resolve) => {
          w.speakDone = resolve;
        }),
      cancel: () => {
        w.speakDone?.();
        w.speakDone = null;
      },
    },
    api: {
      startConversation: async () => ({ conversationId: "c1", greeting: "Good morning!", accessToken: "tok" }),
      postAudio: async () => {
        if (opts?.sttCode) {
          const err = new Error("stt down") as Error & { code: string };
          err.code = opts.sttCode;
          throw err;
        }
        return {
          transcript: "what are your hours",
          reply: opts?.reply ?? "We are open Monday to Friday.",
          conversationState: "active",
          offer: opts?.offerInTurn
            ? { slot: "2026-11-14T10:00:00Z", end: "2026-11-14T10:45:00Z", expiresAt: "2026-11-14T09:00:00Z", offerToken: "u1", durationMinutes: 45, timezone: "Europe/Berlin" }
            : undefined,
        };
      },
      endConversation: async () => {
        w.conversationEnded = true;
        return { conversationState: "ended" };
      },
    },
  };
  return { w, deps };
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

async function startCall(deps: CallEngineDeps) {
  const engine = new CallEngine(deps);
  const p = engine.start();
  await flush();
  return { engine, p };
}

/** Speak a turn: run speech while ticks observe it, then finish. */
async function finishSpeech(w: World, engine: CallEngine, t: { now: number }) {
  w.speakDone?.();
  w.speakDone = null;
  await flush();
  engine.tick((t.now += 90));
  await flush();
}

describe("CallEngine", () => {
  it("text handoff releases the microphone without ending its backend session, including unmount cleanup", async () => {
    const { w, deps } = makeWorld();
    const { engine } = await startCall(deps);
    await finishSpeech(w, engine, { now: 0 });
    await engine.end(true);
    await engine.end();
    expect(w.micEnded).toBe(true);
    expect(w.conversationEnded).toBe(false);
    expect(engine.getState().session?.id).toBe("c1");
  });
  it("mute discards a partial utterance without uploading it", async () => {
    const { w, deps } = makeWorld();
    let uploads = 0;
    deps.api.postAudio = async () => { uploads++; return { transcript: "unexpected", reply: "unexpected" }; };
    const { engine } = await startCall(deps);
    await finishSpeech(w, engine, { now: 0 });
    w.levels = [0.05]; engine.tick(100); engine.tick(500);
    engine.toggleMute();
    engine.tick(2000); await flush(); await flush();
    expect(uploads).toBe(0);
    expect(w.recorder.stopped).toBe(1);
    engine.toggleMute(); await flush();
    expect(engine.getState().status).toBe("listening");
    expect(w.recorder.started).toBe(2);
    await engine.end();
  });

  it("ends a session that finishes connecting after the call was terminated", async () => {
    const { deps } = makeWorld();
    let connected!: (session: { conversationId: string; greeting: string; accessToken: string }) => void;
    const ended: string[] = [];
    deps.api.startConversation = () => new Promise(resolve => { connected = resolve; });
    deps.api.endConversation = async id => { ended.push(id); };
    const engine = new CallEngine(deps);
    const started = engine.start(); await flush();
    await engine.end();
    connected({ conversationId: "late-session", greeting: "Hello", accessToken: "fixture" });
    await started;
    expect(ended).toEqual(["late-session"]);
    expect(engine.getState().status).toBe("ended");
  });

  it("recycles silent idle capture without STT uploads or transcript changes", async () => {
    const { w, deps } = makeWorld();
    let uploads = 0;
    deps.api.postAudio = async () => { uploads++; return { transcript: "unexpected", reply: "unexpected" }; };
    const { engine } = await startCall(deps);
    await finishSpeech(w, engine, { now: 0 });
    engine.tick(100); engine.tick(10100); await flush(); await flush();
    expect(uploads).toBe(0);
    expect(w.recorder.stopped).toBe(1);
    expect(w.recorder.started).toBe(2);
    expect(engine.getState().transcript).toHaveLength(1);
    await engine.end();
  });
  it("silence, separated noise blips and muted input never submit a customer turn", async () => {
    const { w, deps } = makeWorld();
    let uploads = 0;
    deps.api.postAudio = async () => { uploads++; return { transcript: "unexpected", reply: "unexpected" }; };
    const { engine } = await startCall(deps);
    await finishSpeech(w, engine, { now: 0 });
    let now = 100;
    for (let i = 0; i < 20; i++) {
      w.levels = [0.05]; engine.tick(now += 90);
      w.levels = [0]; engine.tick(now += 300);
    }
    engine.tick(now += 30000);
    await flush();
    expect(uploads).toBe(0);
    engine.toggleMute();
    w.levels = [0.2];
    for (let i = 0; i < 10; i++) engine.tick(now += 90);
    w.levels = [0]; engine.tick(now += 2000);
    await flush();
    expect(uploads).toBe(0);
    await engine.end();
  });

  it("a continuous utterance is bounded at 25 seconds even without silence", async () => {
    const { w, deps } = makeWorld();
    const { engine } = await startCall(deps);
    await finishSpeech(w, engine, { now: 0 });
    w.levels = [0.05];
    engine.tick(100);
    engine.tick(25100);
    expect(engine.getState().status).toBe("processing");
    expect(w.recorder.stopped).toBe(1);
    await engine.end();
  });

  it.each(["NO_SPEECH", "OLLAMA_UNAVAILABLE"])("%s does not invent a customer transcript or assistant response", async (sttCode) => {
    const { w, deps } = makeWorld({ sttCode });
    const { engine } = await startCall(deps);
    await finishSpeech(w, engine, { now: 0 });
    w.levels = [0.05]; engine.tick(100); engine.tick(500);
    w.levels = [0]; engine.tick(1800);
    await flush(); await flush();
    expect(engine.getState().transcript).toHaveLength(1); // greeting only
    expect(engine.getState().status).toBe(sttCode === "NO_SPEECH" ? "listening" : "error");
    expect(engine.getState().note).toBeTruthy();
    await engine.end();
  });

  it("connect → speak greeting (recorder paused = feedback guard) → listen → silence ends turn → reply spoken → listens again", async () => {
    const { w, deps } = makeWorld();
    const { engine } = await startCall(deps);

    // Greeting is spoken first; recorder must be paused while it speaks.
    expect(engine.getState().status).toBe("speaking");
    expect(w.recorder.paused).toBe(1);

    const t = { now: 0 };
    await finishSpeech(w, engine, t);
    expect(engine.getState().status).toBe("listening");
    expect(w.recorder.started).toBe(1);

    // Customer speaks (~450ms), then goes silent.
    w.levels = [0.05];
    for (let i = 0; i < 5; i++) engine.tick((t.now += 90));
    w.levels = [0];
    engine.tick((t.now += 90));
    expect(engine.getState().status).toBe("listening"); // 90ms silence: not yet
    let sawProcessing = false;
    for (let i = 0; i < 13 && !sawProcessing; i++) {
      engine.tick((t.now += 90));
      sawProcessing = engine.getState().status === "processing";
    }
    expect(sawProcessing).toBe(true); // end of turn detected synchronously
    expect(w.recorder.stopped).toBe(1);

    // Transcript round trip + reply spoken; recorder paused again.
    await flush();
    await flush();
    expect(engine.getState().status).toBe("speaking");
    const texts = engine.getState().transcript.map((x) => `${x.role}:${x.text}`);
    expect(texts).toContain("customer:what are your hours");
    expect(texts).toContain("assistant:We are open Monday to Friday.");

    await finishSpeech(w, engine, t);
    expect(engine.getState().status).toBe("listening"); // repeatable turns
    expect(w.recorder.paused).toBe(2);

    // End call: mic tracks stopped, conversation ended, state terminal.
    await engine.end();
    expect(engine.getState().status).toBe("ended");
    expect(w.micEnded).toBe(true);
    expect(w.conversationEnded).toBe(true);
  });

  it("an offer surfaced in a call turn is exposed for the UI (confirm still happens in chat)", async () => {
    const { w, deps } = makeWorld({ offerInTurn: true });
    const { engine } = await startCall(deps);
    const t = { now: 0 };
    await finishSpeech(w, engine, t);
    w.levels = [0.05];
    for (let i = 0; i < 5; i++) engine.tick((t.now += 90));
    w.levels = [0];
    for (let i = 0; i < 14; i++) engine.tick((t.now += 90));
    await flush();
    await flush();
    expect(engine.getState().offer?.offerToken).toBe("u1");
    await engine.end();
  });

  it("STT unavailable degrades honestly and keeps the session for text chat", async () => {
    const { w, deps } = makeWorld({ sttCode: "RESOURCE_LIMIT" });
    const { engine } = await startCall(deps);
    const t = { now: 0 };
    await finishSpeech(w, engine, t);
    w.levels = [0.05];
    for (let i = 0; i < 5; i++) engine.tick((t.now += 90));
    w.levels = [0];
    for (let i = 0; i < 14; i++) engine.tick((t.now += 90));
    await flush();
    await flush();
    await flush();
    const s = engine.getState();
    expect(s.status).toBe("unavailable");
    expect(s.note).toContain("text chat");
    expect(s.session).not.toBeNull();
    await engine.end();
  });

  it("microphone rejection surfaces a clear error", async () => {
    const base = makeWorld();
    const deps: CallEngineDeps = { ...base.deps, openMic: async () => {
      throw new Error("denied");
    } };
    const engine = new CallEngine(deps);
    await engine.start();
    expect(engine.getState().status).toBe("error");
    expect(engine.getState().note).toContain("Microphone");
  });

  it("barge-in: loud sustained input cancels TTS, marks the interruption, resumes listening", async () => {
    const { w, deps } = makeWorld();
    const { engine } = await startCall(deps);
    expect(engine.getState().status).toBe("speaking");
    // Loud sustained customer voice during TTS (> BARGE_MS of >= BARGE_RMS).
    w.levels = [0.2];
    let now = 0;
    for (let i = 0; i < 5; i++) {
      engine.tick((now += 90));
      await flush();
    }
    expect(engine.getState().status).toBe("listening");
    expect(engine.getState().transcript.some((x) => x.text === "— interrupted —")).toBe(true);
    await engine.end();
  });

  it("a too-short recording is skipped without an API round trip", async () => {
    const { w, deps } = makeWorld();
    w.recorder.blobSize = 500;
    const { engine } = await startCall(deps);
    const t = { now: 0 };
    await finishSpeech(w, engine, t);
    w.levels = [0.05];
    for (let i = 0; i < 5; i++) engine.tick((t.now += 90));
    w.levels = [0];
    for (let i = 0; i < 14; i++) engine.tick((t.now += 90));
    await flush();
    await flush();
    expect(engine.getState().status).toBe("listening"); // silently resumed
    expect(engine.getState().transcript.every((x) => x.text !== "…")).toBe(true);
    await engine.end();
  });

  it("ending mid-turn invalidates the in-flight turn (no stale post after end)", async () => {
    const { w, deps } = makeWorld();
    // Hold postAudio until the test releases it, so end() lands mid-flight.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = () => r()));
    const heldDeps: CallEngineDeps = {
      ...deps,
      api: {
        ...deps.api,
        postAudio: async (id, token, blob) => {
          await gate;
          return deps.api.postAudio(id, token, blob);
        },
      },
    };
    const { engine } = await startCall(heldDeps);
    const t = { now: 0 };
    await finishSpeech(w, engine, t);
    w.levels = [0.05];
    for (let i = 0; i < 5; i++) engine.tick((t.now += 90));
    w.levels = [0];
    for (let i = 0; i < 14; i++) {
      engine.tick((t.now += 90));
      if (engine.getState().status === "processing") break;
    }
    await flush(); // finishTurn begins; postAudio now pending on the gate
    await engine.end();
    release();
    await flush();
    await flush();
    expect(engine.getState().status).toBe("ended"); // not overwritten by the stale turn
    expect(engine.getState().transcript.every((x) => x.role !== "assistant" || x.text === "Good morning!")).toBe(true);
  });

  it("silent mode (speaker off): replies are never spoken, recorder never pauses", async () => {
    const { w, deps } = makeWorld();
    const { engine } = await startCall(deps);
    engine.setSpeaker(false);
    await flush();
    // Greeting TTS was cancelled → straight to listening, no speak pending.
    expect(engine.getState().status).toBe("listening");
    expect(w.speakDone).toBeNull();

    const t = { now: 0 };
    w.levels = [0.05];
    for (let i = 0; i < 5; i++) engine.tick((t.now += 90));
    w.levels = [0];
    for (let i = 0; i < 14; i++) engine.tick((t.now += 90));
    await flush();
    await flush();
    // Reply arrived as transcript but was never spoken (paused stayed at the
    // single greeting pause; no new speak promise was created).
    expect(engine.getState().status).toBe("listening");
    expect(w.recorder.paused).toBe(1);
    expect(w.speakDone).toBeNull();
    expect(engine.getState().transcript.some((x) => x.text === "We are open Monday to Friday.")).toBe(true);
    await engine.end();
  });

  it("retryVoice from STT-unavailable resumes listening with the note cleared", async () => {
    const { w, deps } = makeWorld({ sttCode: "RESOURCE_LIMIT" });
    const { engine } = await startCall(deps);
    const t = { now: 0 };
    await finishSpeech(w, engine, t);
    w.levels = [0.05];
    for (let i = 0; i < 5; i++) engine.tick((t.now += 90));
    w.levels = [0];
    for (let i = 0; i < 14; i++) engine.tick((t.now += 90));
    await flush();
    await flush();
    await flush();
    expect(engine.getState().status).toBe("unavailable");

    engine.retryVoice();
    expect(engine.getState().status).toBe("listening");
    expect(engine.getState().note).toBeNull();
    await engine.end();
  });
});
