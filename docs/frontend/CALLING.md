# Browser voice calling — architecture, deployment requirements, telephony plan

Status: implemented (local verification only — see the honest limits at the end).

## Current reliability checkpoint — 2026-10-27

Owner-assisted Chrome microphone tests reached real tiny-int8 transcription:
seven uploads had different audio hashes, with 4.753s cold and 1.251–1.724s
warm STT. The owner reported slow replies and a repeated date question; one
visible transcript misheard “flat” as “flight”. Full acoustic accuracy/echo/
barge-in are not declared PASS. The isolated test backend kept records only
in memory and used the mock calendar; no microphone audio was saved.

Mute now discards partial capture; silent buffers recycle every 10s; late
connections are closed after termination. Continue in chat preserves its
active backend session through React unmount. These failures were reproduced
in fixtures before repair. All 26 frontend tests pass. Backend natural-time
parsing fixes the reproduced invented-year loop; exact greeting/site-visit
requests and clear preferences avoid unnecessary inference. qwen remains
1.7b; idle residency is limited to 60s per request. Cold loading can still
take 13s and recognition can still mishear words. Admission and sequential
STT/LLM safeguards remain unchanged. See HANDOFF for measured before/after data.

### Owner manual recheck

1. Use `npm run build && npm start` in the root and a built frontend:
   `cd frontend`, `npm run build`, then
   `npm run preview -- --port 5174 --host 127.0.0.1`.
   Keep `CALENDAR_MODE=mock`. Built preview uses less RAM than the dev server.
2. Leave at least 1.5 GB free before cold STT verification. Close unused apps
   yourself or wait for Ollama's 60s idle unload; never lower the RAM gates.
   `node scripts/speech-live-test.mjs` checks its gate before model loading.
3. Open `http://localhost:5174/call`, allow the microphone, and wait for
   Listening after every reply: “Hello.” → “I want to buy a 3BHK flat.” →
   “My budget is 80 lakh.” → “Can I book a site visit?” Check every transcript;
   do not accept an incorrect word as verified speech.
4. Supply synthetic identity/contact only when asked. For date/time use an
   unambiguous future date, e.g. “28 October at 3 pm” on 27 October 2026.
   Check the offered year and **configured business timezone**; UTC is the
   existing fallback when settings are absent. Stop at the offer during a
   voice-only check; confirmation remains a separate deliberate action.
5. Check silence/noise, mute/unmute, audible TTS and a deliberate interruption.
   Use Prefer to type → Continue in chat and verify the same session accepts
   text. End the session afterwards. Failure/empty-STT/outage/retry paths pass
   fixtures; their acoustic behavior still needs observation.

## What the Call feature is

`/call` is a continuous browser voice conversation with the AI receptionist:

```
mic → silence detection (end of turn) → POST /api/v1/conversations/{id}/audio
    → existing STT + conversation turn → reply spoken via speechSynthesis
    → listen again — until the customer ends the call
```

- **No new infrastructure.** It reuses the existing speech sidecar, conversation
  service and inference stack over the same API and conversation token.
- **Feedback guard:** capture is inactive/paused while the assistant speaks.
  Acoustic echo after playback still requires live-device verification. Barge-in watches a
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

2026-10-26 repair: `recorder.ts` resets bytes and the stop promise on every new
utterance, waits for final data before completing, and disposes on termination.
`recorder.test.ts` drives the production adapter with browser-event fixtures:
two VAD turns upload different bytes and display transcripts derived from those
bytes, once each. Both tests fail against the original adapter. Separated noise
blips and muted input are ignored; continuous speech is capped at 25 seconds.
Empty STT (`NO_SPEECH`) prompts retry without adding an invented transcript.
Transcripts remain visible in the call UI; no diagnostic transcript/audio logs
were added. Real STT script: BLOCKED at 1.19 GB free / 1.5 GB required; microphone,
acoustic feedback and barge-in have not been verified with live audio.

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

Not verified yet: microphone behaviour on iOS/Android, comprehensive acoustic
echo/barge-in quality, and a complete human four-line dialogue after the latest
backend date/performance fixes. Windows Chrome microphone/STT round trips were
observed as described in the current checkpoint above.

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
