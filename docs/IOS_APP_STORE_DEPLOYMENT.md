# Putting Katkee on iPhone and the App Store

Last updated 12 October 2026.

> **iOS status: BLOCKED in this environment (no Mac).** The iOS app has not been built,
> signed, run on an iPhone or uploaded. Everything below happens on a Mac with Xcode. Expect to
> fix a few things on the first native build: CocoaPods resolution, Firebase and the Nitro
> camera modules have never been compiled for iOS here.

What is already done in the code, and what only you can do:

| Already in the code | Only you can do |
|---|---|
| Bundle ID `com.katkee.app`, version 1.0.0, production API `https://api.katkee.com/` (`mobile/build-config.json`, Xcode) | Join the Apple Developer Program and register the bundle ID |
| Your app icon (`AppIcon-1024.png`, opaque, 1024 x 1024) and a launch screen with your mark on the app's background | Deploy the backend and website at katkee.com (`LAUNCH.md`) |
| Privacy Policy, Terms and Help Center pages, served at katkee.com/privacy, /terms and /support | Firebase project and APNs key for push |
| iPhone-only, portrait, iOS 15.1+, React Native 0.87 | Screenshots, a demo account and the review submission |
| Camera, microphone, photos and location explanations (`Info.plist`); approximate location only; standard encryption declared | |
| Privacy manifest (`PrivacyInfo.xcprivacy`) listing what the app collects; no tracking | |
| In-app account deletion, report, block, moderation, terms notice at sign-up (App Review 1.2 and 5.1.1(v)) | |
| Google sign-in hidden on iOS unless configured (avoids the Sign in with Apple rule, 4.8) | |
| A release check that refuses to build until all of this is set (`check-release.cjs`). It passes today | |

---

## 1. What you need

- **A Mac** with the Xcode version App Store Connect currently requires (Xcode 26 or later in
  2026), plus Node 22, Ruby with Bundler, and Git.
- **An Apple Developer Program membership** (US$99 a year; Apple shows the price in rupees when
  you enrol from India) at <https://developer.apple.com/programs/>. Katkee is a sole
  proprietorship, which Apple enrols as an **individual**: sign up with your own Apple Account,
  and the App Store shows your legal name, Rahul Katakdhond, as the seller. (Organization
  enrolment needs a legal entity with a D-U-N-S number; if you later form a company, Apple can
  move the membership to it.)
- **An iPhone** on iOS 15.1 or later, for testing.
- **The backend and website live at katkee.com** (step 2). The app does nothing without the
  API, and App Review opens the Privacy Policy and Support pages.
- **Have a lawyer review the Privacy Policy and Terms** before launch (`legal/README.md` lists
  what to check), and create the mailboxes the pages give: support@, privacy@ and
  grievance@katkee.com.

## 2. Deploy the backend first

1. Follow `LAUNCH.md` and `infra/README.md`. They create the API, the worker, PostgreSQL, S3
   and CloudFront for media, SES email and alarms in AWS ap-south-1, and serve
   `https://api.katkee.com` and the website at `https://katkee.com`.
2. Check it from the repository root: `npm run check:live` must pass every line (the API's
   health, the Privacy Policy, Terms, Help Center and account deletion pages, and the www
   redirect). Then run the other checks after a deploy in `infra/README.md`, section 4.
3. **Push notifications** (`docs/REALTIME_AND_PUSH.md`, "Setup"):
   1. Create a Firebase project and add an iOS app with your bundle ID (step 3).
   2. In the Apple Developer site, create an **APNs auth key** (.p8) under Keys and upload it
      to Firebase, under Project settings, then Cloud Messaging.
   3. Download `GoogleService-Info.plist`. You'll add it in Xcode in step 5; it's ignored by git
      on purpose.
   4. Give the backend the Firebase service account (`FCM_SERVICE_ACCOUNT_JSON`). Turn push on
      with the infra setting `providers`, as `infra/README.md` describes.
4. Create a **demo account** for Apple's reviewers, with a profile photo, a few public Stories
   and a Highlight, so the reviewer sees a working app.

## 3. Register the bundle ID

The identifiers are set and confirmed: the bundle ID is **`com.katkee.app`** (reverse-DNS of
katkee.com), in `mobile/build-config.json` and in Xcode (the test target is
`com.katkee.app.tests`). It can never change after the first upload.

1. On <https://developer.apple.com/account/resources/identifiers>, add an **App ID** with the
   bundle ID `com.katkee.app`, and turn on **Push Notifications**.
2. `mobile/build-config.json` already holds the release values:

   ```json
   {
     "developmentApiUrl": "",
     "productionApiUrl": "https://api.katkee.com/",
     "androidApplicationId": "com.katkee.app",
     "iosBundleId": "com.katkee.app",
     "appVersion": "1.0.0",
     "releaseIdentifiersConfirmed": true,
     "privacyPolicyUrl": "https://katkee.com/privacy",
     "termsUrl": "https://katkee.com/terms",
     "supportUrl": "https://katkee.com/support"
   }
   ```

   The Privacy Policy and Terms links also appear on the sign-up screen, and in Settings, then
   About; Help links to the Help Center.
