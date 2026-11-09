/**
 * What a push says, in the recipient's language (users.locale): English, Hindi or Marathi, worded
 * like the app (mobile/src/i18n/GLOSSARY.md). Usernames, group names, festival names and anything
 * people wrote stay as they are. The title is always "Katkee".
 */
import { formatCount, type Locale } from "../../shared/locale";
import { ar, de, es, fr, id, pt } from "./push-text-world";

export type VerificationOutcome = "approved" | "denied" | "removed" | "restored";

export interface PushText {
  /** Someone did something: likes, comments, follows, messages... keyed by outbox kind. */
  actor: Record<string, (actor: string) => string>;
  someone: string;
  call: (actor: string, video: boolean) => string;
  missedCall: (actor: string, video: boolean) => string;
  countdown: (title: string, owner: string) => string;
  milestone: (views: number) => string;
  festival: (emoji: string, greeting: string, name: string) => string;
  streak: (days: number) => string;
  nudgeFirst: string;
  nudgeBack: string;
  scheduledLive: string;
  scheduledFailed: string;
  verification: Record<VerificationOutcome, string>;
  groupMessage: (actor: string, group: string | null) => string;
  reaction: (actor: string, emoji: string) => string;
  /** Someone's very first Story: worth a hello, so it says so. */
  firstStory: (actor: string) => string;
}

const en: PushText = {
  actor: {
    like: (a) => `@${a} liked your Story`,
    comment: (a) => `@${a} commented on your Story`,
    mention: (a) => `@${a} mentioned you`,
    follow: (a) => `@${a} started following you`,
    follow_request: (a) => `@${a} requested to follow you`,
    follow_accepted: (a) => `@${a} accepted your follow request`,
    invite_joined: (a) => `@${a} joined from your invite`,
    // Never the message itself: lock screens and notification logs are not private.
    message: (a) => `@${a} sent you a message`,
    new_story: (a) => `@${a} posted a new Story`,
    collab_invite: (a) => `@${a} invited you to a collab Story`,
    collab_accepted: (a) => `@${a} accepted your collab Story`,
  },
  firstStory: (a) => `@${a} posted their first Story on Katkee 👋 Say hi`,
  someone: "someone",
  call: (a, video) => (video ? `@${a} is video calling you` : `@${a} is calling you`),
  missedCall: (a, video) => `Missed ${video ? "video" : "voice"} call from @${a}`,
  countdown: (title, owner) => `⏰ ${title} — @${owner}'s countdown has ended`,
  milestone: (views) => `Your Story reached ${formatCount(views, "en")} views 🎉`,
  festival: (emoji, greeting, name) => `${emoji} ${greeting}! Share your ${name} Story on Katkee`,
  streak: (days) => `🔥 Keep your ${days}-day streak going: post a Story today`,
  nudgeFirst: "Share your first Story: your friends on Katkee will see it 👋",
  nudgeBack: "Your friends miss your Stories 👀 Share what you're up to today",
  scheduledLive: "Your scheduled Story is live",
  scheduledFailed: "Your scheduled Story couldn't be posted. Open Katkee to see why.",
  verification: {
    approved: "You're verified. Your badge now shows on your profile.",
    denied: "Your verification request wasn't approved.",
    removed: "Your verified badge was removed.",
    restored: "Your verified badge is back on your profile.",
  },
  groupMessage: (a, group) => `@${a} sent a message in ${group ?? "your group"}`,
  reaction: (a, emoji) => `@${a} reacted ${emoji} to your message`,
};

