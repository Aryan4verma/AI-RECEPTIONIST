import { afterEach, expect, it, vi } from "vitest";
import { makeSpeech } from "./useCallEngine";

afterEach(() => vi.unstubAllGlobals());

it("cancel resolves pending speech even when the browser emits no completion event", async () => {
  vi.stubGlobal("SpeechSynthesisUtterance", class { rate = 1; onend = null; onerror = null; });
  const cancel = vi.fn();
  vi.stubGlobal("speechSynthesis", { speak: vi.fn(), cancel });
  const speech = makeSpeech();
  let complete = false;
  const pending = speech.speak("Synthetic reply").then(() => { complete = true; });
  expect(complete).toBe(false);
  speech.cancel();
  await pending;
  expect(complete).toBe(true);
  expect(cancel).toHaveBeenCalledTimes(2);
});
