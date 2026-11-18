-- install_source (modules/analytics/events.ts): where an install came from, in broad strokes
-- (Google ads, a Katkee invite, the Play Store), counted once per install. Never the referrer or
-- the ad click id. Added to whatever events the list already has (0066's pattern).
DO $$
DECLARE def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
   WHERE conname = 'analytics_events_name_check' AND conrelid = 'analytics_events'::regclass;
  IF def IS NULL OR position('ARRAY[' in def) = 0 THEN
    RAISE EXCEPTION 'analytics_events_name_check has an unexpected shape: %', def;
  END IF;
  IF position('''install_source''' in def) > 0 THEN
    RETURN;
  END IF;
  ALTER TABLE analytics_events DROP CONSTRAINT analytics_events_name_check;
  EXECUTE 'ALTER TABLE analytics_events ADD CONSTRAINT analytics_events_name_check '
    || replace(def, 'ARRAY[', 'ARRAY[''install_source''::text, ');
END $$;
