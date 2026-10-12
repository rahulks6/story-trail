# App Store and Google Play: submission checklist

Updated 12 October 2026. The step-by-step guides are `docs/IOS_APP_STORE_DEPLOYMENT.md` and
`docs/GOOGLE_PLAY_DEPLOYMENT.md`; the order of the whole launch is in `LAUNCH.md`. This page is
the checklist of what each store asks for, and where Katkee stands.

## Done in this repository

| Item | Where |
| --- | --- |
| Identity: name **Katkee**, bundle ID and package name **`com.katkee.app`**, version 1.0.0 | `mobile/build-config.json`, Xcode, Gradle |
| App icon, every size, from the approved artwork; launch screens; notification icon | `BRAND.md` |
| Google Play icon (512 x 512, 32-bit) and feature graphic (1024 x 500) | `brand/store/` |
| Privacy Policy, Terms, Help Center and account deletion pages | https://katkee.com/privacy, /terms, /support, /delete-account (`website/`) |
| Support contact | support@katkee.com |
| Listing text: short and full description, keywords | `docs/GOOGLE_PLAY_DEPLOYMENT.md`, section 7; `docs/IOS_APP_STORE_DEPLOYMENT.md`, section 7 |
| Privacy answers: Apple App Privacy and Google Data safety, matching the policy | The two store guides |
| In-app account deletion (Apple 5.1.1(v); Google's account deletion policy) | Settings, then Delete account; and https://katkee.com/delete-account |
| User-generated content safety (Apple 1.2): terms at sign-up, report, block, moderation | Report on Stories, comments, messages and profiles; Block and Mute; a moderation queue in the Admin console |
| Login services (Apple 4.8): email and phone sign-in; Google hidden on iPhone unless configured | `mobile/src/config/providers.ts` |
| Location: approximate only, opt-in, never for ads | Nearby Stories; the location sticker |
| No tracking, no advertising identifier, no third-party analytics or ad SDKs | Privacy manifest; Data safety: nothing shared |
| Encryption: standard HTTPS only (`ITSAppUsesNonExemptEncryption` = NO) | `Info.plist` |
| Android: target API 36, 16 KB page-size check, AAB build | `docs/GOOGLE_PLAY_DEPLOYMENT.md` |

## Still yours to do

### Accounts and legal
- [ ] Apple Developer Program (US$99 a year) and Google Play Console (US$25 once). As a company,
      both need a D-U-N-S number.
- [ ] Register `com.katkee.app` as an App ID on the Apple Developer site (with Push
      Notifications).
- [ ] Check the name "Katkee" is free on both stores.
- [ ] A lawyer's review of the Privacy Policy and Terms (`legal/README.md`), and the Grievance
      Officer's name for India.
- [ ] The mailboxes: support@, privacy@ and grievance@katkee.com.

### Live services
- [ ] The backend and website deployed at api.katkee.com and katkee.com, and `npm run check:live`
      passing (`LAUNCH.md`). Both stores reject a submission whose policy or support page doesn't
      load.
- [ ] Firebase for push (`google-services.json`, `GoogleService-Info.plist`, an APNs key).
- [ ] A demo account for the reviewers, with a photo, a few public Stories and a Highlight.

### From the real app (needs native builds and phones)
- [ ] Screenshots: iPhone 6.9-inch (3 to 10), Android phone (2 to 8). Real screens only: Home, a
      creator page, Create, Messages, Activity. Both stores reject mock-ups that don't match the
      app.
- [ ] Every flow tested on an iPhone and an Android phone (the checklists in the two guides).

### Forms
- [ ] Content rating: Apple's questionnaire and IARC (Google). With user-generated content and
      open messages, expect 12+ (Apple) and Teen (IARC). Answer for what the app allows.
- [ ] Google: target audience 13 and over; Ads: Yes if Sponsored Stories are on; app access
      with the demo account.
- [ ] Apple: export compliance is already answered in the app.

### Every release
- Raise `appVersion` in `mobile/build-config.json` for a new version (Xcode's Version must
  match; the release check enforces it).
- iOS: raise the Build number for every upload. Android: raise `KATKEE_VERSION_CODE` for every
  upload.
