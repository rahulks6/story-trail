const sets: Record<string, string[]> = {
  "rahul.creates": ["Konkan", "Food", "Monsoon", "Pune", "Friends", "Diwali"],
  asha_k: ["Vada pav", "Goa", "Kitchen", "Markets", "Rain"],
};
export async function listHighlightsForUser(username: string) {
  const titles = sets[username];
  if (!titles) throw new Error("forbidden");
  return { highlights: titles.map((title, i) => ({ id: `h${i}`, title, coverMediaId: `m${i}`, itemCount: 4 })) };
}
export async function reorderHighlights() {}
