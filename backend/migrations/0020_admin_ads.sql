-- Additive: retain existing identity, content, report rows and legacy status values.
CREATE TABLE admin_grants (
 user_id uuid PRIMARY KEY REFERENCES users(id), role text NOT NULL CHECK(role IN ('ADMIN','SUPER_ADMIN')),
 permissions jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(permissions)='array'),
 enabled boolean NOT NULL DEFAULT true, version integer NOT NULL DEFAULT 1,
 mfa_required boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO admin_grants(user_id,role,permissions)
 SELECT id,'ADMIN','["reports.read","reports.review","content.remove","users.view","users.suspend","moderation.history.read"]'::jsonb
 FROM users WHERE is_moderator AND deleted_at IS NULL;
CREATE TABLE admin_sessions (
 token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), csrf_hash text NOT NULL,
 expires_at timestamptz NOT NULL, reauthenticated_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_sessions_user_idx ON admin_sessions(user_id);
ALTER TABLE users ADD COLUMN moderation_state text NOT NULL DEFAULT 'ACTIVE' CHECK(moderation_state IN ('ACTIVE','RESTRICTED','SUSPENDED','DISABLED'));
UPDATE users SET moderation_state='SUSPENDED' WHERE NOT is_active;
ALTER TABLE stories ADD COLUMN moderation_removed_at timestamptz;
ALTER TABLE story_comments ADD COLUMN moderation_removed_at timestamptz;
ALTER TABLE reports ADD COLUMN version integer NOT NULL DEFAULT 1;
ALTER TABLE reports ADD COLUMN priority integer NOT NULL DEFAULT 0 CHECK(priority BETWEEN 0 AND 3);
ALTER TABLE reports ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE reports DROP CONSTRAINT reports_target_type_valid;
ALTER TABLE reports ADD CONSTRAINT reports_target_type_valid CHECK(target_type IN ('story','comment','user','ad'));
ALTER TABLE reports DROP CONSTRAINT reports_status_valid;
ALTER TABLE reports ADD CONSTRAINT reports_status_valid CHECK(status IN ('pending','under_review','dismissed','actioned','appealed','closed'));
CREATE INDEX reports_queue_priority_idx ON reports(status,priority DESC,created_at);
CREATE TABLE moderation_actions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), report_id uuid REFERENCES reports(id), actor_id uuid NOT NULL REFERENCES users(id),
 target_type text NOT NULL, target_id uuid NOT NULL, action text NOT NULL, reason text NOT NULL,
 previous_state jsonb NOT NULL, new_state jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX moderation_actions_target_idx ON moderation_actions(target_type,target_id,created_at DESC);
CREATE TABLE admin_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid REFERENCES users(id), action text NOT NULL,
 target_id uuid, metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_audit_actor_time_idx ON admin_audit(actor_id,created_at DESC);
CREATE INDEX admin_audit_time_idx ON admin_audit(created_at DESC);
CREATE FUNCTION reject_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Audit history is append-only'; END $$;
CREATE TRIGGER admin_audit_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON admin_audit FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_mutation();
CREATE TRIGGER moderation_actions_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON moderation_actions FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_mutation();
CREATE TABLE moderation_appeals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), action_id uuid NOT NULL REFERENCES moderation_actions(id),
 user_id uuid NOT NULL REFERENCES users(id), reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 1000),
 status text NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','UPHELD','DENIED')), resolution text,
 reviewer_id uuid REFERENCES users(id), version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(action_id,user_id)
);
CREATE TABLE moderation_notices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id),
 action_id uuid NOT NULL REFERENCES moderation_actions(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX moderation_notices_user_idx ON moderation_notices(user_id,created_at DESC);
CREATE TABLE advertisers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL CHECK(length(name) BETWEEN 1 AND 100),
 user_id uuid NOT NULL REFERENCES users(id), created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ad_campaigns (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), advertiser_id uuid NOT NULL REFERENCES advertisers(id),
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 120), objective text NOT NULL DEFAULT 'awareness',
 status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','PENDING_REVIEW','APPROVED','ACTIVE','PAUSED','REJECTED','COMPLETED')),
 start_at timestamptz NOT NULL, end_at timestamptz NOT NULL CHECK(end_at>start_at),
 budget_minor bigint NOT NULL CHECK(budget_minor>=0), currency text NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
 impression_limit integer NOT NULL CHECK(impression_limit BETWEEN 1 AND 100000000),
 user_cap integer NOT NULL CHECK(user_cap BETWEEN 1 AND 100), daily_cap integer NOT NULL CHECK(daily_cap BETWEEN 1 AND 20),
 created_by uuid NOT NULL REFERENCES users(id), version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ad_campaigns_eligibility_idx ON ad_campaigns(status,start_at,end_at);
CREATE TABLE ad_creatives (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), campaign_id uuid NOT NULL UNIQUE REFERENCES ad_campaigns(id),
 media_id uuid NOT NULL REFERENCES media(id), caption text NOT NULL CHECK(length(caption)<=500),
 cta text NOT NULL CHECK(cta IN ('Learn More','Visit Website','Shop Now','Install')),
 destination text NOT NULL, review_status text NOT NULL DEFAULT 'PENDING' CHECK(review_status IN ('PENDING','APPROVED','REJECTED','REMOVED')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ad_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), campaign_id uuid NOT NULL REFERENCES ad_campaigns(id),
 reviewer_id uuid NOT NULL REFERENCES users(id), decision text NOT NULL, reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ad_delivery_settings (
 id integer PRIMARY KEY CHECK(id=1), organic_gap integer NOT NULL CHECK(organic_gap BETWEEN 3 AND 100),
 session_cap integer NOT NULL CHECK(session_cap BETWEEN 1 AND 10), daily_cap integer NOT NULL CHECK(daily_cap BETWEEN 1 AND 50)
);
INSERT INTO ad_delivery_settings VALUES(1,6,2,5);
CREATE TABLE ad_deliveries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), viewer_id uuid NOT NULL REFERENCES users(id),
 campaign_id uuid NOT NULL REFERENCES ad_campaigns(id), creative_id uuid NOT NULL REFERENCES ad_creatives(id),
 session_id uuid NOT NULL, slot integer NOT NULL CHECK(slot>=3), created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '10 minutes', UNIQUE(viewer_id,session_id,slot)
);
CREATE INDEX ad_deliveries_caps_idx ON ad_deliveries(viewer_id,campaign_id,created_at DESC);
CREATE INDEX ad_deliveries_campaign_idx ON ad_deliveries(campaign_id);
CREATE TABLE ad_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), delivery_id uuid NOT NULL REFERENCES ad_deliveries(id),
 event_type text NOT NULL CHECK(event_type IN ('ad_requested','ad_rendered','ad_impression','ad_qualified_view','ad_complete','ad_click','ad_hide','ad_report','ad_load_failed')),
 visible_ms integer NOT NULL DEFAULT 0 CHECK(visible_ms BETWEEN 0 AND 3600000), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(delivery_id,event_type)
);
CREATE TABLE ad_hides (
 viewer_id uuid NOT NULL REFERENCES users(id), creative_id uuid NOT NULL REFERENCES ad_creatives(id),
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(viewer_id,creative_id)
);
