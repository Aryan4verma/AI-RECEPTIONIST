import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, postAudio, ApiError, type Offer, type TurnResult } from "../../lib/api";
import { Badge, Button, ErrorNote, Modal, Spinner, Toast } from "../../components/ui";
import { formatDateTime } from "../../lib/format";
import { IconArrowRight, IconArrowUp, IconCalendar, IconChat, IconMic, IconPhone, IconShield, IconSparkle, IconWaveform } from "../../components/icons";

/* ---------- Types ---------- */
interface Message {
  id: number;
  role: "customer" | "assistant" | "system";
  text: string;
  transcript?: boolean;
}

type Phase =
  | { kind: "idle" } // no session yet (landing)
  | { kind: "starting" }
  | { kind: "chat" }
  | { kind: "ended"; reason: string };

interface PendingOffer {
  offer: Offer;
  decided: "accept" | "decline" | null;
  busy: boolean;
  outcome: string | null; // bookingState after confirm
}

const SESSION_KEY = "cleardesk.session";

function loadSession(): { id: string; token: string } | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as { id: string; token: string }) : null;
  } catch {
    return null;
  }
}

/* ---------- Offer slip (the signature element) ---------- */
function OfferSlip({
  pending,
  onConfirm,
  onCancelAsk,
  cancelling,
}: {
  pending: PendingOffer;
  onConfirm: (decision: "accept" | "decline") => void | Promise<void>;
  onCancelAsk: () => void;
  cancelling: boolean;
}) {
  const { offer: o } = pending;
  const [left, setLeft] = useState(() => Math.max(0, new Date(o.expiresAt).getTime() - Date.now()));
  // Hold duration captured at mount — the progress bar shows elapsed share of
  // the hold, which stays honest regardless of the configured TTL.
  const [total] = useState(left);

  useEffect(() => {
    const iv = setInterval(() => setLeft(Math.max(0, new Date(o.expiresAt).getTime() - Date.now())), 1000);
    return () => clearInterval(iv);
  }, [o.expiresAt]);

  const mins = Math.floor(left / 60000);
  const secs = Math.floor((left % 60000) / 1000);
  const expired = left <= 0;
  const held = total > 0 ? Math.min(1, Math.max(0, 1 - left / total)) : 1;

  if (pending.outcome) {
    const ok = pending.outcome === "CONFIRMED";
    const verifying = pending.outcome === "UNRESOLVED";
    const cancelled = pending.outcome === "CANCELLED";
    return (
      <div className={`rise mx-auto mt-3 w-full max-w-md overflow-hidden rounded-card border shadow-slip ${ok ? "border-pine-200 bg-pine-50" : verifying ? "border-warn-fg/25 bg-warn-bg" : "border-line bg-surface"}`}>
        <div className="flex items-center justify-between px-5 pt-4">
          <span className="micro">{ok ? "Appointment confirmed" : verifying ? "Verifying with the calendar" : cancelled ? "Appointment cancelled" : "Not booked"}</span>
          {ok && <Badge tone="success">Confirmed</Badge>}
          {verifying && <Badge tone="warn">Verifying</Badge>}
          {cancelled && <Badge tone="neutral">Cancelled</Badge>}
        </div>
        <div className="px-5 pb-5 pt-2.5">
          <p className="font-display text-lg leading-snug text-ink">{formatDateTime(o.slot)}</p>
          <p className="mt-1 text-sm text-ink-2">
            {o.durationMinutes} minutes · {o.timezone}
          </p>
          <p className="mt-3 text-[13px] leading-relaxed text-ink-2">
            {ok
              ? "You're all set. We've saved this appointment — you'll receive a confirmation."
              : verifying
                ? "We're double-checking the calendar. Your booking is being verified — you'll be contacted once confirmed. Nothing else is needed from you."
                : cancelled
                  ? "This appointment was cancelled at your request. You can book a new one anytime."
                  : "This time wasn't booked. You can ask for another slot whenever you're ready."}
          </p>
          {ok && (
            <button
              onClick={onCancelAsk}
              disabled={cancelling}
              className="mt-3 text-xs font-medium text-ink-2 underline underline-offset-2 hover:text-danger-fg disabled:opacity-50"
            >
              {cancelling ? "Cancelling…" : "Cancel this appointment"}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="rise mx-auto mt-3 w-full max-w-md overflow-hidden rounded-card border border-line bg-surface shadow-slip">
      <div className="flex items-center justify-between border-b border-dashed border-line px-5 py-3">
        <span className="micro flex items-center gap-1.5">
          <IconCalendar className="size-3.5" /> Proposed appointment
        </span>
        <span
          className={`font-display text-[15px] tabular ${expired || mins < 3 ? "text-danger-fg" : "text-pine-700"}`}
          aria-label={expired ? "Offer expired" : `Offer holds for ${mins} minutes ${secs} seconds`}
        >
          {expired ? "expired" : `${mins}:${String(secs).padStart(2, "0")}`}
        </span>
      </div>
      <div className="px-5 pb-5 pt-3">
        <p className="font-display text-xl leading-snug text-ink">{formatDateTime(o.slot)}</p>
        <p className="mt-1 text-sm text-ink-2">
          {o.durationMinutes} minutes · {o.timezone}
        </p>
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-canvas-deep" role="presentation">
          <div
            className={`h-full rounded-full transition-[width] duration-1000 ease-linear ${expired ? "bg-danger-fg/50" : "bg-pine-600"}`}
            style={{ width: `${expired ? 100 : held * 100}%` }}
          />
        </div>
        <div className="mt-4 flex gap-2">
          <Button className="flex-1" disabled={expired || pending.busy} loading={pending.busy && pending.decided === "accept"} onClick={() => onConfirm("accept")}>
            Confirm booking
          </Button>
          <Button variant="secondary" disabled={expired || pending.busy} onClick={() => onConfirm("decline")}>
            Not now
          </Button>
        </div>
        {expired && <p className="mt-2 text-center text-xs text-ink-3">This offer expired — ask for another time.</p>}
      </div>
    </div>
  );
}

/* ---------- Main chat page ---------- */
export default function Chat() {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [messages, setMessages] = useState<Message[]>([]);
  const [restored, setRestored] = useState(false); // session restored w/o history
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [pendingOffer, setPendingOffer] = useState<PendingOffer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ tone: "info" | "error" | "success"; msg: string } | null>(null);
  const [speak, setSpeak] = useState(false);
  const [recording, setRecording] = useState(false);
  const [consent, setConsent] = useState(false);
  const [cancelAskOpen, setCancelAskOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [sessionEnded, setSessionEnded] = useState(false);

  const sessionRef = useRef<{ id: string; token: string } | null>(loadSession());
  const nextId = useRef(1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const push = (m: Omit<Message, "id">) => {
    setMessages((prev) => [...prev, { ...m, id: nextId.current++ }]);
  };
  const speakText = useCallback(
    (text: string) => {
      if (!speak || typeof speechSynthesis === "undefined") return;
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.02;
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    },
    [speak],
  );

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, thinking, pendingOffer]);

  // Restore an existing session (status only — customer history isn't served).
  useEffect(() => {
    const s = sessionRef.current;
    if (!s) return;
    api
      .status(s.id, s.token)
      .then((st) => {
        if (st.status === "ended" || st.status === "expired") {
          sessionStorage.removeItem(SESSION_KEY);
          sessionRef.current = null;
          setRestored(false);
        } else {
          setRestored(true);
          setConsent(st.consentRecording);
          setPhase({ kind: "chat" });
        }
      })
      .catch(() => {
        sessionStorage.removeItem(SESSION_KEY);
        sessionRef.current = null;
      });
  }, []);

  async function start(channel: "text" | "voice") {
    setPhase({ kind: "starting" });
    setError(null);
    try {
      const s = await api.startConversation(channel);
      sessionRef.current = { id: s.conversationId, token: s.accessToken };
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(sessionRef.current));
      setMessages([{ id: nextId.current++, role: "assistant", text: s.greeting }]);
      speakText(s.greeting);
      setPhase({ kind: "chat" });
      inputRef.current?.focus();
    } catch (e) {
      setPhase({ kind: "idle" });
      setError(e instanceof ApiError ? friendly(e) : "Couldn't reach the receptionist. Please try again.");
    }
  }

  async function send(text: string) {
    const s = sessionRef.current;
    if (!s || !text.trim() || sending) return;
    setError(null);
    setInput("");
    push({ role: "customer", text });
    setSending(true);
    setThinking(true);
    try {
      const r = await api.sendMessage(s.id, s.token, text.trim());
      handleTurn(r);
    } catch (e) {
      if (e instanceof ApiError && e.message.includes("has ended")) {
        sessionStorage.removeItem(SESSION_KEY);
        sessionRef.current = null;
        setSessionEnded(true);
      } else {
        push({ role: "system", text: friendlyErr(e) });
      }
    } finally {
      setSending(false);
      setThinking(false);
    }
  }

  function handleTurn(r: TurnResult) {
    push({ role: "assistant", text: r.reply });
    speakText(r.reply);
    if (r.offer) {
      setPendingOffer({ offer: r.offer, decided: null, busy: false, outcome: null });
    }
    if (r.conversationState === "escalated") {
      // Honest handoff copy: the conversation is flagged in the staff console —
      // no push notification is sent, so don't claim one.
      push({ role: "system", text: "Your conversation has been flagged for the team — they'll see it in their inbox and follow up with you." });
    }
  }

  async function confirm(decision: "accept" | "decline") {
    const s = sessionRef.current;
    if (!s || !pendingOffer) return;
    setPendingOffer({ ...pendingOffer, busy: true, decided: decision });
    try {
      const r = await api.confirm(s.id, s.token, pendingOffer.offer.offerToken, decision);
      setPendingOffer({ ...pendingOffer, busy: false, decided: decision, outcome: r.bookingState });
      if (r.bookingState === "CONFIRMED") {
        push({ role: "system", text: "Appointment confirmed — see your slip above." });
        setToast({ tone: "success", msg: "Appointment confirmed" });
      } else if (r.bookingState === "UNRESOLVED") {
        setToast({ tone: "info", msg: "Booking is being verified — we'll confirm shortly" });
      } else if (r.bookingState === "SLOT_TAKEN") {
        setToast({ tone: "error", msg: "That slot was just taken — ask for another time" });
      }
    } catch (e) {
      setPendingOffer({ ...pendingOffer, busy: false, decided: null });
      const err = e instanceof ApiError ? e : null;
      if (err?.code === "OFFER_EXPIRED" || err?.code === "SLOT_TAKEN") {
        setPendingOffer({ ...pendingOffer, outcome: "EXPIRED" });
        setToast({ tone: "error", msg: "That offer is no longer available — ask for another time" });
      } else {
        push({ role: "system", text: friendlyErr(e) });
      }
    }
  }

  /* ---- Voice message (recording sent as a message — distinct from a call) ---- */
  async function toggleRecording() {
    if (recording) {
      recorderRef.current?.stop();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setToast({ tone: "error", msg: "Voice messages aren't supported in this browser — please type" });
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "";
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        const blob = new Blob(chunks, { type: mime || "audio/webm" });
        if (blob.size < 2000) return; // too short to be speech
        await sendAudio(blob);
      };
      recorderRef.current = rec;
      rec.start();
      setRecording(true);
    } catch {
      setToast({ tone: "error", msg: "Microphone unavailable — please type instead" });
    }
  }

  async function sendAudio(blob: Blob) {
    const s = sessionRef.current;
    if (!s) return;
    setThinking(true);
    setError(null);
    try {
      const r = await postAudio(s.id, s.token, blob, "voice.webm");
      push({ role: "customer", text: r.transcript, transcript: true });
      handleTurn(r);
    } catch (e) {
      const code = e instanceof ApiError ? e.code : "";
      if (code === "STT_FAILED" || code === "RESOURCE_LIMIT") {
        setToast({ tone: "error", msg: "Voice is unavailable right now — please type your message" });
      } else if (code === "UNSUPPORTED_MEDIA_TYPE" || code === "AUDIO_TOO_LARGE") {
        setToast({ tone: "error", msg: "That recording couldn't be processed — please type instead" });
      } else {
        push({ role: "system", text: friendlyErr(e) });
      }
    } finally {
      setThinking(false);
      inputRef.current?.focus();
    }
  }

  async function toggleConsent(next: boolean) {
    const s = sessionRef.current;
    if (!s) return;
    try {
      const r = await api.consent(s.id, s.token, next);
      setConsent(r.consentRecording);
      setToast({ tone: next ? "info" : "success", msg: next ? "Recording consent noted" : "Recording remains off" });
    } catch {
      setToast({ tone: "error", msg: "Couldn't save that preference" });
    }
  }

  async function endSession() {
    const s = sessionRef.current;
    if (!s) return;
    try {
      // Ends the conversation ONLY — a confirmed appointment always survives.
      // (api.cancel is reserved for the explicit "Cancel appointment" action.)
      await api.endConversation(s.id, s.token);
    } catch {
      /* ending anyway */
    }
    sessionStorage.removeItem(SESSION_KEY);
    sessionRef.current = null;
    speechSynthesis?.cancel();
    setPhase({ kind: "ended", reason: "done" });
  }

  /** Explicit, deliberate appointment cancellation (never session close). */
  async function cancelAppointment() {
    const s = sessionRef.current;
    if (!s || !pendingOffer) return;
    setCancelling(true);
    try {
      await api.cancel(s.id, s.token);
      setPendingOffer({ ...pendingOffer, outcome: "CANCELLED" });
      push({ role: "system", text: "Your appointment was cancelled. This conversation has ended." });
      setToast({ tone: "info", msg: "Appointment cancelled" });
      sessionStorage.removeItem(SESSION_KEY);
      sessionRef.current = null;
      speechSynthesis?.cancel();
      setSessionEnded(true);
    } catch (e) {
      const err = e instanceof ApiError ? e : null;
      if (err?.code === "CALENDAR_UNAVAILABLE") {
        setToast({ tone: "error", msg: "Cancellation couldn't be verified with the calendar — nothing was changed" });
      } else {
        setToast({ tone: "error", msg: "Couldn't cancel right now — please try again" });
      }
    } finally {
      setCancelling(false);
      setCancelAskOpen(false);
    }
  }

  /* ---------- Render ---------- */
  const inConversation = phase.kind === "chat" || phase.kind === "starting";

  return (
    /* Height is locked to the viewport ONLY inside a conversation (anchored
       transcript). The landing/ended views use natural document flow so long
       content scrolls the page instead of nesting scrollbars. */
    <div className={`bg-canvas ${inConversation ? "flex h-dvh flex-col" : "flex min-h-dvh flex-col"}`}>
      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-line bg-surface/85 backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-5 py-3 sm:px-8">
          <Link to="/" className="flex items-center gap-3 rounded-lg" aria-label="Cleardesk home">
            <Mark />
            <span className="leading-tight">
              <span className="block font-display text-[18px] font-semibold tracking-tight text-ink">Cleardesk</span>
              <span className="block text-[10.5px] font-medium uppercase tracking-[0.14em] text-ink-3">AI receptionist</span>
            </span>
          </Link>
          <div className="flex items-center gap-2.5">
            {phase.kind === "chat" && !sessionEnded && (
              <>
                <label className="hidden items-center gap-1.5 text-xs text-ink-2 sm:flex" title="Read replies aloud">
                  <input type="checkbox" checked={speak} onChange={(e) => setSpeak(e.target.checked)} className="accent-pine-600" />
                  Voice replies
                </label>
                <Button size="sm" variant="ghost" onClick={endSession}>
                  End session
                </Button>
              </>
            )}
            <a
              href="/admin"
              className="hidden items-center gap-1.5 rounded-full border border-line-strong bg-surface px-3.5 py-1.5 text-xs font-semibold text-ink-2 transition-colors hover:border-ink-3 hover:text-ink sm:inline-flex"
            >
              Staff sign-in
            </a>
          </div>
        </div>
      </header>

      {/* Landing — natural page flow */}
      {phase.kind === "idle" && <Landing onStart={() => start("text")} error={error} />}

      {phase.kind === "starting" && (
        <main className="flex flex-1 items-center justify-center">
          <div className="flex flex-col items-center gap-3 text-ink-3">
            <Spinner />
            <p className="text-sm">Connecting you to the receptionist…</p>
          </div>
        </main>
      )}

      {phase.kind === "ended" && (
        <main className="flex flex-1 items-center justify-center px-5">
          <div className="rise flex flex-col items-center gap-4 py-16 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-pine-50 text-pine-700">
              <svg className="size-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <p className="font-display text-2xl text-ink">Session ended</p>
            <p className="max-w-sm text-sm leading-relaxed text-ink-2">Thanks for chatting. Start a new conversation anytime.</p>
            <Button variant="secondary" onClick={() => { setMessages([]); setPendingOffer(null); setPhase({ kind: "idle" }); }}>
              New conversation
            </Button>
          </div>
        </main>
      )}

      {/* Conversation — viewport-locked, transcript anchored to the composer */}
      {phase.kind === "chat" && (
        <main ref={scrollRef} className="pane-scroll mx-auto w-full max-w-3xl flex-1 overflow-y-auto px-4 sm:px-6">
          <div className="flex min-h-full flex-col justify-end py-6">
            {restored && messages.length === 0 && (
              <div className="mx-auto mb-4 max-w-md rounded-lg border border-line bg-info-bg px-4 py-3 text-[13px] text-info-fg">
                Welcome back. Your previous message history isn't shown after a refresh, but the receptionist still has your
                details — just continue typing.
              </div>
            )}
            <div className="space-y-3.5" aria-live="polite">
              {messages.map((m) => (
                <ChatBubble key={m.id} message={m} />
              ))}
              {thinking && <TypingRow />}
            </div>
            {pendingOffer && (
              <OfferSlip
                pending={pendingOffer}
                onConfirm={(d) => void confirm(d)}
                onCancelAsk={() => setCancelAskOpen(true)}
                cancelling={cancelling}
              />
            )}
            {error && <div className="pt-2"><ErrorNote>{error}</ErrorNote></div>}
          </div>
        </main>
      )}

      {/* Composer */}
      {phase.kind === "chat" && sessionEnded && (
        <div className="sticky bottom-0 border-t border-line bg-surface/90 backdrop-blur">
          <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-4 pt-3.5 pb-4 sm:px-6">
            <p className="text-sm text-ink-2">This conversation has ended.</p>
            <Button
              variant="secondary"
              onClick={() => {
                setMessages([]);
                setPendingOffer(null);
                setSessionEnded(false);
                setPhase({ kind: "idle" });
              }}
            >
              New conversation
            </Button>
          </div>
        </div>
      )}
      {phase.kind === "chat" && !sessionEnded && (
        <div className="sticky bottom-0 border-t border-line bg-surface/90 backdrop-blur">
          <div className="mx-auto w-full max-w-3xl px-4 pt-3 pb-4 sm:px-6">
            <div
              className={`flex items-end gap-1.5 rounded-[26px] border bg-raised py-1.5 pl-1.5 pr-1.5 transition-colors ${
                recording ? "border-danger-fg/50" : "border-line-strong focus-within:border-pine-500 focus-within:ring-2 focus-within:ring-pine-600/15"
              }`}
            >
              <button
                onClick={toggleRecording}
                aria-label={recording ? "Stop recording" : "Record a voice message"}
                aria-pressed={recording}
                title={recording ? "Stop recording" : "Record a voice message (not a phone call)"}
                className={`flex size-10 shrink-0 items-center justify-center rounded-full border transition-colors ${
                  recording ? "rec-pulse border-danger-fg bg-danger-fg text-white" : "border-transparent text-ink-2 hover:bg-pine-50 hover:text-pine-700"
                }`}
              >
                {recording ? (
                  <span className="block size-3 rounded-[3px] bg-white" />
                ) : (
                  <IconMic className="size-5" />
                )}
              </button>
              <label className="sr-only" htmlFor="composer-input">
                Type your message
              </label>
              <textarea
                id="composer-input"
                ref={inputRef}
                rows={1}
                value={input}
                placeholder={recording ? "Listening…" : "Type your message…"}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send(input);
                  }
                }}
                className="max-h-36 min-h-10 flex-1 resize-none self-center bg-transparent px-2 py-2 text-sm text-ink placeholder:text-ink-3/70 focus:outline-none"
              />
              <button
                onClick={() => send(input)}
                disabled={!input.trim() || sending || recording}
                aria-label="Send message"
                className="flex size-10 shrink-0 items-center justify-center rounded-full bg-pine-700 text-[#f4f1e8] shadow-card transition-all hover:bg-pine-800 disabled:opacity-30"
              >
                {sending ? <Spinner className="size-4" /> : <IconArrowUp className="size-4.5" />}
              </button>
            </div>
            <div className="mt-2 flex items-center justify-between px-1.5">
              <p className="text-[11px] text-ink-3">
                {recording ? "Recording — tap the square to send" : "Enter to send · Shift+Enter for a new line"}
              </p>
              <label className="flex items-center gap-1.5 text-[11px] text-ink-2" title="Recording is off by default">
                <input type="checkbox" checked={consent} onChange={(e) => toggleConsent(e.target.checked)} className="accent-pine-600" />
                Allow call recording
              </label>
            </div>
          </div>
        </div>
      )}
      {toast && <Toast tone={toast.tone} onClose={() => setToast(null)}>{toast.msg}</Toast>}

      {/* Explicit cancellation confirmation — a confirmed appointment is only
          ever cancelled through this deliberate two-step action. */}
      <Modal
        open={cancelAskOpen}
        onClose={() => !cancelling && setCancelAskOpen(false)}
        title="Cancel this appointment?"
        footer={
          <>
            <Button variant="secondary" disabled={cancelling} onClick={() => setCancelAskOpen(false)}>
              Keep it
            </Button>
            <Button variant="danger" disabled={cancelling} loading={cancelling} onClick={() => void cancelAppointment()}>
              Cancel appointment
            </Button>
          </>
        }
      >
        This permanently cancels your appointment
        {pendingOffer ? ` on ${formatDateTime(pendingOffer.offer.slot)} (${pendingOffer.offer.timezone})` : ""} and
        ends this conversation. Ending a chat never cancels an appointment — only this action does.
      </Modal>
    </div>
  );
}

