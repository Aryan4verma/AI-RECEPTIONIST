import { useEffect, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useCallEngine } from "../../call/useCallEngine";
import { formatDateTime } from "../../lib/format";
import { Button } from "../../components/ui";
import {
  IconAlert,
  IconArrowRight,
  IconChat,
  IconMicOff,
  IconMic,
  IconPhone,
  IconPhoneOff,
  IconShield,
  IconSpeaker,
} from "../../components/icons";

const SESSION_KEY = "cleardesk.session";

function mmss(sec: number): string {
  return `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
}

/* Letterspaced state eyebrow — every label maps to a real engine state. */
const STATE_LABEL: Record<string, string> = {
  idle: "Ready to call",
  connecting: "Connecting",
  listening: "Listening to you",
  processing: "Thinking",
  speaking: "Speaking to you",
  unavailable: "Voice unavailable",
  error: "Connection problem",
  ended: "Call ended",
};

export default function Call() {
  const { state, start, end, toggleMute, setSpeaker, retryVoice, isSecureContext } = useCallEngine();
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
    <div className="flex h-dvh flex-col bg-canvas text-ink">
      {/* Top bar */}
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex w-full max-w-md items-center justify-between px-5 py-3.5 sm:max-w-3xl sm:px-8">
          <Link to="/" className="flex items-center gap-3" aria-label="Cleardesk home">
            <span className="flex size-9 items-center justify-center rounded-lg bg-pine-800 font-display text-lg font-semibold text-[#f4f1e8]">
              C
            </span>
            <span className="leading-tight">
              <span className="block font-display text-[17px] font-semibold tracking-tight text-ink">Cleardesk</span>
              <span className="block text-[10px] font-medium uppercase tracking-[0.16em] text-ink-3">Voice call</span>
            </span>
          </Link>
          <Link to="/" className="rounded-full px-3 py-1.5 text-xs font-medium text-ink-2 hover:bg-pine-50 hover:text-pine-700">
            ← Back to chat
          </Link>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-5 py-8 sm:max-w-3xl sm:px-8">
        {/* Pre-call */}
        {!live && state.status !== "ended" && (
          <div className="rise flex flex-1 flex-col items-center justify-center gap-6 text-center">
            {/* Static concentric orb preview */}
            <div className="relative flex size-36 items-center justify-center" aria-hidden="true">
              <span className="absolute inset-0 rounded-full border border-pine-200" />
              <span className="absolute inset-4 rounded-full border border-pine-100" />
              <span className="flex size-24 items-center justify-center rounded-full bg-gradient-to-b from-pine-700 to-pine-800 font-display text-3xl font-semibold text-[#f4f1e8] shadow-card">
                C
              </span>
            </div>
            <div className="max-w-md">
              <h1 className="font-display text-3xl leading-tight text-ink sm:text-4xl">
                Call the <span className="font-display-italic text-pine-700">AI receptionist</span>
              </h1>
              <p className="mt-3 text-[14.5px] leading-relaxed text-ink-2">
                A continuous voice conversation in your browser — speak naturally, and the receptionist answers out loud.
                It hears you when you pause, and you can interrupt it anytime.
              </p>
              <p className="mt-2 text-xs leading-relaxed text-ink-2">
                This is a browser voice call over your internet connection — not a phone call to a telephone number.
                Nothing is recorded unless you allow it.
              </p>
            </div>
            {isSecureContext ? (
              <Button size="lg" onClick={start}>
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
            <p className="flex items-center gap-1.5 text-[11px] text-ink-3">
              <IconShield className="size-3.5" /> Audio goes to your own receptionist service — never a third-party call provider.
            </p>
          </div>
        )}

        {/* Post-call */}
        {state.status === "ended" && (
          <div className="rise flex flex-1 flex-col items-center justify-center gap-5 text-center">
            <div className="relative flex size-28 items-center justify-center" aria-hidden="true">
              <span className="absolute inset-0 rounded-full border border-pine-200" />
              <span className="flex size-20 items-center justify-center rounded-full bg-gradient-to-b from-pine-700 to-pine-800 font-display text-2xl font-semibold text-[#f4f1e8]">
                C
              </span>
            </div>
            <p className="micro">Call ended · {mmss(state.durationSec)}</p>
            <h1 className="font-display text-3xl text-ink">Thanks for calling.</h1>
            {state.session && (
              <p className="max-w-sm text-sm leading-relaxed text-ink-2">
                Your conversation is saved — continue it by text, or review anything the receptionist proposed.
              </p>
            )}
            <div className="flex flex-wrap justify-center gap-3">
              {state.session && (
                <Button onClick={continueInChat}>
                  <IconChat className="size-4" />
                  Continue in chat
                </Button>
              )}
              <Button variant="secondary" onClick={start}>
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
            <div className="flex flex-col items-center gap-4 pb-5 pt-1 sm:pt-4">
              <p
                className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-pine-700"
                aria-live="polite"
              >
                <IconSparkleDot />
                {state.muted && state.status === "listening" ? "On mute" : STATE_LABEL[state.status]}
              </p>

              {/* Concentric orb — rings animate only on real listening/speaking */}
              <div className="relative flex size-40 items-center justify-center" role="img" aria-label={`Call state: ${STATE_LABEL[state.status]}`}>
                {(state.status === "listening" || state.status === "speaking") && (
                  <>
                    <span className={`orb-ring absolute inset-0 rounded-full border border-pine-300/70 ${state.status === "speaking" ? "" : "delay-2"}`} />
                    <span className="orb-ring absolute inset-0 rounded-full border border-pine-200/70 delay-3" />
                  </>
                )}
                <div
                  className={`flex size-28 items-center justify-center rounded-full font-display text-3xl font-semibold text-[#f4f1e8] shadow-card ${
                    state.status === "speaking"
                      ? "orb-speaking bg-gradient-to-b from-pine-600 to-pine-800 ring-2 ring-brass-300/60"
                      : "bg-gradient-to-b from-pine-700 to-pine-800"
                  }`}
                >
                  {state.status === "unavailable" || state.status === "error" ? (
                    <IconAlert className="size-8 text-warn-fg" />
                  ) : (
                    <span className={state.status === "connecting" ? "animate-pulse" : ""}>C</span>
                  )}
                </div>
              </div>

              {/* Real waveform — heights driven by live mic level */}
              <div className="flex h-8 items-center gap-1.5" aria-hidden="true">
                {barLevels.map((h, i) => (
                  <span
                    key={i}
                    className="wave-bar w-1 rounded-full bg-pine-600"
                    style={{
                      height: `${(state.status === "listening" ? h : 0.16) * 32}px`,
                      opacity: state.status === "listening" ? 0.5 + h * 0.5 : 0.25,
                    }}
                  />
                ))}
              </div>

              {inCall && (
                <p className="font-display text-3xl tabular leading-none text-ink">
                  {mmss(state.durationSec)}
                </p>
              )}
            </div>

            {/* Unavailable / error — honest, with retry and a real text fallback */}
            {(state.status === "unavailable" || state.status === "error") && (
              <div className="rise rounded-card border border-line bg-surface p-5 text-center shadow-card">
                <p className="text-[13.5px] leading-relaxed text-ink-2">{state.note}</p>
                <div className="mt-4 flex flex-wrap justify-center gap-2.5">
                  <Button variant="secondary" onClick={retryVoice}>
                    Try voice again
                  </Button>
                  {state.session && (
                    <Button onClick={continueInChat}>
                      <IconChat className="size-4" />
                      Continue in chat
                    </Button>
                  )}
                </div>
              </div>
            )}

            {/* Live transcript */}
            <div className="mt-4 flex min-h-0 flex-1 flex-col sm:mt-5">
              <div className="flex h-full max-h-72 flex-col rounded-card border border-line bg-surface shadow-card">
                <p className="border-b border-line px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-3">
                  Live transcript
                </p>
                <div ref={transcriptRef} className="pane-scroll flex-1 space-y-2.5 overflow-y-auto px-4 py-3.5">
                  {state.transcript.map((m) => (
                    <div
                      key={m.id}
                      className={`max-w-[85%] text-[13.5px] leading-relaxed ${
                        m.role === "customer"
                          ? "self-end rounded-2xl rounded-br-sm bg-pine-700 px-3.5 py-2 text-[#f4f1e8]"
                          : m.role === "system"
                            ? "self-center text-center text-[12px] italic text-ink-3"
                            : "self-start rounded-2xl rounded-tl-sm border border-line bg-raised px-3.5 py-2 text-ink"
                      }`}
                    >
                      {m.text}
                    </div>
                  ))}
                  {state.offer && (
                    <div className="self-start rounded-2xl border border-brass-500/40 bg-brass-300/10 px-4 py-3">
                      <p className="micro !text-brass-600">Proposed appointment</p>
                      <p className="mt-1 font-display text-[15px] text-ink">{formatDateTime(state.offer.slot)}</p>
                      <p className="text-xs text-ink-2">
                        {state.offer.durationMinutes} minutes · {state.offer.timezone}
                      </p>
                      <p className="mt-2 text-[12px] leading-relaxed text-ink-2">
                        Saying “yes” doesn’t confirm by voice — bookings are confirmed deliberately. End the call and
                        confirm in chat so your appointment is verified.
                      </p>
                      <button
                        onClick={() => void end()}
                        className="mt-2 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-pine-700 underline-offset-2 hover:underline"
                      >
                        End call &amp; confirm in chat <IconArrowRight className="size-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Prefer to type — mid-call handoff to the same conversation */}
              {state.session && inCall && (
                <button
                  onClick={continueInChat}
                  className="mx-auto mt-3 inline-flex items-center gap-2 rounded-full border border-line-strong bg-surface px-4 py-2 text-[12.5px] font-medium text-ink-2 transition-colors hover:border-pine-400 hover:text-pine-700"
                >
                  <IconChat className="size-4" />
                  Prefer to type? Continue in chat
                  <IconArrowRight className="size-3.5" />
                </button>
              )}
            </div>

            {/* Controls — three circular actions with captions */}
            <div className="flex items-start justify-center gap-8 pb-2 pt-6">
              <ControlButton
                label={state.muted ? "Unmute" : "Mute"}
                pressed={state.muted}
                onClick={toggleMute}
                icon={state.muted ? <IconMicOff className="size-5" /> : <IconMic className="size-5" />}
              />
              <button onClick={() => void end()} aria-label="End call" className="group flex flex-col items-center gap-1.5">
                <span className="flex size-16 items-center justify-center rounded-full bg-pine-700 text-[#f4f1e8] shadow-pop transition-transform group-hover:scale-105 group-active:scale-95">
                  <IconPhoneOff className="size-6" />
                </span>
                <span className="text-[11px] font-medium text-ink-2">End call</span>
              </button>
              <ControlButton
                label={state.speakerOn ? "Speaker" : "Voice off"}
                pressed={!state.speakerOn}
                onClick={() => setSpeaker(!state.speakerOn)}
                icon={
                  <span className="relative flex items-center justify-center">
                    <IconSpeaker className="size-5" />
                    {!state.speakerOn && (
                      <span className="absolute h-0.5 w-6 rotate-45 rounded-full bg-current" aria-hidden="true" />
                    )}
                  </span>
                }
              />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function ControlButton({
  label,
  icon,
  onClick,
  pressed,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  pressed?: boolean;
}) {
  return (
    <button onClick={onClick} aria-label={label} aria-pressed={pressed} className="group flex flex-col items-center gap-1.5">
      <span
        className={`flex size-13 items-center justify-center rounded-full border shadow-card transition-colors ${
          pressed ? "border-pine-300 bg-pine-100 text-pine-700" : "border-line bg-surface text-ink-2 hover:border-pine-300 hover:text-pine-700"
        }`}
      >
        {icon}
      </span>
      <span className="text-[11px] font-medium text-ink-2">{label}</span>
    </button>
  );
}

function IconSparkleDot() {
  return (
    <svg className="size-3 text-brass-500" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2.5 14 9.5l7 2.5-7 2.5-2 7-2-7-7-2.5 7-2.5Z" />
    </svg>
  );
}
