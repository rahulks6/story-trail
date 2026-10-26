# Putting Katkee on Android and Google Play

Last updated 12 October 2026.

> **Android status: BLOCKED in this environment.** The build needs `dl.google.com` and
> `repo.reactnative.dev`, which this environment's network policy refuses. The app hasn't been
> compiled since the React Native 0.87 upgrade, and the signed release bundle (AAB) has never
> been built or run on a phone. Everything below happens on your computer (Windows, macOS or
> Linux) or in CI. Expect to fix a few things on the first native build.

What is already done, and what only you can do:

| Already done | Only you can do |
|---|---|
| Package name `com.katkee.app`, version from `mobile/build-config.json`, target API 36, 16 KB page-size check | Create the Google Play developer account |
| Launcher icon from your artwork: adaptive, round, themed (Android 13) and Android 7 versions; status-bar notification icon | Create and keep the upload key (never in the repository) |
| Android 12+ launch screen: your mark on the app's background; dark window from the first frame | Deploy the backend and website at katkee.com (`LAUNCH.md`) |
| Privacy Policy, Terms, Help Center and account deletion pages, served at katkee.com | Firebase project for push (`google-services.json`) |
| Approximate location only; no precise or background location; no photo-library permission (the system photo picker is used) | Screenshots, the store forms below, a demo account, and testers |
| In-app account deletion, report, block, moderation, terms at sign-up | |
| Store icon (512 x 512) and feature graphic (1024 x 500) in `brand/store/` | |
| A release check that refuses to build until everything is set (`check-release.cjs`) | |

---

## 1. What you need

- **A Google Play developer account** (US$25 once) at <https://play.google.com/console/signup>.
  - Katkee is a sole proprietorship, so either account type works:
    - **Personal**: the quickest. The store shows your name as the developer. A personal
      account created after November 2023 must run a **closed test with at least 12 testers
      for 14 days in a row** before it can publish to everyone (step 8).
    - **Organization**: needs a D-U-N-S number for the business (free from Dun & Bradstreet
      India; it can take a few weeks) and documents that match the registration. The store
      shows the business as the developer, and there is no 12-tester rule.
- **A computer** with Node 22, **JDK 17** and the Android SDK (Android Studio installs it). The
  exact versions are in `docs/NATIVE_BUILD_HANDOFF.md`.
- **An Android phone** (Android 7 or later) for testing.
- **The backend and website live at katkee.com** (`LAUNCH.md`, parts 1 to 14). Check with
  `npm run check:live`.

## 2. Push notifications (Firebase)