3. The check passes:

   ```sh
   npm run check:ios-release
   ```

   It runs again automatically in every Release build and stops the build if anything is
   missing or wrong: the addresses, the bundle IDs, the version, the icon (1024 x 1024 and
   opaque) and the privacy manifest.

## 4. The app icon and launch screen

Both are in the project, made from your artwork (`brand/katkee-app-icon-1024.png`):
- `Images.xcassets/AppIcon.appiconset/AppIcon-1024.png`: one 1024 x 1024 opaque image, from
  which Xcode makes every other size;
- `LaunchScreen.storyboard`: your mark (`LaunchLogo`) centred on the app's background, so
  launching flows straight into the app.

If the artwork changes, replace the master and run `node scripts/brand-assets.cjs`
(`BRAND.md`).

## 5. Build and run on your iPhone

```sh
git clone <your repository> katkee && cd katkee
npm --prefix mobile ci
cd mobile && bundle install
cd ios && bundle exec pod install && cd ..
open ios/KatkeeMobile.xcworkspace          # the workspace, not the .xcodeproj
```

In Xcode, select the **KatkeeMobile** target:

1. **Signing & Capabilities**:
   - Team: your developer team.
   - Automatically manage signing: on.
   - Bundle Identifier: `com.katkee.app` (already set, for Debug and Release).
   - Add the **Push Notifications** capability if it isn't listed. The entitlements file says
     `development`; App Store signing switches it to production by itself.
2. **General**: Version = `appVersion` (for example 1.0.0). Build = 1, then raise the Build
   number on every upload.
3. Drag `GoogleService-Info.plist` into the KatkeeMobile group, with "Copy items if needed"
   and the KatkeeMobile target ticked.
4. **Google sign-in on iOS**: leave `googleIosClientId` empty in
   `mobile/src/config/providers.ts`. The app then hides the Google button on iPhone. If you
   want Google on iPhone, App Review (guideline 4.8) also expects **Sign in with Apple**, which
   Katkee doesn't have yet. Email and phone sign-in don't trigger that rule.
5. Plug in your iPhone, choose it as the run destination and press Run (Debug). On iOS 16 or
   later, turn on Developer Mode on the phone when asked.

**Test these on the phone before uploading:**
- sign up (the terms line links work), log in, log out and log back in;
- Home:
  - tap right for the next Story, tap left for the previous one;
  - swipe up and down between people;
  - hold to pause, double-tap to like;
- Create: camera, gallery, editor, publish; the Story appears on Home and your profile ring;
- profile:
  - Edit Profile: take a photo, move and scale it, Save;
  - leave with unsaved changes (the Discard prompt);
  - Highlights;
  - someone else's page: Follow, Message, More;
- Settings, then Privacy:
  - Nearby Stories on and off: the location prompt says "approximate";
  - private account;
- DMs, Activity, push notifications with the app closed, and the badge after reading;
- report a Story and block an account; delete a test account (Settings, then Delete
  account).

## 6. Archive and upload

1. In Xcode, set the run destination to **Any iOS Device (arm64)**.
2. Product, then **Archive**. The Release build runs the release check first and stops with a
   list if anything is missing.
3. In the Organizer, choose the archive, then **Distribute App**, then **App Store Connect**,
   then Upload. Keep "Upload your app's symbols" on.
4. The build appears in App Store Connect, under the app's TestFlight tab, after processing
   (usually 10 to 30 minutes). Apple emails you if something is wrong.

## 7. Set up the app in App Store Connect

At <https://appstoreconnect.apple.com>, open Apps, then +, then **New App**:
- Platform: iOS.
- Name: "Katkee" (must be unique on the App Store; have an alternative ready).
- Primary language.
- Bundle ID: `com.katkee.app`.
- SKU: any internal code, such as `katkee-ios`.

**App Information**
- Category: **Social Networking**.
- Content Rights: say whether the app shows third-party content. Users post their own.
- Age Rating: answer the questionnaire honestly. Katkee has **user-generated content** and
  **messaging**, and anyone can post. The questionnaire decides the rating; if App Store
  Connect lets you set a higher rating than the calculated one, choose 18+, to match the Terms.
  Whatever the store rating, the app refuses anyone under 18 at sign-up (date of birth, checked
  on the server).

**Pricing and Availability**: Free. For the India launch, under Availability, choose **India**
only. You can add countries later without a new build (update the legal pages first:
`legal/README.md`).

**App Privacy** (the "nutrition label"). Add the Privacy Policy URL,
`https://katkee.com/privacy`, then declare these. They
match `mobile/ios/KatkeeMobile/PrivacyInfo.xcprivacy`, and none is used for tracking.

