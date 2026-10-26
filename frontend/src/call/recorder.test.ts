import { describe, expect, it } from "vitest";
import { createRecorder } from "./recorder";
import { CallEngine } from "./engine";

/** Browser event ordering: final dataavailable follows stop(), then onstop. */
class FakeMediaRecorder {
  state: RecordingState = "inactive";
  mimeType = "audio/webm";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  audio = "";
  stops = 0;
  start() { this.state = "recording"; }
  pause() { this.state = "paused"; }
  resume() { this.state = "recording"; }
  stop() {
    this.stops++;
    this.state = "inactive";
    const audio = this.audio;
    queueMicrotask(() => {
      this.ondataavailable?.({ data: new Blob([audio]) });
      this.onstop?.();
    });
  }
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("real recorder adapter lifecycle (synthetic browser events)", () => {
  it("resets chunks AND stop promise; includes final bytes, and coalesces duplicate stops", async () => {
    const native = new FakeMediaRecorder();
    const recorder = createRecorder(native as unknown as MediaRecorder);
    recorder.start();
    native.ondataavailable?.({ data: new Blob(["first-"]) });
    native.audio = "utterance";
    const first = recorder.stop();
    expect(recorder.stop()).toBe(first);
    expect(() => recorder.start()).toThrow("still stopping");
    expect(await (await first).text()).toBe("first-utterance");
    recorder.start();
    native.audio = "second-utterance";
    const second = recorder.stop();
    expect(second).not.toBe(first);
    expect(await (await second).text()).toBe("second-utterance");
    expect(native.stops).toBe(2);
    recorder.dispose?.();
    expect(recorder.isSupported()).toBe(false);
  });

  it("two VAD turns submit distinct adapter bytes and show transcripts derived from those bytes, once per turn", async () => {
    const native = new FakeMediaRecorder();
    const recorder = createRecorder(native as unknown as MediaRecorder);
    let level = 0;
    let stopped = false;
    let closed = false;
    let release!: () => void;
    let pending = 0;
    let peakPending = 0;
    const uploaded: string[] = [];
    const engine = new CallEngine({
      openMic: async () => ({
        recorder,
        stream: { getTracks: () => [{ stop() { stopped = true; } }], getAudioTracks: () => [] } as unknown as MediaStream,
        analyser: { level: () => level, close() { closed = true; } },
      }),
      speech: { speak: async () => undefined, cancel() {} },
      api: {
        startConversation: async () => ({ conversationId: "synthetic", accessToken: "test", greeting: "Hello" }),
        endConversation: async () => undefined,
        postAudio: async (_id, _token, blob) => {
          pending++;
          peakPending = Math.max(peakPending, pending);
          const bytes = await blob.text();
          uploaded.push(bytes);
          await new Promise<void>((resolve) => { release = resolve; });
          pending--;
          return { transcript: bytes.trim(), reply: "Acknowledged" };
        },
      },
    });
    engine.setSpeaker(false);
    await engine.start();
    let now = 0;
    const utterances = ["I want to buy a 3BHK flat.", "My budget is around 80 lakh."];
    for (const text of utterances) {
      native.audio = text.padEnd(3000, " ");
      level = 0.05;
      for (let i = 0; i < 6; i++) engine.tick(now += 90);
      level = 0;
      for (let i = 0; i < 20; i++) engine.tick(now += 90);
      await flush();
      expect(engine.getState().status).toBe("processing");
      for (let i = 0; i < 30; i++) engine.tick(now += 90);
      release();
      await flush();
      expect(engine.getState().status).toBe("listening");
    }
    expect(uploaded.map((bytes) => bytes.trim())).toEqual(utterances);
    expect(engine.getState().transcript.filter((turn) => turn.role === "customer").map((turn) => turn.text)).toEqual(utterances);
    expect(peakPending).toBe(1);
    await engine.end();
    expect(stopped && closed).toBe(true);
    expect(recorder.isSupported()).toBe(false);
  });
});
