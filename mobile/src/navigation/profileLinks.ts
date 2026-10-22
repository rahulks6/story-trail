/** Shared profiles and Stories are katkee.com addresses, so they work for people without the app. */
export const WEB_ORIGIN = "https://katkee.com";

/**
 * What the app opens: its own katkee:// links (push notifications, reset emails, links shared by
 * older versions) and katkee.com links (Android App Links and iOS Universal Links send /u/ and /s/
 * here). www redirects to katkee.com on the web, but a pasted link may still carry it.
 */
export const LINK_PREFIXES = ["katkee://", WEB_ORIGIN, "https://www.katkee.com"];

/** The path part of a link the app handles ("user/asha?id=…"), or null for any other URL. */
export function linkPath(url: string): string | null {
  for (const prefix of LINK_PREFIXES) {
    if (!url.toLowerCase().startsWith(prefix)) continue;
    const rest = url.slice(prefix.length);
    // "https://katkee.com.evil.example/u/x" shares the prefix but not the host.
    if (prefix !== "katkee://" && rest !== "" && !/^[/?#]/.test(rest)) return null;
    return rest;
  }
  return null;
}

/** katkee://user/<name> and, on the web, katkee.com/u/<name>. */
export function profileUsernameFromPath(path: string): string | null {
  return /^\/?(?:user|u)\/([a-z0-9_.]{3,30})\/?$/i.exec(path)?.[1].toLowerCase() ?? null;
}

export type DeepLinkTarget =
  // `userId` (from ?id=) finds the person even after a rename; the name is the fallback.
  | { kind: "profile"; username: string; userId?: string }
  | { kind: "story"; storyId: string }
  | { kind: "conversation"; conversationId: string }
  | { kind: "activity" }
  | { kind: "home" }
  | { kind: "followRequests" }
  | { kind: "resetPassword"; email?: string; code?: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Parses the path part of a katkee:// or katkee.com link (React Navigation passes it without
 * the prefix). Anything malformed returns null so the app opens normally instead of
 * navigating somewhere broken.
 */
export function deepLinkTarget(path: string): DeepLinkTarget | null {
  const [rawPath = "", rawQuery = ""] = path.replace(/^\/+/, "").split("?");
  const username = profileUsernameFromPath(rawPath);
  if (username) {
    const userId = new URLSearchParams(rawQuery).get("id")?.toLowerCase();
    return { kind: "profile", username, ...(userId && UUID_RE.test(userId) ? { userId } : {}) };
  }
  const story = /^(?:story|s)\/([^/]+)\/?$/i.exec(rawPath)?.[1];
  if (story) return UUID_RE.test(story) ? { kind: "story", storyId: story.toLowerCase() } : null;
  // Push notifications: a DM thread, or the Activity tab.
  const conversation = /^conversation\/([^/]+)\/?$/i.exec(rawPath)?.[1];
  if (conversation) return UUID_RE.test(conversation) ? { kind: "conversation", conversationId: conversation.toLowerCase() } : null;
  if (/^activity\/?$/i.test(rawPath)) return { kind: "activity" };
  // Festival greetings, streaks and reminders open Home (and its festival ring).
  if (/^home\/?$/i.test(rawPath)) return { kind: "home" };
  if (/^follow-requests\/?$/i.test(rawPath)) return { kind: "followRequests" };
  if (/^reset-password\/?$/i.test(rawPath)) {
    const query = new URLSearchParams(rawQuery);
    const email = query.get("email")?.trim().toLowerCase();
    const code = query.get("code")?.trim();
    return {
      kind: "resetPassword",
      ...(email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? { email } : {}),
      ...(code && /^\d{6}$/.test(code) ? { code } : {}),
    };
  }
  return null;
}

/**
 * The link Share profile sends: the account ID keeps it working after a rename. It opens the
 * app where it's installed, and katkee.com's "Open in Katkee" page anywhere else.
 */
export function profileShareLink(username: string, userId: string): string {
  return `${WEB_ORIGIN}/u/${username}?id=${userId}`;
}

/** The link a shared Story carries (Share via…, Copy link). */
export function storyShareLink(storyId: string): string {
  return `${WEB_ORIGIN}/s/${storyId}`;
}
