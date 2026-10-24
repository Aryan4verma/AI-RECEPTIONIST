-- 0001: extensions + private helper schema (DATABASE.md §5)
-- Applied ONLY via the Supabase CLI (SUPABASE.md §5); never ad-hoc SQL.

create extension if not exists pgcrypto;

-- Internal helpers live in a non-Data-API-exposed schema: Supabase exposes
-- `public` by default, and a SECURITY DEFINER function in an exposed schema
-- would be callable with its creator's privileges (G02 condition E).
create schema if not exists private;
revoke all on schema private from public;
revoke all on schema private from anon;
comment on schema private is
  'Internal SECURITY DEFINER helpers. Never exposed via the Data API.';
