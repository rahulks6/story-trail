# Launching Katkee: every step, in order

Last updated 14 October 2026. Follow the parts in order: the stores review a working app, and the
app needs the servers and the website live first.

**The first launch is India only, across the whole country, for adults (18 and older).** Katkee
is operated by Rahul Katakdhond, a sole proprietorship registered in India, who is also its
Grievance Officer. The section "India: the rules that apply", near the end, says what that means
in practice.

| Address | What it is |
| --- | --- |
| https://katkee.com | The website: landing page, Help Center, Privacy Policy, Terms, account deletion (`website/`) |
| https://api.katkee.com | The API the app talks to, and the Admin console at `/admin` (`backend/`, `admin/`) |
| `com.katkee.app` | The app's bundle ID (iOS) and package name (Android) |

## Before you start

**Ready in this project** (tested here; see `RELEASE_READINESS.md` for the evidence):
- the app for iPhone and Android, configured for `https://api.katkee.com/` and `com.katkee.app`,
  with your icon, launch screens and in-app logo;
- the API, worker and Admin console, and the website they serve on katkee.com;
- the AWS infrastructure as code (`infra/`);
- the release check (`npm run check:ios-release` passes) and the live check
  (`npm run check:live`, for after the deploy);
- the store forms' answers, descriptions and graphics (`brand/store/`).

**What you need**
- **A Mac** with at least 100 GB free. The iPhone app can only be built on a Mac with Xcode, so
  use it for everything below. (The server and Android parts also work on Linux, or on Windows
  with WSL.)
- **An iPhone and an Android phone** to test on.
- **A password manager** (Bitwarden, 1Password or similar). You will create keys that must never
  be lost or shared: the AWS access key, the media signing key, the Firebase key, the Apple push
  key and the Android upload key.
