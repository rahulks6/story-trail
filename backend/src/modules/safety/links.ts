/**
 * Links in user-written text (comments, DMs, captions, bios) and ad destinations:
 *   - script and data URLs are never accepted, anywhere;
 *   - domains on the Admin-managed blocklist (and their subdomains) are refused;
 *   - when Google Safe Browsing is configured, links it flags are refused (an
 *     unreachable or slow service lets the text through rather than blocking people);
 *   - accounts under a day old can't put links in comments or DMs, and accounts under a
 *     week old can't post look-alike (punycode) domains — the usual spam/phishing shapes.
 */
import { config } from "../../config/env";
import { query, queryOne } from "../../db/psql";
import { HttpError } from "../../http/errors";

export type TextSurface = "comment" | "message" | "caption" | "bio" | "ad_destination";

// Only real script/data/file URLs: "data: 5 GB used" or "File: notes.pdf" are ordinary text.
const DANGEROUS_SCHEME = /\b(?:javascript|vbscript):\S|\bdata:[a-z]+\/[a-z0-9.+-]+[;,]|\bfile:\/\//i;
// Explicit URLs, www. hosts, and bare domains on common top-level domains.
const LINK = /\b(?:https?:\/\/[^\s<>"']+|www\.[^\s<>"']+|(?:[a-z0-9-]+\.)+(?:com|net|org|io|co|in|xyz|info|biz|me|app|link|ly|gl|ru|tk|top|click|site|online|shop|store|live|club|vip|cc|ws)(?:\/[^\s<>"']*)?)/gi;

export interface FoundLink {
  url: string;
  host: string;
}

/** Links in `text`, with lower-cased hosts (punycode as written). */
export function extractLinks(text: string): FoundLink[] {
  const found: FoundLink[] = [];
  for (const match of text.matchAll(LINK)) {
    const raw = match[0].replace(/[.,!?)\]]+$/, "");
    const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
    try {
      const url = new URL(withScheme);
      found.push({ url: url.toString(), host: url.hostname.toLowerCase().replace(/\.$/, "") });
    } catch {
      // Not a parseable URL: nothing to check.
    }
  }
  return found;
}

/** example.com, sub.example.com → ["sub.example.com", "example.com"] (no bare TLD). */
function candidateDomains(host: string): string[] {
  const labels = host.split(".");
  const out: string[] = [];
  for (let i = 0; i < labels.length - 1; i++) out.push(labels.slice(i).join("."));
  return out;
}

export interface LinkReputation {
  /** The subset of `urls` known to be unsafe. */
  unsafe(urls: string[]): Promise<Set<string>>;
}

/** Google Safe Browsing Lookup API v4 (threatMatches:find), with a small verdict cache. */
export class SafeBrowsing implements LinkReputation {
  private readonly cache = new Map<string, { unsafe: boolean; until: number }>();

  constructor(private readonly apiKey: string, private readonly endpoint: string, private readonly timeoutMs = 2000) {}

  async unsafe(urls: string[]): Promise<Set<string>> {
    const now = Date.now();
    const result = new Set<string>();
    const unknown: string[] = [];
    for (const url of urls) {
      const hit = this.cache.get(url);
      if (hit && hit.until > now) {
        if (hit.unsafe) result.add(url);
      } else {
        unknown.push(url);
      }
    }
    if (!unknown.length) return result;
    const res = await fetch(`${this.endpoint}/v4/threatMatches:find?key=${encodeURIComponent(this.apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(this.timeoutMs),
      body: JSON.stringify({
        client: { clientId: "katkee", clientVersion: "1.0" },
        threatInfo: {
          threatTypes: ["MALWARE", "SOCIAL_ENGINEERING", "UNWANTED_SOFTWARE", "POTENTIALLY_HARMFUL_APPLICATION"],
          platformTypes: ["ANY_PLATFORM"],
          threatEntryTypes: ["URL"],
          threatEntries: unknown.map((url) => ({ url })),
        },
      }),
    });
    if (!res.ok) throw new Error(`Safe Browsing ${res.status}`);
    const body = (await res.json()) as { matches?: { threat?: { url?: string } }[] };
    const flagged = new Set((body.matches ?? []).map((m) => m.threat?.url).filter((u): u is string => !!u));
    if (this.cache.size > 5000) this.cache.clear();
    for (const url of unknown) {
      const bad = flagged.has(url);
      this.cache.set(url, { unsafe: bad, until: now + (bad ? 3600_000 : 600_000) });
      if (bad) result.add(url);
    }
    return result;
  }
}

let reputation: LinkReputation | null = config.safety.safeBrowsingApiKey
  ? new SafeBrowsing(config.safety.safeBrowsingApiKey, config.safety.safeBrowsingEndpoint)
  : null;

/** Tests only. */
export function setLinkReputation(next: LinkReputation | null): void {
  reputation = next;
}

const refuse = (message: string) => new HttpError(422, message, { links: message });

/**
 * Throws 422 when `text` contains a link that isn't allowed for this author on this surface.
 * `authorId` is null for Admin-authored ad destinations.
 */
export async function assertLinksAllowed(text: string, surface: TextSurface, authorId: string | null): Promise<void> {
  if (!text) return;
  if (DANGEROUS_SCHEME.test(text)) throw refuse("That link type isn't allowed.");
  const links = extractLinks(text);
  if (!links.length) return;

  if (authorId) {
    const age = await queryOne(`SELECT extract(epoch FROM now() - created_at) / 3600 AS hours FROM users WHERE id = :'id'`, { id: authorId });
    const hours = Number(age?.hours ?? 0);
    if (hours < 24 && (surface === "comment" || surface === "message")) {
      throw refuse("New accounts can share links after their first day.");
    }
    if (hours < 24 * 7 && links.some((l) => l.host.split(".").some((label) => label.startsWith("xn--")))) {
      throw refuse("Links with look-alike characters can't be shared from new accounts.");
    }
  }

  const domains = [...new Set(links.flatMap((l) => candidateDomains(l.host)))];
  const blocked = await query(`SELECT domain FROM blocked_link_domains WHERE domain = ANY (string_to_array(:'domains', ','))`, { domains: domains.join(",") });
  if (blocked.length) throw refuse(`Links to ${blocked[0]!.domain as string} aren't allowed on Katkee.`);

  if (reputation) {
    try {
      const unsafe = await reputation.unsafe(links.map((l) => l.url));
      if (unsafe.size) throw refuse("That link was flagged as unsafe.");
    } catch (error) {
      if (error instanceof HttpError) throw error;
      // The check is a safety net, not a gate: an outage must not stop people posting.
      console.warn(JSON.stringify({ event: "link_reputation_unavailable", error: (error as Error).message }));
    }
  }
}
