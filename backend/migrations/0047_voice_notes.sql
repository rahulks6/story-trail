-- Voice notes in direct messages: media of kind 'audio' (AAC in MP4), processed to one small
-- "audio" variant. They are only ever sent in messages; stories.service refuses them as Stories.
ALTER TABLE media DROP CONSTRAINT media_kind_valid;
ALTER TABLE media ADD CONSTRAINT media_kind_valid CHECK (kind IN ('photo', 'video', 'audio'));
