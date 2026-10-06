# Katkee production infrastructure (AWS, ap-south-1)

AWS CDK code for the production environment in Mumbai. Live deployment status: **BLOCKED**. It
has never been deployed, because no AWS account is connected to this project yet. Section 9
lists what the tests cover and what only a real deploy can show.

## 1. What it creates

| Area | Resources |
| --- | --- |
| Network | VPC over 2 availability zones. The load balancer is in public subnets, tasks in private subnets, and the database in isolated subnets. Two NAT gateways, an S3 gateway endpoint, and the default security group emptied. |
| API | ECS Fargate service behind an HTTPS load balancer (TLS 1.2+, HTTP→HTTPS redirect, 120 s idle timeout for realtime sockets). Health check on `/ready`, circuit breaker with rollback, CPU autoscaling 2–10. |
| Worker | ECS Fargate service for media processing (ffmpeg), push delivery and retention. It scales 1–4 on queue depth and its health check reads a heartbeat file. |
| Migrations | A one-off Fargate task (`node dist/scripts/migrate.js`) that connects as the schema owner and keeps the runtime role current. |
| Database | PostgreSQL 16 on RDS: Multi-AZ, KMS-encrypted, TLS only (`rds.force_ssl`), 14-day point-in-time recovery, deletion protection, final snapshot, Performance Insights. Statement text is kept out of logs, because statements carry user text. |
| Database roles | `katkee_owner` (master) runs migrations only. The API and worker connect as `katkee_app`, which can read and write rows but cannot change the schema; audit history is insert-only for it (backend/scripts/runtime-role.ts). |
| Media | Private S3 bucket: Block Public Access, TLS only, versioned, abandoned uploads aborted after 2 days. It is delivered only through CloudFront with origin access control and signed URLs (trusted key group). |
| Jobs | SQS wake-up queue with a dead-letter queue. Jobs, leases and retries live in PostgreSQL. |
| Secrets | Secrets Manager, encrypted with the stack's KMS key. The stack generates the JWT secrets, the Admin MFA key, the phone identity key and both database passwords. Provider credentials are placeholders that operators fill in (section 3). |
| Edge | WAF with AWS managed rules, a per-IP rate limit and an optional Admin IP allowlist. Rules that inspect request bodies only count, so nobody is blocked for what they type. |
| Operations | CloudWatch alarms (5xx, p99 latency, unhealthy tasks, CPU and memory, database CPU, storage and connections, dead letters, job backlog) sent to email. A monthly budget, and AWS Backup daily (35 days) and monthly (1 year) for the database and media. |

Every container has a read-only root file system and a writable `/tmp` volume. The image
declares `/tmp` as a volume, so the mount starts world-writable. The app refuses to start in
production if it cannot write there.

## 2. One-time setup (outside the stack)

1. **AWS account and tools.** Install AWS CLI v2, Node 22, and Docker with buildx. Then run
   `npm ci` in `infra/` and `npx cdk bootstrap aws://<account>/ap-south-1`.
2. **Certificate.** Request an ACM certificate in **ap-south-1** for the API name (for example
   `api.katkee.app`) with DNS validation. Keep its ARN.
3. **Email.** Verify the sending domain in SES (ap-south-1) with DKIM, and request production
   access. The sandbox only delivers to verified addresses.
4. **CloudFront signing key.** Generate the pair locally and never commit it; `*.pem` is
   gitignored:
   ```sh
   openssl genrsa -out cloudfront-private.pem 2048
   openssl rsa -in cloudfront-private.pem -pubout -out cloudfront-public.pem
   ```
