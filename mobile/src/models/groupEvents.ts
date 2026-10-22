import type { GroupEvent } from "../api/conversations";

/**
 * A group's "what happened" line, from the reader's side: "You added @dev", "@asha left",
 * "@dev named the group Goa trip". `nameOf` turns an id into "@username" or "you" (someone no
 * longer in the group, whose name the app doesn't know, is "someone").
 */
export function groupEventText(event: GroupEvent, actor: string, nameOf: (userId: string) => string): string {
  const people = (ids: string[]) => {
    const names = ids.map(nameOf);
    return names.length <= 2 ? names.join(" and ") : `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
  };
  switch (event.type) {
    case "created":
      return event.title ? `${actor} made the group ${event.title}` : `${actor} made the group`;
    case "added":
      return `${actor} added ${people(event.userIds)}`;
    case "removed":
      return `${actor} removed ${people(event.userIds)}`;
    case "left":
      return `${actor} left`;
    case "renamed":
      return event.title ? `${actor} named the group ${event.title}` : `${actor} removed the group's name`;
    default:
      return "";
  }
}

/** "You" for yourself; otherwise "@name", or "Someone" when not known. Capitalised for the line's start. */
export function actorName(userId: string, myUserId: string | undefined, username: string | undefined): string {
  if (userId === myUserId) return "You";
  return username ? `@${username}` : "Someone";
}
