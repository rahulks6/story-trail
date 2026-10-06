-- Phase 6c: keep the iPhone app-icon badge in step with what is unread.
--
-- iOS shows the badge number carried by the latest push, so after someone read their
-- Activity or a conversation in the app, the icon kept the old count until the next push
-- arrived. Reading now queues a 'badge' push: no text and no sound, only the current
-- unread total (computed when it is sent), and only to the person's iPhones; Android
-- launchers count the notifications in the tray instead. At most one is waiting per
-- person, a few seconds after the read, so reading several conversations in a row sends
-- a single update. (A failed send that is retried no longer counts as waiting, so its
-- retry never collides with a newer update; both would carry the same current total.)
ALTER TABLE push_outbox DROP CONSTRAINT push_outbox_kind_check;
ALTER TABLE push_outbox ADD CONSTRAINT push_outbox_kind_check
    CHECK (kind IN ('like', 'comment', 'follow', 'follow_request', 'mention', 'message', 'badge'));

CREATE UNIQUE INDEX push_outbox_one_queued_badge ON push_outbox (user_id) WHERE kind = 'badge' AND status = 'queued' AND attempts = 0;

-- Called where a read lowers someone's unread total (notifications and conversations
-- repositories). Does nothing for people with no active iPhone, so it never wakes the
-- push worker for them.
CREATE FUNCTION queue_badge_update(p_user uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM push_devices WHERE user_id = p_user AND platform = 'ios' AND disabled_at IS NULL) THEN
        INSERT INTO push_outbox (user_id, kind, run_after)
        VALUES (p_user, 'badge', now() + interval '3 seconds')
        ON CONFLICT (user_id) WHERE kind = 'badge' AND status = 'queued' AND attempts = 0 DO NOTHING;
    END IF;
END $$;
