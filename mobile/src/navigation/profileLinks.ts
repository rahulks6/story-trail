export function profileUsernameFromPath(path: string): string | null {
  return /^\/?user\/([a-z0-9_.]{3,30})\/?$/i.exec(path)?.[1].toLowerCase() ?? null;
}

export type DeepLinkTarget =
  | { kind: "profile"; username: string }
  | { kind: "story"; storyId: string }
  | { kind: "resetPassword"; email?: string; code?: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Parses the path part of a katkee:// link (React Navigation passes it without the
 * scheme). Anything malformed returns null so the app opens normally instead of
 * navigating somewhere broken.
 */
export function deepLinkTarget(path: string): DeepLinkTarget | null {
  const [rawPath = "", rawQuery = ""] = path.replace(/^\/+/, "").split("?");
  const username = profileUsernameFromPath(rawPath);
  if (username) return { kind: "profile", username };
  const story = /^story\/([^/]+)\/?$/i.exec(rawPath)?.[1];
  if (story) return UUID_RE.test(story) ? { kind: "story", storyId: story.toLowerCase() } : null;
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
