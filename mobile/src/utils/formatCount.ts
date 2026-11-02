import { formatNumber, getLanguage, t } from "../i18n";

// English counts in thousands, millions and billions; Hindi and Marathi in हज़ार, लाख (100,000)
// and करोड़/कोटी (10,000,000), the way Indian apps and news write them.
const WESTERN = [[1_000_000_000, "count.billions"], [1_000_000, "count.millions"], [1_000, "count.thousands"]] as const;
const INDIAN = [[10_000_000, "count.crores"], [100_000, "count.lakhs"], [1_000, "count.thousands"]] as const;

/**
 * Counts the way a profile shows them: 999, 9,999, 12.3K, 123K, 1.2M (in Hindi 12.3 हज़ार,
 * 1.2 लाख). Always rounded down, so a count never reads higher than it is. Screen readers get
 * the exact number (profileHeader.*Spoken).
 */
export function formatCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0";
  const whole = Math.floor(n);
  if (whole < 10_000) return formatNumber(whole);
  const [size, key] = (getLanguage() === "en" ? WESTERN : INDIAN).find(([at]) => whole >= at)!;
  const value = whole / size;
  const shown = value >= 100 ? Math.floor(value) : Math.floor(value * 10) / 10;
  return t(key, { value: shown });
}
