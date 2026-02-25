-- Speed up round-scoped command lookup during readiness-driven execution.

create index if not exists idx_game_events_round_scoped_commands
  on secret_toaster.game_events (game_id, event_type, (payload ->> 'round'), id)
  where event_type = 'command.received';
