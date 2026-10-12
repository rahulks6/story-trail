/**
 * Counts the way a profile shows them: 999, 9,999, 12.3K, 123K, 1.2M. Always rounded down, so a
 * count never reads higher than it is. Screen readers get the exact number from countLabel.
 */
export function formatCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0";
  const whole = Math.floor(n);
  if (whole < 10_000) return whole.toLocaleString("en-US");
  const [value, unit] =
    whole < 1_000_000 ? [whole / 1_000, "K"] : whole < 1_000_000_000 ? [whole / 1_000_000, "M"] : [whole / 1_000_000_000, "B"];
  const shown = value >= 100 ? Math.floor(value) : Math.floor(value * 10) / 10;
  return `${shown}${unit}`;
}

/** "1 follower", "12,345 followers": the exact count, for screen readers. */
export function countLabel(n: number, singular: string, plural: string): string {
  return `${Math.floor(n).toLocaleString("en-US")} ${Math.floor(n) === 1 ? singular : plural}`;
}
