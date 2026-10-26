# AI Receptionist (backend + AI phase)

Local-first AI receptionist backend: Fastify + TypeScript, Supabase/PostgreSQL,
Ollama (`qwen3:1.7b` default), Faster-Whisper speech sidecar, mock-first Google
Calendar integration. Frontend is a separate phase.

- **Authoritative state:** `docs/backend/PROGRESS.md` (control/resume §1, §7)
- **API contract:** `docs/backend/API.md` · **Handoff:** `docs/backend/HANDOFF.md`
- **Migrations:** `supabase/migrations/` (CLI-only application; 0001–0007 applied to project `ogxdszjypswutekqgorb`)

## Quickstart

```bash
cp .env.example .env   # fill the four server-side values (never commit)
npm ci
npm run dev            # tsx; or npm run build && npm start
```

## Commands

`npm run typecheck` · `npm test` (Vitest; fixture + real-process + gated live suites)
`node scripts/verify-live-db.mjs` (read-only live DB verification)
`node scripts/speech-live-test.mjs` (real STT measurement; RAM-gated)

## Safety notes

Secrets live only in `.env` (git-ignored). No remote DDL, real Calendar writes,
or paid cloud inference without explicit owner authorization (see PROGRESS.md §5 ledger).
