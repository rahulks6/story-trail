# Store listing and App Store Optimisation (ASO)

The listing text for Google Play and the App Store, written for search. It describes only what
the app does today. Keep it that way, because both stores reject listings that promise features
the app doesn't have.

Keywords people search for in this category: *stories app, status, story maker, chat, voice
notes, group chat, friends, festival wishes, Diwali status, private, social app*.

## Google Play

Play ranks on the **title, short description and full description**, so keywords go in all three.
Use them naturally; repeating a keyword over and over is against policy.

| Field | Text | Length |
|---|---|---|
| App name (30) | `Katkee: Stories & Chat` | 22 |
| Short description (80) | `Share daily Stories, voice notes & group chats with friends. Festival wishes too` | 80 |

**Full description** (4,000 limit):

```
Katkee is the Stories app for your people. Share your day as Stories that disappear after 24 hours, chat with friends, send voice notes, and celebrate every festival together.

📸 STORIES THAT DISAPPEAR IN 24 HOURS
• Post photo and video Stories from the camera or your gallery
• Add text in stylish fonts, stickers, drawings, filters and music
• Mention friends, add your location and a caption
• Keep your best moments as Highlights on your profile
• Close Friends: share a Story with only your closest people

✨ STORIES PICKED FOR WHAT YOU LOVE
• Choose your interests: cricket, food, travel, Bollywood, music, festivals, fashion and more
• Your Home learns what you enjoy and shows you more of it
• Discover new creators and people near you (optional)

💬 CHAT, VOICE NOTES & GROUP CHATS
• Private messages that arrive instantly
• Voice notes, photos and videos in chat
• React with a tap, reply to any message, pin and forward
• Group chats with up to 32 friends
• Reply to a Story straight from the Story

🪔 FESTIVAL WISHES & GREETINGS
• Festival greetings and stickers for Diwali, Holi, Eid, Christmas and more
• A special festival Story ring, so everyone sees your celebration

👤 A PROFILE THAT LOOKS LIKE YOU
• Profile photo and cover photo
• Your interests, bio and Highlights
• A verified badge for public figures and creators
• Insights for your own Stories: who viewed them is visible only to you

🔒 SAFE AND PRIVATE
• Private account: approve who follows you
• Block, mute and report from any profile, Story, comment or message
• Nearby is optional and never shows your exact location
• Delete your account any time from Settings
• We don't sell your data

🌗 Light and dark mode.

Katkee is for people 18 and older.
Questions? support@katkee.com · katkee.com
```

**Screenshots** (up to 8; the first 3 matter most). Take them from the release build on a
phone. Use real screens only, with a short caption on top of each:
1. A Story with text and stickers: "Your day, as Stories"
2. The interests screen: "Picked for what you love"
3. A chat with a voice note and a reaction: "Chats that feel alive"
4. A group chat: "Group chats with up to 32 friends"
5. A festival Story with a greeting: "Celebrate every festival"
6. A profile with a cover photo and Highlights: "Keep the best as Highlights"
7. The Story editor's text styles: "Text, stickers, music"
8. Privacy settings: "Private when you want it"

**Promo video:** upload one of the reels to YouTube and paste the link.

## App Store

Apple ranks on the **name, subtitle and keyword field**, but not the description. Don't repeat in
the keyword field any word that's already in the name or subtitle.

| Field | Text | Length |
|---|---|---|
| Name (30) | `Katkee: Stories & Chat` | 22 |
| Subtitle (30) | `Status, voice notes & friends` | 29 |
| Keywords (100, comma-separated, no spaces) | `story,maker,group,festival,wishes,diwali,status,video,photo,share,private,social,daily,camera,vlog` | 98 |
| Promotional text (170, can change without review) | `This Diwali, share the glow 🪔 Festival greetings, Stories that disappear in 24 hours, voice notes and group chats with your people.` | ~130 |

The description is the same as Play's above. Leave out "Light and dark mode" if you need room.

Don't put competitors' names (for example WhatsApp or Instagram) in any field: Apple rejects
them (guideline 2.3.7), and Play treats them as misleading.

## Getting downloads faster

1. **Ratings early.** Ask happy testers to rate the app on the first day. Ratings and reviews
   move rankings the most. (The app should ask in-app only after a good moment, such as after
   posting a third Story, never at launch.)
2. **Reply to every review** in Play Console within a day.
3. **Seasonal promo text.** Change the iOS promotional text and the first line of the Play
   description for each festival (Diwali, Christmas, Holi). It needs no review on iOS.
4. **Localise.** Add a Hindi listing (Play Console → Store listing → Manage translations). Most
   users in India search in English, but a Hindi listing ranks in Hindi searches with almost no
   competition.
5. **Link from Instagram.** Put the store link in the bio and say "link in bio" in every reel.
   Installs that come from outside the store also lift the store ranking.
6. **Custom store listing** (Play): a festival-themed listing for traffic from Instagram, with
   Diwali screenshots.
7. **Store listing experiments** (Play): test two icons, or two first screenshots, for a week.

## Before you submit

**Play:**
- [ ] Closed test: 12+ testers opted in for 14 days in a row (needed for new personal developer
  accounts), then **apply for production** with the questionnaire
- [ ] Data safety form filled in as in GOOGLE_PLAY_DEPLOYMENT.md
- [ ] Content rating questionnaire (social, user-generated content, 18+)
- [ ] Target audience 18+; Child safety standards URL: https://katkee.com/child-safety
- [ ] Account deletion URL: https://katkee.com/delete-account
- [ ] "Contains ads": Yes only if Sponsored Stories are switched on

**App Store:**
- [ ] Google sign-in stays hidden on iPhone (no iOS Google client ID) unless Sign in with Apple is
  added (guideline 4.8)
- [ ] A review account with a username and password in App Review notes, and Stories already on it
- [ ] Report, block, and the 18+ age rating are in place (guideline 1.2, user-generated content)
- [ ] Privacy labels as in IOS_APP_STORE_DEPLOYMENT.md
