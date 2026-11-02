import { t } from "../i18n";
/** A readable device name from a user agent, without pretending to know more than it says. */
export function deviceLabel(userAgent: string | null): string {
  const ua = userAgent ?? "";
  if (/iPhone|iPad|iOS|CFNetwork|Darwin/i.test(ua)) return /iPad/i.test(ua) ? "iPad" : "iPhone";
  if (/Android|okhttp/i.test(ua)) return t("devices.androidPhone");
  if (/Mozilla|Chrome|Safari|Firefox/i.test(ua)) return t("devices.webBrowser");
  return ua ? ua.slice(0, 40) : t("devices.unknownDevice");
}
