CREATE TABLE IF NOT EXISTS cycle_events (
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  event_date date NOT NULL,
  event_type text NOT NULL
    CHECK (event_type IN ('period_start', 'period_end', 'no_symptom')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, event_date)
);

CREATE INDEX IF NOT EXISTS cycle_events_user_date_idx
  ON cycle_events (user_id, event_date DESC);
