-- Enable Postgres changes streaming for secret_toaster schema tables used by the app.

do $$
declare
  table_name text;
  table_names text[] := array[
    'secret_toaster.games',
    'secret_toaster.game_memberships',
    'secret_toaster.game_events',
    'secret_toaster.player_readiness',
    'secret_toaster.chat_messages'
  ];
begin
  foreach table_name in array table_names
  loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = split_part(table_name, '.', 1)
        and tablename = split_part(table_name, '.', 2)
    ) then
      execute format('alter publication supabase_realtime add table %s', table_name);
    end if;
  end loop;
end
$$;
