-- Performance follow-up: add covering indexes for FK columns flagged by advisor.

create index if not exists idx_game_events_caused_by
  on secret_toaster.game_events (caused_by);

create index if not exists idx_chat_messages_sender_user_id
  on secret_toaster.chat_messages (sender_user_id);
