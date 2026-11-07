// Run by android-walkthrough.sh for flow=store: fills a set of demo accounts with Stories, chats,
// likes and comments against the live API, so mobile/.maestro/store.yaml can capture the real app
// looking the way it does in use, for the Google Play screenshots. Every account is a throwaway
// support+e2e-… account (verified with the run's GitHub OIDC token) and the workflow deletes them
// all at the end. The photos are Unsplash-licensed (free to use commercially, no people's faces),
// downloaded by the walk-through into PHOTOS, plus Katkee's own photos from Pexels (brand/store/photos, see SOURCES.md there).
//
// Usage: node store-seed.mjs <photos dir> <accounts file> <main password>
import { readFileSync, appendFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

const API = "https://api.katkee.com";
const [PHOTOS, ACCOUNTS, MAIN_PASSWORD] = process.argv.slice(2);
const RUN = (process.env.GITHUB_RUN_ID ?? "0").slice(-6);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(method, path, token, body, contentType = "application/json") {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(API + path, {
      method,
      headers: { ...(body !== undefined ? { "Content-Type": contentType } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : contentType === "application/json" ? JSON.stringify(body) : body,
    });
    const text = await res.text();
    if (res.ok) return text ? JSON.parse(text) : {};
    if ((res.status === 429 || res.status >= 500) && attempt < 4) { await sleep(2000 * attempt); continue; }
    throw new Error(`${method} ${path}: ${res.status} ${text.slice(0, 300)}`);
  }
}

async function oidc() {
  const r = await fetch(`${process.env.ACTIONS_ID_TOKEN_REQUEST_URL}&audience=katkee-e2e`, {
    headers: { Authorization: `bearer ${process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` },
  });
  return (await r.json()).value;
}

// The cast: the account the screenshots are taken from, and the friends who post and chat.
const PEOPLE = {
  maya: { displayName: "Maya Kapoor", username: "maya.wanders", bio: "Chasing sunsets and good coffee ☀️", avatar: "avatar-maya", cover: "cover-maya" },
  arjun: { displayName: "Arjun Mehta", username: "arjun.beaches", bio: "Beaches, boats and long walks", avatar: "avatar-arjun" },
  sofia: { displayName: "Sofia Alvarez", username: "sofia.cooks", bio: "Cooking my way around the world", avatar: "avatar-sofia" },
  leo: { displayName: "Leo Bennett", username: "leo.waves", bio: "Surf, sun, repeat", avatar: "avatar-leo" },
  zara: { displayName: "Zara Ahmed", username: "zara.sketches", bio: "Coffee, sketchbooks and slow mornings", avatar: "avatar-zara" },
  kenji: { displayName: "Kenji Sato", username: "kenji.streets", bio: "Street photographer, always walking", avatar: "avatar-kenji" },
};

async function makeAccount(key) {
  const p = PEOPLE[key];
  p.email = `support+e2e-store-${RUN}-${key}@katkee.com`;
  p.password = key === "maya" ? MAIN_PASSWORD : `E2e-${randomBytes(8).toString("hex")}`;
  // Signing up signs in too. Sign-up and log-in share one small budget per network address
  // (10 per 15 minutes), so no extra log-ins: the app's own log-in as Maya needs one more.
  const signup = await call("POST", "/api/v1/auth/signup", null, { displayName: p.displayName, username: p.username, email: p.email, birthDate: "1995-04-12", password: p.password });
  p.token = signup.tokens.accessToken;
  // The token too, so the workflow can delete the account without logging in again.
  appendFileSync(ACCOUNTS, `${p.username} ${p.email} ${p.password} ${p.token}\n`);
  await call("POST", "/api/v1/auth/email/ci-verify", p.token, { token: await oidc() });
  console.log(`account ${p.username}`);
}

async function upload(p, photo) {
  const { media } = await call("POST", "/api/v1/media/photos", p.token, readFileSync(`${PHOTOS}/${photo}.jpg`), "image/jpeg");
  return media.id;
}

async function profile(key) {
  const p = PEOPLE[key];
  const update = { bio: p.bio, avatarMediaId: await upload(p, p.avatar) };
  if (p.cover) update.coverMediaId = await upload(p, p.cover);
  for (let attempt = 1; ; attempt++) {
    try { await call("PATCH", "/api/v1/users/me", p.token, update); return; } catch (e) {
      if (attempt >= 6) throw e;
      await sleep(3000); // the photos may still be processing
    }
  }
}

async function story(key, photo, caption, extra = {}) {
  const p = PEOPLE[key];
  const mediaId = await upload(p, photo);
  let r = await call("POST", "/api/v1/stories", p.token, { mediaId, caption, audience: "public", allowComments: "everyone", ...extra });
  for (let i = 0; !r.story && i < 30; i++) {
    await sleep(2000);
    const { publish } = await call("GET", `/api/v1/stories/publish-requests/${r.publish.requestId}`, p.token);
    if (publish.state === "published") r = { story: publish.story ?? { id: publish.storyId } };
    else if (publish.state === "failed") throw new Error(`story ${photo} failed`);
  }
  if (!r.story) throw new Error(`story ${photo} never published`);
  console.log(`story ${p.username}: ${caption}`);
  return r.story.id;
}

async function chat(a, b) {
  const { conversation } = await call("POST", `/api/v1/users/${PEOPLE[b].username}/conversation`, PEOPLE[a].token, {});
  return conversation.id;
}
async function say(key, conversationId, body, extra = {}) {
  const { message } = await call("POST", `/api/v1/conversations/${conversationId}/messages`, PEOPLE[key].token, { body, ...extra });
  await sleep(1200); // so the messages keep their order and read as a real exchange
  return message.id;
}

for (const key of Object.keys(PEOPLE)) await makeAccount(key);
for (const key of Object.keys(PEOPLE)) await profile(key);

// Everyone follows everyone: Maya's Home fills with her friends' Stories.
for (const a of Object.keys(PEOPLE)) for (const b of Object.keys(PEOPLE)) {
  if (a !== b) await call("POST", `/api/v1/users/${PEOPLE[b].username}/follow`, PEOPLE[a].token, {});
}

// A song from Katkee's library for one friend's Story.
const { tracks } = await call("GET", "/api/v1/music?limit=10", PEOPLE.leo.token);
const music = tracks?.[0] ? { trackId: tracks[0].id, startMs: 0, durationMs: 15000 } : undefined;

// Maya's own Stories first (her profile, Highlights and Activity), then her friends'.
const mayaStreet = await story("maya", "story-street", "Lost in the little streets of Alsace 🌸");
const mayaSunset = await story("maya", "story-sunset", "That sky tonight 🔥");
const mayaLake = await story("maya", "story-lake", "Clearest water I've ever seen 💙");
await call("POST", "/api/v1/highlights", PEOPLE.maya.token, { title: "Travel", storyIds: [mayaStreet, mayaLake] });
await call("POST", "/api/v1/highlights", PEOPLE.maya.token, { title: "Skies", storyIds: [mayaSunset] });

await story("kenji", "story-city", "City lights from up here ✨");
await story("zara", "story-coffee", "Slow morning, first sketch of the day");
await story("leo", "story-beach", "Found my happy place 🌊", music ? { music } : {});
await story("sofia", "story-food", "Dinner I'm proud of tonight 🌶️ recipe in my Highlights");
await story("arjun", "story-palms", "Island time 🌴 no signal, no problem");

// Likes and comments on Maya's Stories, for her Activity.
for (const key of ["sofia", "arjun", "zara", "leo", "kenji"]) await call("POST", `/api/v1/stories/${mayaStreet}/like`, PEOPLE[key].token, {});
for (const key of ["arjun", "leo"]) await call("POST", `/api/v1/stories/${mayaSunset}/like`, PEOPLE[key].token, {});
await call("POST", `/api/v1/stories/${mayaStreet}/comments`, PEOPLE.sofia.token, { body: "Take me with you next time 😍" });
await call("POST", `/api/v1/stories/${mayaSunset}/comments`, PEOPLE.arjun.token, { body: "That light is unreal" });

// Chats, oldest first; Sofia's is the newest so it tops Maya's inbox.
const group = (await call("POST", "/api/v1/conversations/groups", PEOPLE.arjun.token, {
  usernames: [PEOPLE.maya.username, PEOPLE.leo.username, PEOPLE.zara.username], title: "Weekend trip 🏕️",
})).conversation.id;
await say("arjun", group, "Cabin is booked for Saturday!");
await say("zara", group, "Yesss, I'll bring the board games");
await say("leo", group, "I'm on snacks 🍫");

const kenji = await chat("kenji", "maya");
await say("kenji", kenji, "Sent you the photos from last night");
await say("maya", kenji, "These are amazing, thank you!");

const zara = await chat("zara", "maya");
await say("zara", zara, "Coffee tomorrow? ☕");
await say("maya", zara, "Always. 10 at our usual place?");

const sofia = await chat("sofia", "maya");
await say("sofia", sofia, "Your Alsace Story 😍 when did you go?");
const mayaReply = await say("maya", sofia, "Last week! Every street looks like a postcard 📸");
await call("PUT", `/api/v1/conversations/${sofia}/messages/${mayaReply}/reaction`, PEOPLE.sofia.token, { emoji: "❤️" });
await say("sofia", sofia, "Okay, we're planning a trip together");
await say("maya", sofia, "Deal ✈️ spring?");
await say("sofia", sofia, "Spring it is! I'll start a list 📝");
console.log("seeded");
