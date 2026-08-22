CREATE TABLE IF NOT EXISTS auth_accounts (
  user_id uuid PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
  email varchar(254) NOT NULL,
  password_hash bytea NOT NULL CHECK (octet_length(password_hash) = 64),
  password_salt bytea NOT NULL CHECK (octet_length(password_salt) = 16),
  password_algorithm text NOT NULL DEFAULT 'scrypt-v1'
    CHECK (password_algorithm = 'scrypt-v1'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auth_accounts_email_unique UNIQUE (email),
  CONSTRAINT auth_accounts_email_canonical CHECK (email = lower(email))
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth_accounts(user_id) ON DELETE CASCADE,
  token_hash bytea NOT NULL CHECK (octet_length(token_hash) = 32),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auth_sessions_token_hash_unique UNIQUE (token_hash)
);

CREATE INDEX IF NOT EXISTS auth_sessions_user_expires_idx
  ON auth_sessions (user_id, expires_at DESC);

CREATE INDEX IF NOT EXISTS auth_sessions_expires_idx
  ON auth_sessions (expires_at);

-- A legacy anonymous UUID can be claimed only once.  The source app_users row
-- is intentionally retained because other, non-personal feature tables may
-- still refer to it while clients finish moving their offline queue.
CREATE TABLE IF NOT EXISTS auth_device_claims (
  device_user_id uuid PRIMARY KEY,
  account_user_id uuid NOT NULL REFERENCES auth_accounts(user_id) ON DELETE CASCADE,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auth_device_claims_distinct_users
    CHECK (device_user_id <> account_user_id)
);

CREATE INDEX IF NOT EXISTS auth_device_claims_account_idx
  ON auth_device_claims (account_user_id, claimed_at DESC);
