-- Migration 0007 — Google Calendar integration state (Stage 7).
-- Apply only with owner authorization via the Supabase CLI migration workflow.
-- Isolated from business_config (whose CHECK constraint permits only the six
-- business-facing categories). Single-row table (singleton id enforced).

create table public.google_integration (
  id uuid primary key check (id = '00000000-0000-0000-0000-000000000001'),
  connected boolean not null default false,
  calendar_id text,
  -- Opaque Vault secret reference — never the refresh token itself.
  credential_ref text,
  -- auth.users UUID of the admin who completed the OAuth connection.
  connected_by uuid references auth.users (id) on delete set null,
  connected_at timestamptz,
  access_role text,
  last_error text,
  last_verified_at timestamptz,
  updated_at timestamptz not null default now()
);

-- Vault posture: RLS on with NO policies — anon/authenticated get nothing;
-- only the service role (backend) bypasses RLS.
alter table public.google_integration enable row level security;
revoke all on public.google_integration from public, anon, authenticated, service_role;
-- RLS bypass does not grant table privileges. The backend store loads and
-- upserts this row; it does not delete rows or administer this table.
grant select, insert, update on public.google_integration to service_role;
