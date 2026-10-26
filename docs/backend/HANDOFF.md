# Stage 10 — Frontend Handoff

Status: backend feature-complete for the frontend phase; **not** declared production-ready (see Limitations).

## Current continuation — 2026-10-26

Voice repair commit `00479a0`: recorder state resets between turns (regression proves distinct uploaded bytes/transcripts), bounded contextual property enquiries, source checks for preferences and booking identities, audio handoff status, empty-speech retry, noise/mute limits and TTS cancellation. Verification: frontend 16/16, both builds/typechecks, real local qwen3:1.7b synthetic dialogue PASS. Live STT BLOCKED at 1.19 GB free versus 1.5 GB script gate; actual microphone/echo/barge-in not verified.

Google migration `20261025000007_google_integration.sql` (reviewed source `49d8425`) APPLIED via owner-authorized CLI workflow on `ogxdszjypswutekqgorb`, 2026-10-26. Only 0007 was pending/applied; Vault/seed/role updates skipped. Remote history 0001–0007 matches; no migrations remain pending. Ten columns, singleton constraints and UUID auth FK verified; RLS enabled, zero policies; backend service_role SELECT/INSERT/UPDATE, no anon/authenticated/PUBLIC access. Existing 11 tables' row/content fingerprints and schema/security fingerprint unchanged; integration table empty. Migration verifier corrected for the seventh file/twelfth table. Full fixture-suite result is recorded in PROGRESS §1.

OAuth preparation: normal push synced main through `99439bb`; all four Google variables are missing from backend `.env`. Owner chose to populate them personally; private credentials were not accessed. Backend has one loopback listener, health/readiness 200 and protected status 401 without auth. A synthetic rejected callback revealed code/state in request logs; query-string scrubbing is now verified in the live backend and by 7 focused tests (typecheck PASS). No real connection or Google API calls performed.

Latest OAuth repair: four Google settings are now present; mode stays mock. Connected database contracts confirm scalar UUID creation and scoped `DELETE FROM vault.secrets WHERE id = $1::uuid` (no delete_secret function). Old create query fails read-only EXPLAIN with 42703. Callback now returns rendered text/html with sanitized actionable stage categories; logs omit raw errors and OAuth values. Failed calendar checks/Vault/persistence/audit paths clean issued credentials, report incomplete cleanup and avoid a false success; replacement names are unique. 38 focused tests and typecheck PASS; live missing-state response is HTML/400/[state]. No migrations or real Google/event operations performed. The historical failing callback lacked stage logging, and successful live consent still requires owner retry.

**Frontend polish checkpoint, 2026-10-26:** Owner completed OAuth successfully; live authenticated Overview shows Connected with Owner access. Focused polish fixes the Calendar ID's intrinsic-width overflow using bounded grid tracks, compact semantic key/value metadata, ellipsis, copy feedback and an expandable selectable full ID. Copy/paste verified against the complete value. Desktop recent conversations now sit below appointments to remove the blank stretched area; responsive status columns, narrower internally scrolling sidebar, readable metrics/buttons/helper text, stronger heading hierarchy and long-text wrapping preserve the existing visual identity. Images load locally; the shared Photo component has an intentional architectural fallback and recovers when its source changes. An isolated unavailable→available image fixture verified both paths and was removed afterwards.

Verification: frontend 16/16 tests PASS; `npm run build` includes TypeScript and Vite checks, PASS. Live Overview has no page-level horizontal overflow at 320/390/768/1280 px; connected ID expansion stays bounded. Customer landing/chat and call entry inspected at mobile width without activating the microphone; one temporary chat session opened and ended, with no messages sent. No backend contract, migration, OAuth mutation or Google event change. `CALENDAR_MODE=mock` confirmed. The owner's existing admin origin is `http://localhost:5174/admin/overview` (5173 was already occupied); frontend dev server restored on 5174 for verification.

**Premium frontend redesign checkpoint, 2026-10-26 (owner-authorized):** Shared ivory/forest paper surfaces, Fraunces/Inter hierarchy, compact rectangular controls, operational lists, responsive console navigation and editorial customer photography now cover Overview, Conversations, Customers, Appointments, Business settings, AI models, login, landing, chat and call entry. Native dialog/drawer overlays contain focus, restore the trigger and support Escape; fields associate labels, hints and errors. Search/filter recovery, read-only record details, unsaved-settings protection, duration validation and truthful model availability improve existing workflows. Admin routes are lazy-loaded. Calendar connected metadata and full-ID/copy controls remain intact.

Verification: frontend **22/22 tests PASS** (six new shared-UI semantic regressions plus the existing voice tests); TypeScript/Vite production build PASS. Live pages inspected at representative 1440/1280/768/375/320px widths with no observed page-level horizontal overflow; transcript drawer focus/Escape/return, empty search recovery, unsaved draft discard, native invalid-duration blocking and local-model prefill verified. Login image renders at its full intended height. Live customer/appointment lists are empty, so populated details and destructive actions were not exercised or seeded. One additional anonymous chat session was opened and ended without messages; no customer, appointment, configuration, provider, OAuth or Google event writes. `CALENDAR_MODE=mock` preserved; backend contracts and recorder engine unchanged. Screenshots are local verification artifacts outside Git.

Next: owner reviews the redesign. Q3 is still required before real Google event writes. Voice live microphone/STT verification remains outstanding under unchanged RAM gates; no further features authorized.

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
