import type { GroupEvent } from "../api/conversations";
import { t } from "../i18n";

/**
 * A group's "what happened" line, from the reader's side: "You added @dev", "@asha left",
 * "@dev named the group Goa trip". `nameOf` turns an id into "@username" or "you" (someone no
 * longer in the group, whose name the app doesn't know, is "someone").
 */
export function groupEventText(event: GroupEvent, actor: string, nameOf: (userId: string) => string): string {
  const people = (ids: string[]) => {
    const names = ids.map(nameOf);
    return names.length <= 2 ? names.join(" and ") : t("groupEvents.andLengthMore", { value: names.slice(0, 2).join(", "), length: names.length - 2 });
  };
  switch (event.type) {
    case "created":
      return event.title ? t("groupEvents.actorMadeTheGroupTitle", { actor, title: event.title }) : t("groupEvents.actorMadeTheGroup", { actor });
    case "added":
      return t("groupEvents.actorAddedUserids", { actor, userIds: people(event.userIds) });
    case "removed":
      return t("groupEvents.actorRemovedUserids", { actor, userIds: people(event.userIds) });
    case "left":
      return t("groupEvents.actorLeft", { actor });
    case "renamed":
      return event.title ? t("groupEvents.actorNamedTheGroupTitle", { actor, title: event.title }) : t("groupEvents.actorRemovedTheGroupsName", { actor });
    default:
      return "";
  }
}

/** "You" for yourself; otherwise "@name", or "Someone" when not known. Capitalised for the line's start. */
export function actorName(userId: string, myUserId: string | undefined, username: string | undefined): string {
  if (userId === myUserId) return t("common.you");
  return username ? `@${username}` : t("common.someone");
}
