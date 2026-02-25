-- Hardening and performance follow-up for core baseline.

create or replace function core.set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, core
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create index if not exists idx_user_app_memberships_created_by
  on core.user_app_memberships (created_by);

drop policy if exists "users can view own profile" on core.profiles;
create policy "users can view own profile"
on core.profiles
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "users can insert own profile" on core.profiles;
create policy "users can insert own profile"
on core.profiles
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "users can update own profile" on core.profiles;
create policy "users can update own profile"
on core.profiles
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "users can view own memberships" on core.user_app_memberships;
create policy "users can view own memberships"
on core.user_app_memberships
for select
to authenticated
using ((select auth.uid()) = user_id);
