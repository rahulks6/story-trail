ALTER TABLE ad_campaigns ADD COLUMN updated_by uuid REFERENCES users(id);
CREATE INDEX ad_deliveries_session_idx ON ad_deliveries(viewer_id,session_id,slot);
CREATE INDEX ad_events_type_time_idx ON ad_events(event_type,created_at);
CREATE INDEX moderation_appeals_status_time_idx ON moderation_appeals(status,created_at);
-- Hardening: lock and recheck inside a function so concurrent bootstrap attempts
-- cannot both observe an empty Super Admin set from a stale statement snapshot.
CREATE FUNCTION bootstrap_super_admin(p_email text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE target uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(78210942);
 IF EXISTS(SELECT 1 FROM admin_grants WHERE role='SUPER_ADMIN' AND enabled) THEN RETURN NULL; END IF;
 SELECT id INTO target FROM users WHERE email=p_email AND is_active AND deleted_at IS NULL;
 IF target IS NULL THEN RETURN NULL; END IF;
 INSERT INTO admin_grants(user_id,role,permissions) VALUES(target,'SUPER_ADMIN','[]')
 ON CONFLICT(user_id) DO UPDATE SET role='SUPER_ADMIN',enabled=true,version=admin_grants.version+1;
 INSERT INTO admin_audit(actor_id,action,target_id) VALUES(target,'SUPER_ADMIN_BOOTSTRAPPED',target);
 RETURN target;
END $$;
CREATE OR REPLACE FUNCTION transition_campaign(p_actor uuid,p_id uuid,p_version integer,p_action text,p_reason text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE c ad_campaigns%ROWTYPE; next_state text;
BEGIN
 SELECT * INTO c FROM ad_campaigns WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 IF c.version<>p_version THEN RAISE EXCEPTION 'CONFLICT'; END IF;
 IF p_action='submit' AND c.status IN ('DRAFT','REJECTED') THEN next_state:='PENDING_REVIEW';
 ELSIF p_action='approve' AND c.status='PENDING_REVIEW' THEN next_state:='APPROVED';
 ELSIF p_action='reject' AND c.status='PENDING_REVIEW' THEN next_state:='REJECTED';
 ELSIF p_action='activate' AND c.status IN ('APPROVED','PAUSED') AND EXISTS(SELECT 1 FROM ad_creatives WHERE campaign_id=c.id AND review_status='APPROVED') AND c.end_at>now() THEN next_state:='ACTIVE';
 ELSIF p_action='pause' AND c.status='ACTIVE' THEN next_state:='PAUSED';
 ELSIF p_action='complete' AND c.status IN ('ACTIVE','PAUSED','APPROVED') THEN next_state:='COMPLETED';
 ELSE RAISE EXCEPTION 'INVALID_TRANSITION'; END IF;
 IF p_action IN ('approve','reject') THEN
  IF c.created_by=p_actor OR c.updated_by=p_actor THEN RAISE EXCEPTION 'SELF_REVIEW'; END IF;
  UPDATE ad_creatives SET review_status=CASE WHEN p_action='approve' THEN 'APPROVED' ELSE 'REJECTED' END WHERE campaign_id=c.id;
  INSERT INTO ad_reviews(campaign_id,reviewer_id,decision,reason) VALUES(c.id,p_actor,p_action,p_reason);
 END IF;
 UPDATE ad_campaigns SET status=next_state,version=version+1,updated_at=now() WHERE id=p_id;
 INSERT INTO admin_audit(actor_id,action,target_id,metadata) VALUES(p_actor,'CAMPAIGN_'||upper(p_action),p_id,jsonb_build_object('previous',c.status,'state',next_state,'reason',p_reason));
 RETURN jsonb_build_object('id',p_id,'status',next_state,'version',c.version+1);
END $$;

