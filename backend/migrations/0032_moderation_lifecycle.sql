-- Phase 4a: the report lifecycle in the spec's vocabulary, report priority, moderator notes,
-- appeals that move reports to APPEALED and then CLOSED (or reverse the action), impersonation
-- and scam reports, and DM evidence that a reporter chooses to attach (the documented safety
-- workflow: moderators see only those messages, with a dedicated permission, and every view
-- is audited). Additive except for the status values, which are renamed in place.

-- 1. OPEN, UNDER_REVIEW, ACTIONED, DISMISSED, APPEALED, CLOSED.
ALTER TABLE reports DROP CONSTRAINT reports_status_valid;
UPDATE reports SET status = CASE status
  WHEN 'pending' THEN 'OPEN' WHEN 'under_review' THEN 'UNDER_REVIEW' WHEN 'dismissed' THEN 'DISMISSED'
  WHEN 'actioned' THEN 'ACTIONED' WHEN 'appealed' THEN 'APPEALED' WHEN 'closed' THEN 'CLOSED' ELSE status END;
ALTER TABLE reports ALTER COLUMN status SET DEFAULT 'OPEN';
ALTER TABLE reports ADD CONSTRAINT reports_status_valid
  CHECK (status IN ('OPEN', 'UNDER_REVIEW', 'ACTIONED', 'DISMISSED', 'APPEALED', 'CLOSED'));

-- 2. Report categories: impersonation and scams join the existing reasons.
ALTER TABLE reports DROP CONSTRAINT reports_reason_valid;
ALTER TABLE reports ADD CONSTRAINT reports_reason_valid CHECK (reason IN (
  'spam', 'harassment', 'nudity', 'violence', 'hate_speech', 'self_harm', 'impersonation', 'scam', 'other'));

-- 3. One open report per reporter and target: repeats don't flood the queue. Existing
--    duplicates are closed (kept as records), the oldest stays open.
UPDATE reports r SET status = 'CLOSED', resolution_note = 'Duplicate report closed by migration 0032.', updated_at = now()
WHERE r.status IN ('OPEN', 'UNDER_REVIEW') AND EXISTS (
  SELECT 1 FROM reports o
  WHERE o.reporter_id = r.reporter_id AND o.target_type = r.target_type AND o.target_id = r.target_id
    AND o.status IN ('OPEN', 'UNDER_REVIEW') AND (o.created_at, o.id) < (r.created_at, r.id));
CREATE UNIQUE INDEX reports_one_open_per_reporter ON reports (reporter_id, target_type, target_id)
  WHERE status IN ('OPEN', 'UNDER_REVIEW');

-- Where a report came from: in-app content, a DM thread (with attached messages) or an ad.
ALTER TABLE reports ADD COLUMN source text NOT NULL DEFAULT 'content' CHECK (source IN ('content', 'direct_message', 'ad'));
UPDATE reports SET source = 'ad' WHERE target_type = 'ad';

-- 4. Priority 0-3 from how serious the reason is, plus one when three or more people have
--    reported the same thing. Set on every insert path (app reports, ad reports, DM reports).
CREATE FUNCTION report_reason_priority(p_reason text) RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_reason WHEN 'self_harm' THEN 3 WHEN 'violence' THEN 2 WHEN 'hate_speech' THEN 2 WHEN 'nudity' THEN 2
    WHEN 'harassment' THEN 1 WHEN 'impersonation' THEN 1 WHEN 'scam' THEN 1 ELSE 0 END
$$;
CREATE FUNCTION reports_set_priority() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE reporters integer;
BEGIN
  IF NEW.target_type = 'ad' THEN NEW.source := 'ad'; END IF;
  SELECT count(DISTINCT reporter_id) + 1 INTO reporters FROM reports
  WHERE target_type = NEW.target_type AND target_id = NEW.target_id AND status IN ('OPEN', 'UNDER_REVIEW') AND reporter_id <> NEW.reporter_id;
  NEW.priority := LEAST(3, GREATEST(NEW.priority, report_reason_priority(NEW.reason) + CASE WHEN reporters >= 3 THEN 1 ELSE 0 END));
  IF reporters >= 3 THEN
    UPDATE reports SET priority = LEAST(3, GREATEST(priority, report_reason_priority(reason) + 1)), updated_at = now()
    WHERE target_type = NEW.target_type AND target_id = NEW.target_id AND status IN ('OPEN', 'UNDER_REVIEW');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER reports_priority BEFORE INSERT ON reports FOR EACH ROW EXECUTE FUNCTION reports_set_priority();
