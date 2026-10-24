-- 0006: policies via private.is_app_admin() + EXPLICIT role grants
-- Security preflight: under Supabase's default-grants enforcement (effective
-- for the October 30, 2026 legacy-key deadline), no role can rely on automatic
-- Data API grants. Every privilege below is granted explicitly per the access
-- matrix (AUTH.md §3); adding policies never removes grants, so revocation is
-- also explicit. RLS itself was enabled at table creation (0002–0005); the
-- statements here are idempotent re-assertions and review anchors.

alter table public.app_admins enable row level security;
alter table public.business_config enable row level security;
alter table public.customers enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.booking_state enable row level security;
alter table public.appointments enable row level security;
alter table public.model_providers enable row level security;
alter table public.consent_decisions enable row level security;
alter table public.recordings enable row level security;
alter table public.audit_log enable row level security;

-- Baseline: strip every privilege from anon on the whole schema.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

-- Policies (RLS is the row filter; grants below are the column/table gate —
-- separate controls, both required).
create policy admins_select_business_config on public.business_config
  for select to authenticated using (private.is_app_admin());
create policy admins_insert_business_config on public.business_config
  for insert to authenticated with check (private.is_app_admin());

create policy admins_select_customers on public.customers
  for select to authenticated using (private.is_app_admin());
create policy admins_insert_customers on public.customers
  for insert to authenticated with check (private.is_app_admin());
create policy admins_update_customers on public.customers
  for update to authenticated using (private.is_app_admin()) with check (private.is_app_admin());

create policy admins_select_conversations on public.conversations
  for select to authenticated using (private.is_app_admin());
create policy admins_update_conversations on public.conversations
  for update to authenticated using (private.is_app_admin()) with check (private.is_app_admin());

create policy admins_select_messages on public.messages
  for select to authenticated using (private.is_app_admin());

create policy admins_select_booking_state on public.booking_state
  for select to authenticated using (private.is_app_admin());
create policy admins_update_booking_state on public.booking_state
  for update to authenticated using (private.is_app_admin()) with check (private.is_app_admin());

create policy admins_select_appointments on public.appointments
  for select to authenticated using (private.is_app_admin());
create policy admins_insert_appointments on public.appointments
  for insert to authenticated with check (private.is_app_admin());
create policy admins_update_appointments on public.appointments
  for update to authenticated using (private.is_app_admin()) with check (private.is_app_admin());

create policy admins_select_model_providers on public.model_providers
  for select to authenticated using (private.is_app_admin());
create policy admins_insert_model_providers on public.model_providers
  for insert to authenticated with check (private.is_app_admin());
create policy admins_update_model_providers on public.model_providers
  for update to authenticated using (private.is_app_admin()) with check (private.is_app_admin());
create policy admins_delete_model_providers on public.model_providers
  for delete to authenticated using (private.is_app_admin());

-- Consent evidence: admin-readable, append-only (no update/delete policies).
create policy admins_select_consent_decisions on public.consent_decisions
  for select to authenticated using (private.is_app_admin());

-- Recordings: admin-readable; inserts stay consent-gated by the 0005 trigger
-- regardless of role (service_role included).
create policy admins_select_recordings on public.recordings
  for select to authenticated using (private.is_app_admin());

-- Audit log: admin-readable; NO update/delete policies for any role.
create policy admins_select_audit_log on public.audit_log
  for select to authenticated using (private.is_app_admin());
revoke update, delete on public.audit_log from authenticated;

-- EXPLICIT grants per the access matrix (no reliance on default grants).
grant usage on schema public to authenticated, service_role;

-- authenticated (business administrators; row access filtered by RLS):
grant select on
  public.business_config, public.customers, public.conversations, public.messages,
  public.booking_state, public.appointments, public.model_providers,
  public.consent_decisions, public.recordings, public.audit_log
  to authenticated;
grant insert, update on public.business_config to authenticated;
grant insert, update on public.customers to authenticated;
grant insert, update on public.conversations to authenticated;
grant insert, update on public.appointments to authenticated;
grant insert, update, delete on public.model_providers to authenticated;
-- authenticated can NEVER write: messages, booking_state (no insert), consent
-- decisions, recordings, audit log, app_admins.

-- service_role (trusted backend process; row access also backend-checked):
grant select, insert, update, delete on
  public.business_config, public.customers, public.conversations, public.messages,
  public.booking_state, public.appointments, public.model_providers,
  public.consent_decisions, public.recordings
  to service_role;
grant select on public.app_admins to service_role;
-- Audit log append-only for EVERY role incl. the backend: insert + read only.
grant select, insert on public.audit_log to service_role;
revoke update, delete on public.audit_log from service_role;
