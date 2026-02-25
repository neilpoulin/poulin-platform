-- Secret Toaster v1 schema baseline

create schema if not exists secret_toaster;

insert into core.apps (slug, name, description, is_active)
values (
  'secret-toaster',
  'Secret Toaster',
  'Turn-based strategy game with invites, events, and chat',
  true
)
on conflict (slug)
do update
set
  name = excluded.name,
  description = excluded.description,
  is_active = excluded.is_active,
  updated_at = timezone('utc', now());

create or replace function secret_toaster.app_id()
returns uuid
language sql
stable
set search_path = pg_catalog, core
as $$
  select id from core.apps where slug = 'secret-toaster' limit 1;
$$;

create table if not exists secret_toaster.games (
  id uuid primary key default gen_random_uuid(),
  app_id uuid not null references core.apps (id) on delete restrict,
  game_code text not null unique,
  title text,
  created_by uuid not null references auth.users (id) on delete restrict,
  status text not null default 'lobby',
  round integer not null default 0,
  is_private boolean not null default true,
  join_password_hash text,
  current_state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint games_status_check check (status in ('lobby', 'active', 'completed', 'archived')),
  constraint games_code_format check (game_code ~ '^[A-Z0-9]{4,12}$')
);

create index if not exists idx_games_app_id on secret_toaster.games (app_id);
create index if not exists idx_games_status on secret_toaster.games (status);
create index if not exists idx_games_created_by on secret_toaster.games (created_by);

create trigger set_secret_toaster_games_updated_at
before update on secret_toaster.games
for each row
execute function core.set_updated_at();

create table if not exists secret_toaster.game_memberships (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references secret_toaster.games (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'player',
  is_active boolean not null default true,
  joined_at timestamptz not null default timezone('utc', now()),
  left_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint game_memberships_role_check check (role in ('owner', 'player', 'spectator')),
  constraint game_memberships_unique unique (game_id, user_id)
);

create index if not exists idx_game_memberships_game_id on secret_toaster.game_memberships (game_id);
create index if not exists idx_game_memberships_user_id on secret_toaster.game_memberships (user_id);

create trigger set_secret_toaster_game_memberships_updated_at
before update on secret_toaster.game_memberships
for each row
execute function core.set_updated_at();

create or replace function secret_toaster.is_game_member(p_game_id uuid, p_user_id uuid)
returns boolean
language sql
stable
set search_path = pg_catalog, secret_toaster
as $$
  select exists (
    select 1
    from secret_toaster.game_memberships gm
    where gm.game_id = p_game_id
      and gm.user_id = p_user_id
      and gm.is_active = true
  );
$$;

create table if not exists secret_toaster.game_invites (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references secret_toaster.games (id) on delete cascade,
  token text not null unique,
  created_by uuid not null references auth.users (id) on delete restrict,
  invited_email text,
  expires_at timestamptz,
  used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_game_invites_game_id on secret_toaster.game_invites (game_id);
create index if not exists idx_game_invites_created_by on secret_toaster.game_invites (created_by);

create trigger set_secret_toaster_game_invites_updated_at
before update on secret_toaster.game_invites
for each row
execute function core.set_updated_at();

create table if not exists secret_toaster.game_events (
  id bigint generated always as identity primary key,
  game_id uuid not null references secret_toaster.games (id) on delete cascade,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  caused_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_game_events_game_id_created_at
  on secret_toaster.game_events (game_id, created_at);

create table if not exists secret_toaster.chat_messages (
  id bigint generated always as identity primary key,
  game_id uuid not null references secret_toaster.games (id) on delete cascade,
  sender_user_id uuid not null references auth.users (id) on delete restrict,
  message text not null,
  created_at timestamptz not null default timezone('utc', now()),
  edited_at timestamptz,
  deleted_at timestamptz,
  constraint chat_messages_length_check check (char_length(message) between 1 and 2000)
);

create index if not exists idx_chat_messages_game_id_created_at
  on secret_toaster.chat_messages (game_id, created_at);

alter table secret_toaster.games enable row level security;
alter table secret_toaster.game_memberships enable row level security;
alter table secret_toaster.game_invites enable row level security;
alter table secret_toaster.game_events enable row level security;
alter table secret_toaster.chat_messages enable row level security;

grant usage on schema secret_toaster to authenticated;
grant select on secret_toaster.games to authenticated;
grant select on secret_toaster.game_memberships to authenticated;
grant select on secret_toaster.game_invites to authenticated;
grant select on secret_toaster.game_events to authenticated;
grant select, insert on secret_toaster.chat_messages to authenticated;

create policy "members can read games"
on secret_toaster.games
for select
to authenticated
using (
  secret_toaster.is_game_member(id, (select auth.uid()))
);

create policy "members can read game memberships"
on secret_toaster.game_memberships
for select
to authenticated
using (
  secret_toaster.is_game_member(game_id, (select auth.uid()))
);

create policy "owners can read invites"
on secret_toaster.game_invites
for select
to authenticated
using (
  exists (
    select 1
    from secret_toaster.game_memberships gm
    where gm.game_id = game_invites.game_id
      and gm.user_id = (select auth.uid())
      and gm.role = 'owner'
      and gm.is_active = true
  )
);

create policy "members can read events"
on secret_toaster.game_events
for select
to authenticated
using (
  secret_toaster.is_game_member(game_id, (select auth.uid()))
);

create policy "members can read chat"
on secret_toaster.chat_messages
for select
to authenticated
using (
  secret_toaster.is_game_member(game_id, (select auth.uid()))
);

create policy "members can write own chat"
on secret_toaster.chat_messages
for insert
to authenticated
with check (
  sender_user_id = (select auth.uid())
  and secret_toaster.is_game_member(game_id, (select auth.uid()))
);
