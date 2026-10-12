# App Store & Play Store submission checklist

Everything a reviewer or a store's submission form will actually ask for,
organized by what's already true of this codebase vs. what you still need
to produce yourself (assets, accounts, and judgment calls no one else can
make for you). Cross-reference `DEPLOYMENT.md` for the build/submit steps
themselves — this file is the content checklist.

## Already true of this codebase (verify, don't rebuild)

- **Account deletion, in-app** (Apple guideline 5.1.1(v), required for any
  app with account creation): Settings, then Delete account
  (`AccountSecurityScreen.tsx`). It confirms your identity, deletes the
  account's Stories, blocks login and revokes sessions. See
  `backend/README.md`'s Phase 12 section.
- **User-generated-content safety** (Apple guideline 1.2): a working
  Report flow (Story, comment, or account — `ReportSheet.tsx` → a real
  moderator queue) and Block/Mute, all real and tested since Phases 5/10.
  Apple's guideline also mentions "the ability to filter objectionable
  content" — this build satisfies it with a human moderation queue and
  reactive reporting, not automated image scanning (no NSFW-detection API
  is wired in). If a reviewer specifically flags this, the fallback is a
  real automated content-moderation API (AWS Rekognition / Google Cloud
  Vision SafeSearch both have real, well-documented APIs) gating media
  upload — a genuine follow-up, not something to fake now.
- **Third-party login** (updated 12 October 2026). Email and phone sign-in
  don't trigger Apple's guideline 4.8. Google sign-in exists, but the
  iPhone app shows it only when `googleIosClientId` is set in
  `mobile/src/config/providers.ts`. Leave it empty for the App Store,
  unless you also add Sign in with Apple, which 4.8 then requires.
- **Terms at sign-up** (guideline 1.2): the sign-up and onboarding screens
  say that joining agrees to the Terms and Privacy Policy, with zero
  tolerance for objectionable content and abuse.
- **No ad SDK, no data broker, no data sale.** Katkee's own Sponsored
  Stories choose ads by interests and platform, and advertisers see only
  totals.
- **HTTPS-only once deployed per `DEPLOYMENT.md`** — satisfies iOS App
  Transport Security and both stores' "uses encryption in transit"
  questions with the standard/exempt answer (see Export Compliance below).

## What you still need to do yourself

### Accounts
- [ ] Apple Developer Program — $99/yr, developer.apple.com/programs
- [ ] Google Play Console — $25 one-time, play.google.com/console

### App identity
- [ ] Pick a real bundle identifier (iOS, e.g. `com.yourcompany.katkee`)
      and application ID (Android, e.g. `com.yourcompany.katkee`) —
      reverse-DNS, can't contain spaces, can't be changed after your first
      submission. Set these when you bootstrap the native project (see
      `DEPLOYMENT.md`).
- [ ] App name availability — check it's not already taken on either
      store before you commit to it everywhere else (domain, socials).

### Visual assets (none of these exist yet — no image-generation tool
was used to fake them; produce real ones)
- [ ] App icon: a single 1024×1024 PNG, no transparency, no rounded
      corners (both stores apply their own mask). Every other size is
      generated from this one by Xcode/Android Studio or `npx
      @bam.tech/react-native-make` — you don't hand-produce each size.
- [ ] Splash/launch screen matching the icon's branding.
- [ ] Feature graphic (Android only): 1024×500 PNG/JPG, shown at the top
      of your Play Store listing.
- [ ] Screenshots — **need the app actually running** (simulator, EAS
      preview build, or a physical device — see `DEPLOYMENT.md`), so
      these can't be produced until after your first successful build.
      Apple: at minimum one 6.7" (iPhone 15 Pro Max-class) set; add 6.5"
      and iPad sets if you support iPad. Google: phone screenshots
      required (min 2, up to 8), tablet optional. Show real screens —
      Home feed, Story viewer, a profile, the DM thread, Activity — not
      marketing mockups; both stores reject screenshots that don't match
      the actual app.

### Store listing copy
- [ ] App name, subtitle (iOS)/short description (Android, 80 chars max)
- [ ] Full description (Android: 4000 chars max)
- [ ] Keywords (iOS: 100 chars, comma-separated, not shown to users)
- [ ] Support URL and support/contact email (both stores require these,
      separate from the privacy policy)
- [ ] Marketing URL (optional, iOS)

### Privacy Policy & Terms of Service
- [ ] Publish `legal/PRIVACY_POLICY.md` and `legal/TERMS_OF_SERVICE.md`
      at real, public URLs (e.g. `yourapp.com/privacy`,
      `yourapp.com/terms`) — **have an actual lawyer review both first**,
      per their own top-of-file notes. Neither store accepts a policy
      that isn't actually reachable at submission time.

### Apple "App Privacy" (Data Safety's iOS equivalent — a structured
form in App Store Connect, not free text)
**Updated 12 October 2026.** Use the table in
[`docs/IOS_APP_STORE_DEPLOYMENT.md`](docs/IOS_APP_STORE_DEPLOYMENT.md),
section 7. It matches `mobile/ios/KatkeeMobile/PrivacyInfo.xcprivacy` and
`legal/PRIVACY_POLICY.md`. Since this checklist was first written, Katkee
also collects:
- **coarse location**: Nearby Stories, opt-in;
- **phone number**: phone sign-in;
- **audio**: video Stories;
- **direct messages**;
- **diagnostics**: crash counts.

Interests can also choose which Sponsored Stories appear (first-party
advertising). Nothing is used for tracking, so answer "No" to every
tracking question.

### Google Play "Data Safety" form
Same underlying facts as above, in Google's own categories: Personal info
(email), Photos/videos, App activity (in-app actions, other user-generated
content), App info and performance. Declare data is encrypted in transit
(true once `DEPLOYMENT.md`'s HTTPS setup is live) and that users can
request deletion (true: in-app under Settings, then Delete account, and via
the support email in the privacy policy). Add coarse location (Nearby
Stories, optional), phone number, audio and messages, as in the Apple table.

### Content rating questionnaires
Both stores run you through a structured questionnaire (IARC for Google,
Apple's own for iOS) covering UGC, messaging, and user interaction — with
open DMs and public UGC, expect this to land around **teen/12+ or
higher**, not "everyone" — answer honestly based on what the app actually
allows; guessing low and getting flagged in review costs you a full
review cycle.

### Export compliance (iOS)
App Store Connect asks whether your app uses encryption. Answer **yes**
(HTTPS/TLS) and that it **only uses the exempt kind** (standard TLS for
authentication/data transport, not custom cryptography) — this is the
standard answer for the overwhelming majority of apps and avoids an
export-compliance document filing; only revisit this if you ever add
custom encryption beyond TLS.

### Reviewer access
Both stores' human reviewers need to actually sign in to evaluate an app
that requires an account. In your submission notes:
- [ ] Provide a real demo account's email + password (create one on your
      deployed backend specifically for this — don't hand out a personal
      account).
- [ ] If review flags anything moderation-related, point them at the
      Report flow and mention the moderator queue exists
      (`backend/README.md`'s Phase 10 section) even though it has no
      dedicated admin UI yet (see that section's own documented gap).

### Versioning, every single submission
- iOS: bump `CFBundleShortVersionString` (marketing version, e.g. 1.0.1)
  for a real release, and `CFBundleVersion` (build number) on **every**
  upload, TestFlight included — it must strictly increase even for the
  same marketing version.
- Android: bump `versionName` (marketing) and `versionCode` (integer,
  strictly increasing) the same way.
- Both live in the native project files generated when you bootstrap (see
  `DEPLOYMENT.md`) — not yet present in this repo.