- **Money.** Rough figures from the providers' public prices; check them before you start:

  | What | Cost |
  | --- | --- |
  | AWS in Mumbai (servers, database, storage, network) | About US$300 to 400 a month (₹25,000 to 35,000) before you have many users, growing with use. Charges start at Part 7 |
  | Apple Developer Program | US$99 a year, charged in rupees |
  | Google Play developer account | US$25, once |
  | Mailboxes (Zoho Mail's free plan, or Google Workspace) | Free, or a few hundred rupees a month |
  | Twilio, for phone sign-in (optional) | Per SMS sent |

  Most of the AWS cost is the database running in two data centres (so it survives one failing)
  and two NAT gateways. Apply for AWS Activate startup credits (https://aws.amazon.com/activate)
  before you start. A cheaper single-server setup exists (`backend/docker-compose.prod.yml`), but
  you then look after backups and failures yourself; this guide uses AWS.

**Start the slow things today.** They take days, so begin them before Part 1:
1. **Apple Developer Program**: enrol (Part 19, step 1). Approval can take a couple of days.
2. **Google Play developer account** (Part 18, step 7). Identity checks take a few days; an
   organization account also needs a D-U-N-S number, which can take weeks.
3. **AWS account** (Part 2).
4. **katkee.com's name servers** (Part 3): up to 48 hours to take effect.
5. **12 testers** with Android phones and Gmail addresses, if your Google Play account is
   personal: they must keep the test version installed for 14 days (Part 18).

**Never share or upload** your access keys, `.pem`, `.p8`, `.p12` or Firebase `.json` files.
Nobody, including Apple, Google, AWS or a developer you hire, needs them sent by email or chat.

**Rather not install the server tools?** Parts 3 to 16 can run on a cloud machine instead of your
Mac: see "Running the server parts on a cloud machine", near the end.

## Part 1. Set up your Mac

1. Install **Xcode** from the Mac App Store. Open it once and let it install its extra
   components.
2. Install **Homebrew**: paste this into Terminal, then run the two "Next steps" commands it
   prints at the end:
   ```sh
   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
   ```
3. Install the tools:
   ```sh
   brew install node@22 awscli ruby
   brew install --cask temurin@17 android-studio
   ```
   Then install **Docker Desktop** for your Mac's chip from https://www.docker.com/products/docker-desktop/.
4. Make them the defaults. Open your Terminal settings file with `nano ~/.zshrc`, add these lines
   at the end, save (Control-O, Enter) and exit (Control-X), then close and reopen Terminal:
   ```sh
   export PATH="$(brew --prefix node@22)/bin:$(brew --prefix ruby)/bin:$PATH"
   export JAVA_HOME="$(/usr/libexec/java_home -v 17)"
   export ANDROID_HOME="$HOME/Library/Android/sdk"
   export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
   ```
   Check: `node --version` shows v22, `java -version` shows 17, and `aws --version` works.
5. Open **Docker Desktop** from Applications and let it start. On a Mac with Apple silicon, keep
   "Use Rosetta for x86_64/amd64 emulation" on (Settings, General): the servers run on Intel
   processors, and this makes building for them faster.
6. **The project.** Unzip the launch package into your home folder:
   ```sh
   cd ~ && unzip ~/Downloads/Katkee-Launch-Package-India-2026-10-13.zip
   cd ~/katkee
   ```
   Commands below say which folder they run in. `~/katkee` is the project.

## Part 2. AWS account

1. At https://aws.amazon.com, create an account. With an Indian address it is with Amazon Web
   Services India (AISPL): you pay in rupees and get GST invoices (add your GSTIN if you have
   one). Use a card that allows international and recurring payments. Choose the free Basic
   support plan.
2. Sign in as the **root user** (your sign-up email). At the top right, open your account name,
   then **Security credentials**, and assign an MFA device (an authenticator app such as Google
   Authenticator or Microsoft Authenticator).
3. Create a day-to-day admin user: **IAM**, Users, **Create user**:
   - User name `katkee-admin`. Tick "Provide user access to the AWS Management Console", choose
     "I want to create an IAM user", and set a password.
   - Permissions: "Attach policies directly", then `AdministratorAccess`.
   - Create it and note the console sign-in URL it shows. Sign in with that URL from now on, and
     add MFA for this user too (IAM, Users, katkee-admin, Security credentials).
4. A key for Terminal: IAM, Users, katkee-admin, Security credentials, **Create access key**,
   "Command Line Interface (CLI)". Save both values in your password manager; the secret is
   shown only once.
5. In Terminal:
   ```sh
   aws configure
   ```
   Paste the access key ID and the secret; region `ap-south-1`; output format `json`. Then check:
   ```sh
   aws sts get-caller-identity
   ```
   It prints your 12-digit account ID.
6. In the AWS console, choose **Asia Pacific (Mumbai)** in the region menu (top right) for
   everything below. Route 53 is the exception: it has no region.

## Part 3. katkee.com's DNS on Route 53

With katkee.com's DNS in Route 53, AWS can create the records for the certificate and email
itself, and katkee.com can point at the servers.

1. **Route 53**, Hosted zones, **Create hosted zone**: domain name `katkee.com`, type Public.
2. Open it. The **NS** record lists four name servers, such as `ns-123.awsdns-45.com`. Copy them.
3. At the company where you bought katkee.com (GoDaddy, Hostinger, BigRock, Namecheap and so on),
   open the domain's **Nameservers** setting, choose custom name servers, and enter the four,
   without a dot at the end. If the domain already has records there (email, for example),
   create the same records in Route 53 first.
4. Wait until it takes effect (often an hour, at most 48). This shows the four `awsdns` names
   when it has:
   ```sh
   dig NS katkee.com +short
   ```

## Part 4. Email

Two separate things: **mailboxes** that receive email (support@, privacy@, grievance@ and
ops@katkee.com, which the website, the policy and the stores give out), and **Amazon SES**, which
sends the app's email (password reset codes and sign-in alerts).

**Mailboxes.** Zoho Mail's free plan is enough to start; Google Workspace is the paid alternative
and works the same way.
1. Sign up for Zoho Mail with your domain, katkee.com.
2. Prove you own the domain: Zoho shows a TXT value. In Route 53, katkee.com, **Create record**:
   record name empty, type TXT, the value in double quotes.
3. Create your mailbox, for example `rahul@katkee.com`.
4. Add the **MX** records Zoho shows: one record, name empty, type MX, one value per line (for
   example `10 mx.zoho.in`, `20 mx2.zoho.in` and `50 mx3.zoho.in`).
5. Add **SPF** as Zoho shows (for example `"v=spf1 include:zoho.in ~all"`). Route 53 keeps every
   TXT value for a name in one record, so add it as a second line of the TXT record from step 2.
6. Add **DKIM**: in Zoho's admin console, Email Authentication, DKIM, add a selector, create the
   TXT record it shows (a name like `zoho._domainkey`), then verify it in Zoho.
7. Add `support@`, `privacy@`, `grievance@` and `ops@katkee.com` as aliases of your mailbox (or
   as groups that deliver to you). Send a test email to each.

**Sending: Amazon SES** (AWS console, Mumbai)
1. **Amazon SES**, Identities, **Create identity**: type Domain, `katkee.com`. Under "Advanced DKIM
   settings" keep Easy DKIM and RSA_2048, and tick **Publish DNS records to Route53**. Create. It
   shows Verified within about an hour.
2. Until SES gives you production access (Part 16) it only sends to addresses you have verified.
   Create a second identity, type Email address, `rahul@katkee.com` (and any other address you
   test with), and click the link in the email SES sends.
3. In Route 53, create a record: name `_dmarc`, type TXT, value
   `"v=DMARC1; p=quarantine; rua=mailto:ops@katkee.com"`.

## Part 5. The HTTPS certificate

1. **AWS Certificate Manager** (Mumbai), **Request**, "Request a public certificate".
2. Domain names: `api.katkee.com`, then "Add another name to this certificate": `katkee.com` and
   `www.katkee.com`. Validation: DNS. Key algorithm: RSA 2048. Request.
3. Open the certificate and choose **Create records in Route 53**, then Create records.
4. Wait for the status **Issued** (usually 5 to 30 minutes once Part 3 has taken effect). Copy
   its ARN, which starts `arn:aws:acm:ap-south-1:`.

## Part 6. Settings and the media signing key

1. Install the deploy tools:
   ```sh
   cd ~/katkee/infra
   npm ci
   npm run build
   ```
2. Make the key that signs links to photos and videos (still in `infra`):
   ```sh
   openssl genrsa -out cloudfront-private.pem 2048
   openssl rsa -in cloudfront-private.pem -pubout -out cloudfront-public.pem
   ```
   Save a copy of `cloudfront-private.pem` in your password manager (git ignores `.pem` files).
3. The settings. In the block below, replace `PASTE-CERTIFICATE-ARN` with your ARN from Part 5,
   then paste the whole block into Terminal (still in `infra`). Nothing in it is secret.
   ```sh
   cat > cdk.context.json <<'EOF'
   {
     "imageTag": "r1",
     "apiDomainName": "api.katkee.com",
     "apiCertificateArn": "PASTE-CERTIFICATE-ARN",
     "websiteDomainName": "katkee.com",
     "emailFrom": "Katkee <no-reply@katkee.com>",
     "sesIdentity": "katkee.com",
     "cloudFrontPublicKeyFile": "cloudfront-public.pem",
     "alarmEmail": "ops@katkee.com",
     "adminConsoleEnabled": "true",
     "monthlyBudgetUsd": "400"
   }
   EOF
   ```
   `imageTag` names the version of the servers you upload in Part 10: `r1` now, then `r2`, `r3`
   and so on. To change a setting later, edit the file with `nano cdk.context.json`. Every
   setting is explained in `infra/README.md`, section 2.
4. Prepare your AWS account for deploys (once):
   ```sh
   npx cdk bootstrap aws://$(aws sts get-caller-identity --query Account --output text)/ap-south-1
   ```

## Part 7. Create everything (the first deploy)

This creates the network, database, storage, load balancer, queues, firewall, alarms and
backups, but runs no servers yet. **AWS charges by the hour from here on.**

```sh
cd ~/katkee/infra
npx cdk deploy -c bootstrap=true
```

It lists the security changes and asks whether to deploy: type `y`. It takes 20 to 40 minutes.
Then:

1. An email "AWS Notification - Subscription Confirmation" arrives at ops@katkee.com. Click
   **Confirm subscription**, or alarms reach no one.
2. Load the stack's names into Terminal. Paste this block into **every new Terminal window**
   before the commands in Parts 9 to 15, and again after each `cdk deploy`:
   ```sh
   out() { aws cloudformation describe-stacks --stack-name KatkeeProduction --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text; }
   ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
   CLUSTER=$(out ClusterName); SUBNETS=$(out TaskSubnets)
   MIGRATE_TASK=$(out MigrateTaskDefinition); MIGRATE_SG=$(out MigrateSecurityGroup)
   API_TASK=$(out ApiTaskDefinition); API_SG=$(out ApiSecurityGroup)
   API_REPO=$(out ApiRepositoryUri); WORKER_REPO=$(out WorkerRepositoryUri)
   API_SERVICE=$(out ApiServiceName); WORKER_SERVICE=$(out WorkerServiceName)
   echo "$CLUSTER $API_REPO"
   ```
   The last line must print two names. If it prints nothing, the deploy hasn't finished.

## Part 8. Push notifications (Firebase)

1. At https://console.firebase.google.com, **create a project** named Katkee (Google Analytics
   off).
2. **Add an Android app** with the package name `com.katkee.app`. Download `google-services.json`
   and copy it into the project (skip the SDK steps Firebase shows; the app has them):
   ```sh
   cp ~/Downloads/google-services.json ~/katkee/mobile/android/app/
   ```
3. **Add an iOS app** with the bundle ID `com.katkee.app`. Download `GoogleService-Info.plist`
   and keep it for Part 19.
4. **The servers' key**: Project settings, Service accounts, **Generate new private key**. Rename
   the downloaded file to `firebase-service-account.json` and leave it in Downloads for Part 9.
5. **iPhone notifications**, once your Apple membership is active: upload the APNs key (Part 19,
   step 3) under Project settings, Cloud Messaging, Apple app configuration, with its Key ID
   and your Team ID. The servers need nothing more: iPhone notifications go through Firebase.

## Part 9. Put the secret keys in AWS

The deploy made a placeholder for each secret, and the servers refuse to start until the real
value is in:

```sh
cd ~/katkee/infra
aws secretsmanager put-secret-value --secret-id katkee/production/CLOUDFRONT_PRIVATE_KEY --secret-string file://cloudfront-private.pem
aws secretsmanager put-secret-value --secret-id katkee/production/FCM_SERVICE_ACCOUNT_JSON --secret-string file://$HOME/Downloads/firebase-service-account.json
```

Save `firebase-service-account.json` in your password manager, then delete it from Downloads.
Turn push notifications on: open `nano cdk.context.json` and add this line under the `{`:

```json
  "providers": "fcm",
```

## Part 10. Build and upload the servers

Load the names first (Part 7, step 2). Then:

```sh
cd ~/katkee/backend
aws ecr get-login-password --region ap-south-1 | docker login --username AWS --password-stdin $ACCOUNT.dkr.ecr.ap-south-1.amazonaws.com
docker buildx build --platform linux/amd64 --build-context admin=../admin --build-context website=../website -t $API_REPO:r1 --push .
docker buildx build --platform linux/amd64 --build-context admin=../admin --build-context website=../website --target worker -t $WORKER_REPO:r1 --push .
```

Each build takes 10 to 30 minutes the first time. The tag (`r1`) must be the `imageTag` in
`cdk.context.json`. A tag can only be uploaded once: every later change gets a new one ("Every
update after launch", below).

## Part 11. Create the database tables

```sh
TASK=$(aws ecs run-task --cluster $CLUSTER --launch-type FARGATE --task-definition $MIGRATE_TASK \
  --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$MIGRATE_SG],assignPublicIp=DISABLED}" \
  --query 'tasks[0].taskArn' --output text)
aws ecs wait tasks-stopped --cluster $CLUSTER --tasks $TASK
aws ecs describe-tasks --cluster $CLUSTER --tasks $TASK --query 'tasks[0].containers[0].exitCode'
```

The last command must print `0`. Anything else: see "If something goes wrong".

## Part 12. Start the servers

```sh
cd ~/katkee/infra
npx cdk deploy
```

This time without `bootstrap` (type `y` if asked). Load the names again (Part 7, step 2), wait
five minutes, then check:

```sh
aws ecs describe-services --cluster $CLUSTER --services $API_SERVICE $WORKER_SERVICE \
  --query 'services[].[serviceName,desiredCount,runningCount]' --output table
```

The API should show 2 and 2, and the worker 1 and 1. If a wanted count is still 0:

```sh
aws ecs update-service --cluster $CLUSTER --service $API_SERVICE --desired-count 2
aws ecs update-service --cluster $CLUSTER --service $WORKER_SERVICE --desired-count 1
```

## Part 13. Point katkee.com at the servers

In Route 53, katkee.com, **Create record** three times, each with type **A** and **Alias** on,
routing to "Alias to Application and Classic Load Balancer", Asia Pacific (Mumbai), and the load
balancer in the list (its name matches the `LoadBalancerDns` output):

| Record name | Type | Routes to |
| --- | --- | --- |
| `api` | A (Alias) | the load balancer |
| (empty) | A (Alias) | the load balancer |
| `www` | A (Alias) | the load balancer |

## Part 14. Check that everything is live

```sh
cd ~/katkee
npm run check:live
```

Every line must say PASS: the API's health and readiness; the Privacy Policy, Terms, Help Center
and account deletion pages (each with its security headers); and the www redirect. The stores
reject an app whose policy or support page doesn't load. Then open https://katkee.com and
https://katkee.com/support on your phone.

## Part 15. Your account and the Admin console

1. Create your Katkee account. The app isn't built yet, so do it from Terminal. Before pasting,
   replace the email if yours differs, `CHOOSE-A-LONG-PASSWORD` with a long password (without the
   `'` character), and `YYYY-MM-DD` with your date of birth, such as `1990-01-31`:
   ```sh
   curl -sS -X POST https://api.katkee.com/api/v1/auth/signup -H 'Content-Type: application/json' \
     -d '{"username":"rahul.katakdhond","email":"rahul@katkee.com","password":"CHOOSE-A-LONG-PASSWORD","displayName":"Rahul Katakdhond","birthDate":"YYYY-MM-DD"}'
   ```
   The answer shows your new account. An error names the field to fix.
2. Make that account the Super Admin (once; Part 7, step 2 loads the names):
   ```sh
   aws ecs run-task --cluster $CLUSTER --launch-type FARGATE --task-definition $API_TASK \
     --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$API_SG],assignPublicIp=DISABLED}" \
     --overrides '{"containerOverrides":[{"name":"api","command":["node","dist/scripts/bootstrap-super-admin.js","rahul@katkee.com"]}]}'
   ```
3. After a minute, open https://api.katkee.com/admin/login, sign in, and set up two-step
   verification with your authenticator app. Reports, appeals and accounts are handled here.

## Part 16. Email to everyone (SES production access)

Now that katkee.com is live: **Amazon SES** (Mumbai), Account dashboard, **Request production
access**:
- Mail type: Transactional. Website URL: https://katkee.com.
- Use case, for example: "Katkee is a social app. We only send transactional email to our own
  registered users: 6-digit password reset codes and new sign-in security alerts. No marketing or
  bulk email. Bounces and complaints are handled by the SES suppression list, and people can
  delete their account in the app."

It is usually approved within a day. Until then only the addresses verified in Part 4 get email.

## Part 17. Optional extras

Each one is off until you turn it on. Launch without them if you like.

**Phone sign-in (Twilio).** India needs every business SMS to go through DLT registration; see
"SMS codes" in the India section below.
1. At https://www.twilio.com, create an account and upgrade it (add a payment method).
2. In the Twilio console: **Verify**, Services, create a service named Katkee (SMS). Copy its
   Service SID (`VA…`). On the console's home page, copy the Account SID (`AC…`) and Auth Token.
3. Put them in AWS:
   ```sh
   aws secretsmanager put-secret-value --secret-id katkee/production/TWILIO_ACCOUNT_SID --secret-string 'AC…'
   aws secretsmanager put-secret-value --secret-id katkee/production/TWILIO_AUTH_TOKEN --secret-string 'your auth token'
   ```
4. In `cdk.context.json`, change the providers line to the first line below, and add the other
   two under it:
   ```json
     "providers": "fcm,phone",
     "twilioVerifyServiceSid": "VA…",
     "phoneAuthCountries": "IN",
   ```
   Then `npx cdk deploy` from `infra`. Test with numbers on Jio, Airtel, Vi and BSNL.

**Google sign-in.** On Android only: on iPhone, App Review would then also require Sign in with
Apple, which Katkee doesn't have.
1. In Google Cloud (the Firebase project), APIs and Services, Credentials: create an OAuth client
   ID of type **Web application**, and one of type **Android** with the package name
   `com.katkee.app` and the SHA-1 fingerprints of your upload key and of Play's app signing key
   (Play Console, App integrity).
2. Put the web client ID in `mobile/src/config/providers.ts` (`googleWebClientId`) and rebuild the
   app; add `"googleClientIds": "<the web client ID>",` to `cdk.context.json` and deploy.

**Sponsored Stories (ads).** Off at launch. To turn them on later, add
`"features": "ads,sponsoredStories,adReporting",` to `cdk.context.json` and deploy, and change
the stores' "Ads" answer to Yes (`docs/GOOGLE_PLAY_DEPLOYMENT.md`, section 6).

**Link checks (Google Safe Browsing).** Put an API key in
`katkee/production/SAFE_BROWSING_API_KEY` and add `safeBrowsing` to `providers`.

## Part 18. The Android app and Google Play

The details, with every store answer, are in `docs/GOOGLE_PLAY_DEPLOYMENT.md`.

1. **Android SDK.** Open Android Studio once and finish its setup (Standard). Then More Actions,
   SDK Manager, SDK Tools: tick "Android SDK Command-line Tools (latest)" and Apply. Then:
   ```sh
   sdkmanager "platforms;android-37.0" "build-tools;37.0.0" "ndk;27.1.12297006" "cmake;3.30.5" "platform-tools"
   sdkmanager --licenses
   ```
2. **Your upload key** (once). Answer its questions (your name, Katkee, your city and state, `IN`)
   and choose a strong password:
   ```sh
   keytool -genkeypair -v -storetype PKCS12 -keystore ~/katkee-upload.p12 \
     -alias katkee-upload -keyalg RSA -keysize 4096 -validity 10000
   ```
   Save `katkee-upload.p12` and its password in your password manager, plus a backup copy. Every
   future update must be signed with it.
3. **Build.** `google-services.json` must be in `mobile/android/app/` (Part 8). Then:
   ```sh
   cd ~/katkee
   npm --prefix mobile ci
   export KATKEE_UPLOAD_STORE_FILE="$HOME/katkee-upload.p12"
   export KATKEE_UPLOAD_STORE_PASSWORD='your key password'
   export KATKEE_UPLOAD_KEY_ALIAS=katkee-upload
   export KATKEE_UPLOAD_KEY_PASSWORD='your key password'
   export KATKEE_VERSION_CODE=1
   npm run check:android-release
   npm run build:android-release
   ```
   (With this kind of key, both passwords are the same.) The results are
   `mobile/android/app/build/outputs/bundle/release/app-release.aab`, which you upload to Google,
   and `mobile/android/app/build/outputs/apk/release/app-release.apk`, which you test.
4. **Test on your Android phone.** Settings, About phone: tap Build number seven times. Then in
   Developer options, turn on USB debugging. Connect the phone, allow the computer, and:
   ```sh
   adb install -r mobile/android/app/build/outputs/apk/release/app-release.apk
   ```
   Go through the checklist in `docs/GOOGLE_PLAY_DEPLOYMENT.md`, section 4: sign up (try a date of
   birth under 18: it must be refused), Home's taps and swipes, Create, profile, messages,
   notifications, report and block, and deleting a test account.
5. **Screenshots**: on the phone, take 2 to 8 of Home, a creator page, Create, Messages and
   Activity.
6. **A demo account** for the reviewers: sign up in the app with an adult date of birth, add a
   profile photo, a few public Stories and a Highlight. Keep its email and password.
7. **Developer account**: at https://play.google.com/console/signup, pay US$25 and verify your
   identity. Personal (your name, the 12-tester rule) or organization (the business name, needs
   a D-U-N-S number).
8. **Create the app**: Create app; name Katkee; App; Free; accept the declarations. Keep Play App
   Signing (Google-managed key).
9. **App content forms** (Dashboard, "Set up your app"). Copy the answers from
   `docs/GOOGLE_PLAY_DEPLOYMENT.md`, section 6: privacy policy `https://katkee.com/privacy`; app
   access with the demo account; ads No (while Sponsored Stories are off); content rating;
   target audience **18 and over** only; data safety (the table there); government, financial,
   health and news apps all No; account deletion URL `https://katkee.com/delete-account`.
10. **Store listing** (Grow users, Store presence, Main store listing): the texts in section 7 of
    that guide, the icon `brand/store/google-play-icon-512.png`, the feature graphic
    `brand/store/google-play-feature-graphic-1024x500.png`, your screenshots, category Social,
    email support@katkee.com, website https://katkee.com.
11. **Countries**: Test and release, Production, Countries / regions: **India** only.
12. **Internal test**: Test and release, Testing, Internal testing: create a release, upload
    `app-release.aab`, add yourself as a tester, and install it from the opt-in link.
13. **Closed test** (needed for a personal account): create a closed testing track, add your 12
    or more testers, release the same bundle, and ask them to install it and keep it for 14 days.
    Then apply for production access from the Dashboard.
14. **Production**: create a production release with the bundle, roll it out to a share first
    (for example 10%), and raise it to 100% when it's stable. The first review takes a few days.
15. Every new upload needs a higher `KATKEE_VERSION_CODE` (2, 3, ...).

## Part 19. The iPhone app and the App Store

The details, with every App Store Connect answer, are in `docs/IOS_APP_STORE_DEPLOYMENT.md`.

1. **Enrol** in the Apple Developer Program at https://developer.apple.com/programs/ with your
   own Apple Account (two-factor authentication on). A sole proprietor enrols as an
   **individual**: the App Store shows "Rahul Katakdhond" as the seller.
2. **The App ID**: on https://developer.apple.com/account/resources/identifiers, add an App ID with
   the explicit bundle ID `com.katkee.app`, with **Push Notifications** ticked.
3. **The push key**: Keys, +, name "Katkee push", tick Apple Push Notifications service (APNs),
   register, and **download the .p8 file** (Apple lets you download it once; save it in your
   password manager). Note its Key ID, and your Team ID (Membership details). Upload it to
   Firebase (Part 8, step 5).
4. **Install the iPhone libraries**:
   ```sh
   cd ~/katkee
   npm --prefix mobile ci
   cd mobile && bundle install
   cd ios && bundle exec pod install && cd ..
   open ios/KatkeeMobile.xcworkspace
   ```
   Open the `.xcworkspace`, not the `.xcodeproj`.
5. **In Xcode**, select the KatkeeMobile target:
   - Signing & Capabilities: Team = your developer team; "Automatically manage signing" on; the
     bundle identifier is already `com.katkee.app`; add the Push Notifications capability if it
     isn't listed.
   - General: Version 1.0.0, Build 1 (raise the Build for every upload).
   - Drag `GoogleService-Info.plist` (Part 8) into the KatkeeMobile group, with "Copy items if
     needed" and the KatkeeMobile target ticked.
6. **Test on your iPhone.** Connect it and trust the Mac. In Xcode, Product, Scheme, Edit Scheme,
   Run: set Build Configuration to **Release**. Choose your iPhone at the top and press Run. The
   first time, turn on Developer Mode on the iPhone (Settings, Privacy and Security) and restart
   it. Go through the checklist in `docs/IOS_APP_STORE_DEPLOYMENT.md`, section 5, including a date
   of birth under 18 (refused) and a notification with the app closed.
7. **Create the app** in https://appstoreconnect.apple.com: Apps, +, New App: iOS; name Katkee;
   primary language English (U.K.) or English (U.S.); bundle ID `com.katkee.app`; SKU
   `katkee-ios`.
8. **Fill in its pages** from `docs/IOS_APP_STORE_DEPLOYMENT.md`, section 7: category Social
   Networking; the age rating questionnaire (choose 18+ if it offers a higher rating than the
   calculated one); Pricing and Availability: Free, **India** only; App Privacy (the table there,
   including the date of birth); screenshots at the 6.9-inch size; description; support URL
   `https://katkee.com/support`; marketing URL `https://katkee.com`; the demo account and review
   notes.
9. **Upload**: in Xcode, choose "Any iOS Device (arm64)" as the destination, then Product,
   **Archive**. In the Organizer window, Distribute App, App Store Connect, Upload. The build
   appears in App Store Connect after 10 to 30 minutes.
10. **TestFlight**: add yourself as an internal tester and install it from the TestFlight app.
    Test once more.
11. **Submit**: on the 1.0 version page, choose the build, **Add for Review**, then Submit. Review
    usually takes one to two days.

## Part 20. When the apps are live

1. Put the store links in `website/site.json` (`"stores"`): the App Store link (it looks like
   `https://apps.apple.com/in/app/katkee/id…`) and `https://play.google.com/store/apps/details?id=com.katkee.app`.
2. `node website/build.cjs` from `~/katkee`, then publish it like any update (below, with the next
   tag). The website's "Coming soon" buttons become download buttons.

## Every update after launch

**Servers** (the code changed, or `website/`): use the next tag, here `r2`.
1. Part 10's two builds, with `:r2` instead of `:r1`.
2. In `cdk.context.json`, keep `"imageTag": "r1"` and add `"migrationImageTag": "r2",`. Then
   `npx cdk deploy` from `infra`, load the names (Part 7, step 2), and run Part 11 (it must print
   `0`). Database changes only ever add, so the running version keeps working meanwhile.
3. Set `"imageTag": "r2"`, delete the `migrationImageTag` line, and `npx cdk deploy` again. The
   servers switch over one at a time; a version that never becomes healthy is rolled back by
   itself.
4. To undo a release, put the previous `imageTag` back and `npx cdk deploy`.

**Apps**: for a new version, raise `appVersion` in `mobile/build-config.json`, and Xcode's Version
to match. For every upload, raise `KATKEE_VERSION_CODE` (Android) and Xcode's Build (iPhone).

## Running the server parts on a cloud machine

Parts 3 to 16 need only a terminal with internet access, Docker, Node 22 and the AWS CLI, so they
can run on a Linux cloud machine (a Claude Code cloud session, for example) instead of your Mac.
The commands are the same, with these differences:

1. **Access**: instead of `aws configure`, the machine gets three environment variables in its
   settings: `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` (the katkee-admin access key from
   Part 2) and `AWS_DEFAULT_REGION` set to `ap-south-1`. Never paste the key into a chat.
2. **Network**: the server image build installs packages from `deb.debian.org`, so the machine
   must be allowed to reach it, besides AWS, Docker Hub and the npm registry. If the machine's
   proxy inspects HTTPS traffic, the build's `apt-get` and `npm ci` steps also need the proxy's
   certificate: pass it as a build secret (`--secret`) to those steps only, so it stays out of the
   images.
3. **Tools**: `pip install awscli`, and start Docker if it isn't running (`dockerd &`, as root).
   On an Intel (x86_64) machine the image builds run natively, without emulation.
4. **Keys from other services** (the Firebase key in Part 9, Twilio's in Part 17) can go straight
   into Secrets Manager from the AWS console instead of onto the machine: Secrets Manager, the
   secret (for example `katkee/production/FCM_SERVICE_ACCOUNT_JSON`), Retrieve secret value, Edit,
   then paste the value as plaintext.
5. **Afterwards**, make the access key inactive (IAM, Users, katkee-admin, Security credentials)
   until the next update needs it.

The steps in your browser stay yours: the name servers at your domain company (Part 3), the
mailboxes (Part 4), confirming the alarm email (Part 7), Firebase (Part 8), your own account's
password (Part 15), and the apps and stores (Parts 18 and 19).

## If something goes wrong

| What you see | What it means, and what to do |
| --- | --- |
| `cdk deploy` says `Missing context "…"` | That setting is missing from `cdk.context.json` (Part 6, step 3) |
| `cdk deploy` fails on the certificate | It isn't Issued yet, or it isn't in Mumbai (Part 5) |
| Commands fail with `AccessDenied … with an explicit deny in a service control policy` | The account is in an AWS Organization whose policy allows only some Regions. In the management account: AWS Organizations, Policies, Service control policies, the Region restriction policy, Edit policy, and add `"ap-south-1"` to its `aws:RequestedRegion` list |
| The console shows "Region Asia Pacific (Mumbai) restricted" | A console display setting, separate from the policy above: Unified Settings (the gear icon), Account settings, Visible Regions, Edit, "All available regions" |
| The first deploy fails on CloudFront saying your account must be verified | New AWS accounts sometimes need this: open a free support case (Account and billing) asking AWS to enable CloudFront. Before deploying again, clear what the failed deploy kept: in CloudFormation, turn off the `KatkeeProduction` stack's termination protection and delete it; then delete the `katkee/production/…` secrets (without a recovery window), the empty `katkeeproduction-…` buckets, the `katkee-api` and `katkee-worker` repositories, the `KatkeeProduction-…` and `aws-waf-logs-katkee` log groups and the backup vault, and schedule its KMS key for deletion. Their names would clash with the new deploy |
| The servers keep restarting | CloudWatch, Log groups, the one with `ApiLogs` (or `WorkerLogs`) in its name, newest stream. A message naming a setting such as `CLOUDFRONT_PRIVATE_KEY` means that secret still holds its placeholder (Part 9) |
| Part 11 doesn't print `0` | Read the log group with `MigrateLogs` in its name |
| https://api.katkee.com answers 503 | The servers aren't healthy yet: check Part 12's counts and the logs |
| `check:live` fails only "www redirect" | The `www` record is missing (Part 13) |
| `Could not resolve host: api.katkee.com` just after Part 13 | A resolver that looked the name up before the record existed remembers "not found" for up to 15 minutes. Wait, or add `--connect-to api.katkee.com:443:LOAD-BALANCER-DNS:443` to the `curl` command (`LoadBalancerDns` output) |
| `check:live` fails every line with `ENOTFOUND` on a cloud machine | The machine reaches the internet through a proxy: run `NODE_USE_ENV_PROXY=1 npm run check:live` |
| No password reset email | SES is still in its sandbox (Part 16), or look in the spam folder |
| No notifications on iPhone | The APNs key isn't in Firebase (Part 8, step 5), or `GoogleService-Info.plist` isn't in Xcode |
| The Android build stops before starting | `npm run check:android-release` says what's missing |

`infra/README.md` has the full reference: every setting, secret rotation, backups and recovery.

## India: the rules that apply

**Done in the app and the infrastructure**
- **18 and older only.** Sign-up (email, Google or phone) asks for a date of birth; the server
  refuses anyone under 18 before storing anything (`backend/src/modules/auth/age.ts`). People
  can report an account as "May be under 18"; delete any account that is. This keeps Katkee out
  of the DPDP Act's rules for children's data, which need verifiable parental consent.
- **Grievance Officer** published on katkee.com/support, the Terms (section 12) and the Privacy
  Policy (section 11): Rahul Katakdhond, grievance@katkee.com, with the response times and the
  appeal to the Grievance Appellate Committee (IT Rules 2021, rule 3(2)).
- **180 days.** A deleted account's registration details are kept apart for 180 days, then
  deleted (IT Rules rule 3(1)(h)); content removed by moderation is kept 180 days as evidence
  (rule 3(1)(g)); every log is kept 180 days in Mumbai (CERT-In directions, 2022).
- **Data in India.** The servers, database, files and logs are in AWS Mumbai (ap-south-1).
- **Phone sign-in** is set up for Indian numbers (`phoneAuthCountries` defaults to `IN`).
- **Store answers** for 18+ and India only: `docs/IOS_APP_STORE_DEPLOYMENT.md` (section 7) and
  `docs/GOOGLE_PLAY_DEPLOYMENT.md` (sections 6 and 7).

**Your accounts as a sole proprietor**
- **Apple** enrols a sole proprietorship as an **individual**: the App Store shows "Rahul
  Katakdhond" as the seller. No D-U-N-S number needed.
- **Google Play**: a **personal** account (your name; a closed test with 12 testers for 14 days
  before production) or an **organization** account (the business name; needs a D-U-N-S number
  for the proprietorship; no 12-tester rule).
- In both stores, choose **India** as the only country. Add others later, after updating the
  legal pages.
- Keep the proprietorship's papers ready (PAN, the registration certificate, a bank account in
  the business name). Ask a chartered accountant about GST before you sell Sponsored Stories.
- **Investment**: a sole proprietorship can't issue shares. Before raising money, form a
  private limited company and move the apps, the domain and the store accounts to it.

**SMS codes (phone sign-in)**: every business SMS in India goes through TRAI's DLT registration.
Katkee sends codes with Twilio Verify; check in the Twilio console that its India messages are
DLT-registered for your account (Twilio's own registration covers its default message; a custom
sender name or text needs your own), then send a test code to a number on each network (Jio,
Airtel, Vi, BSNL).

**Running Katkee in India** (yours, every day):
- **grievance@katkee.com**: acknowledge each complaint within 24 hours, resolve it within 15
  days; act on a request to remove content that breaks the Terms within 72 hours; remove intimate
  or morphed images of the person complaining within 24 hours. Keep a log of complaints and what
  you did.
- **Orders from a court or the government**: remove or disable the content within 36 hours, and
  answer a lawful request for information within 72 hours.
- **Security incidents** (a breach, a hacked account system, a defaced site): report them to
  CERT-In (incident@cert-in.org.in) within 6 hours of noticing.
- **Once a year**: remind users of the Terms and Privacy Policy (an in-app notice or an email).
- **At 50 lakh (5 million) users in India** Katkee becomes a significant social media
  intermediary: it then needs a Chief Compliance Officer, a nodal contact person and a resident
  Grievance Officer (employees living in India), a physical address in India, and monthly
  compliance reports. Plan for it as you grow.

## Before launch: still open

- **Native builds and devices**: the iOS app has never been built (no Mac here), and the Android
  build is blocked by this environment's network policy. Test every flow in the two store guides
  on real phones.
- **Legal review**: the policy and terms describe the code accurately but are not legal advice.
  The governing law is India; the operator and Grievance Officer are Rahul Katakdhond. Add the
  proprietorship's trade name and address if it has them (`legal/README.md`).
- **A crash reporter** (Sentry is stubbed in `mobile/src/crashReporting.ts`).
- **Sign in with Apple**, only if you turn Google sign-in on for iPhone (App Review 4.8).
- `RELEASE_READINESS.md` has the full gate list and what each item needs.
