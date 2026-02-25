-- Include alliance tables in realtime publication.

do $$
begin
  execute 'alter publication supabase_realtime add table secret_toaster.game_alliances';
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  execute 'alter publication supabase_realtime add table secret_toaster.game_player_alliances';
exception
  when duplicate_object then null;
end
$$;
