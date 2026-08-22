CREATE TABLE IF NOT EXISTS agent_session_bindings (
  session_hash bytea PRIMARY KEY
    CHECK (octet_length(session_hash) = 32),
  subject_type text NOT NULL
    CHECK (subject_type IN ('account', 'anonymous', 'public')),
  subject_id uuid,
  account_user_id uuid REFERENCES auth_accounts(user_id) ON DELETE CASCADE,
  session_mode text NOT NULL
    CHECK (session_mode IN ('online', 'offline')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (subject_type = 'account'
      AND subject_id IS NOT NULL
      AND account_user_id = subject_id)
    OR (subject_type = 'anonymous'
      AND subject_id IS NOT NULL
      AND account_user_id IS NULL)
    OR (subject_type = 'public'
      AND subject_id IS NULL
      AND account_user_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS agent_session_bindings_expires_idx
  ON agent_session_bindings (expires_at);

CREATE INDEX IF NOT EXISTS agent_session_bindings_account_idx
  ON agent_session_bindings (account_user_id, expires_at DESC)
  WHERE account_user_id IS NOT NULL;
