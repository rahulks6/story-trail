# Launching Katkee: katkee.com, the App Store and Google Play

Last updated 13 October 2026. This is the order that works: the stores review a working app, and
the app needs the API and the website live first.

**The first launch is India only, across the whole country, for adults (18 and older).** Katkee
is operated by Rahul Katakdhond, a sole proprietorship registered in India, who is also its
Grievance Officer. The section "India: the rules that apply" below says what that means in
practice.

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
- store screenshots from the real app, a demo account, and the submissions;
- running the grievance mailbox (below).

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

## 1. katkee.com: email and DNS

1. **Mailboxes.** Create these (or forwarders to your own inbox) with your email provider. The
   website, the policy and the stores point people at them:

   | Address | For |
   | --- | --- |
   | support@katkee.com | Help; the stores' support contact |
   | privacy@katkee.com | Data requests; account deletion without the app |
   | grievance@katkee.com | Complaints to the Grievance Officer, Rahul Katakdhond (acknowledge within 24 hours) |
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
  The governing law is India; the operator and Grievance Officer are Rahul Katakdhond. Add the
  proprietorship's trade name and address if it has them (`legal/README.md`).
- **A crash reporter** (Sentry is stubbed in `mobile/src/crashReporting.ts`).
- **Sign in with Apple**, only if you turn Google sign-in on for iPhone (App Review 4.8).
- `RELEASE_READINESS.md` has the full gate list and what each item needs.
