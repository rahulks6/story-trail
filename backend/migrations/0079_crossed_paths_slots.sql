-- Crossed paths, tighter (review of 0078): a visit is now kept per 3-hour slot, not per day, so
-- someone who opened the app in an area in the morning and again in the evening doesn't look
-- present all day. Visits are kept two days, so starting the table afresh loses nothing that matters.
DROP TABLE crossed_visits;
CREATE TABLE crossed_visits (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cell text NOT NULL CHECK (cell ~ '^[0-9b-hjkmnp-z]{5}$'),
  slot timestamptz NOT NULL,
  first_at timestamptz NOT NULL DEFAULT now(),
  last_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, cell, slot)
);
CREATE INDEX crossed_visits_cell ON crossed_visits (cell, slot);
CREATE INDEX crossed_visits_user ON crossed_visits (user_id, last_at);