UPDATE reports SET priority = GREATEST(priority, report_reason_priority(reason)) WHERE status IN ('OPEN', 'UNDER_REVIEW');

-- 5. Moderator notes: append-only, shown with the report and the target's history.
CREATE TABLE moderation_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid REFERENCES reports (id),
  target_type text NOT NULL,
  target_id uuid NOT NULL,
  author_id uuid NOT NULL REFERENCES users (id),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX moderation_notes_target_idx ON moderation_notes (target_type, target_id, created_at DESC);
CREATE TRIGGER moderation_notes_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON moderation_notes
  FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_mutation();

-- 6. Appeals: opening one moves the report to APPEALED; the decision closes it, and an upheld
--    appeal reverses the action in the same transaction.
ALTER TABLE moderation_appeals ADD COLUMN reviewed_at timestamptz;
CREATE FUNCTION moderation_appeal_opened() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE reports SET status = 'APPEALED', version = version + 1, updated_at = now()
  WHERE id = (SELECT report_id FROM moderation_actions WHERE id = NEW.action_id) AND status = 'ACTIONED';
  RETURN NEW;
END $$;
CREATE TRIGGER moderation_appeals_opened AFTER INSERT ON moderation_appeals FOR EACH ROW EXECUTE FUNCTION moderation_appeal_opened();