1. In the Firebase console (<https://console.firebase.google.com>), use the same project as for
   iOS, and **add an Android app** with the package name `com.katkee.app`.
2. Download `google-services.json` into `mobile/android/app/`. It's ignored by git on purpose.
   Without it the app still builds, without push.
3. The backend sends Android notifications with the Firebase service account
   (`FCM_SERVICE_ACCOUNT_JSON`, `infra/README.md`, section 3).

## 3. Create the upload key (once)

Google signs the app you publish (Play App Signing). You sign each upload with your own
**upload key**. Create it once and keep it, with its passwords, in a password manager. If you
lose it, Google can reset it, but that takes days.

```sh
keytool -genkeypair -v -storetype PKCS12 -keystore ~/katkee-upload.p12 \
  -alias katkee-upload -keyalg RSA -keysize 4096 -validity 10000
```

Never put the key or its passwords in the repository. The build reads them from the
environment:

```sh
export KATKEE_UPLOAD_STORE_FILE="$HOME/katkee-upload.p12"
export KATKEE_UPLOAD_STORE_PASSWORD='…'
export KATKEE_UPLOAD_KEY_ALIAS=katkee-upload
export KATKEE_UPLOAD_KEY_PASSWORD='…'
```

## 4. Build the release bundle

From the repository root:

```sh
npm --prefix mobile ci
npm run check:android-release              # only your upload key may still be missing
export KATKEE_VERSION_CODE=1                # raise it for every upload: 1, 2, 3...
npm run build:android-release
```

This builds the signed APK and the **AAB** (Android App Bundle, what Play wants):

```
mobile/android/app/build/outputs/bundle/release/app-release.aab
mobile/android/app/build/outputs/apk/release/app-release.apk
```

It refuses to start if anything in `mobile/build-config.json` is missing, or if the key is the
public debug key. Afterwards it checks that every native library is aligned for 16 KB memory
pages (Google Play requires this) and verifies the APK's signature. The evidence goes to
`docs/native-builds/`.

**Test the APK on your phone before uploading:**

```sh
adb install -r mobile/android/app/build/outputs/apk/release/app-release.apk
```

- sign up (the Terms and Privacy Policy links open katkee.com), log in, log out;
- Home:
  - tap right for the next Story, left for the previous one;
  - swipe up and down between people;
  - hold to pause, double-tap to like;
- Create: camera, flash, timer, gallery, text, drawing, stickers (the location sticker asks
  for *approximate* location), publish;
- profile:
  - Edit Profile: take a photo, move and scale it, Save;
  - Highlights;
  - someone else's page: Follow, Message, More;
- Settings, then Privacy:
  - Nearby Stories (Android shows "Approximate");
  - private account;
- Messages, Activity, notifications with the app closed;
- report a Story, block an account, delete a test account (Settings, then Delete account);
- the launcher icon on your home screen, and with themed icons on (Android 13+).

## 5. Create the app in Play Console

At <https://play.google.com/console>, choose **Create app**:
- App name: **Katkee**;
- Default language;
- App or game: **App**; Free or paid: **Free**;
- accept the declarations.

Then, under **Test and release**, **Setup**, **App signing**: keep **Google-managed key**
(Play App Signing). Your first upload registers your upload key.

**Shared links (App Links).** Shared profiles and Stories are `https://katkee.com/u/…` and
`/s/…` links. Android opens them in the app only if katkee.com's `assetlinks.json` lists the key
the installed app is signed with, and apps from Play are signed with Google's key. After the first
upload, open **Test and release**, **App integrity**, **Play app signing**, **Settings**, copy the
**SHA-256 certificate fingerprint** under "App signing key certificate", add it to
`appLinks.android.sha256CertFingerprints` in `website/site.json` (next to the upload key that's
already there), then `node website/build.cjs`, commit and deploy (`website/README.md`, "Shared
links"). Until then, the links open the website's "Open in Katkee" page, whose button still opens
the app.

## 6. Fill in the app content forms

Play Console lists them on the dashboard, under "Set up your app".

**Privacy policy**: `https://katkee.com/privacy`

**App access**: choose "All or some functionality is restricted", and add the demo account's
email and password with these instructions: "Sign in with this account. Stories are on Home;
Create is the + tab." Create the account on the live backend, with a profile photo, a few
public Stories and a Highlight.

**Ads**: **Yes** if Sponsored Stories are on (the `features` infra setting), otherwise No.
Sponsored Stories are labelled "Sponsored" in the app.

**Content rating** (the IARC questionnaire): category **Social networking / communication**.
Answer honestly; Katkee has:
- user-generated content that anyone can post (Stories, comments);
- users who can talk to each other (direct messages);
- users who can share an approximate place (the location sticker);
- no gambling, no purchases, no unmoderated web browsing.

**Target audience and content**: age group **18 and over** only. Katkee is for people 18 and
older (`legal/TERMS_OF_SERVICE.md`, section 2): sign-up asks for a date of birth and the server
refuses anyone under 18. Answer that the app isn't designed for children. With no age group
under 18, the Families policy doesn't apply.

**News app**: No. **Government app**: No. **Financial features**: None. **Health**: None.

**Data safety**. These answers match `legal/PRIVACY_POLICY.md` and the iOS privacy manifest.
- Data is **encrypted in transit**: Yes.
- People **can request deletion**: Yes.
- **Shared** with third parties: none (AWS, Firebase, Twilio and Google Safe Browsing process
  data on Katkee's behalf, which Google doesn't count as sharing).

| Data type (Google's names) | Collected | Required or optional | Purposes |
|---|---|---|---|
| Location: Approximate location | Yes | Optional (Nearby Stories, location sticker) | App functionality, Personalization |
| Personal info: Name | Yes | Required | App functionality, Account management |
| Personal info: Email address | Yes | Required | App functionality, Account management |
| Personal info: User IDs | Yes | Required | App functionality, Analytics |
| Personal info: Phone number | Yes | Optional (phone sign-in) | Account management |
| Personal info: Other info (date of birth; bio, interests) | Yes | Required (the date of birth; bio and interests are optional) | App functionality, Account management, Fraud prevention, security and compliance (the date of birth confirms the person is 18 or older; it is never used for ads), Personalization, Advertising or marketing (interests choose Sponsored Stories, when on) |
| Messages: Other in-app messages | Yes | Optional | App functionality |
| Photos and videos: Photos; Videos (Stories, profile and cover photos, chat photos, and the ID photo sent with an optional verification request) | Yes | Optional | App functionality, Fraud prevention, security and compliance (the ID photo is only seen by staff reviewing verification and deleted afterwards) |
| Audio: Voice or sound recordings (sound in video Stories, voice messages in chats) | Yes | Optional | App functionality |
| App activity: App interactions (views, likes, follows) | Yes | Required | App functionality, Analytics, Personalization |
| App activity: Other user-generated content (captions, comments, feedback sent from Settings) | Yes | Optional | App functionality |
| App info and performance: Crash logs (crash reports to Katkee's own server: the error, its trace, the screen, phone model and app version); Diagnostics | Yes | Required | App functionality, Analytics |
| Device or other IDs (the push token) | Yes | Optional | App functionality |

If Sponsored Stories stay off, remove "Advertising or marketing".

**Account deletion**: Play asks for a web page where people can ask to delete their account.
Enter `https://katkee.com/delete-account`. It gives the in-app steps, the email route, and what
is deleted when.

## 7. Store listing

Under **Grow users**, **Store presence**, **Main store listing**:

| Field | Katkee |
|---|---|
| App name (30 characters) | Katkee |
| Short description (80) | Share Stories that disappear in 24 hours. Keep the best as Highlights. |
| App icon (512 x 512, 32-bit PNG) | `brand/store/google-play-icon-512.png` |
| Feature graphic (1024 x 500) | `brand/store/google-play-feature-graphic-1024x500.png` |
| Phone screenshots (2 to 8) | From the release build on a phone: Home, a creator page, Create, Messages, Activity. Real screens only |
| Category | Social |
| Contact email | support@katkee.com |
| Website | https://katkee.com |

Full description (up to 4,000 characters):

```
Katkee is Stories, and nothing else.

Share your day as Stories that disappear after 24 hours, and keep the moments that matter as
Highlights on your profile.

Home
• Stories from people you follow, with new creators near you mixed in
• Tap right for the next Story, tap left to go back
• Swipe up or down to move between people
• Hold to pause, double-tap to like

Create
• A full-screen camera for photos and video
• Flash, timer, front and back camera
• Add photos and videos from your gallery
• Text, drawing, stickers and music from a free library of songs

Search, Activity and Messages
• Find people by username or name, and follow them from your results
• Likes, comments, mentions, new followers and follow requests in one place
• Private one-to-one messages that arrive as they're sent

Your profile
• A ring around your photo when you have a Story
• Highlights, three to a row
• Insights for your own Stories. Who viewed them is visible only to you

Safety and privacy
• Make your account private and approve who follows you
• Block, mute and report from any profile, Story, comment or message
• Nearby Stories is optional, and uses a city-sized area, never your exact location
• We don't sell your data

Katkee is for people 18 and older.
```

**Countries and regions** (Test and release, Production, Countries / regions): choose
**Add countries / regions**, tick **all**, and keep "New countries and regions" on so Katkee
is offered wherever Google adds one. The legal pages cover users everywhere
(`legal/README.md`, "Worldwide release", has what to check with a lawyer). Play also asks for
your **EU trader status** (Policy, App content, then Digital Services Act).

## 8. Test, then release

1. **Internal testing** (Test and release, Testing, Internal testing): create a release, upload
   `app-release.aab`, add up to 100 testers by email, and install from the opt-in link. No
   review wait.
2. **Closed testing**: required for new personal accounts (12 or more testers, 14 days in a
   row), and useful for everyone. Ask testers to use the app on their own phones.
3. **Pre-launch report**: Play tests every upload on real devices and signs in with the App
   access credentials. Read it before production.
4. **Production**: create a release with the same AAB (or a newer one), and roll out to a
   percentage first (for example 10%), then raise it. The first review usually takes a few days.

Check the release's **App bundle explorer** in Play Console. It shows the permissions the
bundle really asks for, after every library has added its own. Expect internet, network state,
notifications, wake lock, camera, microphone, vibration, approximate location, and biometric
(added by the sign-in storage library; Katkee doesn't ask for it). Precise location, background
location, storage and photo-library permissions should not appear: the manifest removes the
storage permission a file library adds, and the photo picker needs none.

## 9. Every update

1. Raise `appVersion` in `mobile/build-config.json` for a new version (Android and iOS use it),
   and raise `KATKEE_VERSION_CODE` for **every** upload.
2. `npm run build:android-release`, test the APK, upload the AAB, and roll out.
3. When the app is live, add its Play link to `website/site.json` (`website/README.md`). The
   website's "Coming soon" button becomes "Get it on Google Play".

## Not verified here

Building the Android app, signing, running on a phone, push delivery through FCM, the camera and
photo picker, the on-phone photo crop, and Play review. The server is tested against a real
database, and the app in component tests (`RELEASE_READINESS.md`). Device behaviour needs your
testing in step 4.