5. **Settings.** Pass these as `-c key=value` to every `cdk` command, or keep them in
   `infra/cdk.context.json`. None of them is secret.

   | Context key | Example | Notes |
   | --- | --- | --- |
   | `imageTag` | `3f9c2a1b` | Git commit of the images in ECR. |
   | `migrationImageTag` | `4d7e0b2c` | Optional; for releases (section 5). |
   | `apiDomainName` | `api.katkee.app` | |
   | `apiCertificateArn` | `arn:aws:acm:ap-south-1:…` | Must be in ap-south-1. |
   | `emailFrom`, `sesIdentity` | `Katkee <no-reply@katkee.app>`, `katkee.app` | |
   | `cloudFrontPublicKeyFile` | `cloudfront-public.pem` | Or `cloudFrontPublicKeyPem` in cdk.context.json. The CLI keeps only the first line of a multi-line `-c` value. |
   | `alarmEmail` | `ops@katkee.app` | Confirm the subscription email after the first deploy. |
   | `adminConsoleEnabled` | `true` | |
   | `adminOrigin` | `https://api.katkee.app` | Defaults to the API origin. |
   | `adminAllowedCidrs` | `203.0.113.0/24` | Optional WAF allowlist for `/admin` and `/api/v1/admin`. |
   | `providers` | `fcm,apns,phone,safeBrowsing` | Only after their secrets are filled in (section 3). |
   | `apnsBundleId` | `app.katkee` | Needed with `apns`. |
   | `twilioVerifyServiceSid`, `phoneAuthCountries` | `VA…`, `IN` | Needed with `phone`. |
   | `googleClientIds` | `…apps.googleusercontent.com` | Turns Google sign-in on. |
   | `features` | `ads,sponsoredStories,adReporting` | Off unless listed. |
   | `analyticsTimeZone` | `Asia/Kolkata` | The default. Fix it before launch (docs/ANALYTICS.md). |
   | `databaseInstanceType` | `t4g.medium` | The default. |
   | `monthlyBudgetUsd` | `500` | The default. |

   The stack refuses settings that would only fail after deploying: a certificate in another
   region, a malformed key, an `http://` Admin origin, a bad Twilio SID, and similar.

## 3. First deploy

1. **Bootstrap mode** creates everything, including the ECR repositories, and runs no tasks:
   ```sh
   cd infra && npm ci && npm run build
   npx cdk deploy -c bootstrap=true -c imageTag=<commit> -c apiDomainName=… -c apiCertificateArn=… \
     -c emailFrom=… -c sesIdentity=… -c cloudFrontPublicKeyFile=cloudfront-public.pem -c alarmEmail=…
   ```
2. **Fill in provider secrets.** Each one starts as a random placeholder, and a placeholder
   stops the app at startup with the setting's name; it never runs. The CloudFront key is
   always needed. The others only matter once their provider is listed in `providers`:
   ```sh
   aws secretsmanager put-secret-value --secret-id katkee/production/CLOUDFRONT_PRIVATE_KEY --secret-string file://cloudfront-private.pem
   # Push (Android, and iOS through Firebase): the service account JSON
   aws secretsmanager put-secret-value --secret-id katkee/production/FCM_SERVICE_ACCOUNT_JSON --secret-string file://firebase-service-account.json
   # Direct APNs: APNS_KEY_ID, APNS_TEAM_ID, APNS_PRIVATE_KEY (the .p8 file)
   # Phone sign-in: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN
   # Link checks: SAFE_BROWSING_API_KEY. Not checked at startup, so verify it after enabling.
   ```
3. **Build and push the images.** Run these from `backend/`; the Admin console sources are a
   named build context:
   ```sh
   aws ecr get-login-password --region ap-south-1 | docker login --username AWS --password-stdin <account>.dkr.ecr.ap-south-1.amazonaws.com
   docker buildx build --platform linux/amd64 --build-context admin=../admin -t <ApiRepositoryUri>:<commit> --push .
   docker buildx build --platform linux/amd64 --build-context admin=../admin --target worker -t <WorkerRepositoryUri>:<commit> --push .
   ```
   Tags are immutable, so push a new commit for every change.
4. **Migrate.** This creates the schema and the `katkee_app` runtime role. The `<…>` values are
   stack outputs:
   ```sh
   aws ecs run-task --cluster <ClusterName> --launch-type FARGATE --task-definition <MigrateTaskDefinition> \
     --network-configuration "awsvpcConfiguration={subnets=[<TaskSubnets>],securityGroups=[<MigrateSecurityGroup>],assignPublicIp=DISABLED}"
   aws ecs wait tasks-stopped --cluster <ClusterName> --tasks <taskArn>
   aws ecs describe-tasks --cluster <ClusterName> --tasks <taskArn> --query 'tasks[0].containers[0].exitCode'   # must be 0
   ```
   The output is in the `MigrateLogs` log group.
5. **Start the services.** Deploy again without `bootstrap`. Autoscaling raises the API to 2
   tasks and the worker to 1. If `describe-services` still shows a desired count of 0, run
   `aws ecs update-service --cluster <ClusterName> --service <ApiServiceName> --desired-count 2`,
   and the same for the worker with 1.
6. **DNS.** Point the API name at the `LoadBalancerDns` output (CNAME, or a Route 53 alias).
7. **First Super Admin.** Use an existing, active account. This is a one-off task with the API's
   settings:
   ```sh
   aws ecs run-task --cluster <ClusterName> --launch-type FARGATE --task-definition <ApiTaskDefinition> \
     --network-configuration "awsvpcConfiguration={subnets=[<TaskSubnets>],securityGroups=[<ApiSecurityGroup>],assignPublicIp=DISABLED}" \
     --overrides '{"containerOverrides":[{"name":"api","command":["node","dist/scripts/bootstrap-super-admin.js","owner@example.com"]}]}'
   ```
   Then sign in at `https://<apiDomainName>/admin/login` and enrol two-step verification.