| Data type | Linked to the person | Tracking | Used for |
|---|---|---|---|
| Name | Yes | No | App Functionality |
| Email Address | Yes | No | App Functionality |
| Other Data Types (date of birth, to confirm the person is 18 or older) | Yes | No | App Functionality |
| Phone Number (only if phone sign-in is on) | Yes | No | App Functionality |
| Coarse Location (only with Nearby Stories on) | Yes | No | App Functionality, Product Personalization |
| Photos or Videos | Yes | No | App Functionality |
| Audio Data (sound in video Stories) | Yes | No | App Functionality |
| Emails or Text Messages (direct messages) | Yes | No | App Functionality |
| Other User Content (bio, captions, comments, interests) | Yes | No | App Functionality, Product Personalization, Developer's Advertising (interests choose which Sponsored Stories appear) |
| User ID | Yes | No | App Functionality, Analytics |
| Product Interaction (views, likes, follows) | Yes | No | App Functionality, Analytics, Product Personalization |
| Other Diagnostic Data (crash counts) | Yes | No | Analytics |

Advertisers never see who anyone is, and messages and location are never used for ads.

If you leave Sponsored Stories off (the `features` infra setting), remove "Developer's
Advertising" here and in the privacy manifest.

**Version page (1.0)**
- **Screenshots**: 3 to 10 portrait screenshots at the 6.9-inch iPhone size (for example
  1320 x 2868 or 1290 x 2796 pixels). Take them on a large iPhone or the Xcode simulator: Home,
  a creator page, Create, DMs, Highlights.
- **Promotional text, description, keywords**: for example "Stories-only social app.
  Share moments that disappear after 24 hours, keep the best in Highlights, find people near
  you."
- **Support URL**: `https://katkee.com/support`. **Marketing URL**: `https://katkee.com`.
- **Build**: pick the build you uploaded.
- **App Review Information**: sign-in required, so give the demo account's email and password.
  Contact details. In the notes, tell the reviewer:
  - Katkee is Stories-only: no posts or Reels, and Stories expire after 24 hours.
  - Katkee is for people 18 and older: sign-up asks for a date of birth (the demo account is
    an adult's).
  - **Report**: a Story's More menu, a profile's More menu, and pressing and holding a
    message. **Block**: a profile's More menu. A moderation team reviews reports in the Admin console; say how fast
    you respond.
  - **Delete account**: Settings, then Delete account (it confirms your identity first).
  - **Nearby Stories** is optional, uses approximate location only, and can be turned off in
    Settings, then Privacy.
  - Sponsored Stories are labelled "Sponsored".
- **Export compliance**: already answered in the app (`ITSAppUsesNonExemptEncryption` = NO;
  it only uses standard HTTPS).

## 8. TestFlight, then review

1. **TestFlight**: add yourself and your team as internal testers (up to 100, no review), and
   install from the TestFlight app. For outside testers, create an external group; the first
   build goes through a short Beta App Review.
2. When it's ready, on the version page choose **Add for Review**, then **Submit**. Reviews
   usually take one to two days.
3. When the app is live, add its App Store link to `website/site.json` (`website/README.md`):
   the website's "Coming soon" button becomes "Download on the App Store".
4. If it's rejected, the message names the guideline. Fix it, raise the Build number, upload,
   then reply in App Store Connect or submit again.

### What App Review checks, and where Katkee stands

| Guideline | What it needs | Katkee |
|---|---|---|
| 1.2 User-generated content | Agree to terms with no tolerance for objectionable content; filter; report; block; published contact | Terms notice at sign-up and onboarding; moderation and link safety; Report on Stories, profiles and messages; Block; Support URL |
| 2.1 App completeness | A working backend, a demo account, no placeholder content | Your steps 2 and 7 |
| 4.8 Login services | Sign in with Apple beside Google, Facebook and similar | Google hidden on iPhone unless configured |
| 5.1.1 Data collection | Clear purpose strings; ask only when needed | Camera, microphone, photos and location ask in context; location is opt-in and approximate |
| 5.1.1(v) Account deletion | Delete the account inside the app | Settings, then Delete account |
| 5.1.2 Data use | No tracking without permission | No tracking, no advertising identifier, so no tracking prompt |

## 9. After release

- Use a **phased release** (7 days) to watch for problems first.
- **Monitoring**: the infra alarms email you. Add a crash reporter before launch: Sentry is
  wired as a stub in `mobile/src/crashReporting.ts`. Today only JavaScript crash counts are
  recorded.
- **Every update**:
  1. Raise `appVersion` in `build-config.json` and Version in Xcode (they must match), and
     raise the Build number.
  2. Archive, upload, add the new build to a new version, and submit.

## Not verified here

Native iOS compilation, signing, running on an iPhone, push delivery through APNs, the camera
and photo picker, the on-phone photo crop, and App Store review. Phases 1 to 11 are tested
against a real database and in app component tests (`RELEASE_READINESS.md`). Device behaviour
needs your testing in step 5.
