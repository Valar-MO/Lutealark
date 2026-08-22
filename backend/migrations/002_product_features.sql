CREATE TABLE IF NOT EXISTS conversations (
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  id uuid NOT NULL,
  title varchar(120),
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, id)
);

CREATE INDEX IF NOT EXISTS conversations_user_updated_idx
  ON conversations (user_id, archived, updated_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS conversation_messages (
  user_id uuid NOT NULL,
  id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 20000),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, id),
  FOREIGN KEY (user_id, conversation_id)
    REFERENCES conversations(user_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS conversation_messages_conversation_created_idx
  ON conversation_messages (user_id, conversation_id, created_at, id);

CREATE TABLE IF NOT EXISTS daily_plans (
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  id uuid NOT NULL,
  plan_date date NOT NULL,
  title varchar(120),
  energy_level smallint CHECK (energy_level BETWEEN 1 AND 5),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, id),
  UNIQUE (user_id, plan_date)
);

CREATE INDEX IF NOT EXISTS daily_plans_user_date_idx
  ON daily_plans (user_id, plan_date DESC);

CREATE TABLE IF NOT EXISTS daily_plan_items (
  user_id uuid NOT NULL,
  id uuid NOT NULL,
  plan_id uuid NOT NULL,
  content varchar(200) NOT NULL CHECK (char_length(content) BETWEEN 1 AND 200),
  estimated_minutes smallint CHECK (estimated_minutes BETWEEN 1 AND 240),
  sort_order smallint NOT NULL CHECK (sort_order BETWEEN 0 AND 11),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, id),
  UNIQUE (user_id, plan_id, sort_order),
  FOREIGN KEY (user_id, plan_id)
    REFERENCES daily_plans(user_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS daily_plan_items_plan_idx
  ON daily_plan_items (user_id, plan_id, sort_order);

CREATE TABLE IF NOT EXISTS activity_records (
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  id uuid NOT NULL,
  activity_type text NOT NULL
    CHECK (activity_type IN ('pomodoro', 'environment', 'micro_movement')),
  completed_at timestamptz NOT NULL,
  duration_seconds integer CHECK (duration_seconds BETWEEN 1 AND 86400),
  note varchar(200),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, id)
);

CREATE INDEX IF NOT EXISTS activity_records_user_completed_idx
  ON activity_records (user_id, completed_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS point_events (
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  event_key varchar(160) NOT NULL,
  event_type text NOT NULL CHECK (
    event_type IN (
      'checkin',
      'breathing',
      'pomodoro',
      'plan_item',
      'environment',
      'micro_movement'
    )
  ),
  points smallint NOT NULL,
  source_id varchar(128) NOT NULL,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, event_key),
  CHECK (
    (event_type = 'checkin' AND points = 2)
    OR (event_type = 'breathing' AND points = 3)
    OR (event_type = 'pomodoro' AND points = 5)
    OR (event_type = 'plan_item' AND points = 2)
    OR (event_type = 'environment' AND points = 1)
    OR (event_type = 'micro_movement' AND points = 2)
  )
);

CREATE INDEX IF NOT EXISTS point_events_user_occurred_idx
  ON point_events (user_id, occurred_at DESC, event_key DESC);

CREATE TABLE IF NOT EXISTS point_preferences (
  user_id uuid PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
  weekly_goal smallint NOT NULL DEFAULT 30 CHECK (weekly_goal BETWEEN 1 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
