-- A picture description for a Story (Story settings), read out by screen readers in place of the
-- picture. Optional; NULL on every Story before this. Additive.
ALTER TABLE stories ADD COLUMN alt_text text CHECK (alt_text IS NULL OR char_length(alt_text) BETWEEN 1 AND 500);
