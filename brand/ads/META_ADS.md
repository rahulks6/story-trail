# Katkee on Meta (Facebook and Instagram): ad kit

Posters: `node brand/ads/make-meta-ads.cjs <outDir>`: six ideas, each in 1080x1080 (Feed),
1080x1350 (Feed 4:5) and 1080x1920 (Stories and Reels). Real app screens with demo accounts,
no real people.

| # | Idea | Poster headline |
|---|---|---|
| 1 | Close Friends / privacy | Post for your 8. Not 800 strangers. |
| 2 | Music on Stories | Your day, with a song. 🎵 |
| 3 | Friends, chats and calls (Hinglish) | Chai pe chalein? ☕ |
| 4 | Founding member badge | Be one of the first 1,000. |
| 5 | Invite contest (23 Nov to 21 Dec 2026 only) | Invite friends. Win ₹1,000. 🏆 |
| 6 | Idea 1 in Hindi (Devanagari) | अपने 8 के लिए Story डालो। |

## Ad text (paste into Ads Manager)

Meta tests several texts at once: add all of them to each ad ("Add text options").

**Primary text** (above the image)
1. Your Stories, only for your people. 🔒 Post photos and videos with music, choose who sees each one (Everyone, Followers or Close Friends), and chat with your friends. Free on Android.
2. 800 followers ke liye Story kaun daalta hai? 🤨 Katkee pe apne 8 ke liye daalo. 💛 Stories, music, chats aur video calls, sab ek app mein.
3. Lecture bunk, chai pe chalein? ☕ Post it to Close Friends, get voice notes back, video call the one who couldn't come. That's Katkee.
4. Add any song to your Story, pick the best part, add text and stickers. Your day, your way. 🎵
5. The first 1,000 people on Katkee get a numbered Founding member badge for good. ⭐ Join now, it's free.
6. (Contest ad only, until 21 Dec) Invite your friends to Katkee and win a ₹1,000 Amazon voucher! 🏆 Whoever brings the most friends by 21 Dec wins. Open to people in India, 18+. Rules: katkee.com/contest. Not sponsored by Amazon or Meta.

**Primary text in Hindi** (for the Hindi ad set)
1. अपनी Stories सिर्फ़ अपने लोगों के लिए। 🔒 गाने के साथ फ़ोटो और वीडियो डालें, हर Story कौन देखे यह आप चुनें, और दोस्तों से चैट और वीडियो कॉल करें। Android पर फ़्री।
2. 800 फ़ॉलोअर्स के लिए Story कौन डालता है? 🤨 Katkee पर अपने 8 के लिए डालो। 💛 Stories, गाने, चैट और वीडियो कॉल, सब एक ऐप में।
3. अपनी Story में कोई भी गाना जोड़ें, उसका सबसे अच्छा हिस्सा चुनें, टेक्स्ट और स्टिकर लगाएँ। 🎵
4. (Contest ad only) दोस्तों को Katkee पर बुलाएँ और ₹1,000 का Amazon वाउचर जीतें! 🏆 21 दिसंबर तक सबसे ज़्यादा दोस्त लाने वाला जीतेगा। भारत में 18+ के लिए। नियम: katkee.com/contest

**Headline** (under the image, 40 characters or fewer)
- Stories for your people
- Apne logon ke liye Stories 💛
- Get your Founding member badge
- Stories, chats and video calls
- Invite friends, win ₹1,000 🏆 (contest ad)
- अपने लोगों के लिए Stories 💛 (Hindi)
- दोस्त बुलाओ, ₹1,000 जीतो 🏆 (Hindi contest ad)

**Description** (optional)
- Free on Google Play
- Made in India 🇮🇳

**Button**: Install Now

The contest ad must link the rules (katkee.com/contest), say it's open to people in India
aged 18+, end on 21 Dec, and never show Amazon's logo. Turn it off on 21 Dec.

Don't claim anything the app doesn't do, and don't say "best", "#1" or "most private";
Meta rejects or limits ads that overclaim.

## Setting it up (first time)

1. **Meta Business account**: business.facebook.com. Create one with the Katkee Facebook Page
   and Instagram account, and add a payment method (₹, UPI or card).
2. **Register the app**: developers.facebook.com → My Apps → Create app → Other → Business.
   Settings → Basic → Add platform → Android: package `com.katkee.app`, Play Store link.
   Then Business settings → Accounts → Apps → add it, and link it to your ad account.
3. **Install tracking**: Katkee doesn't use Meta's SDK (it would share app activity with
   Meta). Run the objective **Traffic** to this Play Store link, which tells the app the
   install came from Meta, so Admin > New users shows "Meta ads" (app release 97 and later):

   https://play.google.com/store/apps/details?id=com.katkee.app&referrer=utm_source%3Dmeta%26utm_medium%3Dpaid_social%26utm_campaign%3Dmeta_test

## Campaign (first two weeks)

- **Objective**: Traffic, destination the Play Store link above.
- **Budget**: ₹300 a day for 7 days to test; two ad sets (English, Hindi), ₹150 each.
- **Audience**: India, ages 18–34 (never under 18: Katkee is 18+), Android only, languages English and Hindi. Leave interests
  empty (Advantage+ audience); at most add "Instagram", "Snapchat", "College", "Friendship".
- **Placements**: Advantage+ placements. Meta picks the right poster size for each spot when
  all three sizes are uploaded to the same ad ("Customize for each placement").
- **Ads**: English ad set: ideas 1–5 (and the 15 s app demo video, brand/promo). Hindi ad set: idea 6 and idea 5 with the Hindi texts. Each ad with its three sizes.

## Reading the results

After 3–4 days look at **cost per click** (Traffic) or **cost per install** (App promotion)
per ad, and pause the worst one or two. After a week move the budget to the best. Compare
with Play Console → Statistics → User acquisition, and keep an eye on how many new people
post a Story: cheap installs that never open the app twice don't help.

Rough Indian benchmarks: ₹3–10 per link click, ₹15–40 per install for a new social app.