/* ---------- Sub-components ---------- */
function Mark({ className = "size-9" }: { className?: string }) {
  return (
    <div className={`flex items-center justify-center rounded-lg bg-pine-800 font-display text-lg font-semibold text-[#f4f1e8] ${className}`} aria-hidden="true">
      C
    </div>
  );
}

function Landing({ onStart, error }: { onStart: () => void; error: string | null }) {
  return (
    <>
      <main className="paper-texture">
        {/* Hero — asymmetric editorial split: copy left, photographic vignette right */}
        <div className="mx-auto grid w-full max-w-6xl items-center gap-12 px-5 pb-10 pt-10 sm:px-8 lg:grid-cols-[1.02fr_0.98fr] lg:gap-16 lg:pb-12 lg:pt-12">
          <div>
            <p className="micro flex items-center gap-2 text-pine-700">
              <IconSparkle className="size-3.5" />
              The always-on front desk
            </p>
            <h1 className="mt-5 font-display text-[2.55rem] font-medium leading-[1.07] tracking-[-0.01em] text-ink sm:text-[3.4rem]">
              Every call answered.
              <br />
              <span className="font-display-italic font-normal text-pine-700">Every visitor greeted.</span>
            </h1>
            <p className="mt-5 max-w-md text-[15.5px] leading-relaxed text-ink-2">
              Cleardesk is your AI receptionist — it answers from your own business knowledge, books and changes
              appointments in your calendar, and hands over to a person the moment it should.
            </p>

            {error && <div className="mt-6 w-full max-w-sm"><ErrorNote>{error}</ErrorNote></div>}

            <div className="mt-8 flex flex-col items-start gap-4">
              <Button size="lg" onClick={onStart}>
                Start chatting
                <span className="flex size-6 items-center justify-center rounded-full bg-white/15" aria-hidden="true">
                  <IconArrowRight className="size-4" />
                </span>
              </Button>
              <a
                href="/call"
                className="group inline-flex items-center gap-2 text-[13.5px] font-medium text-ink underline-offset-4 hover:text-pine-700 hover:underline"
              >
                <IconPhone className="size-4 text-pine-600" />
                Prefer to talk? Call the AI receptionist in your browser
                <IconArrowRight className="size-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
              </a>
            </div>
          </div>

          {/* Photographic vignette — a composed product preview, clearly labeled */}
          <div className="relative hidden lg:block" aria-hidden="true">
            <div className="relative h-[430px] overflow-hidden rounded-[18px] bg-gradient-to-br from-pine-200 via-canvas-deep to-brass-300/50 shadow-pop">
              <img
                src="https://images.unsplash.com/photo-1554118811-1e0d58224f24?auto=format&fit=crop&w=1200&q=80"
                alt=""
                loading="lazy"
                decoding="async"
                className="h-full w-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-pine-950/35 via-transparent to-transparent" />
            </div>

            {/* Floating cards — both anchored to the left edge, stacked */}
            <div className="absolute -left-8 top-8 w-64 -rotate-1 rounded-card border border-line bg-surface p-4 shadow-slip">
              <div className="flex items-start gap-2.5">
                <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-pine-50 font-display text-[13px] font-semibold text-pine-700">C</div>
                <div className="rounded-xl rounded-tl-sm border border-line bg-raised px-3.5 py-2 text-[13px] leading-relaxed text-ink">
                  Good morning — how can I help you today?
                </div>
              </div>
              <div className="mt-2.5 flex justify-end pr-1">
                <div className="rounded-xl rounded-tr-sm bg-pine-700 px-3.5 py-2 text-[13px] leading-relaxed text-[#f4f1e8]">
                  I'd like to book a consultation this week
                </div>
              </div>
              <p className="micro mt-2.5 pl-1 !text-[9.5px]">Preview · example conversation</p>
            </div>

            <div className="absolute -left-5 bottom-24 w-64 rotate-1 rounded-card border border-line bg-surface p-4 shadow-slip">
              <p className="micro flex items-center gap-1.5 text-pine-700">
                <IconCalendar className="size-3.5" /> Proposed appointment
              </p>
              <p className="mt-2 font-display text-[15px] leading-snug text-ink">Friday, 14 November · 10:00</p>
              <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-pine-100">
                <div className="h-full w-1/4 rounded-full bg-pine-600" />
              </div>
              <p className="mt-1.5 text-[10.5px] font-medium tabular text-ink-3">holds 14:32</p>
            </div>

            {/* Annotation with arrow toward the booking card */}
            <p className="absolute -bottom-10 right-6 font-display-italic text-[13.5px] text-ink-2">
              replies in seconds — even at 2am
            </p>
            <svg className="absolute -bottom-7 right-24 h-8 w-16 rotate-[160deg] text-ink-3" viewBox="0 0 56 32" fill="none" aria-hidden="true">
              <path d="M2 4c14 20 30 24 50 16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="0.5 4" />
              <path d="M46 16.5 52 20l-4.5 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </div>

        {/* Feature cards */}
        <div className="mx-auto grid w-full max-w-6xl gap-4 px-5 pb-8 sm:grid-cols-3 sm:px-8">
          {[
            {
              icon: <IconChat className="size-4.5" />,
              title: "Grounded answers",
              body: "Replies come from your business knowledge — hours, services, FAQs — never invented facts.",
            },
            {
              icon: <IconCalendar className="size-4.5" />,
              title: "Real bookings",
              body: "Appointments are proposed, confirmed by you, and written to the calendar with a verifiable record.",
            },
            {
              icon: <IconShield className="size-4.5" />,
              title: "Private by default",
              body: "Conversations aren't recorded unless you allow it, and a person is always one request away.",
            },
          ].map((f) => (
            <div
              key={f.title}
              className="group rounded-card border border-line bg-surface p-5 shadow-card transition-shadow hover:shadow-slip"
            >
              <div className="flex items-start justify-between">
                <div className="flex size-10 items-center justify-center rounded-full bg-pine-100 text-pine-700">{f.icon}</div>
                <span className="flex size-7 items-center justify-center rounded-full border border-line-strong text-ink-3 opacity-0 transition-opacity group-hover:opacity-100">
                  <IconArrowRight className="size-3.5" />
                </span>
              </div>
              <h3 className="mt-4 font-display text-[16.5px] text-ink">{f.title}</h3>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-2">{f.body}</p>
            </div>
          ))}
        </div>
      </main>

      <footer className="mt-auto border-t border-line bg-surface">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-5 sm:px-8">
          <p className="max-w-2xl text-xs leading-relaxed text-ink-2">
            Handled by an AI receptionist. Conversations aren't recorded unless you allow it — for anything urgent, just
            ask for a person. Previews on this page are examples; your receptionist answers with your business's real,
            saved knowledge.
          </p>
          <div className="flex items-center gap-4">
            <IconWaveform className="size-6 text-line-strong" />
            <a href="/admin" className="text-xs font-semibold text-ink-2 hover:text-pine-700">
              Staff sign-in
            </a>
          </div>
        </div>
      </footer>
    </>
  );
}

