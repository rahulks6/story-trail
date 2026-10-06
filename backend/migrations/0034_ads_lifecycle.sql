-- Phase 4c: the View Profile CTA, broad non-sensitive audiences enforced at delivery, and
-- automatic completion when a campaign's end date passes or its impressions run out.

-- 1. View Profile opens the advertiser's Katkee profile, so it needs no external destination.
ALTER TABLE ad_creatives DROP CONSTRAINT IF EXISTS ad_creatives_cta_check;
ALTER TABLE ad_creatives ADD CONSTRAINT ad_creatives_cta_check
  CHECK (cta IN ('Learn More', 'Visit Website', 'Shop Now', 'Install', 'View Profile'));

-- 2. Audiences: a fixed list of non-sensitive interest categories, and platforms. Nothing
--    else can be targeted: no religion, health, sexual orientation, politics or other
--    sensitive traits, no free-text interests, and never anything from private messages.
CREATE TABLE ad_interest_categories (
  key   text PRIMARY KEY CHECK (key ~ '^[a-z_]{2,30}$'),
  label text NOT NULL UNIQUE
);
INSERT INTO ad_interest_categories (key, label) VALUES
  ('food', 'Food'), ('travel', 'Travel'), ('fashion', 'Fashion'), ('beauty', 'Beauty'), ('fitness', 'Fitness'),
  ('sports', 'Sports'), ('music', 'Music'), ('movies', 'Movies & TV'), ('gaming', 'Gaming'), ('technology', 'Technology'),
  ('art', 'Art & design'), ('photography', 'Photography'), ('books', 'Books'), ('cars', 'Cars'), ('pets', 'Pets'),
  ('home', 'Home & garden'), ('education', 'Education'), ('business', 'Business'), ('comedy', 'Comedy'), ('dance', 'Dance');

-- {"interests": ["travel", ...], "platforms": ["android", "ios"]}; empty means everyone.
ALTER TABLE ad_campaigns ADD COLUMN audience jsonb NOT NULL DEFAULT '{}'::jsonb
  CHECK (jsonb_typeof(audience) = 'object');

-- The viewer interest that matched (its category label), or NULL when the campaign is
-- broad or nothing matches. Only exact matches on the category list count.
CREATE FUNCTION ad_matched_interest(p_audience jsonb, p_viewer uuid) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT cat.label
  FROM users u
  CROSS JOIN LATERAL jsonb_array_elements_text(u.interests_json::jsonb) ui(v)
  JOIN ad_interest_categories cat ON lower(trim(ui.v)) IN (cat.key, lower(cat.label))
  WHERE u.id = p_viewer AND (p_audience -> 'interests') ? cat.key
  ORDER BY cat.key LIMIT 1
$$;

CREATE FUNCTION ad_audience_matches(p_audience jsonb, p_viewer uuid, p_platform text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT (coalesce(jsonb_array_length(p_audience -> 'platforms'), 0) = 0 OR (p_audience -> 'platforms') ? coalesce(p_platform, ''))
     AND (coalesce(jsonb_array_length(p_audience -> 'interests'), 0) = 0 OR ad_matched_interest(p_audience, p_viewer) IS NOT NULL)
$$;

-- 3. Delivery honours the audience (the app sends its platform).
DROP FUNCTION reserve_ad(uuid, integer);
CREATE FUNCTION reserve_ad(p_viewer uuid, p_slot integer, p_platform text DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql AS $$
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
 AND ad_audience_matches(k.audience, p_viewer, p_platform)
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

-- 4. Campaigns whose end date passed, or whose impressions ran out, become COMPLETED
--    (delivery already stops at both; this keeps the status and audit history honest).
CREATE FUNCTION complete_finished_campaigns() RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  WITH done AS (
    UPDATE ad_campaigns k SET status = 'COMPLETED', version = version + 1, updated_at = now()
    WHERE k.status IN ('ACTIVE', 'PAUSED', 'APPROVED')
      AND (k.end_at <= now() OR (SELECT count(*) FROM ad_deliveries d WHERE d.campaign_id = k.id) >= k.impression_limit)
    RETURNING k.id, k.end_at <= now() AS ended),
  audit AS (
    INSERT INTO admin_audit (actor_id, action, target_id, metadata)
    SELECT NULL, 'CAMPAIGN_COMPLETED', id, jsonb_build_object('reason', CASE WHEN ended THEN 'end_date' ELSE 'impression_limit' END) FROM done)
  SELECT count(*) INTO n FROM done;
  RETURN n;
END $$;
