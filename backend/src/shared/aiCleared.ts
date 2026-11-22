import { config } from "../config/env";

/**
 * Whether a Story may be shown to strangers (Explore, discovery, festival rings, Highlights to
 * explore, the website, Crossed paths): only once the automatic check found nothing unsafe in it
 * (stories/story-ai.ts). Its owner's followers see it at once; strangers a few seconds later. A
 * Story the check couldn't read is let through after a day (by then a Story has gone, and only a
 * Highlight is left). With the check off (no key), everything passes, as before. `alias` is the
 * stories row.
 */
export function aiClearedSql(alias = "s"): string {
  if (!(config.storyAi.enabled && /^sk-ant-/.test(config.storyAi.apiKey))) return "true";
  return `(coalesce(${alias}.ai_safety, 'ok') = 'ok' AND (${alias}.ai_checked_at IS NOT NULL OR ${alias}.created_at < now() - interval '1 day'))`;
}
