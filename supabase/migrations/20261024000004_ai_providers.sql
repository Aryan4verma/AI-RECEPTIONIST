-- 0004: AI provider registry (FR-15/16/17; credential_ref never holds a key)

create table public.model_providers (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('local', 'cloud')),
  adapter text not null check (adapter in ('ollama', 'openai_compatible')),
  display_name text not null,
  base_url text,
  model_id text,
  capabilities jsonb not null default '{}'::jsonb,
  status text not null default 'unverified' check (status in ('unverified', 'ok', 'error')),
  last_error text,
  credential_ref text,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Protected from creation (security preflight).
alter table public.model_providers enable row level security;
revoke all on public.model_providers from anon;
