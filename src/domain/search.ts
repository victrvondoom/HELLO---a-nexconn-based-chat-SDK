/**
 * Search scoring. Pure: no storage, no clock.
 *
 * Every term of the query must match somewhere in a record (AND), so adding a word narrows the results. A
 * term scores by how it matches a field, times the field's weight: a whole word 1, the start of a word 0.7,
 * inside a word 0.35 (terms of three or more characters only). Accents and case are ignored, so "ines"
 * finds "Inés". The order of results is decided by the score, then by the caller's tie-break.
 */

export interface SearchField {
  text: string;
  /** Titles and names weigh more than descriptions and bodies. */
  weight: number;
}

const MAX_TERMS = 8;

export function normalise(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function queryTerms(query: string): string[] {
  return [...new Set(normalise(query).split(' ').filter((t) => t.length > 0))].slice(0, MAX_TERMS);
}

function termScore(term: string, words: readonly string[], text: string): number {
  if (words.includes(term)) return 1;
  if (words.some((w) => w.startsWith(term))) return 0.7;
  if (term.length >= 3 && text.includes(term)) return 0.35;
  return 0;
}

/** The record's score, or null when some term matches none of its fields. */
export function scoreFields(terms: readonly string[], fields: readonly SearchField[]): number | null {
  if (terms.length === 0) return null;
  const prepared = fields.map((f) => {
    const text = normalise(f.text);
    return { text, words: text.split(' '), weight: f.weight };
  });
  let total = 0;
  for (const term of terms) {
    let best = 0;
    for (const f of prepared) best = Math.max(best, termScore(term, f.words, f.text) * f.weight);
    if (best === 0) return null;
    total += best;
  }
  return total;
}

/** A short excerpt of `text` around the first matching term, for showing why a record matched. */
export function snippet(text: string, terms: readonly string[], max = 140): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const lower = normalise(clean);
  // `normalise` keeps one character per character for ASCII text, so the index carries over closely enough.
  const at = terms.map((t) => lower.indexOf(t)).filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, Math.min(at - Math.floor(max / 3), clean.length - max));
  return `${start > 0 ? '…' : ''}${clean.slice(start, start + max).trim()}${start + max < clean.length ? '…' : ''}`;
}
