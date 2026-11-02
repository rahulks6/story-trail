import React from "react";

/**
 * A translated sentence with marked parts shown differently, e.g. links:
 * "By continuing, you agree to Katkee's <terms>Terms</terms> and <privacy>Privacy Policy</privacy>."
 * Each language puts the marked parts where its word order wants them (Hindi puts the email
 * before the verb), instead of the screen gluing fragments together in English order. A tag
 * without a renderer shows its text plainly.
 */
export function richText(text: string, parts: Record<string, (inner: string) => React.ReactNode>): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const tag = /<(\w+)>(.*?)<\/\1>/g;
  let last = 0;
  for (let match = tag.exec(text); match; match = tag.exec(text)) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const render = parts[match[1]!];
    out.push(render ? <React.Fragment key={out.length}>{render(match[2]!)}</React.Fragment> : match[2]);
    last = tag.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
