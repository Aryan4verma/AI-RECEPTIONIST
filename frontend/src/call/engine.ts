/**
 * CallEngine — the browser voice-call state machine.
 *
 * One continuous loop over the EXISTING backend services:
 *   mic capture → silence detection (end of turn) → POST /audio (STT + turn)
 *   → spoken reply (speechSynthesis) → listen again — until the call ends.
 *
 * Determinism: everything time-driven (VAD silence detection, barge-in
 * sustain) runs inside tick(now), which the UI calls on a rAF/interval loop.
 * The only async events are the injected speech + API adapters, so the whole
 * lifecycle is unit-testable without fake timers (engine.test.ts).
 *
 * Feedback-loop guard: the recorder is PAUSED while the assistant speaks, so
 * its own TTS audio can never be transcribed back as a customer turn. Barge-in
 * watches the separately-analysed (echo-cancelled) signal and cancels TTS.
 * Every animated state the UI shows maps to a real engine state.
 */

export type CallStatus =
  | "idle"
  | "connecting"
  | "listening"
  | "processing"
  | "speaking"
  | "unavailable"
  | "error"
  | "ended";

export interface CallTurn {
  id: number;
  role: "customer" | "assistant" | "system";
  text: string;
}

export interface CallOffer {
  slot: string;
  end: string;
  expiresAt: string;
  offerToken: string;
  durationMinutes: number;
  timezone: string;
}

export interface CallState {
  status: CallStatus;
  durationSec: number;
  muted: boolean;
  /** Real mic level 0..1 while listening (drives the visualizer); 0 otherwise. */
  level: number;
  transcript: CallTurn[];
  note: string | null; // human explanation for unavailable/error
  offer: CallOffer | null;
  session: { id: string; token: string } | null;
}

/* ---- Injectable adapters (real browser impls in useCallEngine.ts) ---- */
export interface RecorderHandle {
  start(): void;
  /** Pause capture (feedback guard while TTS speaks). */
  pause(): void;
  resume(): void;
  /** Stop and resolve the captured audio blob. */
  stop(): Promise<Blob>;
  isSupported(): boolean;
}

export interface AnalyserHandle {
  /** RMS amplitude 0..1 of the live (echo-cancelled) mic signal. */
  level(): number;
  close(): void;
}

export interface SpeechHandle {
  /** Speak; resolves when finished or cancelled. */
  speak(text: string): Promise<void>;
  cancel(): void;
}

export interface CallEngineDeps {
  openMic(): Promise<{ stream: MediaStream; recorder: RecorderHandle; analyser: AnalyserHandle }>;
  speech: SpeechHandle;
  api: {
    startConversation(channel: "voice"): Promise<{ conversationId: string; greeting: string; accessToken: string }>;
    postAudio(id: string, token: string, blob: Blob): Promise<{
      transcript: string;
      reply: string;
      conversationState?: string;
      offer?: CallOffer;
    }>;
    endConversation(id: string, token: string): Promise<unknown>;
  };
}

/** Tuning — deliberately conservative; barge-in needs LOUD sustained input. */
const SILENCE_MS = 1200; // end-of-turn silence after speech
const MIN_SPEECH_MS = 220; // ignore blips shorter than this
const VOICE_RMS = 0.015; // speech detection threshold
const BARGE_RMS = 0.13; // barge-in threshold (well above echo residue)
const BARGE_MS = 350;
const MAX_TURN_MS = 25_000; // force end-of-turn on a very long utterance

const STT_DOWN_CODES = new Set(["STT_FAILED", "RESOURCE_LIMIT"]);

export class CallEngine {
  private state: CallState = {
    status: "idle",
    durationSec: 0,
    muted: false,
    level: 0,
    transcript: [],
    note: null,
    offer: null,
    session: null,
  };
  private nextId = 1;
  private mic: Awaited<ReturnType<CallEngineDeps["openMic"]>> | null = null;
  private stopped = true;
  private startedAt = 0; // ms, listening window start
  private speechStartedAt: number | null = null;
  private lastVoiceAt = 0;
  private bargeStart: number | null = null;
  private pendingBarge = false; // tick() marks a real interruption before cancelling TTS
  private listenEpoch = 0; // invalidates stale turn finishing

  constructor(private readonly deps: CallEngineDeps) {}

  getState(): CallState {
    return this.state;
  }

  private set(patch: Partial<CallState>) {
    this.state = { ...this.state, ...patch };
  }

  private push(role: CallTurn["role"], text: string) {
    this.set({ transcript: [...this.state.transcript, { id: this.nextId++, role, text }] });
  }

  async start(): Promise<void> {
    if (this.state.status !== "idle" && this.state.status !== "ended" && this.state.status !== "error") return;
    this.stopped = false;
    this.set({ status: "connecting", note: null, offer: null, durationSec: 0, transcript: [], level: 0 });
    try {
      this.mic = await this.deps.openMic();
    } catch {
      this.set({ status: "error", note: "Microphone access was blocked. Allow microphone permission and try again." });
      return;
    }
    if (this.stopped) {
      await this.cleanupMic();
      return;
    }
    try {
      const s = await this.deps.api.startConversation("voice");
      if (this.stopped) {
        await this.cleanupMic();
        return;
      }
      this.set({ session: { id: s.conversationId, token: s.accessToken } });
      this.push("assistant", s.greeting);
      await this.speakThenListen(s.greeting);
    } catch {
      this.set({ status: "error", note: "Couldn't reach the receptionist. Please try again." });
      await this.cleanupMic();
    }
  }

