# Katkee on Meta (Facebook and Instagram): ad kit

Posters: `node brand/ads/make-meta-ads.cjs <outDir>`: four ideas, each in 1080x1080 (Feed),
1080x1350 (Feed 4:5) and 1080x1920 (Stories and Reels). Real app screens with demo accounts,
no real people.

| # | Idea | Poster headline |
|---|---|---|
| 1 | Close Friends / privacy | Post for your 8. Not 800 strangers. |
| 2 | Music on Stories | Your day, with a song. 🎵 |
| 3 | Friends, chats and calls (Hinglish) | Chai pe chalein? ☕ |
| 4 | Founding member badge | Be one of the first 1,000. |

## Ad text (paste into Ads Manager)

Meta tests several texts at once: add all of them to each ad ("Add text options").

**Primary text** (above the image)
1. Your Stories, only for your people. 🔒 Post photos and videos with music, choose who sees each one (Everyone, Followers or Close Friends), and chat with your friends. Free on Android.
2. 800 followers ke liye Story kaun daalta hai? 🤨 Katkee pe apne 8 ke liye daalo. 💛 Stories, music, chats aur video calls, sab ek app mein.
3. Lecture bunk, chai pe chalein? ☕ Post it to Close Friends, get voice notes back, video call the one who couldn't come. That's Katkee.
4. Add any song to your Story, pick the best part, add text and stickers. Your day, your way. 🎵
5. The first 1,000 people on Katkee get a numbered Founding member badge for good. ⭐ Join now, it's free.

**Headline** (under the image, 40 characters or fewer)
- Stories for your people
- Apne logon ke liye Stories 💛
- Get your Founding member badge
- Stories, chats and video calls

**Description** (optional)
- Free on Google Play
- Made in India 🇮🇳

**Button**: Install Now

Don't claim anything the app doesn't do, and don't say "best", "#1" or "most private";
Meta rejects or limits ads that overclaim.

## Setting it up (first time)

1. **Meta Business account**: business.facebook.com. Create one with the Katkee Facebook Page
   and Instagram account, and add a payment method (₹, UPI or card).
2. **Register the app**: developers.facebook.com → My Apps → Create app → Other → Business.
   Settings → Basic → Add platform → Android: package `com.katkee.app`, Play Store link.
   Then Business settings → Accounts → Apps → add it, and link it to your ad account.
3. **Install tracking (choose one)**
   - *Start now, no app change*: objective **Traffic**, destination the Play Store link
     (https://play.google.com/store/apps/details?id=com.katkee.app). Meta counts link clicks,
     not installs; Play Console shows the installs.
   - *Better, needs a release*: add Meta's SDK to the app so Meta counts installs and
     optimizes for them (objective **App promotion → App installs**). This shares install
     and app-open events with Meta, so the privacy policy and Play's Data safety form must
     say so before it ships.

## Campaign (first two weeks)

- **Objective**: App promotion (with the SDK) or Traffic (without).
- **Budget**: ₹500–700 a day for 14 days, as one campaign and one ad set (Advantage+), so Meta
  learns faster than with many small ad sets.
- **Audience**: India, ages 18–30, Android only, languages English and Hindi. Leave interests
  empty (Advantage+ audience); at most add "Instagram", "Snapchat", "College", "Friendship".
- **Placements**: Advantage+ placements. Meta picks the right poster size for each spot when
  all three sizes are uploaded to the same ad ("Customize for each placement").
- **Ads**: four ads, one per idea, each with its three sizes and all the text options.

## Reading the results

After 3–4 days look at **cost per click** (Traffic) or **cost per install** (App promotion)
per ad, and pause the worst one or two. After a week move the budget to the best. Compare
with Play Console → Statistics → User acquisition, and keep an eye on how many new people
post a Story: cheap installs that never open the app twice don't help.

Rough Indian benchmarks: ₹3–10 per link click, ₹15–40 per install for a new social app.
