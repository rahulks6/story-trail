-- Phase 8a: who may take a username, and when (spec section 23).
--
-- Every rename is recorded. The name someone renames away from is held for 14 days: they may
-- take it back, nobody else may, so a handle people recognise can't be picked up straight away
-- by someone impersonating its owner. Renames are limited to two in any 14 days. Deleting an
-- account still frees its name at once, as it always has.
-- The rules are triggers on users, so every path obeys them: sign-up, Google/phone onboarding
-- and profile edits. An advisory lock per name makes a rename and a claim of the same name
-- wait for each other.
-- Additive: no existing username changes. The account scrub (retention) deletes a deleted
-- account's history with the rest of its personal data.

CREATE TABLE username_changes (
    id            bigserial PRIMARY KEY,
    user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    old_username  citext NOT NULL,
    new_username  citext NOT NULL,
    changed_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX username_changes_old_idx ON username_changes (old_username, changed_at DESC);
CREATE INDEX username_changes_user_idx ON username_changes (user_id, changed_at DESC);

CREATE FUNCTION username_hold_interval() RETURNS interval LANGUAGE sql IMMUTABLE AS $$ SELECT interval '14 days' $$;

/** Locks the names being claimed or released, in a fixed order so two swaps can't deadlock. */
CREATE FUNCTION lock_usernames(VARIADIC p_names text[]) RETURNS void LANGUAGE plpgsql AS $$
DECLARE n text;
BEGIN
    FOR n IN SELECT DISTINCT lower(x) FROM unnest(p_names) x WHERE x IS NOT NULL ORDER BY 1 LOOP
        PERFORM pg_advisory_xact_lock(hashtext('katkee.username:' || n));
    END LOOP;
END $$;

CREATE FUNCTION guard_username() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    recent integer;
    next_allowed timestamptz;
BEGIN
    -- The scrub renames deleted accounts to deleted_<id>; that is not a claim.
    IF NEW.deleted_at IS NOT NULL OR (TG_OP = 'UPDATE' AND NEW.username = OLD.username) THEN
        RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE' THEN
        PERFORM lock_usernames(OLD.username::text, NEW.username::text);
    ELSE
        PERFORM lock_usernames(NEW.username::text);
    END IF;
    IF EXISTS (SELECT 1 FROM username_changes c
               WHERE c.old_username = NEW.username AND c.user_id <> NEW.id
                 AND c.changed_at > now() - username_hold_interval()) THEN
        RAISE EXCEPTION 'USERNAME_HELD';
    END IF;
    IF TG_OP = 'UPDATE' THEN
        SELECT count(*), min(changed_at) + username_hold_interval() INTO recent, next_allowed
        FROM username_changes
        WHERE user_id = NEW.id AND changed_at > now() - username_hold_interval();
        IF recent >= 2 THEN
            RAISE EXCEPTION 'USERNAME_CHANGE_LIMIT %', to_char(next_allowed AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
        END IF;
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER users_username_guard
    BEFORE INSERT OR UPDATE OF username ON users
    FOR EACH ROW EXECUTE FUNCTION guard_username();

CREATE FUNCTION record_username_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO username_changes (user_id, old_username, new_username) VALUES (NEW.id, OLD.username, NEW.username);
    RETURN NULL;
END $$;

-- Compared as lower(text), not with citext's own operator: a dump restores trigger conditions
-- with an empty search_path, where citext's operator isn't visible and the comparison would
-- silently turn case-sensitive (the restore drill compares the two).
CREATE TRIGGER users_username_history
    AFTER UPDATE OF username ON users
    FOR EACH ROW WHEN (NEW.deleted_at IS NULL AND lower(NEW.username::text) IS DISTINCT FROM lower(OLD.username::text))
    EXECUTE FUNCTION record_username_change();

/**
 * 'available', 'yours', 'taken' or 'held' for a name the format rules already allow.
 * p_user is the person asking (NULL before sign-up): their own released names stay theirs.
 */
CREATE FUNCTION username_availability(p_username citext, p_user uuid) RETURNS text LANGUAGE sql STABLE AS $$
    SELECT CASE
        WHEN EXISTS (SELECT 1 FROM users WHERE username = p_username AND deleted_at IS NULL AND id = p_user) THEN 'yours'
        WHEN EXISTS (SELECT 1 FROM users WHERE username = p_username AND deleted_at IS NULL) THEN 'taken'
        WHEN EXISTS (SELECT 1 FROM username_changes
                     WHERE old_username = p_username AND user_id IS DISTINCT FROM p_user
                       AND changed_at > now() - username_hold_interval()) THEN 'held'
        ELSE 'available'
    END
$$;