function ChatBubble({ message: m }: { message: Message }) {
  if (m.role === "system") {
    return (
      <p className="mx-auto max-w-md text-center text-[13px] leading-relaxed text-ink-3" role="note">
        {m.text}
      </p>
    );
  }
  const mine = m.role === "customer";
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      {!mine && (
        <div
          className="mr-2.5 mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-pine-50 font-display text-[13px] font-semibold text-pine-700"
          aria-hidden="true"
        >
          C
        </div>
      )}
      <div className={`max-w-[78%] rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed ${mine ? "rounded-br-md bg-pine-700 text-[#f4f1e8]" : "rounded-bl-md border border-line bg-surface text-ink shadow-card"}`}>
        {m.transcript && mine && (
          <span className="micro mb-1 block !text-[#f4f1e8]/60" title="Transcribed from your voice">
            voice
          </span>
        )}
        {m.text}
      </div>
    </div>
  );
}

function TypingRow() {
  return (
    <div className="flex justify-start" aria-label="Receptionist is preparing a reply">
      <div className="mr-2.5 mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-pine-50 font-display text-[13px] font-semibold text-pine-700" aria-hidden="true">
        C
      </div>
      <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-md border border-line bg-surface px-4 py-3 shadow-card">
        <span className="typing-dot size-1.5 rounded-full bg-ink-3" />
        <span className="typing-dot size-1.5 rounded-full bg-ink-3" />
        <span className="typing-dot size-1.5 rounded-full bg-ink-3" />
      </div>
    </div>
  );
}

function friendly(e: ApiError): string {
  if (e.code === "RATE_LIMITED") return "You're going a little fast — please wait a moment and try again.";
  if (e.code === "RESOURCE_LIMIT") return "The receptionist is busy right now. Please try again in a minute.";
  return e.message;
}
function friendlyErr(e: unknown): string {
  if (e instanceof ApiError) return friendly(e);
  return "Something went wrong — please try again.";
}
