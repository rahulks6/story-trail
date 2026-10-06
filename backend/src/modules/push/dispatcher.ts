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
}

const TEXT: Record<string, (actor: string) => string> = {
  like: (a) => `@${a} liked your Story`,
  comment: (a) => `@${a} commented on your Story`,
  mention: (a) => `@${a} mentioned you in a comment`,
  follow: (a) => `@${a} started following you`,
  follow_request: (a) => `@${a} requested to follow you`,
  // Never the message itself: lock screens and notification logs are not private.
  message: (a) => `@${a} sent you a message`,
};

type Rendered = { message: PushMessage } | { skip: string };

/** Exported for tests: what this outbox item would show, or why it is skipped. */
export async function renderPush(item: OutboxItem): Promise<Rendered> {
  const row = await queryOne(
    `SELECT (u.is_active AND u.deleted_at IS NULL) AS recipient_ok,
            coalesce(p.push_enabled, true) AS push_enabled,
            coalesce(p.messages_enabled, true) AS messages_enabled,
            a.username AS actor_username,
            (a.id IS NOT NULL AND a.is_active AND a.deleted_at IS NULL) AS actor_ok,
            EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = u.id AND b.blocked_id = a.id)
                                            OR (b.blocker_id = a.id AND b.blocked_id = u.id)) AS blocked,
            (SELECT count(*) FROM notifications n WHERE n.recipient_id = u.id AND n.read_at IS NULL) AS unread_activity,
            (SELECT count(*) FROM conversations c
               JOIN LATERAL (SELECT created_at FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) lm ON true
               LEFT JOIN conversation_reads cr ON cr.conversation_id = c.id AND cr.user_id = u.id
              WHERE (c.user_a_id = u.id OR c.user_b_id = u.id) AND lm.created_at > coalesce(cr.last_read_at, 'epoch')) AS unread_conversations
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
  if (item.kind === "message" && row.messages_enabled !== "t") return { skip: "message pushes turned off" };
  if (item.actorId && (row.actor_ok !== "t" || row.blocked === "t")) return { skip: "actor unavailable" };
  const actor = (row.actor_username as string | null) ?? "someone";
  const text = TEXT[item.kind];
  if (!text) return { skip: `unknown kind ${item.kind}` };
  const isMessage = item.kind === "message";
  const data: Record<string, string> = { kind: item.kind };
  if (row.actor_username) data.actorUsername = row.actor_username;
  if (item.refId) data[isMessage ? "conversationId" : "storyId"] = item.refId;
  data.url = isMessage && item.refId ? `katkee://conversation/${item.refId}`
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
  const rows = await query(`SELECT id, user_id, kind, actor_id, ref_id, attempts FROM claim_push_batch(:'limit', 60)`, { limit: options.batchSize ?? 25 });
  for (const r of rows) {
    const item: OutboxItem = { id: r.id as string, userId: r.user_id as string, kind: r.kind as string, actorId: r.actor_id ?? null, refId: r.ref_id ?? null, attempts: Number(r.attempts) };
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
