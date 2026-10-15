-- Close Friends: each person keeps a private list, and can share a Story with that list only
-- (audience 'close_friends'). The list is never shown to anyone but its owner; a Story's
-- audience is enforced on the server everywhere a Story can be seen (stories/audience.ts).
CREATE TABLE close_friends (
    owner_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    friend_id   uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_id, friend_id),
    CONSTRAINT close_friends_not_self CHECK (owner_id <> friend_id)
);
CREATE INDEX close_friends_friend_idx ON close_friends (friend_id);

ALTER TABLE stories DROP CONSTRAINT stories_audience_valid;
ALTER TABLE stories ADD CONSTRAINT stories_audience_valid CHECK (audience IN ('public', 'followers', 'close_friends'));
