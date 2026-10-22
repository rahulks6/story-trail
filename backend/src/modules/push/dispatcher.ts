/**
 * Sends queued pushes (push_outbox). Text is rendered at send time from current data,
 * so renames apply and blocked, deleted or suspended actors are skipped; preferences
 * are re-checked; DM text never leaves the server in a push. Invalid device tokens are
 * disabled; transient provider failures retry with backoff. A 'badge' item (queued
 * when a read lowers the unread total, migration 0036) silently sets the iPhone
 * app-icon badge to the total at send time.
 */
import { config } from "../../config/env";
import { query, queryOne } from "../../db/psql";
import { ApnsProvider, FcmProvider, parseServiceAccount, type PushMessage, type PushProvider } from "./providers";

export type ProviderMap = Map<"fcm" | "apns", PushProvider>;

export function providersFromConfig(): ProviderMap {
  const providers: ProviderMap = new Map();
  if (config.push.fcmServiceAccount) providers.set("fcm", new FcmProvider(parseServiceAccount(config.push.fcmServiceAccount), config.push.fcmEndpoint));
  const a = config.push.apns;
  if (a.keyId && a.teamId && a.privateKey && a.bundleId) {
    providers.set("apns", new ApnsProvider({ keyId: a.keyId, teamId: a.teamId, privateKey: a.privateKey, bundleId: a.bundleId, host: a.host }));
  }
  return providers;
}

interface OutboxItem {
  id: string;
  userId: string;
  kind: string;
  actorId: string | null;
  refId: string | null;
  attempts: number;
  /** Push-only kinds (milestones, festivals, reminders) carry their text and link. */
  body?: string | null;
  link?: string | null;
}

const TEXT: Record<string, (actor: string) => string> = {
  like: (a) => `@${a} liked your Story`,
  comment: (a) => `@${a} commented on your Story`,
  mention: (a) => `@${a} mentioned you`,
  follow: (a) => `@${a} started following you`,
  follow_request: (a) => `@${a} requested to follow you`,
  follow_accepted: (a) => `@${a} accepted your follow request`,
  // Never the message itself: lock screens and notification logs are not private.
  message: (a) => `@${a} sent you a message`,
  new_story: (a) => `@${a} posted a new Story`,
};

/** Which preference switch (migration 0051) silences each newer kind. */
const SWITCH: Record<string, "stories_enabled" | "milestones_enabled" | "reminders_enabled"> = {
  new_story: "stories_enabled",
  story_milestone: "milestones_enabled",
  festival: "reminders_enabled",
  streak: "reminders_enabled",
  nudge: "reminders_enabled",
};

type Rendered = { message: PushMessage } | { skip: string };

/** Exported for tests: what this outbox item would show, or why it is skipped. */
export async function renderPush(item: OutboxItem): Promise<Rendered> {
  const row = await queryOne(
    `SELECT (u.is_active AND u.deleted_at IS NULL) AS recipient_ok,
            coalesce(p.push_enabled, true) AS push_enabled,
            coalesce(p.messages_enabled, true) AS messages_enabled,
            coalesce(p.stories_enabled, true) AS stories_enabled,
            coalesce(p.milestones_enabled, true) AS milestones_enabled,
            coalesce(p.reminders_enabled, true) AS reminders_enabled,
            a.username AS actor_username,
            (a.id IS NOT NULL AND a.is_active AND a.deleted_at IS NULL) AS actor_ok,
            EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = u.id AND b.blocked_id = a.id)
                                            OR (b.blocker_id = a.id AND b.blocked_id = u.id)) AS blocked,
            (SELECT count(*) FROM notifications n WHERE n.recipient_id = u.id AND n.read_at IS NULL) AS unread_activity,
            (SELECT count(*) FROM conversation_members me
               JOIN LATERAL (SELECT created_at FROM messages m WHERE m.conversation_id = me.conversation_id AND m.created_at >= me.joined_at AND m.created_at > coalesce(me.hidden_before, '-infinity') ORDER BY m.created_at DESC LIMIT 1) lm ON true
               LEFT JOIN conversation_reads cr ON cr.conversation_id = me.conversation_id AND cr.user_id = u.id
              WHERE me.user_id = u.id AND me.left_at IS NULL AND lm.created_at > coalesce(cr.last_read_at, 'epoch')) AS unread_conversations
     FROM users u
     LEFT JOIN notification_preferences p ON p.user_id = u.id
     LEFT JOIN users a ON a.id = NULLIF(:'actor', '')::uuid
     WHERE u.id = :'user'`,
    { user: item.userId, actor: item.actorId ?? "" },
  );
  if (!row || row.recipient_ok !== "t") return { skip: "recipient unavailable" };
  if (row.push_enabled !== "t") return { skip: "push turned off" };
  const badge = Number(row.unread_activity ?? 0) + Number(row.unread_conversations ?? 0);
  if (item.kind === "badge") {
    return { message: { title: "", body: "", data: { kind: "badge" }, collapseKey: "badge", badge, badgeOnly: true } };
  }
  if ((item.kind === "message" || item.kind === "message_reaction") && row.messages_enabled !== "t") return { skip: "message pushes turned off" };
  const toggle = SWITCH[item.kind];
  if (toggle && row[toggle] !== "t") return { skip: `${item.kind} pushes turned off` };
  if (item.kind === "new_story" && item.refId) {
    // The Story may have been deleted, or have expired, while the push waited.
    const live = await queryOne(`SELECT 1 AS ok FROM stories WHERE id = :'id' AND deleted_at IS NULL AND moderation_removed_at IS NULL AND expires_at > now()`, { id: item.refId });
    if (!live) return { skip: "story gone" };
  }
  if (item.body) {
    // A group message's push names the group; it's still a message (and never from someone blocked).
    const conversation = (item.kind === "message_reaction" || item.kind === "message") && item.refId;
    if (conversation && item.actorId && (row.actor_ok !== "t" || row.blocked === "t")) return { skip: "actor unavailable" };
    return {
      message: {
        title: "Katkee",
        body: item.body,
        data: { kind: item.kind, url: item.link ?? "katkee://home", ...(item.refId ? (conversation ? { conversationId: item.refId } : { storyId: item.refId }) : {}) },
        collapseKey: item.refId ? (item.kind === "message" ? `dm-${item.refId}` : `${item.kind}-${item.refId}`) : item.kind,
        threadId: conversation ? `dm-${item.refId}` : "activity",
        badge,
        channel: conversation ? "messages" : "activity",
      },
    };
  }
  if (item.actorId && (row.actor_ok !== "t" || row.blocked === "t")) return { skip: "actor unavailable" };
  const actor = (row.actor_username as string | null) ?? "someone";
  const text = TEXT[item.kind];
  if (!text) return { skip: `unknown kind ${item.kind}` };
  const isMessage = item.kind === "message";
  const data: Record<string, string> = { kind: item.kind };
  if (row.actor_username) data.actorUsername = row.actor_username;
  if (item.refId) data[isMessage ? "conversationId" : "storyId"] = item.refId;
  data.url = isMessage && item.refId ? `katkee://conversation/${item.refId}`
    : item.kind === "follow_request" ? "katkee://follow-requests"
    : item.refId ? `katkee://story/${item.refId}`
    : row.actor_username ? `katkee://user/${row.actor_username}` : "katkee://activity";
  return {
    message: {
      title: "Katkee",
      body: text(actor),
      data,
      collapseKey: isMessage && item.refId ? `dm-${item.refId}` : item.refId ? `${item.kind}-${item.refId}` : undefined,
      threadId: isMessage && item.refId ? `dm-${item.refId}` : "activity",
      badge,
      channel: isMessage ? "messages" : "activity",
    },
  };
}