const hi: PushText = {
  actor: {
    like: (a) => `@${a} ने आपकी स्टोरी लाइक की`,
    comment: (a) => `@${a} ने आपकी स्टोरी पर कमेंट किया`,
    mention: (a) => `@${a} ने आपको मेंशन किया`,
    follow: (a) => `@${a} ने आपको फ़ॉलो करना शुरू किया`,
    follow_request: (a) => `@${a} आपको फ़ॉलो करना चाहते हैं`,
    follow_accepted: (a) => `@${a} ने आपकी फ़ॉलो रिक्वेस्ट स्वीकार की`,
    invite_joined: (a) => `@${a} आपके इनवाइट से Katkee पर आए`,
    message: (a) => `@${a} ने आपको मैसेज भेजा`,
    new_story: (a) => `@${a} ने नई स्टोरी पोस्ट की`,
    collab_invite: (a) => `@${a} ने आपको कोलैब स्टोरी के लिए इनवाइट किया`,
    collab_accepted: (a) => `@${a} ने आपकी कोलैब स्टोरी स्वीकार की`,
  },
  firstStory: (a) => `@${a} ने Katkee पर अपनी पहली स्टोरी पोस्ट की 👋 हाय कहें`,
  someone: "कोई",
  call: (a, video) => (video ? `@${a} आपको वीडियो कॉल कर रहे हैं` : `@${a} आपको कॉल कर रहे हैं`),
  missedCall: (a, video) => `@${a} की मिस्ड ${video ? "वीडियो" : "वॉइस"} कॉल`,
  countdown: (title, owner) => `⏰ ${title} — @${owner} का काउंटडाउन खत्म हो गया`,
  milestone: (views) => `आपकी स्टोरी ${formatCount(views, "hi")} व्यूज़ तक पहुँच गई 🎉`,
  festival: (emoji, greeting, name) => `${emoji} ${greeting}! Katkee पर अपनी ${name} स्टोरी शेयर करें`,
  streak: (days) => `🔥 अपनी ${days} दिन की स्ट्रीक जारी रखें: आज एक स्टोरी पोस्ट करें`,
  nudgeFirst: "अपनी पहली स्टोरी शेयर करें: Katkee पर आपके दोस्त उसे देखेंगे 👋",
  nudgeBack: "आपके दोस्त आपकी स्टोरीज़ मिस कर रहे हैं 👀 आज आप क्या कर रहे हैं, शेयर करें",
  scheduledLive: "आपकी शेड्यूल की गई स्टोरी पोस्ट हो गई",
  scheduledFailed: "आपकी शेड्यूल की गई स्टोरी पोस्ट नहीं हो सकी। वजह जानने के लिए Katkee खोलें।",
  verification: {
    approved: "आप वेरिफ़ाइड हैं। आपका बैज अब आपकी प्रोफ़ाइल पर दिखता है।",
    denied: "आपका वेरिफ़िकेशन अनुरोध मंज़ूर नहीं हुआ।",
    removed: "आपका वेरिफ़ाइड बैज हटा दिया गया।",
    restored: "आपका वेरिफ़ाइड बैज फिर से आपकी प्रोफ़ाइल पर है।",
  },
  groupMessage: (a, group) => `@${a} ने ${group ?? "आपके ग्रुप"} में मैसेज भेजा`,
  reaction: (a, emoji) => `@${a} ने आपके मैसेज पर ${emoji} रिएक्ट किया`,
};

