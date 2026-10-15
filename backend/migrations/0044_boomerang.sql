-- Boomerang: a short clip that plays forward then backward, three times. The camera uploads the
-- clip as it was recorded with effect 'boomerang', and the media worker builds the loop while it
-- processes the video (src/modules/media/processing.ts), so every viewer sees the same thing.
ALTER TABLE media ADD COLUMN effect TEXT NOT NULL DEFAULT 'none';
ALTER TABLE media ADD CONSTRAINT media_effect_valid CHECK (effect IN ('none', 'boomerang'));
ALTER TABLE media ADD CONSTRAINT media_effect_video_only CHECK (effect = 'none' OR kind = 'video');
