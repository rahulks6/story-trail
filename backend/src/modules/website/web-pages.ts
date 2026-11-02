/**
 * The HTML of a public web profile (katkee.com/u/<username>) and of a public Story on it
 * (/s/<story id>), filled into website/src/pages/profile.html's markers. Every value from an
 * account or Story is escaped here; the player gets the Stories as a JSON data block, escaped so
 * nothing in it can end the block early.
 */
import type { WebAccount, WebProfile } from "./web-profile";

/** The template's markers, from the build's manifest (website/build.cjs WEB_MARKERS). */
export interface WebMarkers {
  title: string; description: string; linkPath: string; robots: string; ogType: string; image: string; imageAlt: string; card: string;
  appLink: string; start: string; cover: string; avatar: string; name: string; badge: string; handle: string; category: string;
  stats: string; bio: string; interests: string; stories: string; data: string;
}

export const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** JSON that is safe inside <script type="application/json">: no "<", ">" or "&", no line separators. */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

const CATEGORY_LABELS: Record<string, string> = {
  creator: "Creator", artist: "Artist", public_figure: "Public figure", brand: "Brand", news_media: "News & media", organization: "Organization",
};

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const exact = new Intl.NumberFormat("en");
const count = (n: number, one: string, many: string) =>
  `<li><strong title="${exact.format(n)}">${compact.format(n)}</strong> ${n === 1 ? one : many}</li>`;

const BADGE = '<svg class="verified-badge" viewBox="0 0 24 24" width="22" height="22" role="img" aria-label="Verified">'
  + '<path fill="currentColor" d="M12 1.5l2.6 1.9 3.2-.1 1 3.1 2.6 1.9-1 3.1 1 3.1-2.6 1.9-1 3.1-3.2-.1L12 22.5l-2.6-1.9-3.2.1-1-3.1-2.6-1.9 1-3.1-1-3.1 2.6-1.9 1-3.1 3.2.1z"/>'
  + '<path fill="none" stroke="#0B0B0B" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" d="M7.5 12.3l3 3 6-6.3"/></svg>';

/** The photo's address on this site; ?v= changes with the photo, so a new one is never served from a cache. */
export const photoPath = (account: WebAccount) => (account.photoId ? `/u/${account.username}/photo?v=${account.photoId.slice(0, 8)}` : null);
const coverPath = (account: WebAccount) => (account.coverId ? `/u/${account.username}/cover?v=${account.coverId.slice(0, 8)}` : null);

const clip = (value: string, max: number) => {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
};

/**
 * Every marker's value for one page: the profile, or (with `storyId`) the profile with that
 * Story playing. `origin` is the website's (https://katkee.com); `fallbackImage` the site's
 * social card, for an account without a photo.
 */
export function webPageValues(profile: WebProfile, storyId: string | null, origin: string, fallbackImage: string): Record<keyof WebMarkers, string> {
  const { account, stories, highlights } = profile;
  const name = account.displayName || account.username;
  const photo = photoPath(account);
  const cover = coverPath(account);
  const initial = `<span class="profile-initial" aria-hidden="true">${escapeHtml(Array.from(name)[0]?.toUpperCase() ?? "K")}</span>`;
  const photoImg = photo ? `<img src="${escapeHtml(photo)}" width="112" height="112" alt="${escapeHtml(`${name}'s profile photo`)}">` : initial;
  const avatar = stories.length
    ? `<a class="profile-avatar has-stories" href="/s/${stories[0]!.id}" data-play="stories" aria-label="${escapeHtml(`Watch ${name}'s Story`)}">${photoImg}</a>`
    : `<span class="profile-avatar">${photoImg}</span>`;
  const story = storyId ? stories.find((s) => s.id === storyId) ?? null : null;

  const highlightList = highlights.length
    ? `<section class="profile-highlights wrap-narrow" aria-labelledby="highlights-title">\n<h2 class="profile-section-title" id="highlights-title">Highlights</h2>\n<ul class="highlight-list">\n${highlights.map((h) =>
      `<li><button class="highlight" type="button" data-play="highlight:${h.id}"><span class="highlight-cover"><img src="${escapeHtml(h.cover)}" width="72" height="72" alt="" loading="lazy"></span><span class="highlight-title">${escapeHtml(h.title || "Highlight")}</span></button></li>`).join("\n")}\n</ul>\n</section>`
    : "";
  const empty = !stories.length && !highlights.length ? '<p class="profile-empty wrap-narrow">No Stories to show right now.</p>' : "";

  const description = story
    ? clip(story.caption || `Watch ${name}'s Story on Katkee before it disappears.`, 160)
    : clip(account.bio ? `${account.bio} · ${compact.format(account.followers)} ${account.followers === 1 ? "follower" : "followers"} on Katkee` : `See ${name}'s Stories and Highlights on Katkee.`, 160);
  const image = story ? `${origin}${story.image}` : photo ? `${origin}${photo}` : fallbackImage;

  return {
    title: story ? `Story by ${name} (@${account.username}) · Katkee` : `${name} (@${account.username}) · Katkee`,
    description,
    linkPath: story ? `s/${story.id}` : `u/${account.username}`,
    // A Story lasts a day: worth a link preview, not a search result. Profiles are indexed.
    robots: story ? "noindex" : "index, follow",
    ogType: story ? "article" : "profile",
    image,
    imageAlt: story ? `A Story by ${name}` : photo ? `${name}'s profile photo` : "The Katkee app icon",
    card: story ? "summary_large_image" : "summary",
    appLink: story ? `katkee://story/${story.id}` : `katkee://user/${account.username}?id=${account.id}`,
    start: story?.id ?? "",
    cover: cover ? `<img src="${escapeHtml(cover)}" width="1200" height="400" alt="">` : "",
    avatar,
    name: escapeHtml(name),
    badge: account.verified ? BADGE : "",
    handle: escapeHtml(account.username),
    category: account.professionalCategory ? ` <span class="profile-category">· ${escapeHtml(CATEGORY_LABELS[account.professionalCategory] ?? account.professionalCategory)}</span>` : "",
    stats: `<ul class="profile-stats">${count(account.followers, "follower", "followers")}${count(account.following, "following", "following")}</ul>`,
    bio: account.bio ? `<p class="profile-bio">${escapeHtml(account.bio.trim()).replace(/\r?\n/g, "<br>")}</p>` : "",
    interests: account.interests.length ? `<ul class="profile-interests" aria-label="Interests">${account.interests.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>` : "",
    stories: highlightList + empty,
    data: jsonForScript({ owner: { username: account.username, name, verified: account.verified, photo }, stories, highlights }),
  };
}

/** Values that are text (title, description, ...) are escaped here; the rest are already HTML. */
const TEXT_KEYS: (keyof WebMarkers)[] = ["title", "description", "linkPath", "robots", "ogType", "image", "imageAlt", "card", "appLink", "start"];

/** One pass, so a value that happens to contain a marker (a bio saying "%WEB_DATA%") stays as it is. */
export function fillWebPage(template: string, markers: WebMarkers, values: Record<keyof WebMarkers, string>): string {
  const byMarker = new Map((Object.keys(markers) as (keyof WebMarkers)[]).map((key) => [markers[key], key]));
  const pattern = new RegExp([...byMarker.keys()].map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g");
  return template.replace(pattern, (marker) => {
    const key = byMarker.get(marker)!;
    return TEXT_KEYS.includes(key) ? escapeHtml(values[key]) : values[key];
  });
}
