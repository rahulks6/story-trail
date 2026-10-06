# Backup and restore

Release gate 25. This document covers:
- what is backed up;
- how to restore it in production;
- the drill that proves a backup restores to a working database, and its recorded results.

## Status

| Part | Status | Evidence |
| --- | --- | --- |
| Restore drill: backup → restore → identical schema and data → API works on the restore | IMPLEMENTED AND VERIFIED (local PostgreSQL 16) | `backend/test/backupRestore.test.ts` (6 tests); 4 deliberate defects in the drill, each caught; recorded run on a 138 MB database (below) |
| Production backups: RDS point-in-time recovery 14 days; AWS Backup daily for 35 days and monthly for 1 year; S3 versioning | IMPLEMENTED (in `infra/`), NOT DEPLOYED | `infra/test/katkee-stack.test.ts` (backup plan, retention, encryption) |
| Restore of RDS, AWS Backup or S3 on AWS | **BLOCKED**: no AWS account. Never run. | Procedure below; run it in staging before launch |

## What is backed up

| Data | Mechanism | Recovery point | Kept |
| --- | --- | --- | --- |
| PostgreSQL: accounts, Stories, Highlights, messages, moderation, audit, analytics | RDS automated backups with transaction logs: point-in-time restore | Any second in the window. RDS archives transaction logs about every 5 minutes, so up to ~5 minutes can be lost | 14 days |
| PostgreSQL | AWS Backup snapshots, encrypted with the stack's KMS key | Daily 01:00 IST; monthly on the 1st | 35 days (daily), 1 year (monthly) |
| PostgreSQL at stack deletion | Final snapshot (`RemovalPolicy.SNAPSHOT`) and deletion protection | Deletion time | Until deleted by hand |
| Media in S3: originals and variants | Versioning (overwritten and deleted objects stay as old versions) plus AWS Backup | Immediate (versions) / daily | 30 days (old versions), 35 days / 1 year (AWS Backup) |
| Secrets, KMS key, logs bucket | Retained when the stack is deleted (`RETAIN`) | | |

Stories expire after 24 hours by design, and retention deletes some data on schedule
(`RETENTION_*`). A restore brings back what existed at the restore point, including Stories
that have since expired. They stay hidden, because expiry is computed from their timestamps.

## Restoring the database on AWS

The `<…>` values are stack outputs (`infra/README.md`). A restore always creates a **new**
instance: the damaged one stays untouched until the restore is verified.

1. **Restore** to a point in time, just before the incident:
   ```sh
   aws rds restore-db-instance-to-point-in-time \
     --source-db-instance-identifier <DatabaseInstanceId> \
     --target-db-instance-identifier katkee-restore-20261006 \
     --restore-time 2026-10-06T08:00:00Z \
     --db-subnet-group-name <DatabaseSubnetGroup> \
     --vpc-security-group-ids <DatabaseSecurityGroup> \
     --db-parameter-group-name <DatabaseParameterGroup> \
     --ca-certificate-identifier rds-ca-rsa2048-g1 \
     --multi-az --no-publicly-accessible --deletion-protection
   aws rds wait db-instance-available --db-instance-identifier katkee-restore-20261006
   ```
   - Instead of `--restore-time`, `--use-latest-restorable-time` restores to the newest point.
   - To restore an AWS Backup recovery point instead, find it with
     `aws backup list-recovery-points-by-backup-vault --backup-vault-name <BackupVaultName>`,
     then run `aws backup start-restore-job` with the same network settings.
   - The restore is encrypted with the same KMS key. Its users and passwords are those at the
     restore point.
2. **Point the services at it.** Deploy with `-c databaseHost=<restored endpoint>`; every
   container then uses it, still with verified TLS. Then run the migration task (`infra/README.md`
   §3.4). It must report *Nothing to do*. It also re-applies the runtime role's current password
   and grants.
3. **Check it** before letting people back in:
   - `/ready` answers 200;
   - sign in with a test account, and open a Highlight and a conversation;
   - the newest rows are older than the restore point:
     `SELECT max(created_at) FROM messages`;
   - audit history is still append-only:
     `UPDATE admin_audit SET action = action` must fail with *Audit history is append-only*.
