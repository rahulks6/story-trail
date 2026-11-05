-- Video trimming in the Story editor. The app sends the part of the video to keep; the worker cuts
-- it before processing (src/modules/media/processing.ts). NULL on every video before this, and on
-- untrimmed videos: processed whole, as before. Additive.
ALTER TABLE media ADD COLUMN trim_start_ms integer CHECK (trim_start_ms >= 0);
ALTER TABLE media ADD COLUMN trim_end_ms integer;
ALTER TABLE media ADD CONSTRAINT media_trim_range CHECK (
  (trim_start_ms IS NULL AND trim_end_ms IS NULL) OR (kind = 'video' AND trim_end_ms > trim_start_ms)
);
