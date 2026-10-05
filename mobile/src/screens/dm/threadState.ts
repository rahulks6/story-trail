import type { Message, MessageDeliveryStatus } from "../../api/conversations";
import { serverTimeMs } from "../../utils/serverTime";

/**
 * Pure helpers for a conversation thread kept newest-first (index 0 = the bottom of
 * the inverted chat list). Kept separate from the screen so they can be tested.
 */

function newestFirst(a: Message, b: Message): number {
  const difference = serverTimeMs(b.createdAt) - serverTimeMs(a.createdAt);
  if (difference) return difference;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

const RANK: Record<MessageDeliveryStatus, number> = { sent: 0, delivered: 1, read: 2 };

/**
 * Adds fetched messages to the thread: no duplicates, newest first, and a message's
 * status never moves backwards (a page fetched before a receipt arrived can't undo it).
 */
export function mergeMessages(current: readonly Message[], incoming: readonly Message[]): Message[] {
  const byId = new Map(current.map((m) => [m.id, m]));
  for (const message of incoming) {
    const known = byId.get(message.id);
    if (!known) {
      byId.set(message.id, message);
      continue;
    }
    const status = known.status && message.status && RANK[known.status] > RANK[message.status] ? known.status : message.status ?? known.status;
    byId.set(message.id, { ...known, ...message, ...(status ? { status } : {}) });
  }
  return [...byId.values()].sort(newestFirst);
}

/** The other participant's read/delivered watermarks, applied to the viewer's own messages. */
export function applyReceipt(
  messages: readonly Message[],
  myUserId: string,
  receipt: { lastReadAt: string; lastDeliveredAt: string },
): Message[] {
  const readMs = serverTimeMs(receipt.lastReadAt);
  const deliveredMs = serverTimeMs(receipt.lastDeliveredAt);
  let changed = false;
  const next = messages.map((m) => {
    if (m.senderId !== myUserId) return m;
    const created = serverTimeMs(m.createdAt);
    const status: MessageDeliveryStatus = created <= readMs ? "read" : created <= deliveredMs ? "delivered" : "sent";
    if (m.status && RANK[m.status] >= RANK[status]) return m;
    changed = true;
    return { ...m, status };
  });
  return changed ? next : (messages as Message[]);
}

/** The newest message the thread has (the `after` cursor for catching up). */
export function newestId(messages: readonly Message[]): string | null {
  return messages[0]?.id ?? null;
}

/** The oldest message the thread has (the `before` cursor for loading history). */
export function oldestId(messages: readonly Message[]): string | null {
  return messages[messages.length - 1]?.id ?? null;
}
