-- Fix RLS recursion: policies call is_game_member(), which queries
-- secret_toaster.game_memberships. Without SECURITY DEFINER this can recurse
-- through the game_memberships policy and trigger stack depth errors.

create or replace function secret_toaster.is_game_member(p_game_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
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

revoke all on function secret_toaster.is_game_member(uuid, uuid) from public;
grant execute on function secret_toaster.is_game_member(uuid, uuid) to authenticated;
grant execute on function secret_toaster.is_game_member(uuid, uuid) to service_role;
