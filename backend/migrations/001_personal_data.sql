CREATE TABLE IF NOT EXISTS app_users (
  id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cycle_settings (
  user_id uuid PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
  last_period_date date NOT NULL,
  cycle_length smallint NOT NULL CHECK (cycle_length BETWEEN 21 AND 35),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS daily_checkins (
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  checkin_date date NOT NULL,
  energy smallint NOT NULL CHECK (energy BETWEEN 1 AND 5),
  mood text NOT NULL CHECK (mood IN ('calm', 'anxious', 'low', 'irritable', 'overwhelmed')),
  body_state jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(body_state) = 'array' AND jsonb_array_length(body_state) <= 8),
  note varchar(200),
  share_with_chat boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, checkin_date)
);

CREATE INDEX IF NOT EXISTS daily_checkins_user_date_idx
  ON daily_checkins (user_id, checkin_date DESC);

CREATE TABLE IF NOT EXISTS breathing_records (
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  id uuid NOT NULL,
  mode_id varchar(64) NOT NULL,
  mode_name varchar(100) NOT NULL,
  completed_at timestamptz NOT NULL,
  duration_seconds integer NOT NULL CHECK (duration_seconds BETWEEN 1 AND 86400),
  rating smallint CHECK (rating BETWEEN 1 AND 5),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, id)
);

CREATE INDEX IF NOT EXISTS breathing_records_user_completed_idx
  ON breathing_records (user_id, completed_at DESC);
