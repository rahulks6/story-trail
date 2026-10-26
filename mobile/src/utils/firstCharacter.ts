/** Marks that belong to the character before them: emoji/text style, keycap, skin tones, flag tags, accents, Devanagari vowel signs. */
const JOINS_PREVIOUS = /^(?:[︎️⃣̀-ͯऀ-ःऺ-ॏ॑-ॗॢॣ]|\uD83C[\uDFFB-\uDFFF]|\uDB40[\uDC20-\uDC7F])$/;
const REGIONAL_INDICATOR = /^\uD83C[\uDDE6-\uDDFF]$/;

/**
 * The first character of `text` as people see it, for an initial. charAt(0) took half of an
 * emoji's surrogate pair, which shows as "�"; this keeps a whole emoji (with its skin tone, flag
 * or ZWJ parts). Hermes has no Intl.Segmenter, so the common joining rules are spelled out.
 */
export function firstCharacter(text: string): string {
  const points = Array.from(text);
  if (points.length === 0) return "";
  let out = points[0]!;
  let i = 1;
  if (REGIONAL_INDICATOR.test(out) && points[1] && REGIONAL_INDICATOR.test(points[1])) {
    out += points[1];
    i = 2;
  }
  while (i < points.length) {
    const p = points[i]!;
    if (p === "‍" && i + 1 < points.length) {
      out += p + points[i + 1];
      i += 2;
    } else if (JOINS_PREVIOUS.test(p)) {
      out += p;
      i += 1;
    } else break;
  }
  return out;
}
