-- Transactional moderation. This function is invoked only after live API authorization.
CREATE FUNCTION admin_moderate(p_actor uuid,p_report uuid,p_version integer,p_type text,p_target uuid,p_action text,p_reason text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r reports%ROWTYPE; old_state jsonb; new_state jsonb; affected uuid; action_id uuid; ts timestamptz:=clock_timestamp();
BEGIN
 IF p_report IS NOT NULL THEN
  SELECT * INTO r FROM reports WHERE id=p_report FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF r.version<>p_version OR r.status NOT IN ('pending','under_review') THEN RAISE EXCEPTION 'CONFLICT'; END IF;
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
  UPDATE reports SET status=CASE WHEN p_action='keep' THEN 'dismissed' ELSE 'actioned' END,version=version+1,updated_at=now(),reviewed_by=p_actor,reviewed_at=now(),resolution_note=p_reason WHERE id=p_report;
  IF p_action<>'keep' THEN UPDATE reports SET status='actioned',version=version+1,updated_at=now(),reviewed_by=p_actor,reviewed_at=now(),resolution_note=p_reason WHERE target_type=p_type AND target_id=p_target AND id<>p_report AND status IN ('pending','under_review'); END IF;
 END IF;
 -- Retain only moderation state in history, never account credentials or private message content.
 INSERT INTO moderation_actions(report_id,actor_id,target_type,target_id,action,reason,previous_state,new_state)
 VALUES(p_report,p_actor,p_type,p_target,p_action,p_reason,jsonb_build_object('deleted_at',old_state->'deleted_at','moderation_state',old_state->'moderation_state','review_status',old_state->'review_status'),new_state) RETURNING id INTO action_id;
 INSERT INTO admin_audit(actor_id,action,target_id,metadata) VALUES(p_actor,'MODERATION_'||upper(p_action),p_target,jsonb_build_object('actionId',action_id,'reportId',p_report,'reason',p_reason));
 IF p_action<>'keep' THEN INSERT INTO moderation_notices(user_id,action_id) VALUES(affected,action_id); END IF;
 RETURN jsonb_build_object('actionId',action_id,'state',new_state);
END $$;
