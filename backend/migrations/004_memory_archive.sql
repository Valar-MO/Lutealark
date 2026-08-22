CREATE TABLE IF NOT EXISTS memory_entries (
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  id uuid NOT NULL,
  memory_kind text NOT NULL
    CHECK (memory_kind IN ('preference', 'constraint', 'long_term_goal')),
  summary varchar(300) NOT NULL CHECK (char_length(summary) BETWEEN 1 AND 300),
  source_conversation_id uuid,
  source_turn_hash varchar(128) NOT NULL
    CHECK (char_length(source_turn_hash) BETWEEN 16 AND 128),
  consented_at timestamptz NOT NULL,
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, id),
  UNIQUE (user_id, source_turn_hash)
);

CREATE INDEX IF NOT EXISTS memory_entries_user_updated_idx
  ON memory_entries (user_id, archived, updated_at DESC, id DESC);