async function finish(item: OutboxItem, status: "sent" | "failed" | "skipped", detail: string | null): Promise<void> {
  await query(
    `UPDATE push_outbox SET status = :'status', finished_at = now(), locked_until = NULL, last_error = NULLIF(:'detail', '') WHERE id = :'id'`,
    { id: item.id, status, detail: (detail ?? "").slice(0, 500) },
  );
}

/** Claims and sends one batch. Returns how many outbox items were handled. */
export async function dispatchPushBatch(providers: ProviderMap, options: { maxAttempts: number; batchSize?: number; log?: (e: Record<string, unknown>) => void }): Promise<number> {
  const rows = await query(`SELECT id, user_id, kind, actor_id, ref_id, attempts, body, link FROM claim_push_batch(:'limit', 60)`, { limit: options.batchSize ?? 25 });
  for (const r of rows) {
    const item: OutboxItem = { id: r.id as string, userId: r.user_id as string, kind: r.kind as string, actorId: r.actor_id ?? null, refId: r.ref_id ?? null, attempts: Number(r.attempts), body: r.body ?? null, link: r.link ?? null };
    const rendered = await renderPush(item);
    if ("skip" in rendered) {
      await finish(item, "skipped", rendered.skip);
      continue;
    }
    // Android launchers count the notifications in the tray, so badge updates are for iPhones only.
    const devices = await query(
      `SELECT id, provider, token FROM push_devices
        WHERE user_id = :'user' AND disabled_at IS NULL AND (:'ios_only' = '' OR platform = 'ios')
        ORDER BY last_seen_at DESC LIMIT 10`,
      { user: item.userId, ios_only: rendered.message.badgeOnly ? "1" : "" },
    );
    if (!devices.length) {
      await finish(item, "skipped", "no devices");
      continue;
    }
    let sent = 0, retry = false;
    const errors: string[] = [];
    for (const device of devices) {
      const provider = providers.get(device.provider as "fcm" | "apns");
      if (!provider) {
        errors.push(`${device.provider} not configured`);
        continue;
      }
      const result = await provider.send(device.token as string, rendered.message);
      if (result.ok) {
        sent++;
      } else if (result.invalidToken) {
        await query(`UPDATE push_devices SET disabled_at = now(), disabled_reason = :'reason' WHERE id = :'id'`, { id: device.id as string, reason: `invalid_token:${result.error ?? ""}`.slice(0, 200) });
      } else {
        if (result.retryable) retry = true;
        errors.push(`${device.provider}: ${result.error ?? "error"}`);
      }
    }
    if (sent > 0) {
      await finish(item, "sent", errors.join("; ") || null);
    } else if (retry && item.attempts < options.maxAttempts) {
      await query(
        `UPDATE push_outbox SET status = 'queued', locked_until = NULL, run_after = now() + make_interval(secs => :'delay'::integer), last_error = :'error' WHERE id = :'id'`,
        { id: item.id, delay: 15 * 4 ** (item.attempts - 1), error: errors.join("; ").slice(0, 500) },
      );
    } else {
      await finish(item, errors.length ? "failed" : "skipped", errors.join("; ") || "no deliverable devices");
    }
    options.log?.({ event: "push_dispatched", outboxId: item.id, kind: item.kind, devices: devices.length, sent });
  }
  return rows.length;
}
