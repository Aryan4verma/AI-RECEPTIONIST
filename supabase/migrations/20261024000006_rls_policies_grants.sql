-- 0006: RLS enablement, policies via private.is_app_admin(), grants
-- Zero anon access anywhere; admin-scoped authenticated access; audit append-only.

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

-- Baseline: strip every default grant from anon on the whole schema.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

-- Business tables: authenticated admins via the hardened helper.
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
