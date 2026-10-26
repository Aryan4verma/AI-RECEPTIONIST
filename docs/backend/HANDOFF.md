# Stage 10 — Frontend Handoff

Status: backend feature-complete for the frontend phase; **not** declared production-ready (see Limitations).

## Current continuation — 2026-10-26

Voice repair commit `00479a0`: recorder state resets between turns (regression proves distinct uploaded bytes/transcripts), bounded contextual property enquiries, source checks for preferences and booking identities, audio handoff status, empty-speech retry, noise/mute limits and TTS cancellation. Verification: frontend 16/16, both builds/typechecks, real local qwen3:1.7b synthetic dialogue PASS. Live STT BLOCKED at 1.19 GB free versus 1.5 GB script gate; actual microphone/echo/barge-in not verified.

Google migration `20261025000007_google_integration.sql` (reviewed source `49d8425`) APPLIED via owner-authorized CLI workflow on `ogxdszjypswutekqgorb`, 2026-10-26. Only 0007 was pending/applied; Vault/seed/role updates skipped. Remote history 0001–0007 matches; no migrations remain pending. Ten columns, singleton constraints and UUID auth FK verified; RLS enabled, zero policies; backend service_role SELECT/INSERT/UPDATE, no anon/authenticated/PUBLIC access. Existing 11 tables' row/content fingerprints and schema/security fingerprint unchanged; integration table empty. Migration verifier corrected for the seventh file/twelfth table. Full fixture-suite result is recorded in PROGRESS §1.

OAuth preparation: normal push synced main through `99439bb`; all four Google variables are missing from backend `.env`. Owner chose to populate them personally; private credentials were not accessed. Backend has one loopback listener, health/readiness 200 and protected status 401 without auth. A synthetic rejected callback revealed code/state in request logs; query-string scrubbing is now verified in the live backend and by 7 focused tests (typecheck PASS). No real connection or Google API calls performed.

Next: owner saves the four variables with the exact callback URI and intended dedicated test calendar, then reports ready. Restart/validate the existing backend; owner signs into Admin → Overview → Google Calendar → Connect Google account and personally approves account/consent. Verify connected/storeAvailable, matching calendar and owner/writer access afterwards. Keep `CALENDAR_MODE=mock`; Q3 is still required before any real event writes. Voice live microphone/STT verification remains outstanding under unchanged RAM gates. No additional feature work authorized.

## Local startup

```bash
cp .env.example .env   # fill: SUPABASE_SERVICE_ROLE_KEY, SUPABASE_DB_URL (session pooler,
                       # user postgres.<project-ref>), SUPABASE_DB_CA_CERT_PATH, TOKEN_HASH_SECRET
npm ci
npm run build && npm start          # or: npm run dev (tsx)
# health: GET /healthz ; readiness: GET /readyz (database + Ollama)
node scripts/verify-live-db.mjs     # read-only live verification (no writes)
```

Ollama must run locally with `qwen3:1.7b` (default model; switching via admin API).
Speech sidecar starts on demand (RAM-gated); Python venv: `sidecar/whisper/.venv` (`pip install -r sidecar/whisper/requirements.txt`).

## API surface (authoritative: docs/backend/API.md)

- **Public (conversation token, returned once at session start):**
  `POST /api/v1/conversations` · `POST …/{id}/messages` · `POST …/{id}/audio` (multipart; reply text is intended for browser SpeechSynthesis) · `POST …/{id}/consent` · `POST …/{id}/confirm` · `POST …/{id}/cancel` (**explicit booking cancellation — the only public route that may cancel an appointment**) · `POST …/{id}/end` (ends the conversation ONLY; a booking in any state survives) · `GET …/{id}` (external booking status: confirmed | pending | cancelled | none)
- **Admin (Bearer Supabase JWT + app_admins membership):** business-config GET/PUT, customers CRUD+anonymize, conversations list/transcript, appointments list/cancel (calendar-safe), **AI Models & Providers**: `GET /admin/models/local` (live discovery), provider CRUD, `PUT …/credential` (masked; fail-closed 503 while Vault unverified), `POST …/test`, `PUT /admin/settings/active-model` (applies from next turn).
- Error envelope: `{ error: { code, message, requestId } }` — codes in API.md; never trust `message` for control flow; `BOOKING_UNRESOLVED` (202) means "verifying, do not show as failed".

## Key frontend behaviors

- Offer payload (`offer` field) on the completing turn → render slot/end/expiresAt/offerToken; confirmation requires the **offerToken** + explicit customer decision.
- `escalated` conversationState → the conversation is genuinely flagged in the staff console (request_human, in-chat cancellation requests, and questions outside the knowledge base all escalate server-side). Copy must stay honest: "flagged for the team", never "notified".
- **End session ≠ cancellation**: the frontend's End-session button calls `…/{id}/end`; appointment cancellation is a separate deliberate action calling `…/{id}/cancel`. An escalated conversation stays escalated when the customer ends the session (the staff handoff survives).
- Admin Business settings: the Hours and Services tabs save their category AND sync generated FAQ entries (tagged `source:"auto:…"`) — FAQs are the receptionist's only retrieval surface, so knowledge saved there is what gets answered verbatim.
- Admin provider page: keys are **write-only** (`hasCredential` boolean in listings); unsafe endpoints return `UNSAFE_ENDPOINT` (422).

## Verification status (evidence in PROGRESS.md/TESTING.md)

- Fixture suites: 199/199 (29 files) — journey, recovery, concurrency, cancellation, SSRF, sequencing, admin auth.
- Real DB (isolated local stack, TC-65): full journey PASS; shared project read-only verification PASS; migrations 0001–0006 applied & hash-verified.
- Real model (qwen3:1.7b): intent accuracy 8/8; full-response latency cold ~2.4 s / warm ~1.2 s.

## Limitations / genuine blockers (do not paper over)

- **Real STT unmeasured** — RAM-gated (BLOCKED at ~0.5–0.9 GB free vs 1.5 GB gate); script ready (`scripts/speech-live-test.mjs`).
- **Real Google Calendar: NOT activated** — Q3 authorization pending (OAuth creds + test calendar). Mock adapter is the active provider.
- **SEC-F7 open**: qwen3:1.7b adopts injected intents (2/2 probes; no execution path exists — backend decides everything).
- Migration 0007 is applied and verified (Google integration singleton table, not FK indexes). Cloud-provider activation remains separately gated.
- Single active conversation; single-process deployment on the dev laptop.

## Frontend phase (frontend-master skill)

UI/UX ownership transfers to the frontend phase per INTEGRATION.md (journeys §2, session/cache/retry §3). Backend contract questions → API.md; this file + PROGRESS.md §7 are the resume anchors.

**Implemented 2026-10-25 — `frontend/` (Vite 6 + React 18 + TS strict + Tailwind v4).**
Run: `cd frontend && npm ci && npm run dev` (port 5173, dev proxy `/api` → `127.0.0.1:8787`; start the backend first). Copy `frontend/.env.example` → `frontend/.env` and set `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` to enable admin sign-in (client-safe values only; never server secrets). No admin user exists in `app_admins` yet — provisioning one is an owner action. Rendered-verification evidence and honest NOT OBSERVED items: PROGRESS.md §4 "Frontend phase" row.
