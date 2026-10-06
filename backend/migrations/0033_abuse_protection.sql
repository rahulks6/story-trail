-- Phase 4b: domains that can't be linked anywhere on Katkee (managed in the Admin console;
-- every change is audited). Matching covers subdomains: blocking example.com blocks
-- www.example.com and evil.example.com.
CREATE TABLE blocked_link_domains (
  domain      text PRIMARY KEY CHECK (domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' AND char_length(domain) <= 253),
  reason      text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 300),
  created_by  uuid NOT NULL REFERENCES users (id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Repeated identical comments from one account (copy-paste spam) are looked up by author.
CREATE INDEX story_comments_author_recent_idx ON story_comments (user_id, created_at DESC);
