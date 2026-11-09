-- The app's world languages (mobile/src/i18n): Spanish, Portuguese (Brazil), Indonesian, French,
-- German and Arabic, besides English, Hindi and Marathi. users.locale is what pushes and emails
-- are written in (shared/locale.ts); widen its check to match.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_locale_check;
ALTER TABLE users ADD CONSTRAINT users_locale_check
  CHECK (locale IN ('en', 'hi', 'mr', 'es', 'pt', 'id', 'fr', 'de', 'ar'));
