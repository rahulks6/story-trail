import { localeTag, t } from "../i18n";
import { serverDate } from "./serverTime";

/**
 * Times in a chat, in the app's language and the phone's own clock: each message shows when it
 * was sent ("10:42 am"), and the thread is split by day ("Today", "Yesterday", "Monday", "6 Nov",
 * "6 Nov 2025"), like WhatsApp and Instagram.
 */

/** When a message was sent, as a time of day; "" when it can't be read. */
export function messageClock(createdAt: string | null | undefined): string {
  const at = serverDate(createdAt);
  return at ? at.toLocaleTimeString(localeTag(), { hour: "numeric", minute: "2-digit" }) : "";
}

/** The calendar day a message belongs to, on this phone ("" when unreadable): equal keys, same day. */
export function messageDayKey(createdAt: string | null | undefined): string {
  const at = serverDate(createdAt);
  return at ? `${at.getFullYear()}-${at.getMonth()}-${at.getDate()}` : "";
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** The line that starts a day in a chat. */
export function chatDayLabel(createdAt: string | null | undefined, now: Date = new Date()): string {
  const at = serverDate(createdAt);
  if (!at) return "";
  const days = Math.round((startOfDay(now) - startOfDay(at)) / 86_400_000);
  if (days <= 0) return t("common.today");
  if (days === 1) return t("conversation.yesterday");
  if (days < 7) return at.toLocaleDateString(localeTag(), { weekday: "long" });
  return at.toLocaleDateString(localeTag(), at.getFullYear() === now.getFullYear()
    ? { day: "numeric", month: "short" }
    : { day: "numeric", month: "short", year: "numeric" });
}
