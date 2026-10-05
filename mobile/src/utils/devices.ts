/** A readable device name from a user agent, without pretending to know more than it says. */
export function deviceLabel(userAgent: string | null): string {
  const ua = userAgent ?? "";
  if (/iPhone|iPad|iOS|CFNetwork|Darwin/i.test(ua)) return /iPad/i.test(ua) ? "iPad" : "iPhone";
  if (/Android|okhttp/i.test(ua)) return "Android phone";
  if (/Mozilla|Chrome|Safari|Firefox/i.test(ua)) return "Web browser";
  return ua ? ua.slice(0, 40) : "Unknown device";
}
