-- New accounts must verify their email before using Katkee (the app shows only the code screen
-- until then). Accounts that existed before this, including the store review account, keep
-- working as before: the column is false for them and true for every account created from now on.
ALTER TABLE users ADD COLUMN email_verification_required boolean NOT NULL DEFAULT false;
ALTER TABLE users ALTER COLUMN email_verification_required SET DEFAULT true;
