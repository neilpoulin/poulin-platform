-- Track per-player ready state for a game round.

create table if not exists secret_toaster.player_readiness (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references secret_toaster.games (id) on delete cascade,
  round integer not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  is_ready boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint player_readiness_round_non_negative check (round >= 0),
  constraint player_readiness_unique unique (game_id, round, user_id)
);

create index if not exists idx_player_readiness_game_round
  on secret_toaster.player_readiness (game_id, round);

create index if not exists idx_player_readiness_user
  on secret_toaster.player_readiness (user_id);

create trigger set_secret_toaster_player_readiness_updated_at
before update on secret_toaster.player_readiness
for each row
execute function core.set_updated_at();

alter table secret_toaster.player_readiness enable row level security;

grant select on secret_toaster.player_readiness to authenticated;

create policy "members can read player readiness"
on secret_toaster.player_readiness
for select
to authenticated
using (
  secret_toaster.is_game_member(game_id, (select auth.uid()))
);
