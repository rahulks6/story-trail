# Katkee brand

Updated 12 October 2026, with the approved app icon.

## Name, tagline and wordmark

**Katkee**: mixed case, never all capitals ("KATKEE").

> Story that connects.

The wordmark sets the two halves apart: **Kat** in the text colour and **kee** in the accent,
bold, in the platform's system font. The app's sign-in screen (`LoginScreen.tsx`) and the
website's header (`website/src/layout.html`) draw it this way, as text rather than an image.

## The app icon and the mark

The master is the approved app icon: **`brand/katkee-app-icon-1024.png`** (1024 x 1024, opaque).
Every icon, launch image and store graphic is made from it, by one command:

```sh
node scripts/brand-assets.cjs     # needs backend/node_modules (sharp)
```

The **mark** is the icon without its background: the K and its amber dot. The script traces it
into vector paths and refuses a tracing that drifts from the master's pixels (today: a mean
difference of 0.125 levels out of 255). So the Android icons, the website logo and the in-app
logo are the same shape as the icon, sharp at every size.

| Asset | File | Notes |
| --- | --- | --- |
| iOS app icon | `mobile/ios/KatkeeMobile/Images.xcassets/AppIcon.appiconset/AppIcon-1024.png` | Opaque RGB, as App Store Connect requires; iOS rounds the corners |
| iOS launch screen | `LaunchScreen.storyboard` + `Images.xcassets/LaunchLogo.imageset` | The mark, 112 points tall, on the app's background |
| Android adaptive icon | `res/mipmap-anydpi-v26/ic_launcher*.xml`, `res/drawable/ic_launcher_foreground.xml`, `res/values/ic_launcher_background.xml` | Vector; the mark sits as on the iPhone icon, inside the safe zone of every launcher shape |
| Android themed icon (13+) | `res/drawable/ic_launcher_monochrome.xml` | The mark in one colour; the launcher tints it |
| Android 7 icons | `res/mipmap-*/ic_launcher.png`, `ic_launcher_round.png` | Rounded square and circle, five densities |
| Android launch screen (12+) | `res/values-v31/styles.xml` | The mark on the app's background |
| Android notification icon | `res/drawable/ic_notification.xml` | Shape only (Android tints it with the accent) |
| In-app logo | `mobile/src/components/BrandMark.tsx` (paths in `brandMarkPaths.ts`) | Sign-in and About |
| Website | `website/src/images/`: `katkee-icon.svg`, `favicon.ico`, `apple-touch-icon.png`, `social-card.png` | Header logo, browser tabs, home-screen bookmarks, link previews |
| Google Play | `brand/store/google-play-icon-512.png`, `brand/store/google-play-feature-graphic-1024x500.png` | 32-bit icon; 24-bit feature graphic |
| Vector masters | `brand/katkee-mark.svg`, `brand/katkee-icon.svg` | For print, press and anything else |

Don't redraw, recolour, stretch or add effects to the icon; regenerate from the master instead.

## Colours

Katkee has two palettes, and both are in use:

**The icon artwork** (the master's own three colours):

| Colour | Hex |
| --- | --- |
| Background | `#080C14` |
| The K | `#E4E8F0` |
| The dot | `#FCB020` |

The iOS icon, both launch logos (cut from the master's pixels), the Android adaptive icon's
foreground and background, the website's icon and the store graphics keep these.

**The app's interface** (`mobile/src/theme/colors.ts`, the locked palette of the approved
specification):

| Token | Hex | Used for |
| --- | --- | --- |
| `background` | `#0B0B0B` | Every screen; the launch screens' background; the website's background |
| `surface` | `#141820` | Cards, sheets, inputs |
| `surfaceElevated` | `#1D212A` | Raised elements |
| `border` | `#282C36` | Hairlines |
| `textPrimary` | `#FFFFFF` | Text; the K of the in-app logo; "Kat" |
| `textSecondary` | `#A3A3A3` | Secondary text |
| `accent` | `#FFC800` | Story ring, primary buttons, Follow, Create, badges; the dot of the in-app logo; "kee"; notifications |
| `danger` | `#ED5246` | Destructive actions, errors |
| `success` | `#3FBF7F` | Confirmations |

The in-app logo uses the interface colours, so it matches the wordmark under it. The website
uses the interface palette too.

**A decision for you**: the icon's amber (`#FCB020`) is a little deeper and more orange than
the app's accent (`#FFC800`). They sit side by side only briefly (the icon, then the app). To
make them one colour, either change `accent` in `colors.ts` (the app, the website's
`--accent`, and `notification_accent` in `res/values/colors.xml` follow it) or have the icon
redrawn with `#FFC800`. Until you decide, each keeps its approved value.

## Where the brand appears

- Store listings: the icon, the feature graphic, "Katkee" and the tagline
  (`docs/IOS_APP_STORE_DEPLOYMENT.md`, `docs/GOOGLE_PLAY_DEPLOYMENT.md`).
- katkee.com: the icon in the header and download section, the wordmark, the tagline as the
  headline.
- The app: the launch screen, the sign-in screen (mark, wordmark, tagline), About (mark, name,
  version, tagline).
