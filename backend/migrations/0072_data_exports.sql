-- "Download your data" (Settings): a copy of everything someone has put into Katkee, built by the
-- worker as a ZIP (src/modules/users/data-export.ts), kept for 7 days, then deleted with its file
-- by retention. One a day per person. Additive.
CREATE TABLE data_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'ready', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  locked_by text,
  locked_until timestamptz,
  storage_key text,
  byte_size bigint NOT NULL DEFAULT 0,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  ready_at timestamptz,
  expires_at timestamptz NOT NULL
);
CREATE INDEX data_exports_due ON data_exports (created_at) WHERE status IN ('queued', 'running');
CREATE INDEX data_exports_user ON data_exports (user_id, created_at DESC);
