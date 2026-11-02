import { colorScheme } from "../../theme";

/**
 * An SVG path for one bar standing on `baseline`: up for `height` > 0, down for < 0. Only the
 * end away from the baseline is rounded, so every bar sits squarely on the axis.
 */
export function barPath(x: number, baseline: number, width: number, height: number, radius = 4): string {
  if (height === 0 || width <= 0) return "";
  const h = Math.abs(height);
  const r = Math.min(radius, width / 2, h);
  const dir = height > 0 ? -1 : 1; // SVG's y grows downwards
  const end = baseline + dir * h;
  return [
    `M${x},${baseline}`,
    `L${x},${end - dir * r}`,
    `Q${x},${end} ${x + r},${end}`,
    `L${x + width - r},${end}`,
    `Q${x + width},${end} ${x + width},${end - dir * r}`,
    `L${x + width},${baseline}`,
    "Z",
  ].join(" ");
}

/**
 * Followers gained and lost: two hues apart for every kind of colour vision, each at least 3:1
 * on its card in its own scheme (checked with the dataviz palette validator). Picked per scheme,
 * not flipped: amber is too light to hold up on white.
 */
export function growthColors(): { gained: string; lost: string } {
  return colorScheme() === "light" ? { gained: "#B07D00", lost: "#4D6BC6" } : { gained: "#B88A00", lost: "#6F86D6" };
}