8. **Alarm email.** Confirm the SNS subscription email, otherwise alarms reach no one.

## 4. Checks after a deploy

- `curl -sS https://<apiDomainName>/ready` returns `{"status":"ready"}`.
- `curl -sSI https://<apiDomainName>/admin/login` shows the strict CSP and HSTS headers.
- Upload a photo and a video from the app. Both should reach `ready`; the worker logs show
  `media_job_done`, and the media URL is a `*.cloudfront.net` signed URL.
- Request a password reset to a real inbox. This tests SES.
- Send a DM to a device in the background. This tests FCM/APNs.

## 5. Releases

Migrations only ever add (project rule), so the running version keeps working on the new
schema. Migrate first, then roll the services:

```sh
# 1. build and push <new> images (section 3, step 3)
# 2. move only the migration task to the new image, and run it
npx cdk deploy -c imageTag=<current> -c migrationImageTag=<new> …
aws ecs run-task … --task-definition <MigrateTaskDefinition> …   # exit code 0
# 3. roll the services (circuit breaker: a release that never becomes ready is rolled back)
npx cdk deploy -c imageTag=<new> …
```

To roll back, deploy the previous `imageTag`. ECR keeps the last 50 images.

## 6. Secrets rotation

| Secret | How | Effect |
| --- | --- | --- |
| `db-runtime` | `aws secretsmanager rotate-secret` or put a new password, run the migration task (it applies the password to the role), then `aws ecs update-service --force-new-deployment` for both services. | The old password stops working when the migration task runs, so run the redeploy straight after it. |
| `db-owner` | RDS master password change, then update the secret. | Migrations only. |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | Put a new value, then force a new deployment. | Everyone is signed out. |
| `ADMIN_MFA_ENCRYPTION_KEY` | Do not rotate casually: stored TOTP secrets become unreadable, and every admin re-enrols through a Super Admin reset. | |
| `PHONE_IDENTITY_SECRET` | Do not rotate: it keys existing phone sign-ins. | |
| Provider credentials | Put the new value, then force a new deployment. | |
| CloudFront key pair | Add the new public key to the key group, deploy the new private key, then remove the old public key once old URLs have expired (2 × `MEDIA_URL_TTL_SECONDS`). | Needs a code change to the key group (two keys) during the overlap. |

## 7. Backups and recovery

- Database: point-in-time restore to any second in the last 14 days (RDS), plus AWS Backup
  snapshots (daily for 35 days, monthly for a year). A restore creates a new instance. Point
  `PGHOST` at it by redeploying with the restored instance in place of the old one, or rename
  instances.
- Media: S3 versioning keeps overwritten and deleted objects for 30 days, plus AWS Backup.
- The restore procedure and its drill are in docs/BACKUP_AND_RESTORE.md.

## 8. Develop and test

```sh
npm ci
npm test            # builds, then runs test/*.test.js: stack properties + backend contract (needs backend/dist)
npm run synth       # CloudFormation template in cdk.out/ (needs the context keys above)
```

- `test/katkee-stack.test.ts` checks the synthesized template's security and reliability
  properties: encryption, private networking, least-privilege roles, TLS, WAF, alarms, backups
  and modes.
- `test/backend-contract.test.ts` runs the backend's real startup code (backend/dist) with
  exactly the environment and secret names each container gets. Values AWS fills in at deploy
  time are replaced with realistic ones. It also checks that a placeholder secret stops startup.

## 9. Status

| | Status |
| --- | --- |
| CDK stack synthesizes, with CDK's recommended feature flags | IMPLEMENTED AND VERIFIED (local) |
| Template security and reliability properties | IMPLEMENTED AND VERIFIED (37 tests) |
| Backend starts with the stack's configuration; placeholder secrets refused | IMPLEMENTED AND VERIFIED (contract test against backend/dist) |
| Runtime database role, verified TLS to the database (local PostgreSQL TLS) | IMPLEMENTED AND VERIFIED (backend tests) |
| Deploy to AWS, ECS on Fargate (including the `/tmp` volume permissions), RDS, CloudFront, WAF, SES, alarms | **BLOCKED**: no AWS account. Never deployed. |
| Runtime and worker images | **BLOCKED** here: their `apt-get` step needs deb.debian.org, which this environment cannot reach. The builder stage builds. |
