import { query } from "../../db/psql";
import { NEVER_LEARNED_JSON, TOPICS_JSON, topicsOf, type Topic } from "../../shared/topics";
import * as usersRepo from "../users/users.repository";
import {
  TOPIC_DAILY_CAP,
  TOPIC_HALF_LIFE_DAYS,
  TOPIC_SCORE_MAX,
  TOPIC_SCORE_MIN,
  TOPIC_SIGNALS,
  type TopicProfile,
  type TopicSignal,
} from "./scoring";

/** A removed topic stays at 0, and out of Home's ranking, for this long. */
const PIN_OUT_DAYS = 30;

/** The stored score as it is now (migration 0060: it halves every 14 days since updated_at). */
const DECAYED = (alias: string) =>
  `(${alias}.score * power(0.5::float8, (extract(epoch FROM now() - ${alias}.updated_at) / 86400.0 / ${TOPIC_HALF_LIFE_DAYS})::float8))`;

/** How much of today's cap the row has left (a new day starts from the full cap). */
const LEFT_TODAY = `GREATEST(:'cap'::float8 - CASE WHEN a.day = current_date THEN a.day_change ELSE 0 END, 0)`;

/**
 * Moves the viewer's score for the topics of a Story (its own topic, or its owner's profile
 * interests when it has none) or, with only a creator, that creator's topics (their profile
 * interests and the topics of their live Stories). One statement: it finds the topics and
 * upserts them, decaying what was stored and keeping each topic within its daily cap. A topic
 * the viewer removed stays at 0 until its pin runs out.
 */
export async function learnFromSignal(viewerId: string, signal: TopicSignal, target: { storyId?: string; creatorId?: string }): Promise<void> {
  if (!target.storyId && !target.creatorId) return;
  await query(
    `WITH canon AS (SELECT value AS topic FROM jsonb_array_elements_text(:'canon'::jsonb)),
     story AS (SELECT s.topic, s.owner_id FROM stories s WHERE s.id = NULLIF(:'story', '')::uuid),
     topics AS (
       SELECT topic FROM story WHERE topic IS NOT NULL
       UNION
       SELECT c.topic FROM story s JOIN users u ON u.id = s.owner_id
         CROSS JOIN LATERAL jsonb_array_elements_text(u.interests_json::jsonb) i(v) JOIN canon c ON lower(c.topic) = lower(trim(i.v))
       WHERE s.topic IS NULL
       UNION
       SELECT c.topic FROM users u CROSS JOIN LATERAL jsonb_array_elements_text(u.interests_json::jsonb) i(v) JOIN canon c ON lower(c.topic) = lower(trim(i.v))
       WHERE u.id = NULLIF(:'creator', '')::uuid AND NOT EXISTS (SELECT 1 FROM story)
       UNION
       SELECT s.topic FROM stories s
       WHERE s.owner_id = NULLIF(:'creator', '')::uuid AND NOT EXISTS (SELECT 1 FROM story)
         AND s.topic IS NOT NULL AND s.deleted_at IS NULL AND s.expires_at > now()
     )
     INSERT INTO viewer_topic_affinity AS a (viewer_id, topic, score, updated_at, day, day_change)
     SELECT :'viewer', t.topic, sign(:'delta'::float8) * LEAST(abs(:'delta'::float8), :'cap'::float8), now(), current_date, LEAST(abs(:'delta'::float8), :'cap'::float8)
     FROM topics t
     WHERE t.topic NOT IN (SELECT value FROM jsonb_array_elements_text(:'never'::jsonb))
     ON CONFLICT (viewer_id, topic) DO UPDATE SET
       score = CASE WHEN a.pinned_out_until > now() THEN 0
                    ELSE LEAST(GREATEST(${DECAYED("a")} + sign(:'delta'::float8) * LEAST(abs(:'delta'::float8), ${LEFT_TODAY}), :'min'::float8), :'max'::float8) END,
       day_change = CASE WHEN a.pinned_out_until > now() THEN 0
                         ELSE CASE WHEN a.day = current_date THEN a.day_change ELSE 0 END + LEAST(abs(:'delta'::float8), ${LEFT_TODAY}) END,
       day = current_date,
       updated_at = now()`,
    {
      canon: TOPICS_JSON,
      never: NEVER_LEARNED_JSON,
      story: target.storyId ?? "",
      creator: target.creatorId ?? "",
      viewer: viewerId,
      delta: TOPIC_SIGNALS[signal],
      cap: TOPIC_DAILY_CAP,
      min: TOPIC_SCORE_MIN,
      max: TOPIC_SCORE_MAX,
    },
  );
}

/** The viewer's learned scores as they are now, strongest first, without topics they removed. */
export async function learnedScores(viewerId: string): Promise<Array<{ topic: Topic; score: number }>> {
  const rows = await query(
    `SELECT a.topic, ${DECAYED("a")} AS score FROM viewer_topic_affinity a
     WHERE a.viewer_id = :'viewer' AND (a.pinned_out_until IS NULL OR a.pinned_out_until <= now())
     ORDER BY score DESC, a.topic`,
    { viewer: viewerId },
  );
  return rows.map((r) => ({ topic: r.topic as Topic, score: Number(r.score) }));
}

/** What Home ranks a viewer's interests by: the topics among their chosen interests and their learned scores. */
export async function viewerTopicProfile(viewerId: string): Promise<TopicProfile> {
  const [user, learned] = await Promise.all([usersRepo.findUserById(viewerId), learnedScores(viewerId)]);
  return { chosen: topicsOf(user?.interests ?? []), learned: new Map(learned.map((l) => [l.topic, l.score])) };
}

/** "Remove" in Settings > Your interests: back to 0, and kept there for 30 days. */
export async function forgetTopic(viewerId: string, topic: Topic): Promise<void> {
  await query(
    `INSERT INTO viewer_topic_affinity (viewer_id, topic, score, updated_at, pinned_out_until)
     VALUES (:'viewer', :'topic', 0, now(), now() + make_interval(days => :'days'::integer))
     ON CONFLICT (viewer_id, topic) DO UPDATE SET score = 0, day_change = 0, updated_at = now(), pinned_out_until = EXCLUDED.pinned_out_until`,
    { viewer: viewerId, topic, days: PIN_OUT_DAYS },
  );
}
