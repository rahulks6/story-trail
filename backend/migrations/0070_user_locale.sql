-- App languages (mobile/src/i18n): English, Hindi and Marathi. Additive; nothing changes for
-- anyone until their app sends a language.

-- 1. The language someone uses Katkee in, so pushes and emails reach them in it. The app sends it
--    at sign-up and whenever it changes (PATCH /api/v1/users/me {locale}); English until then.
ALTER TABLE users ADD COLUMN locale text NOT NULL DEFAULT 'en' CHECK (locale IN ('en', 'hi', 'mr'));

-- 2. Pushes written ahead of time (view milestones, festival greetings, streaks, nudges,
--    verification outcomes, group messages and message reactions) keep their English body, and now
--    also the values that text is made from, so the dispatcher writes it in the recipient's
--    language when it sends (src/modules/push/push-text.ts). NULL on rows queued before this, which
--    still send their body as it is.
ALTER TABLE push_outbox ADD COLUMN params jsonb;