const mr: PushText = {
  actor: {
    like: (a) => `@${a} यांनी तुमची स्टोरी लाईक केली`,
    comment: (a) => `@${a} यांनी तुमच्या स्टोरीवर कमेंट केली`,
    mention: (a) => `@${a} यांनी तुम्हाला मेंशन केले`,
    follow: (a) => `@${a} यांनी तुम्हाला फॉलो करायला सुरुवात केली`,
    follow_request: (a) => `@${a} तुम्हाला फॉलो करू इच्छितात`,
    follow_accepted: (a) => `@${a} यांनी तुमची फॉलो रिक्वेस्ट स्वीकारली`,
    invite_joined: (a) => `@${a} तुमच्या आमंत्रणावरून Katkee वर आले`,
    message: (a) => `@${a} यांनी तुम्हाला मेसेज पाठवला`,
    new_story: (a) => `@${a} यांनी नवीन स्टोरी पोस्ट केली`,
    collab_invite: (a) => `@${a} यांनी तुम्हाला कोलॅब स्टोरीसाठी आमंत्रित केले`,
    collab_accepted: (a) => `@${a} यांनी तुमची कोलॅब स्टोरी स्वीकारली`,
  },
  firstStory: (a) => `@${a} यांनी Katkee वर पहिली स्टोरी पोस्ट केली 👋 हाय म्हणा`,
  someone: "कोणीतरी",
  call: (a, video) => (video ? `@${a} तुम्हाला व्हिडिओ कॉल करत आहेत` : `@${a} तुम्हाला कॉल करत आहेत`),
  missedCall: (a, video) => `@${a} यांचा मिस्ड ${video ? "व्हिडिओ" : "व्हॉइस"} कॉल`,
  countdown: (title, owner) => `⏰ ${title} — @${owner} यांचे काउंटडाउन संपले`,
  milestone: (views) => `तुमच्या स्टोरीने ${formatCount(views, "mr")} व्ह्यूज गाठले 🎉`,
  festival: (emoji, greeting, name) => `${emoji} ${greeting}! Katkee वर तुमची ${name} स्टोरी शेअर करा`,
  streak: (days) => `🔥 तुमची ${days} दिवसांची स्ट्रीक चालू ठेवा: आज एक स्टोरी पोस्ट करा`,
  nudgeFirst: "तुमची पहिली स्टोरी शेअर करा: Katkee वरचे तुमचे मित्र ती पाहतील 👋",
  nudgeBack: "तुमचे मित्र तुमच्या स्टोरीज मिस करत आहेत 👀 आज काय करताय ते शेअर करा",
  scheduledLive: "तुमची शेड्यूल केलेली स्टोरी पोस्ट झाली",
  scheduledFailed: "तुमची शेड्यूल केलेली स्टोरी पोस्ट करता आली नाही. कारण पाहण्यासाठी Katkee उघडा.",
  verification: {
    approved: "तुम्ही व्हेरिफाइड आहात. तुमचा बॅज आता तुमच्या प्रोफाइलवर दिसतो.",
    denied: "तुमची व्हेरिफिकेशन विनंती मंजूर झाली नाही.",
    removed: "तुमचा व्हेरिफाइड बॅज काढला गेला.",
    restored: "तुमचा व्हेरिफाइड बॅज पुन्हा तुमच्या प्रोफाइलवर आहे.",
  },
  groupMessage: (a, group) => `@${a} यांनी ${group ?? "तुमच्या ग्रुप"} मध्ये मेसेज पाठवला`,
  reaction: (a, emoji) => `@${a} यांनी तुमच्या मेसेजवर ${emoji} रिॲक्ट केले`,
};

export const PUSH_TEXT: Record<Locale, PushText> = { en, hi, mr, es, pt, id, fr, de, ar };

type Params = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * A push-only kind's text from the values queued with it (push_outbox.params), in `locale`; null
 * when they're missing (a row queued before migration 0070), and the stored English body is sent.
 */
export function pushOnlyText(kind: string, params: Params | null, locale: Locale, actor: string | null): string | null {
  const t = PUSH_TEXT[locale];
  // These two say the same thing every time.
  if (kind === "scheduled_story_live") return t.scheduledLive;
  if (kind === "scheduled_story_failed") return t.scheduledFailed;
  if (!params) return null;
  switch (kind) {
    case "story_milestone": {
      const views = num(params.views);
      return views === null ? null : t.milestone(views);
    }
    case "festival": {
      const [emoji, greeting, name] = [str(params.emoji), str(params.greeting), str(params.name)];
      return emoji && greeting && name ? t.festival(emoji, greeting, name) : null;
    }
    case "streak": {
      const days = num(params.days);
      return days === null ? null : t.streak(days);
    }
    case "nudge":
      return params.variant === "first" ? t.nudgeFirst : params.variant === "back" ? t.nudgeBack : null;
    case "verification": {
      const outcome = params.outcome as VerificationOutcome;
      return outcome in t.verification ? t.verification[outcome] : null;
    }
    case "message":
      return actor ? t.groupMessage(actor, str(params.group)) : null;
    case "new_story":
      return actor && params.first === true ? t.firstStory(actor) : null;
    case "message_reaction": {
      const emoji = str(params.emoji);
      return actor && emoji ? t.reaction(actor, emoji) : null;
    }
    default:
      return null;
  }
}
