# Browser voice calling — architecture, deployment requirements, telephony plan

Status: implemented (local verification only — see the honest limits at the end).

## What the Call feature is

`/call` is a continuous browser voice conversation with the AI receptionist:

```
mic → silence detection (end of turn) → POST /api/v1/conversations/{id}/audio
    → existing STT + conversation turn → reply spoken via speechSynthesis
    → listen again — until the customer ends the call
```

- **No new infrastructure.** It reuses the existing speech sidecar, conversation
  service and inference stack over the same API and conversation token.
- **Feedback guard:** the recorder is paused while the assistant speaks, so its
  own TTS can never be transcribed as a customer turn. Barge-in watches a
  separate echo-cancelled analyser and cancels TTS on loud sustained input.
- **Honest turn-taking:** end of turn = ~1.2 s of silence after real speech;
  a 25 s ceiling forces an end-of-turn on long monologues.
- **Unavailability is a first-class state.** If the speech sidecar is RAM-gated
  (`STT_FAILED` / `RESOURCE_LIMIT`), the call shows *Voice unavailable* with an
  honest explanation (the speech service pauses itself to protect the machine
  when memory is tight) and two real actions: **Try voice again** (a manual
  retry — the gate is often transient as memory frees up; it never loops on its
  own) and **Continue in chat** — the same conversation token carries over, so
  nothing the customer said is lost.
- **Speaker toggle is a real control, not decoration.** Turning it off switches
  the call to silent mode: replies appear in the live transcript only, TTS is
  never invoked, and the recorder is never paused (there is no speaker audio to
  guard against). Useful when the customer must stay quiet.
- **Prefer to type?** appears mid-call under the transcript and hands the SAME
  conversation to the chat screen at any moment — not only after a failure.
- Bookings proposed mid-call appear as a card; confirmation stays a deliberate
  action in chat (voice alone never confirms an appointment).
- The engine lifecycle (repeatable turns, barge-in, feedback guard, mid-turn
  end invalidation, STT degradation with retry, silent mode) is unit-tested in
  `frontend/src/call/engine.test.ts`.

## Running it from a phone (or any other device)

Browsers only grant microphone access in a **secure context**:

| Deployment | Microphone | Notes |
|---|---|---|
| `http://localhost:5173` (dev machine) | ✅ works | localhost is exempt — this is the verified path |
| `http://<lan-ip>:5173` from a phone | ❌ blocked | the call screen shows an explicit HTTPS gate |
| `https://<your-domain>` | ✅ works | required for real phone use |

To use a phone today you need:

1. **HTTPS** for the frontend — e.g. `vite --host` behind a TLS-terminating
   reverse proxy (Caddy does certificates automatically), or a tunnel that
   provides valid HTTPS. Self-signed certificates will not pass.
2. **Network reachability** to the backend — serve the built frontend and the
   Fastify API behind the same origin (or set `VITE_API_BASE`), so the phone
   reaches `/api/v1/…` over HTTPS too. CORS must be configured for that origin.
3. **No public exposure of privileged services.** Only the public API surface
   (`/api/v1/conversations*`) is needed for calls. Ollama and the STT sidecar
   stay loopback-only behind the backend; Supabase secrets never reach the
   browser (only the URL + publishable/anon key, same as chat).
4. **Privacy:** calls are not recorded; audio is processed in memory by the
   backend exactly like chat voice messages (consent-gated persistence).

Not verified yet (needs an HTTPS deployment or a physical device): microphone
behaviour on iOS/Android browsers, and real STT round trips on this 8 GB
development machine (see limits below).

## Telephony (calling a real phone number) — plan only, NOT implemented

A browser call is **not** a PSTN call and must never be presented as one.
Adding real telephone answering would be a separate integration:

1. **Provider options** (pick one): Twilio Programmable Voice, Vonage Voice,
   or a self-hosted SIP trunk (Asterisk/FreeSWITCH) for existing numbers.
2. **Architecture:** a telephony webhook bridge — inbound call → provider
   streams audio (usually μ-law 8 kHz) → transcode → existing STT/turn stack
   → TTS audio streamed back on the same leg. The conversation/booking
   services stay unchanged; only the transport adapter is new.
3. **Owner approvals required before any of it:** purchasing/keeping a phone
   number and plan (recurring cost), provider account + API credentials in the
   approved secret store, call-recording policy for telephony (stricter law
   applies in many jurisdictions), and an explicit go decision per the
   standing rule that paid external services are separately authorized.
4. Nothing above has been purchased, configured or enabled.
