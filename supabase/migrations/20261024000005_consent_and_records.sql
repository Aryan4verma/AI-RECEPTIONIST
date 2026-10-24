-- 0005: consent evidence, recordings, audit log + role-independent consent gate
-- (ADR-0006 v0.2; G02 conditions B/D)

create table public.consent_decisions (
  id uuid primary key default gen_random_uuid(),
  -- Evidence outlives conversations: set-null + plain provenance column.
  conversation_id uuid references public.conversations (id) on delete set null,
  conversation_ref uuid,
  decision boolean not null,
  scope text not null default 'recording',
  decided_at timestamptz not null default now(),
  valid_until timestamptz,
  decision_text text,
  retention_until timestamptz not null default (now() + interval '3 years')
);
create index consent_decisions_latest_idx
  on public.consent_decisions (conversation_id, decided_at desc, id desc);
create index consent_decisions_ref_idx on public.consent_decisions (conversation_ref);

create table public.recordings (
  id uuid primary key default gen_random_uuid(),
  -- NEVER cascade: conversation deletion must not orphan the Storage object.
  conversation_id uuid references public.conversations (id) on delete set null,
  conversation_ref uuid,
  storage_path text not null,
  duration_seconds int,
  retention_until timestamptz not null default (now() + interval '30 days'),
  deletion_state text not null default 'active' check (deletion_state in ('active', 'deletion_pending', 'deleted')),
  deletion_attempts int not null default 0,
  last_deletion_error text,
  created_at timestamptz not null default now()
);
create index recordings_retention_idx on public.recordings (retention_until)
  where deletion_state = 'active';

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_type text not null check (actor_type in ('customer', 'admin', 'system')),
  actor_id text,
  action text not null,
  entity_type text not null,
  entity_id text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_entity_idx on public.audit_log (entity_type, entity_id, created_at desc);

-- Role-independent consent gate (dual-layer, condition D): the latest applicable
-- decision governs — withdrawal/expiry/supersession always win over history.
create or replace function private.enforce_recording_consent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  latest_decision boolean;
  latest_valid_until timestamptz;
  convo uuid;
begin
  convo := coalesce(new.conversation_id, new.conversation_ref);
  if convo is null then
    raise exception 'recording denied: no conversation reference';
  end if;

  select cd.decision, cd.valid_until
  into latest_decision, latest_valid_until
  from public.consent_decisions cd
  where cd.conversation_id = convo or cd.conversation_ref = convo
  order by cd.decided_at desc, cd.id desc
  limit 1;

  if not found then
    raise exception 'recording denied: no consent decision exists';
  end if;
  if latest_decision is not true then
    raise exception 'recording denied: latest consent decision is not affirmative';
  end if;
  if latest_valid_until is not null and latest_valid_until <= now() then
    raise exception 'recording denied: consent has expired';
  end if;

  return new;
end;
$$;

create trigger enforce_recording_consent
  before insert on public.recordings
  for each row
  execute function private.enforce_recording_consent();
