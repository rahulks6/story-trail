CREATE TABLE ad_viewer_sessions (viewer_id uuid PRIMARY KEY REFERENCES users(id), session_id uuid NOT NULL DEFAULT gen_random_uuid(), expires_at timestamptz NOT NULL DEFAULT now()+interval '30 minutes');
CREATE FUNCTION reserve_ad(p_viewer uuid,p_slot integer) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE cfg ad_delivery_settings%ROWTYPE; sess uuid; chosen record; delivery uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('ad-viewer:'||p_viewer::text,0));
 SELECT * INTO cfg FROM ad_delivery_settings WHERE id=1;
 IF p_slot<cfg.organic_gap OR p_slot%cfg.organic_gap<>0 THEN RETURN NULL; END IF;
 INSERT INTO ad_viewer_sessions(viewer_id) VALUES(p_viewer) ON CONFLICT(viewer_id) DO UPDATE SET session_id=CASE WHEN ad_viewer_sessions.expires_at<now() THEN gen_random_uuid() ELSE ad_viewer_sessions.session_id END,expires_at=CASE WHEN ad_viewer_sessions.expires_at<now() THEN now()+interval '30 minutes' ELSE ad_viewer_sessions.expires_at END RETURNING session_id INTO sess;
 IF EXISTS(SELECT 1 FROM ad_deliveries WHERE viewer_id=p_viewer AND session_id=sess AND slot=p_slot) THEN RETURN NULL; END IF;
 IF (SELECT count(*) FROM ad_deliveries WHERE viewer_id=p_viewer AND session_id=sess)>=cfg.session_cap OR (SELECT count(*) FROM ad_deliveries WHERE viewer_id=p_viewer AND created_at>=date_trunc('day',now()))>=cfg.daily_cap THEN RETURN NULL; END IF;
 FOR chosen IN SELECT k.*,c.id AS creative FROM ad_campaigns k JOIN ad_creatives c ON c.campaign_id=k.id JOIN advertisers a ON a.id=k.advertiser_id JOIN users u ON u.id=a.user_id JOIN media m ON m.id=c.media_id
 WHERE k.status='ACTIVE' AND c.review_status='APPROVED' AND k.start_at<=now() AND k.end_at>now() AND u.is_active AND u.deleted_at IS NULL AND NOT u.is_private AND m.status='ready'
 AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.blocker_id=p_viewer AND b.blocked_id=u.id) OR (b.blocker_id=u.id AND b.blocked_id=p_viewer))
 AND NOT EXISTS(SELECT 1 FROM ad_hides WHERE viewer_id=p_viewer AND creative_id=c.id)
 ORDER BY k.updated_at,k.id FOR UPDATE OF k SKIP LOCKED LOOP
  IF (SELECT count(*) FROM ad_deliveries WHERE campaign_id=chosen.id)>=chosen.impression_limit THEN CONTINUE; END IF;
  IF (SELECT count(*) FROM ad_deliveries WHERE campaign_id=chosen.id AND viewer_id=p_viewer)>=chosen.user_cap THEN CONTINUE; END IF;
  IF (SELECT count(*) FROM ad_deliveries WHERE campaign_id=chosen.id AND viewer_id=p_viewer AND created_at>=date_trunc('day',now()))>=chosen.daily_cap THEN CONTINUE; END IF;
  INSERT INTO ad_deliveries(viewer_id,campaign_id,creative_id,session_id,slot) VALUES(p_viewer,chosen.id,chosen.creative,sess,p_slot) RETURNING id INTO delivery;
  INSERT INTO ad_events(delivery_id,event_type) VALUES(delivery,'ad_requested');
  RETURN delivery;
 END LOOP;
 RETURN NULL;
END $$;
CREATE FUNCTION transition_campaign(p_actor uuid,p_id uuid,p_version integer,p_action text,p_reason text) RETURNS jsonb LANGUAGE plpgsql AS $$
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
  IF c.created_by=p_actor THEN RAISE EXCEPTION 'SELF_REVIEW'; END IF;
  UPDATE ad_creatives SET review_status=CASE WHEN p_action='approve' THEN 'APPROVED' ELSE 'REJECTED' END WHERE campaign_id=c.id;
  INSERT INTO ad_reviews(campaign_id,reviewer_id,decision,reason) VALUES(c.id,p_actor,p_action,p_reason);
 END IF;
 UPDATE ad_campaigns SET status=next_state,version=version+1,updated_at=now() WHERE id=p_id;
 INSERT INTO admin_audit(actor_id,action,target_id,metadata) VALUES(p_actor,'CAMPAIGN_'||upper(p_action),p_id,jsonb_build_object('previous',c.status,'state',next_state,'reason',p_reason));
 RETURN jsonb_build_object('id',p_id,'status',next_state,'version',c.version+1);
END $$;
