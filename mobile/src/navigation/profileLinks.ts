export function profileUsernameFromPath(path: string): string | null {
  return /^\/?user\/([a-z0-9_.]{3,30})\/?$/i.exec(path)?.[1].toLowerCase() ?? null;
}
