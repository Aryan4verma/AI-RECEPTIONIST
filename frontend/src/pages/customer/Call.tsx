import { useEffect, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useCallEngine } from "../../call/useCallEngine";
import { formatDateTime } from "../../lib/format";
import { Button } from "../../components/ui";
import { IconAlert, IconArrowRight, IconChat, IconMicOff, IconMic, IconPhone, IconPhoneOff, IconShield, IconSparkle } from "../../components/icons";

const SESSION_KEY = "cleardesk.session";

function mmss(sec: number): string {
  return `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
}

const STATE_LABEL: Record<string, string> = {
  idle: "Ready",
  connecting: "Connecting…",
  listening: "Listening",
  processing: "Thinking",
  speaking: "Speaking",
  unavailable: "Voice unavailable",
  error: "Connection problem",
  ended: "Call ended",
};

export default function Call() {
  const { state, start, end, toggleMute, isSecureContext } = useCallEngine();
  const navigate = useNavigate();
  const transcriptRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight, behavior: "smooth" });
  }, [state.transcript.length]);

  /** Keep the call's conversation for text chat: same session token. */
  function continueInChat() {
    const s = state.session;
    if (s) sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
    navigate("/");
  }

  const inCall = ["connecting", "listening", "processing", "speaking"].includes(state.status);
  const live = inCall || state.status === "unavailable" || state.status === "error";
  const bars = 7;
  const barLevels = Array.from({ length: bars }, (_, i) => {
    const wave = Math.sin((Date.now() / 140 + i * 0.9) % (Math.PI * 2)) * 0.5 + 0.5;
    return state.status === "listening" ? 0.25 + state.level * (0.45 + 0.55 * wave) : 0.16;
  });

  return (
    <div className="flex min-h-dvh flex-col bg-pine-950 text-[#f4f1e8]">
      {/* Top bar */}
      <header className="border-b border-white/10">
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between px-5 py-3.5 sm:px-8">
          <Link to="/" className="flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-lg bg-white/10 font-display text-lg font-semibold">C</span>
            <span className="leading-tight">
              <span className="block font-display text-[17px] font-semibold tracking-tight">Cleardesk</span>
              <span className="block text-[10px] font-medium uppercase tracking-[0.16em] text-white/50">Voice call</span>
            </span>
          </Link>
          <Link to="/" className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-white/70 hover:text-white">
            ← Back to chat
          </Link>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-5 py-8 sm:px-8">
        {/* Pre-call */}
        {!live && state.status !== "ended" && (
          <div className="rise flex flex-1 flex-col items-center justify-center gap-6 text-center">
            <div className="flex size-20 items-center justify-center rounded-full border border-white/15 bg-white/5">
              <IconPhone className="size-8 text-[#f4f1e8]/90" />
            </div>
            <div className="max-w-md">
              <h1 className="font-display text-3xl leading-tight sm:text-4xl">
                Call the <span className="font-display-italic">AI receptionist</span>
              </h1>
              <p className="mt-3 text-[14.5px] leading-relaxed text-white/70">
                A continuous voice conversation in your browser — speak naturally, and the receptionist answers out loud.
                It hears you when you pause, and you can interrupt it anytime.
              </p>
              <p className="mt-2 text-xs leading-relaxed text-white/45">
                This is a browser voice call over your internet connection — not a phone call to a telephone number.
                Nothing is recorded unless you allow it.
              </p>
            </div>
            {isSecureContext ? (
              <Button size="lg" onClick={start} className="!bg-[#f4f1e8] !text-pine-900 hover:!bg-white">
                <IconPhone className="size-4.5" />
                Start call
              </Button>
            ) : (
              <div className="max-w-sm rounded-card border border-warn-fg/30 bg-warn-bg px-4 py-3 text-[13px] leading-relaxed text-warn-fg">
                <strong>Microphone unavailable.</strong> Browsers only grant microphone access on HTTPS (localhost is
                exempt). Open this page over HTTPS to call, or{" "}
                <Link to="/" className="font-semibold underline underline-offset-2">
                  chat by text
                </Link>
                .
              </div>
            )}
            <p className="flex items-center gap-1.5 text-[11px] text-white/40">
              <IconShield className="size-3.5" /> Audio goes to your own receptionist service — never a third-party call provider.
            </p>
          </div>
        )}

        {/* Post-call */}
        {state.status === "ended" && (
          <div className="rise flex flex-1 flex-col items-center justify-center gap-5 text-center">
            <p className="micro !text-white/50">Call ended · {mmss(state.durationSec)}</p>
            <h1 className="font-display text-3xl">Thanks for calling.</h1>
            {state.session && (
              <p className="max-w-sm text-sm leading-relaxed text-white/65">
                Your conversation is saved — continue it by text, or review anything the receptionist proposed.
              </p>
            )}
            <div className="flex flex-wrap justify-center gap-3">
              {state.session && (
                <Button onClick={continueInChat} className="!bg-[#f4f1e8] !text-pine-900 hover:!bg-white">
                  <IconChat className="size-4" />
                  Continue in chat
                </Button>
              )}
              <Button variant="secondary" onClick={start} className="!border-white/25 !bg-transparent !text-[#f4f1e8] hover:!bg-white/10">
                <IconPhone className="size-4" />
                Call again
              </Button>
            </div>
          </div>
        )}

        {/* In-call */}
        {live && (
          <div className="flex flex-1 flex-col">
            {/* Stage */}
            <div className="flex flex-col items-center gap-5 pb-6 pt-2 sm:pt-6">
              <div className="relative flex size-40 items-center justify-center sm:size-44" role="img" aria-label={`Call state: ${STATE_LABEL[state.status]}`}>
                {(state.status === "listening" || state.status === "speaking") && (
                  <>
                    <span className={`orb-ring absolute inset-0 rounded-full border border-white/25 ${state.status === "speaking" ? "" : "delay-2"}`} />
                    <span className={`orb-ring absolute inset-0 rounded-full border border-white/25 delay-3`} />
                  </>
                )}
                <div
                  className={`flex size-28 items-center justify-center rounded-full border sm:size-32 ${
                    state.status === "speaking"
                      ? "orb-speaking border-brass-300/60 bg-gradient-to-b from-pine-700 to-pine-800"
                      : state.status === "listening"
                        ? "border-white/20 bg-gradient-to-b from-pine-700 to-pine-800"
                        : "border-white/15 bg-gradient-to-b from-pine-800 to-pine-900"
                  }`}
                >
                  {state.status === "speaking" ? (
                    <IconSparkle className="size-9 text-brass-300" />
                  ) : state.status === "unavailable" || state.status === "error" ? (
                    <IconAlert className="size-8 text-warn-fg" />
                  ) : (
                    <IconPhone className={`size-8 text-[#f4f1e8]/85 ${state.status === "connecting" ? "animate-pulse" : ""}`} />
                  )}
                </div>
              </div>

              {/* Real waveform — heights driven by live mic level */}
              <div className="flex h-8 items-center gap-1.5" aria-hidden="true">
                {barLevels.map((h, i) => (
                  <span
                    key={i}
                    className="wave-bar w-1 rounded-full bg-[#f4f1e8]/70"
                    style={{ height: `${(state.status === "listening" ? h : 0.16) * 32}px`, opacity: state.status === "listening" ? 0.55 + h * 0.45 : 0.3 }}
                  />
                ))}
              </div>

              <div className="flex items-center gap-3">
                <span
                  className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-1 text-[12.5px] font-semibold ${
                    state.status === "unavailable" || state.status === "error"
                      ? "border-warn-fg/40 bg-warn-bg text-warn-fg"
                      : "border-white/15 bg-white/5 text-[#f4f1e8]"
                  }`}
                  aria-live="polite"
                >
                  <span className={`size-2 rounded-full ${state.status === "listening" ? "bg-success-fg" : state.status === "speaking" ? "bg-brass-300" : state.status === "connecting" || state.status === "processing" ? "bg-white/60 animate-pulse" : "bg-warn-fg"}`} />
                  {state.muted && state.status === "listening" ? "On mute" : STATE_LABEL[state.status]}
                </span>
                {inCall && <span className="font-display text-lg tabular text-white/80">{mmss(state.durationSec)}</span>}
              </div>

              {state.status === "unavailable" && (
                <div className="max-w-md rounded-card border border-warn-fg/30 bg-warn-bg px-4 py-3 text-center text-[13px] leading-relaxed text-warn-fg">
                  {state.note}{" "}
                  <button onClick={continueInChat} className="font-semibold underline underline-offset-2">
                    Continue in chat →
                  </button>
                </div>
              )}
              {state.status === "error" && (
                <div className="max-w-md rounded-card border border-danger-fg/30 bg-danger-bg px-4 py-3 text-center text-[13px] leading-relaxed text-danger-fg">
                  {state.note}
                </div>
              )}
            </div>

            {/* Live transcript */}
            <div className="min-h-0 flex-1">
              <div className="flex h-full max-h-64 flex-col rounded-card border border-white/10 bg-white/[0.04]">
                <p className="border-b border-white/10 px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/45">
                  Live transcript
                </p>
                <div ref={transcriptRef} className="pane-scroll flex-1 space-y-2.5 overflow-y-auto px-4 py-3.5">
                  {state.transcript.map((m) => (
                    <div key={m.id} className={`max-w-[85%] text-[13.5px] leading-relaxed ${m.role === "customer" ? "self-end rounded-xl rounded-br-sm bg-[#f4f1e8] px-3.5 py-2 text-pine-950" : m.role === "system" ? "self-center text-center text-[12px] italic text-white/50" : "self-start rounded-xl rounded-tl-sm border border-white/10 bg-white/[0.06] px-3.5 py-2 text-[#f4f1e8]"}`}>
                      {m.text}
                    </div>
                  ))}
                  {state.offer && (
                    <div className="self-start rounded-xl border border-brass-300/40 bg-white/[0.06] px-4 py-3 text-[#f4f1e8]">
                      <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-brass-300">Proposed appointment</p>
                      <p className="mt-1 font-display text-[15px]">{formatDateTime(state.offer.slot)}</p>
                      <p className="text-xs text-white/60">{state.offer.durationMinutes} minutes · {state.offer.timezone}</p>
                      <p className="mt-2 text-[12px] leading-relaxed text-white/65">
                        Saying “yes” doesn’t confirm by voice — bookings are confirmed deliberately.
                        End the call and confirm in chat so your appointment is verified.
                      </p>
                      <button onClick={() => void end()} className="mt-2 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-brass-300 underline-offset-2 hover:underline">
                        End call & confirm in chat <IconArrowRight className="size-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Controls */}
            <div className="flex items-center justify-center gap-4 pb-2 pt-6">
              <button
                onClick={toggleMute}
                aria-label={state.muted ? "Unmute microphone" : "Mute microphone"}
                aria-pressed={state.muted}
                className={`flex size-13 items-center justify-center rounded-full border transition-colors ${
                  state.muted ? "border-white/30 bg-white/15 text-white" : "border-white/15 bg-white/5 text-[#f4f1e8] hover:bg-white/10"
                }`}
              >
                {state.muted ? <IconMicOff className="size-5" /> : <IconMic className="size-5" />}
              </button>
              <button
                onClick={() => void end()}
                aria-label="End call"
                className="flex size-16 items-center justify-center rounded-full bg-danger-fg text-white shadow-pop transition-transform hover:scale-105 active:scale-95"
              >
                <IconPhoneOff className="size-6" />
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
