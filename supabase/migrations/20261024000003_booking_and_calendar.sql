-- 0003: appointments + calendar idempotency (ADR-0004 v0.2)

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references public.conversations (id) on delete set null,
  customer_id uuid references public.customers (id) on delete set null,
  service_type text,
  purpose text,
  scheduled_start timestamptz not null,
  scheduled_end timestamptz not null,
  duration_minutes int not null,
  meeting_type text,
  timezone text not null,
  status text not null default 'pending_confirmation' check (status in (
    'pending_confirmation', 'confirmed', 'cancelled', 'completed', 'expired', 'failed', 'unresolved')),
  google_calendar_id text,
  google_event_id text,
  idempotency_key uuid not null unique default gen_random_uuid(),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint appointments_period_check check (scheduled_end > scheduled_start)
);

create index appointments_start_idx on public.appointments (scheduled_start desc, id);
create index appointments_open_start_idx on public.appointments (scheduled_start)
  where status in ('confirmed', 'pending_confirmation');
-- Duplicate-event prevention (SEC-9): at most one appointment per real event.
create unique index appointments_google_event_id_unique_idx
  on public.appointments (google_event_id)
  where google_event_id is not null;

-- Protected from creation (security preflight).
alter table public.appointments enable row level security;
revoke all on public.appointments from anon;
