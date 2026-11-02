-- Public profiles on the web (src/modules/website/web-profile.ts): katkee.com/u/<username> shows a
-- public account's profile, Highlights and public Stories to anyone, signed out. Additive: the new
-- column defaults to on, which only matters for public accounts; a private account never shows.

-- 1. "Show my profile on the web" (Settings > Privacy). Off keeps the minimal "Open in Katkee"
--    page, the same one a private or unknown account gets, and keeps the profile out of search
--    engines and the sitemap.
ALTER TABLE users ADD COLUMN show_on_web boolean NOT NULL DEFAULT true;

-- 2. The profile sitemap (sitemap-profiles.xml) lists the newest accounts that show on the web.
--    Partial, so the index holds only those accounts and the sitemap never scans the rest.
CREATE INDEX users_web_profiles_idx ON users (created_at DESC)
  WHERE show_on_web AND NOT is_private AND is_active AND deleted_at IS NULL AND moderation_state = 'ACTIVE';

-- 3. How often web profiles and Stories are opened: one count per kind of page per day, nothing
--    about who opened them or which profile. A web visit is never a Story view (story_views),
--    a profile visit, or reach: those are for signed-in people only.
CREATE TABLE web_page_views (
  day date NOT NULL,
  page text NOT NULL CHECK (page IN ('profile', 'story')),
  views bigint NOT NULL DEFAULT 0 CHECK (views >= 0),
  PRIMARY KEY (day, page)
);
