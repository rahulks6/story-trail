-- Story filters are applied to the pixels while the media is processed
-- (src/modules/media/filters.ts), so every viewer sees the same picture. The filter chosen in the
-- editor travels with the upload; 'original' (every row before this migration) means none, and
-- such media keeps being shown with the app's light tint for its Story's filter.
ALTER TABLE media ADD COLUMN filter TEXT NOT NULL DEFAULT 'original';
