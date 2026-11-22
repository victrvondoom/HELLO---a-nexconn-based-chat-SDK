/**
 * Similar-question grouping for the live room. Deterministic, no model: a question's keywords (lower case,
 * stop words removed, a light suffix trim), and Jaccard similarity between keyword sets where words sharing a
 * four-letter stem match. A question
 * joins the most similar existing group at or above `SIMILAR`; otherwise it starts its own.
 */
const STOP = new Set('a an and are as at be but by can could do does for from how i if in is it its me my of on or our please should so that the their them then there these this to us was we what when where which who why will with would you your about any some more than also just get use using'.split(' '));
export const SIMILAR = 0.5;

export function keywords(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w))
    .map((w) => w.replace(/(ing|ed|es|s)$/, '') || w);
  return [...new Set(words)].sort();
}

/** Two keywords match when equal, or when both are 4+ letters and share their first four ("failures", "fails"). */
const same = (a: string, b: string) => a === b || (a.length >= 4 && b.length >= 4 && a.slice(0, 4) === b.slice(0, 4));

/** Jaccard similarity of two keyword sets, with stem-tolerant matching. */
export function similarity(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const inter = a.filter((w) => b.some((x) => same(w, x))).length;
  return inter / (a.length + b.length - inter);
}

/** The group key for a new question, given the existing groups' keys. */
export function groupFor(text: string, existingKeys: readonly string[]): string {
  const mine = keywords(text);
  let best: { key: string; score: number } | null = null;
  for (const key of existingKeys) {
    const score = similarity(mine, key.split(' '));
    if (score >= SIMILAR && (!best || score > best.score)) best = { key, score };
  }
  return best?.key ?? (mine.join(' ') || text.toLowerCase().trim().slice(0, 60));
}