4. **Media written after the restore point** remains in S3 without rows; it is harmless. Media
   **deleted** after the restore point (by retention or by its owner) has rows again but no
   objects. List the keys the restored database references:
   ```sql
   SELECT storage_key FROM media WHERE purged_at IS NULL AND original_purged_at IS NULL
   UNION SELECT v->>'key' FROM media, jsonb_each(variants) AS e(name, v) WHERE purged_at IS NULL;
   ```
   Check each key with `aws s3api head-object`. Bring back a missing one by deleting its delete
   marker: `aws s3api list-object-versions --prefix <key>`, then
   `aws s3api delete-object --key <key> --version-id <delete-marker-version>`. Old versions are
   kept 30 days; for older losses, use AWS Backup.
5. **Afterwards**: the stack's alarms still watch the original instance. Plan a follow-up
   change that makes the restored instance the stack's own (restore from a snapshot of it), then
   remove `databaseHost` and delete the damaged instance.

A **single object** deleted or overwritten by mistake comes back the same way as in step 4. To
restore the **whole bucket**, AWS Backup restores into a new bucket. Copy what is needed back,
or point `MEDIA_S3_BUCKET` and the CloudFront origin at the new bucket in a stack change.

## Logical backups (pg_dump)

For moving data between instances, or keeping an export outside AWS:

```sh
pg_dump --format=custom --no-owner --no-privileges --file katkee.dump        # one consistent snapshot
createdb katkee_new && pg_restore --exit-on-error --single-transaction --no-owner --no-privileges -d katkee_new katkee.dump
DB_RUNTIME_USER=katkee_app DB_RUNTIME_PASSWORD=… PGDATABASE=katkee_new node dist/scripts/migrate.js
```

- `--no-owner --no-privileges` leaves out roles and grants. The migration runner recreates the
  runtime role's grants.
- `pg_dump` must be the server's major version or newer. The API image's `psql`
  (postgresql-client 15) is enough for migrations but not for dumping PostgreSQL 16.

## The drill

`backend/scripts/restore-drill.ts` runs the whole path and fails on any difference:

```sh
node dist/scripts/restore-drill.js <new-database> [--keep] [--report report.json]   # PG* settings choose the server and source
```

1. `pg_dump` (custom format, one snapshot).
2. A new database, then `pg_restore` in a single transaction, so a damaged backup restores
   nothing and leaves no database behind.
3. The migration runner on the restore: nothing to apply. With `DB_RUNTIME_USER` set, it also
   re-grants the runtime role.
4. Fingerprints of both databases, compared:
   - schema: extensions, columns, constraints, indexes, triggers, functions and sequences;
   - data: row count and a checksum of every row, per table.
5. A JSON report. A restore that differs is kept for inspection. The drill never writes to the
   source and never touches an existing database.

Run it against staging, or against a restored copy, not the production instance: it reads the
whole database and needs CREATEDB.

### Tests

`backend/test/backupRestore.test.ts`, part of the integration suite:

1. A database with real activity is restored identically, and migrations find nothing to do.
   The activity is accounts, a follow, a photo Story, a Highlight, a two-way conversation and
   audit history.
2. The API, started on the restore, signs the person in and returns their Highlight and both
   messages.
3. Audit history is still append-only on the restore (the trigger came back).
4. The comparison catches a deleted message and a dropped trigger, and reports exactly those two
   differences.
5. A truncated backup restores nothing and leaves no database behind.
6. The drill refuses an existing database name and the source itself.

Deliberately breaking the drill, one defect at a time, makes these tests fail in all four cases:
- keeping a failed restore;
- ignoring data;
- ignoring triggers;
- dropping a database it did not create.

### Recorded run

`docs/backup-drills/2026-10-06T14-43-16Z-local-138MB.json`. The source was a copy of an
integration-test database plus synthetic load:
- 20,000 accounts;
- 10,000 conversations;
- 300,000 messages;
- 330,462 rows in 66 tables, 138 MB on disk.

| Step | Result |
| --- | --- |
| Dump | 22.0 MB custom format, 1.8 s, sha256 recorded |
| Restore | 2.9 s, single transaction |
| Migrations on the restore | *Nothing to do* |
| Verification | 3.1 s, 66 tables, **0 differences** |

This is a laptop-class container on local disk. It shows the procedure works and gives a
throughput floor; it is not the production recovery time. RDS restore time depends on instance
size and storage and must be measured in staging before launch (**BLOCKED** here).

## Targets to confirm in staging

| | Target | Basis |
| --- | --- | --- |
| Recovery point (database) | ≤ 5 minutes | RDS archives transaction logs about every 5 minutes |
| Recovery point (media) | 0 for overwrites and deletes within 30 days | S3 versioning |
| Recovery time | To be measured: restore + verification + switch-over | Staging drill (BLOCKED here) |
| Drill frequency | Quarterly, and before migrations that rewrite data | |
