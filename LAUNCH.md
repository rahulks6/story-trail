# Launching Katkee: katkee.com, the App Store and Google Play

Last updated 12 October 2026. This is the order that works: the stores review a working app, and
the app needs the API and the website live first.

| Address | What it is |
| --- | --- |
| https://katkee.com | The website: landing page, Help Center, Privacy Policy, Terms, account deletion (`website/`) |
| https://api.katkee.com | The API the app talks to, and the Admin console at `/admin` (`backend/`, `admin/`) |
| `com.katkee.app` | The app's bundle ID (iOS) and package name (Android) |

## What is ready, and what only you can do

**Ready in this repository** (tested here; see `RELEASE_READINESS.md` for the evidence):
- the app for iPhone and Android, configured for `https://api.katkee.com/` and `com.katkee.app`,
  with your icon, launch screens and in-app logo;
- the API, worker and Admin console, and the website they serve on katkee.com;
- the AWS infrastructure as code (`infra/`), and a single-server alternative;
- the release check (`npm run check:ios-release` passes) and the live check
  (`npm run check:live`, for after the deploy);
- the store forms' answers, descriptions and graphics (`brand/store/`).

**Only you can do** (accounts, money, legal decisions and devices):
- AWS, Apple Developer (US$99 a year) and Google Play (US$25 once) accounts;
- a Mac with Xcode for iOS, and an Android phone and an iPhone to test on;
- the mailboxes and DNS records for katkee.com below;
- provider accounts: Firebase (push notifications); optionally Twilio (phone sign-in) and
  Google sign-in;
- a lawyer's review of the Privacy Policy and Terms (`legal/README.md`);
- store screenshots from the real app, a demo account, and the submissions.

## 1. katkee.com: email and DNS

1. **Mailboxes.** Create these (or forwarders to your own inbox) with your email provider. The
   website, the policy and the stores point people at them:

   | Address | For |
   | --- | --- |
   | support@katkee.com | Help; the stores' support contact |
   | privacy@katkee.com | Data requests; account deletion without the app |
   | grievance@katkee.com | Complaints under India's IT Rules (acknowledge within 24 hours) |
   | ops@katkee.com | Server alarms (`infra/README.md`) |

2. **Sending email** (password reset codes, security alerts). In Amazon SES (ap-south-1), verify
   the domain `katkee.com` with DKIM, and request production access. The sender is
   `Katkee <no-reply@katkee.com>`.

3. **DNS records** (at your domain registrar or Route 53). The load balancer name comes from the
   deploy in step 2:

   | Name | Type | Value |
   | --- | --- | --- |
   | `api.katkee.com` | CNAME, or a Route 53 alias | the `LoadBalancerDns` output |
   | `katkee.com` | Route 53 alias A/AAAA, or your provider's ALIAS/ANAME | the `LoadBalancerDns` output |
   | `www.katkee.com` | CNAME, or a Route 53 alias | the `LoadBalancerDns` output |
   | ACM validation | CNAME | as ACM shows when you request the certificate |
   | SES DKIM (3 records) | CNAME | as SES shows |
   | `katkee.com` | MX and SPF (TXT) | from your mailbox provider |
   | `_dmarc.katkee.com` | TXT | `v=DMARC1; p=quarantine; rua=mailto:ops@katkee.com` |

## 2. Deploy the backend and website (AWS)

Follow `infra/README.md`. The katkee.com settings are:

```sh
-c apiDomainName=api.katkee.com -c websiteDomainName=katkee.com \
-c apiCertificateArn=<one ACM certificate in ap-south-1 for api.katkee.com, katkee.com and www.katkee.com> \
-c emailFrom="Katkee <no-reply@katkee.com>" -c sesIdentity=katkee.com -c alarmEmail=ops@katkee.com \
-c apnsBundleId=com.katkee.app
```

The image carries the website (`backend/Dockerfile`), so one deploy publishes the API, the Admin
console and katkee.com. On katkee.com only the website is reachable; `www` redirects there.

A single server instead of AWS's managed services: `backend/docker-compose.prod.yml` with
`DOMAIN=api.katkee.com` and `WEBSITE_DOMAIN=katkee.com` (Caddy gets the certificates). Media
still needs S3 and CloudFront.

Then create the first Super Admin and sign in at https://api.katkee.com/admin
(`infra/README.md`, section 3, step 7).

## 3. Check that everything is live

From the repository root, on your computer:

```sh
npm run check:live
```

Every line must say PASS: the API's health and readiness; the Privacy Policy, Terms, Help Center
and account deletion pages (each with its security headers); and the www redirect. The stores
reject an app whose policy or support page doesn't load.

Also open https://katkee.com on a phone, and request a password reset to a real inbox (that tests
SES).

## 4. iPhone and the App Store

`docs/IOS_APP_STORE_DEPLOYMENT.md`: register the bundle ID, build and test on your iPhone,
archive and upload, the App Store Connect forms (App Privacy answers included), TestFlight and
review.

## 5. Android and Google Play

`docs/GOOGLE_PLAY_DEPLOYMENT.md`: the upload key, building the bundle, testing on your phone,
the Play Console forms (Data safety answers included), the testing tracks and the release.

## 6. When the apps are live

Put the App Store and Google Play links in `website/site.json`, run `node website/build.cjs`,
commit and deploy (`website/README.md`). The website's "Coming soon" buttons become download
buttons.

## Before launch: still open

- **Native builds and devices**: the iOS app has never been built (no Mac here), and the Android
  build is blocked by this environment's network policy. Test every flow in the two store guides
  on real phones.
- **Legal review**: the policy and terms describe the code accurately but are not legal advice.
  The governing law is set to India; the Grievance Officer's name still needs adding
  (`legal/README.md`).
- **A crash reporter** (Sentry is stubbed in `mobile/src/crashReporting.ts`).
- **Sign in with Apple**, only if you turn Google sign-in on for iPhone (App Review 4.8).
- `RELEASE_READINESS.md` has the full gate list and what each item needs.