  /** Drive time-based logic; the UI calls this on a ~90ms loop. */
  tick(nowMs: number): void {
    if (this.stopped) return;
    const lvl = this.mic?.analyser.level() ?? 0;
    if (this.state.status === "listening") {
      this.set({ level: Math.min(1, lvl * 6) });
      if (lvl >= VOICE_RMS) {
        this.speechStartedAt ??= nowMs;
        this.lastVoiceAt = nowMs;
      }
      const spokeFor = this.speechStartedAt !== null && this.lastVoiceAt - this.speechStartedAt >= MIN_SPEECH_MS;
      const silenceDone = spokeFor && nowMs - this.lastVoiceAt >= SILENCE_MS;
      const tooLong = nowMs - this.startedAt >= MAX_TURN_MS && this.lastVoiceAt > 0 && nowMs - this.lastVoiceAt >= 300;
      if (silenceDone || tooLong) {
        this.speechStartedAt = null;
        void this.finishTurn(this.listenEpoch);
      }
    } else if (this.state.status === "speaking") {
      // Barge-in: loud sustained customer voice cancels TTS.
      if (lvl >= BARGE_RMS) {
        this.bargeStart ??= nowMs;
        if (nowMs - this.bargeStart >= BARGE_MS) {
          this.bargeStart = null;
          this.pendingBarge = true;
          this.deps.speech.cancel(); // resolves the speak promise → listen()
        }
      } else {
        this.bargeStart = null;
      }
    } else {
      this.set({ level: 0 });
    }
  }

  toggleMute(): void {
    const next = !this.state.muted;
    this.mic?.stream.getAudioTracks().forEach((t) => (t.enabled = !next));
    this.set({ muted: next });
  }

  async end(): Promise<void> {
    this.stopped = true;
    this.listenEpoch++;
    this.deps.speech.cancel();
    const s = this.state.session;
    await this.cleanupMic();
    if (s) {
      try {
        await this.deps.api.endConversation(s.id, s.token);
      } catch {
        /* best-effort: the call is over regardless */
      }
    }
    this.set({ status: "ended", level: 0 });
  }

  private async cleanupMic() {
    this.mic?.stream.getTracks().forEach((t) => t.stop());
    this.mic?.analyser.close();
    this.mic = null;
  }

  /** Speak with the recorder paused; resume listening when done (or barged in). */
  private async speakThenListen(text: string): Promise<void> {
    if (this.stopped) return;
    this.set({ status: "speaking" });
    this.mic?.recorder.pause();
    const epoch = this.listenEpoch;
    try {
      await this.deps.speech.speak(text);
    } catch {
      /* cancelled or failed → still resume listening */
    }
    if (this.stopped || epoch !== this.listenEpoch) return;
    if (this.pendingBarge) {
      this.pendingBarge = false;
      this.push("system", "— interrupted —");
    }
    this.listen();
  }

  /** Continuous capture until end-of-turn silence is detected (see tick). */
  private listen(): void {
    if (this.stopped) return;
    this.set({ status: "listening", level: 0 });
    this.speechStartedAt = null;
    this.lastVoiceAt = 0;
    this.startedAt = this.lastTickTime();
    const rec = this.mic?.recorder;
    if (!rec || !rec.isSupported()) {
      this.set({
        status: "unavailable",
        note: "Voice capture isn't supported in this browser — continue in text chat instead.",
      });
      return;
    }
    try {
      rec.resume();
      rec.start();
    } catch {
      /* already recording */
    }
  }

  /** Anchor for startedAt when no tick clock is available (real clock). */
  private lastTickTime(): number {
    return typeof performance !== "undefined" ? performance.now() : Date.now();
  }

  /** Stop capture, send the audio, speak the reply, listen again. */
  private async finishTurn(epoch: number): Promise<void> {
    if (this.stopped || epoch !== this.listenEpoch) return;
    this.set({ status: "processing", level: 0 });
    const rec = this.mic?.recorder;
    const s = this.state.session;
    if (!rec || !s) return;
    let blob: Blob;
    try {
      blob = await rec.stop();
    } catch {
      this.listen();
      return;
    }
    if (this.stopped || epoch !== this.listenEpoch) return;
    if (blob.size < 2000) {
      // Too short to be speech — skip the round trip.
      this.listen();
      return;
    }
    this.push("customer", "…"); // placeholder replaced by the transcript
    try {
      const r = await this.deps.api.postAudio(s.id, s.token, blob);
      if (this.stopped || epoch !== this.listenEpoch) return;
      const transcript = this.state.transcript.slice();
      const mine = transcript.pop();
      if (mine) transcript.push({ ...mine, text: r.transcript });
      this.set({ transcript, offer: r.offer ?? this.state.offer });
      if (r.conversationState === "escalated") {
        this.push("system", "Your conversation has been flagged for the team — they'll follow up with you.");
      }
      this.push("assistant", r.reply);
      await this.speakThenListen(r.reply);
    } catch (err) {
      if (this.stopped || epoch !== this.listenEpoch) return;
      const code = (err as { code?: string })?.code ?? "";
      if (STT_DOWN_CODES.has(code)) {
        this.set({
          status: "unavailable",
          note: "Voice recognition is unavailable on the receptionist right now. Your call can continue in text chat.",
        });
      } else {
        this.set({ status: "error", note: "The receptionist couldn't be reached. Please try again." });
      }
    }
  }
}
