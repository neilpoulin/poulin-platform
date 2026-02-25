-- Add alliance management and scoped chat visibility.

create table if not exists secret_toaster.game_alliances (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references secret_toaster.games (id) on delete cascade,
  name text not null,
  color_hex text,
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint game_alliances_name_length check (char_length(name) between 2 and 40),
  constraint game_alliances_color_format check (color_hex is null or color_hex ~ '^#[0-9A-Fa-f]{6}$'),
  constraint game_alliances_unique_name_per_game unique (game_id, name)
);

create unique index if not exists idx_game_alliances_game_id_id
  on secret_toaster.game_alliances (game_id, id);

create trigger set_secret_toaster_game_alliances_updated_at
before update on secret_toaster.game_alliances
for each row
execute function core.set_updated_at();

create table if not exists secret_toaster.game_player_alliances (
  game_id uuid not null references secret_toaster.games (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  alliance_id uuid,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (game_id, user_id),
  constraint game_player_alliances_fk
    foreign key (game_id, alliance_id)
    references secret_toaster.game_alliances (game_id, id)
    on delete set null
);

create index if not exists idx_game_player_alliances_alliance_id
  on secret_toaster.game_player_alliances (alliance_id);

create trigger set_secret_toaster_game_player_alliances_updated_at
before update on secret_toaster.game_player_alliances
for each row
execute function core.set_updated_at();

alter table secret_toaster.chat_messages
  add column if not exists message_type text not null default 'GLOBAL',
  add column if not exists alliance_id uuid,
  add column if not exists recipient_user_id uuid references auth.users (id) on delete set null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'chat_messages_message_type_check'
  ) then
    alter table secret_toaster.chat_messages
      add constraint chat_messages_message_type_check
      check (message_type in ('GLOBAL', 'ALLIANCE', 'DIRECT'));
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'chat_messages_scope_check'
  ) then
    alter table secret_toaster.chat_messages
      add constraint chat_messages_scope_check
      check (
        (message_type = 'GLOBAL' and alliance_id is null and recipient_user_id is null)
        or (message_type = 'ALLIANCE' and alliance_id is not null and recipient_user_id is null)
        or (message_type = 'DIRECT' and alliance_id is null and recipient_user_id is not null)
      );
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'chat_messages_alliance_fk'
  ) then
    alter table secret_toaster.chat_messages
      add constraint chat_messages_alliance_fk
      foreign key (game_id, alliance_id)
      references secret_toaster.game_alliances (game_id, id)
      on delete set null;
  end if;
end
$$;

create or replace function secret_toaster.is_alliance_member(p_game_id uuid, p_alliance_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, secret_toaster
as $$
  select exists (
    select 1
    from secret_toaster.game_player_alliances gpa
    where gpa.game_id = p_game_id
      and gpa.user_id = p_user_id
      and gpa.alliance_id = p_alliance_id
  );
$$;

revoke all on function secret_toaster.is_alliance_member(uuid, uuid, uuid) from public;
grant execute on function secret_toaster.is_alliance_member(uuid, uuid, uuid) to authenticated;
grant execute on function secret_toaster.is_alliance_member(uuid, uuid, uuid) to service_role;

alter table secret_toaster.game_alliances enable row level security;
alter table secret_toaster.game_player_alliances enable row level security;

grant select on secret_toaster.game_alliances to authenticated;
grant select on secret_toaster.game_player_alliances to authenticated;

drop policy if exists "members can read chat" on secret_toaster.chat_messages;
drop policy if exists "members can write own chat" on secret_toaster.chat_messages;

create policy "members can read alliances"
on secret_toaster.game_alliances
for select
to authenticated
using (
  secret_toaster.is_game_member(game_id, (select auth.uid()))
);

create policy "members can read player alliances"
on secret_toaster.game_player_alliances
for select
to authenticated
using (
  secret_toaster.is_game_member(game_id, (select auth.uid()))
);

create policy "members can read scoped chat"
on secret_toaster.chat_messages
for select
to authenticated
using (
  secret_toaster.is_game_member(game_id, (select auth.uid()))
  and (
    message_type = 'GLOBAL'
    or (
      message_type = 'ALLIANCE'
      and alliance_id is not null
      and secret_toaster.is_alliance_member(game_id, alliance_id, (select auth.uid()))
    )
    or (
      message_type = 'DIRECT'
      and (
        sender_user_id = (select auth.uid())
        or recipient_user_id = (select auth.uid())
      )
    )
  )
);

create policy "members can write scoped chat"
on secret_toaster.chat_messages
for insert
to authenticated
with check (
  sender_user_id = (select auth.uid())
  and secret_toaster.is_game_member(game_id, (select auth.uid()))
  and (
    message_type = 'GLOBAL'
    or (
      message_type = 'ALLIANCE'
      and alliance_id is not null
      and secret_toaster.is_alliance_member(game_id, alliance_id, (select auth.uid()))
    )
    or (
      message_type = 'DIRECT'
      and recipient_user_id is not null
    )
  )
);