-- Only actions that took something away can be appealed.
CREATE FUNCTION moderation_action_appealable(p_action text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT p_action IN ('remove', 'restrict', 'suspend')
$$;

CREATE FUNCTION admin_review_appeal(p_actor uuid, p_appeal uuid, p_version integer, p_decision text, p_reason text)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE a moderation_appeals%ROWTYPE; act moderation_actions%ROWTYPE; reversed boolean := false; reversal uuid; owner uuid;
BEGIN
  SELECT * INTO a FROM moderation_appeals WHERE id = p_appeal FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF a.status <> 'OPEN' OR a.version <> p_version THEN RAISE EXCEPTION 'CONFLICT'; END IF;
  SELECT * INTO act FROM moderation_actions WHERE id = a.action_id;
  IF p_decision = 'UPHELD' THEN
    -- The appeal succeeds: undo what the action took away, if it can still be undone.
    IF act.action = 'remove' AND act.target_type IN ('story', 'comment') THEN
      IF act.target_type = 'story' THEN
        SELECT owner_id INTO owner FROM stories WHERE id = act.target_id AND moderation_removed_at IS NOT NULL AND deleted_at = moderation_removed_at FOR UPDATE;
        IF FOUND AND EXISTS (SELECT 1 FROM users WHERE id = owner AND deleted_at IS NULL AND is_active) THEN
          UPDATE stories SET deleted_at = NULL, moderation_removed_at = NULL WHERE id = act.target_id; reversed := true;
        END IF;
      ELSE
        SELECT user_id INTO owner FROM story_comments WHERE id = act.target_id AND moderation_removed_at IS NOT NULL AND deleted_at = moderation_removed_at FOR UPDATE;
        IF FOUND AND EXISTS (SELECT 1 FROM users WHERE id = owner AND deleted_at IS NULL AND is_active) THEN
          UPDATE story_comments SET deleted_at = NULL, moderation_removed_at = NULL WHERE id = act.target_id; reversed := true;
        END IF;
      END IF;
    ELSIF act.action = 'remove' AND act.target_type = 'ad' THEN
      UPDATE ad_creatives SET review_status = 'APPROVED' WHERE id = act.target_id AND review_status = 'REMOVED';
      reversed := FOUND; -- the campaign stays paused until someone resumes it
    ELSIF act.action IN ('restrict', 'suspend') AND act.target_type = 'user' THEN
      UPDATE users SET moderation_state = 'ACTIVE', is_active = true
      WHERE id = act.target_id AND deleted_at IS NULL AND moderation_state = (act.new_state ->> 'state');
      reversed := FOUND;
    END IF;
    IF reversed THEN
      INSERT INTO moderation_actions (report_id, actor_id, target_type, target_id, action, reason, previous_state, new_state)
      VALUES (act.report_id, p_actor, act.target_type, act.target_id, 'appeal_reversal', p_reason,
              jsonb_build_object('reversedAction', act.id), jsonb_build_object('state', 'ACTIVE'))
      RETURNING id INTO reversal;
    END IF;
  ELSIF p_decision <> 'DENIED' THEN
    RAISE EXCEPTION 'INVALID_DECISION';
  END IF;
  UPDATE moderation_appeals SET status = p_decision, resolution = p_reason, reviewer_id = p_actor, reviewed_at = now(), version = version + 1
  WHERE id = p_appeal;
  UPDATE reports SET status = 'CLOSED', version = version + 1, updated_at = now()
  WHERE id = act.report_id AND status IN ('APPEALED', 'ACTIONED');
  INSERT INTO admin_audit (actor_id, action, target_id, metadata)
  VALUES (p_actor, 'APPEAL_' || p_decision, p_appeal,
          jsonb_build_object('actionId', act.id, 'reportId', act.report_id, 'reversed', reversed, 'reversalActionId', reversal, 'resolution', p_reason));
  RETURN jsonb_build_object('appealId', p_appeal, 'decision', p_decision, 'reversed', reversed, 'reversalActionId', reversal);
END $$;

-- 7. The atomic moderation function, with the new status names.
CREATE OR REPLACE FUNCTION admin_moderate(p_actor uuid,p_report uuid,p_version integer,p_type text,p_target uuid,p_action text,p_reason text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r reports%ROWTYPE; old_state jsonb; new_state jsonb; affected uuid; action_id uuid; ts timestamptz:=clock_timestamp();
BEGIN
 IF p_report IS NOT NULL THEN
  SELECT * INTO r FROM reports WHERE id=p_report FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF r.version<>p_version OR r.status NOT IN ('OPEN','UNDER_REVIEW') THEN RAISE EXCEPTION 'CONFLICT'; END IF;
  p_type:=r.target_type; p_target:=r.target_id;
 END IF;
 -- Lock the target too, so separate reports for the same content cannot conflict.
 IF p_type='story' THEN
  SELECT to_jsonb(s),owner_id INTO old_state,affected FROM stories s WHERE id=p_target FOR UPDATE;
 ELSIF p_type='comment' THEN
  SELECT to_jsonb(c),user_id INTO old_state,affected FROM story_comments c WHERE id=p_target FOR UPDATE;
 ELSIF p_type='user' THEN
  SELECT jsonb_build_object('moderation_state',moderation_state,'is_active',is_active,'deleted_at',deleted_at),id INTO old_state,affected FROM users WHERE id=p_target FOR UPDATE;
 ELSIF p_type='ad' THEN
  SELECT to_jsonb(c),a.user_id INTO old_state,affected FROM ad_creatives c JOIN ad_campaigns k ON k.id=c.campaign_id JOIN advertisers a ON a.id=k.advertiser_id WHERE c.id=p_target FOR UPDATE OF c;
 ELSE RAISE EXCEPTION 'INVALID_TARGET'; END IF;
 IF old_state IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 IF p_action IN ('restrict','suspend','restore_account') AND (p_type<>'user' OR p_target=p_actor OR EXISTS(SELECT 1 FROM admin_grants WHERE user_id=p_target AND enabled)) THEN RAISE EXCEPTION 'PROTECTED_TARGET'; END IF;
 IF p_action='remove' THEN
  IF p_type='story' THEN
   IF old_state->>'deleted_at' IS NOT NULL THEN RAISE EXCEPTION 'CONFLICT'; END IF;
   UPDATE stories SET deleted_at=ts,moderation_removed_at=ts WHERE id=p_target;
  ELSIF p_type='comment' THEN
   IF old_state->>'deleted_at' IS NOT NULL THEN RAISE EXCEPTION 'CONFLICT'; END IF;
   UPDATE story_comments SET deleted_at=ts,moderation_removed_at=ts WHERE id=p_target;
  ELSIF p_type='ad' THEN
   IF old_state->>'review_status'='REMOVED' THEN RAISE EXCEPTION 'CONFLICT'; END IF;
   UPDATE ad_creatives SET review_status='REMOVED' WHERE id=p_target;
   UPDATE ad_campaigns SET status='PAUSED',version=version+1,updated_at=now() WHERE id=(old_state->>'campaign_id')::uuid;
  ELSE RAISE EXCEPTION 'INVALID_ACTION'; END IF;
  new_state:=jsonb_build_object('state','REMOVED_BY_MODERATION');
 ELSIF p_action='restore' THEN
  IF p_type NOT IN ('story','comment') OR old_state->>'moderation_removed_at' IS NULL OR old_state->>'deleted_at' IS DISTINCT FROM old_state->>'moderation_removed_at' THEN RAISE EXCEPTION 'RESTORE_NOT_ALLOWED'; END IF;
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=affected AND deleted_at IS NULL AND is_active) THEN RAISE EXCEPTION 'RESTORE_NOT_ALLOWED'; END IF;
  IF p_type='story' THEN UPDATE stories SET deleted_at=NULL,moderation_removed_at=NULL WHERE id=p_target;
  ELSE UPDATE story_comments SET deleted_at=NULL,moderation_removed_at=NULL WHERE id=p_target; END IF;
  new_state:=jsonb_build_object('state','ACTIVE');
 ELSIF p_action IN ('restrict','suspend','restore_account') THEN
  new_state:=jsonb_build_object('state',CASE p_action WHEN 'restrict' THEN 'RESTRICTED' WHEN 'suspend' THEN 'SUSPENDED' ELSE 'ACTIVE' END);
  IF old_state->>'deleted_at' IS NOT NULL OR old_state->>'moderation_state'=new_state->>'state' THEN RAISE EXCEPTION 'CONFLICT'; END IF;
  UPDATE users SET moderation_state=new_state->>'state',is_active=(p_action<>'suspend') WHERE id=p_target;
  IF p_action='suspend' THEN
   UPDATE refresh_tokens SET revoked_at=now() WHERE user_id=p_target AND revoked_at IS NULL;
   DELETE FROM admin_sessions WHERE user_id=p_target;
  END IF;
 ELSIF p_action='keep' AND p_report IS NOT NULL THEN new_state:=jsonb_build_object('state','UNCHANGED');
 ELSE RAISE EXCEPTION 'INVALID_ACTION'; END IF;
 IF p_report IS NOT NULL THEN
  UPDATE reports SET status=CASE WHEN p_action='keep' THEN 'DISMISSED' ELSE 'ACTIONED' END,version=version+1,updated_at=now(),reviewed_by=p_actor,reviewed_at=now(),resolution_note=p_reason WHERE id=p_report;
  IF p_action<>'keep' THEN UPDATE reports SET status='ACTIONED',version=version+1,updated_at=now(),reviewed_by=p_actor,reviewed_at=now(),resolution_note=p_reason WHERE target_type=p_type AND target_id=p_target AND id<>p_report AND status IN ('OPEN','UNDER_REVIEW'); END IF;
 END IF;
 -- Retain only moderation state in history, never account credentials or private message content.
 INSERT INTO moderation_actions(report_id,actor_id,target_type,target_id,action,reason,previous_state,new_state)
 VALUES(p_report,p_actor,p_type,p_target,p_action,p_reason,jsonb_build_object('deleted_at',old_state->'deleted_at','moderation_state',old_state->'moderation_state','review_status',old_state->'review_status'),new_state) RETURNING id INTO action_id;
 INSERT INTO admin_audit(actor_id,action,target_id,metadata) VALUES(p_actor,'MODERATION_'||upper(p_action),p_target,jsonb_build_object('actionId',action_id,'reportId',p_report,'reason',p_reason));
 IF p_action<>'keep' THEN INSERT INTO moderation_notices(user_id,action_id) VALUES(affected,action_id); END IF;
 RETURN jsonb_build_object('actionId',action_id,'state',new_state);
END $$;

-- 8. DM evidence the reporter attached: a snapshot of the chosen messages (the report keeps
--    them even if the conversation changes). Reports know where they came from.
CREATE TABLE report_message_evidence (
  report_id       uuid NOT NULL REFERENCES reports (id) ON DELETE CASCADE,
  message_id      uuid NOT NULL,
  conversation_id uuid NOT NULL,
  sender_id       uuid NOT NULL,
  body            text,
  shared_story_id uuid,
  sent_at         timestamptz NOT NULL,
  captured_at     timestamptz NOT NULL DEFAULT now(),
  -- Retention clears the text 180 days after the report is resolved (see media/retention.ts).
  purged_at       timestamptz,
  PRIMARY KEY (report_id, message_id)
);
CREATE INDEX report_message_evidence_purge_idx ON report_message_evidence (captured_at) WHERE purged_at IS NULL;
