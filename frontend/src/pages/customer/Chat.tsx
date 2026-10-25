import { useCallback, useEffect, useRef, useState } from "react";
import { api, postAudio, ApiError, type Offer, type TurnResult } from "../../lib/api";
import { Badge, Button, ErrorNote, Spinner, Toast } from "../../components/ui";
import { formatDateTime } from "../../lib/format";

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
}: {
  pending: PendingOffer;
  onConfirm: (decision: "accept" | "decline") => void | Promise<void>;
}) {
  const { offer: o } = pending;
  const [left, setLeft] = useState(() => Math.max(0, new Date(o.expiresAt).getTime() - Date.now()));

  useEffect(() => {
    const iv = setInterval(() => setLeft(Math.max(0, new Date(o.expiresAt).getTime() - Date.now())), 1000);
    return () => clearInterval(iv);
  }, [o.expiresAt]);

  const mins = Math.floor(left / 60000);
  const secs = Math.floor((left % 60000) / 1000);
  const expired = left <= 0;

  if (pending.outcome) {
    const ok = pending.outcome === "CONFIRMED";
    const verifying = pending.outcome === "UNRESOLVED";
    return (
      <div className={`rise mx-auto mt-2 w-full max-w-md rounded-card border p-5 shadow-slip ${ok ? "border-pine-200 bg-pine-50" : verifying ? "border-warn-fg/25 bg-warn-bg" : "border-line bg-raised"}`}>
        <div className="flex items-center justify-between">
          <span className="micro">{ok ? "Appointment confirmed" : verifying ? "Verifying with the calendar" : "Not booked"}</span>
          {ok && <Badge tone="success">Confirmed</Badge>}
          {verifying && <Badge tone="warn">Verifying</Badge>}
        </div>
        <p className="mt-2 font-display text-lg leading-snug text-ink">{formatDateTime(o.slot)}</p>
        <p className="mt-1 text-sm text-ink-2">
          {o.durationMinutes} minutes · {o.timezone}
        </p>
        <p className="mt-3 text-[13px] text-ink-2">
          {ok
            ? "You're all set. We've saved this appointment — you'll receive a confirmation."
            : verifying
              ? "We're double-checking the calendar. Your booking is being verified — you'll be contacted once confirmed. Nothing else is needed from you."
              : "This time wasn't booked. You can ask for another slot whenever you're ready."}
        </p>
      </div>
    );
  }

  return (
    <div className="rise mx-auto mt-2 w-full max-w-md rounded-card border border-line bg-raised p-5 shadow-slip">
      <div className="flex items-center justify-between">
        <span className="micro">Proposed appointment</span>
        <span className={`micro tabular ${expired || mins < 3 ? "text-danger-fg" : ""}`}>
          {expired ? "expired" : `holds ${mins}:${String(secs).padStart(2, "0")}`}
        </span>
      </div>
      <p className="mt-2 font-display text-xl leading-snug text-ink">{formatDateTime(o.slot)}</p>
      <p className="mt-1 text-sm text-ink-2">
        {o.durationMinutes} minutes · {o.timezone}
      </p>
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
      push({ role: "system", text: friendlyErr(e) });
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
      push({ role: "system", text: "A colleague has been notified and will follow up with you." });
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

  /* ---- Voice ---- */
  async function toggleRecording() {
    if (recording) {
      recorderRef.current?.stop();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setToast({ tone: "error", msg: "Voice input isn't supported in this browser — please type" });
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
      await api.cancel(s.id, s.token);
    } catch {
      /* ending anyway */
    }
    sessionStorage.removeItem(SESSION_KEY);
    sessionRef.current = null;
    speechSynthesis?.cancel();
    setPhase({ kind: "ended", reason: "done" });
  }

  /* ---------- Render ---------- */
  return (
    <div className="flex h-dvh flex-col bg-canvas">
      {/* Header */}
      <header className="border-b border-line bg-surface/80 backdrop-blur">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between px-4 py-3.5 sm:px-6">
          <div className="flex items-center gap-2.5">
            <Logo />
            <div className="leading-tight">
              <p className="font-display text-[17px] font-semibold text-ink">Cleardesk</p>
              <p className="text-[11px] text-ink-3">AI receptionist</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {phase.kind === "chat" && (
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
          </div>
        </div>
      </header>

      {/* Body */}
      <main ref={scrollRef} className="pane-scroll mx-auto w-full max-w-3xl flex-1 overflow-y-auto px-4 sm:px-6">
        {phase.kind === "idle" && (
          <div className="py-6">
            <Landing onStart={start} error={error} />
          </div>
        )}
        {phase.kind === "starting" && (
          <div className="flex flex-col items-center gap-3 py-24 text-ink-3">
            <Spinner />
            <p className="text-sm">Connecting you to the receptionist…</p>
          </div>
        )}
        {phase.kind === "ended" && (
          <div className="flex flex-col items-center gap-4 py-24 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-pine-50 text-pine-600">
              <svg className="size-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <p className="font-display text-2xl text-ink">Session ended</p>
            <p className="max-w-sm text-sm text-ink-2">Thanks for chatting. Start a new conversation anytime.</p>
            <Button variant="secondary" onClick={() => { setMessages([]); setPendingOffer(null); setPhase({ kind: "idle" }); }}>
              New conversation
            </Button>
          </div>
        )}
        {phase.kind === "chat" && (
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
            {pendingOffer && <OfferSlip pending={pendingOffer} onConfirm={(d) => void confirm(d)} />}
            {error && phase.kind === "chat" && <div className="pt-2"><ErrorNote>{error}</ErrorNote></div>}
          </div>
        )}
      </main>

      {/* Composer */}
      {phase.kind === "chat" && (
        <div className="sticky bottom-0 border-t border-line bg-surface/90 backdrop-blur">
          <div className="mx-auto w-full max-w-3xl px-4 pt-3 pb-4 sm:px-6">
            <div className="flex items-end gap-2">
              <button
                onClick={toggleRecording}
                aria-label={recording ? "Stop recording" : "Record a voice message"}
                aria-pressed={recording}
                title={recording ? "Stop recording" : "Hold a conversation by voice"}
                className={`flex size-11 shrink-0 items-center justify-center rounded-full border transition-colors ${
                  recording ? "rec-pulse border-danger-fg bg-danger-fg text-white" : "border-line-strong bg-surface text-ink hover:border-pine-600 hover:text-pine-600"
                }`}
              >
                {recording ? (
                  <span className="block size-3 rounded-[3px] bg-white" />
                ) : (
                  <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                    <rect x="9" y="3" width="6" height="11" rx="3" />
                    <path d="M5 11a7 7 0 0014 0M12 18v3" strokeLinecap="round" />
                  </svg>
                )}
              </button>
              <textarea
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
                className="max-h-36 min-h-11 flex-1 resize-none rounded-xl border border-line-strong bg-surface px-4 py-3 text-sm text-ink placeholder:text-ink-3/70 focus:border-pine-600 focus:outline-none focus:ring-2 focus:ring-pine-600/15"
              />
              <Button onClick={() => send(input)} disabled={!input.trim() || sending || recording} loading={sending} className="h-11 shrink-0">
                Send
                <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M5 12h14m-6-6 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Button>
            </div>
            <div className="mt-2 flex items-center justify-between">
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
    </div>
  );
}

/* ---------- Sub-components ---------- */
function Logo() {
  return (
    <div className="flex size-9 items-center justify-center rounded-lg bg-pine-600 font-display text-lg font-semibold text-white" aria-hidden="true">
      C
    </div>
  );
}

function Landing({ onStart, error }: { onStart: (c: "text" | "voice") => void; error: string | null }) {
  return (
    <div className="rise flex flex-col items-center py-10 text-center sm:py-16">
      <div className="mb-6 flex size-14 items-center justify-center rounded-2xl bg-pine-600 font-display text-2xl font-semibold text-white shadow-slip" aria-hidden="true">
        C
      </div>
      <h1 className="max-w-xl font-display text-4xl font-semibold leading-[1.15] text-ink sm:text-5xl">
        The front desk that<br />never steps away.
      </h1>
      <p className="mt-4 max-w-md text-[15px] leading-relaxed text-ink-2">
        Ask questions, book an appointment, or change one — just like talking to the receptionist.
      </p>
      {error && <div className="mt-6 w-full max-w-sm"><ErrorNote>{error}</ErrorNote></div>}
      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <Button size="md" onClick={() => onStart("text")} className="px-6">
          Start chatting
        </Button>
        <Button size="md" variant="secondary" onClick={() => onStart("voice")} className="px-6">
          <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <rect x="9" y="3" width="6" height="11" rx="3" />
            <path d="M5 11a7 7 0 0014 0M12 18v3" strokeLinecap="round" />
          </svg>
          Talk instead
        </Button>
      </div>
      <p className="mt-10 max-w-sm text-xs leading-relaxed text-ink-3">
        Handled by an AI receptionist. Conversations aren't recorded unless you allow it. For anything urgent, just ask for a
        person.
      </p>
    </div>
  );
}

function ChatBubble({ message: m }: { message: Message }) {
  if (m.role === "system") {
    return (
      <p className="mx-auto max-w-md text-center text-[13px] text-ink-3" role="note">
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
      <div className={`max-w-[78%] rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed ${mine ? "rounded-br-md bg-pine-600 text-white" : "rounded-bl-md border border-line bg-surface text-ink"}`}>
        {m.transcript && mine && (
          <span className="micro mb-1 block text-white/60" title="Transcribed from your voice">
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
      <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-md border border-line bg-surface px-4 py-3">
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
