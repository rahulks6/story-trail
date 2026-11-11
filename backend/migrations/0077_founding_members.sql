-- Founding members: the first 1,000 real accounts get a number (#1 to #1000) for a badge on
-- their profile. Numbers follow sign-up order and are never reused or renumbered, so a deleted
-- account's number stays with it. Automated test accounts (support+e2e-…@katkee.com, as in
-- analytics/people.ts) never get one.
ALTER TABLE users ADD COLUMN founding_number integer UNIQUE CHECK (founding_number BETWEEN 1 AND 1000);

UPDATE users u SET founding_number = n.rn
FROM (
  SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn
  FROM users
  WHERE NOT (coalesce(email, '') ~* '^support\+e2e-[a-z0-9-]{1,40}@katkee\.com$')
) n
WHERE u.id = n.id AND n.rn <= 1000;

-- Each new account takes the next number while there are any left. The lock makes two sign-ups
-- at the same moment take turns instead of one failing on the unique number.
CREATE FUNCTION assign_founding_number() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE next_number integer;
BEGIN
  IF NEW.founding_number IS NOT NULL OR coalesce(NEW.email, '') ~* '^support\+e2e-[a-z0-9-]{1,40}@katkee\.com$' THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('katkee_founding_number'));
  SELECT coalesce(max(founding_number), 0) + 1 INTO next_number FROM users;
  IF next_number <= 1000 THEN NEW.founding_number := next_number; END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER users_founding_number BEFORE INSERT ON users
  FOR EACH ROW EXECUTE FUNCTION assign_founding_number();
