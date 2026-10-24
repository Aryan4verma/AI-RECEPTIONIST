-- 0002: core tables + hardened admin-membership helper (DATABASE.md §2)

create table public.app_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  created_at timestamptz not null default now()
);
-- Protected from creation (security preflight): RLS on + zero grants.
-- No RLS policies for `authenticated` on app_admins (recursion avoidance):
-- membership is read through private.is_app_admin() only.
alter table public.app_admins enable row level security;
revoke all on public.app_admins from anon;
revoke all on public.app_admins from authenticated;

create table public.business_config (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in
    ('business_info', 'hours', 'services', 'faqs', 'appointment_types', 'escalation')),
  content jsonb not null,
  version int not null,
  updated_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  unique (category, version)
);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  contact_email text,
  contact_phone text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers (id) on delete set null,
  channel text not null check (channel in ('text', 'voice')),
  status text not null default 'active' check (status in ('active', 'ended', 'escalated', 'expired')),
  access_token_hash text not null,
  consent_recording boolean not null default false,
  summary text,
  summary_expires_at timestamptz,
  context_snapshot jsonb,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  role text not null check (role in ('customer', 'assistant', 'system')),
  content text not null,
  content_type text not null default 'text' check (content_type in ('text', 'transcript')),
  corrected boolean not null default false,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
create index messages_conversation_idx on public.messages (conversation_id, created_at);

create table public.booking_state (
  conversation_id uuid primary key references public.conversations (id) on delete cascade,
  state text not null default 'COLLECT_DETAILS' check (state in (
    'COLLECT_DETAILS', 'VALIDATE', 'CHECK_AVAILABILITY', 'OFFER_SLOT',
    'AWAIT_CONFIRMATION', 'RECHECK_AVAILABILITY', 'CREATE_EVENT', 'VERIFY_RESULT',
    'CONFIRMED', 'UNRESOLVED', 'CANCELLED', 'REJECTED', 'EXPIRED', 'FAILED')),
  extracted jsonb not null default '{}'::jsonb,
  offered_slot timestamptz,
  offer_expires_at timestamptz,
  confirmation_token_hash text,
  calendar_idempotency_key uuid,
  unresolved_since timestamptz,
  reconciliation_attempts int not null default 0,
  last_reconciled_at timestamptz,
  escalated_at timestamptz,
  attempts int not null default 0,
  last_error text,
  updated_at timestamptz not null default now()
);

-- Immediate protection: RLS enabled at creation for every core table, before
-- any policy exists (RLS-on + zero policies = zero rows via the Data API), and
-- anon stripped explicitly — policies never remove grants.
alter table public.business_config enable row level security;
alter table public.customers enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.booking_state enable row level security;
revoke all on public.business_config, public.customers, public.conversations,
  public.messages, public.booking_state from anon;

-- Hardened SECURITY DEFINER helper (G02 condition E):
-- - non-exposed `private` schema (0001)
-- - pinned empty search_path, fully qualified names
-- - no caller-supplied identity: reads server-managed auth.uid() only
-- - definer = migration owner (bypassrls) reads app_admins directly → no
--   recursive policy evaluation (42P17 impossible by construction)
create or replace function private.is_app_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.app_admins a
    where a.user_id = (select auth.uid())
  );
$$;

revoke execute on function private.is_app_admin() from public;
revoke execute on function private.is_app_admin() from anon;
grant usage on schema private to authenticated;
grant execute on function private.is_app_admin() to authenticated;
