-- Core shared schema baseline
-- Creates app registry, profiles, and per-app memberships.

create schema if not exists core;

create or replace function core.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table if not exists core.apps (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint apps_slug_format check (slug ~ '^[a-z0-9_\-]+$')
);

create trigger set_core_apps_updated_at
before update on core.apps
for each row
execute function core.set_updated_at();

create table if not exists core.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create trigger set_core_profiles_updated_at
before update on core.profiles
for each row
execute function core.set_updated_at();

create table if not exists core.user_app_memberships (
  id uuid primary key default gen_random_uuid(),
  app_id uuid not null references core.apps (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member',
  status text not null default 'active',
  created_by uuid references auth.users (id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint user_app_memberships_unique unique (app_id, user_id),
  constraint user_app_memberships_role check (role in ('owner', 'admin', 'member')),
  constraint user_app_memberships_status check (status in ('active', 'invited', 'suspended'))
);

create index if not exists idx_user_app_memberships_user
  on core.user_app_memberships (user_id);

create index if not exists idx_user_app_memberships_app
  on core.user_app_memberships (app_id);

create index if not exists idx_user_app_memberships_status
  on core.user_app_memberships (status);

create trigger set_core_user_app_memberships_updated_at
before update on core.user_app_memberships
for each row
execute function core.set_updated_at();

alter table core.apps enable row level security;
alter table core.profiles enable row level security;
alter table core.user_app_memberships enable row level security;

grant usage on schema core to authenticated;
grant select on core.apps to authenticated;

grant select, insert, update on core.profiles to authenticated;

grant select on core.user_app_memberships to authenticated;

create policy "authenticated can read active apps"
on core.apps
for select
to authenticated
using (is_active = true);

create policy "users can view own profile"
on core.profiles
for select
to authenticated
using (auth.uid() = user_id);

create policy "users can insert own profile"
on core.profiles
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "users can update own profile"
on core.profiles
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "users can view own memberships"
on core.user_app_memberships
for select
to authenticated
using (auth.uid() = user_id);
