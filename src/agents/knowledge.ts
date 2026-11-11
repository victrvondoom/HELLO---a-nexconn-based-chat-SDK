import type { IncidentCategory, ReferenceDoc } from '../domain/types';
import type { Reference } from './types';

/**
 * Event-guide retrieval. A small BM25 ranker over title, tags and body, with light stemming.
 * It is deterministic and runs in-process, so answers do not depend on a model or a network,
 * and the same question always cites the same pages.
 */

const STOP = new Set(
  'a an and are as at be been but by can could do does did for from had has have how i if in into is it its me my of on or our please should so that the their them then there these they this to was we were what when where which who why will with would you your yours anyone someone any some get got need want find tell know im iam'.split(
    ' ',
  ),
);

/** Lower-cases, drops punctuation and stop words, and folds simple plurals and verb endings. */
export function terms(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/wi-?fi/g, 'wifi')
    .replace(/step-free/g, 'stepfree')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP.has(t))
    .map(stem);
}

function stem(t: string): string {
  if (t.length > 5 && t.endsWith('ing')) return t.slice(0, -3);
  if (t.length > 4 && t.endsWith('ies')) return `${t.slice(0, -3)}y`;
  if (t.length > 4 && t.endsWith('ed')) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss')) return t.slice(0, -1);
  return t;
}

export interface KnowledgeHit {
  doc: ReferenceDoc;
  /** 0..1, normalised against the best possible score for the query. */
  score: number;
  matched: string[];
  snippet: string;
}

export interface KnowledgeQuery {
  text: string;
  /** Staff may read STAFF documents. Everyone else only sees EVERYONE documents. */
  staff: boolean;
  /** If set, procedure documents for this category are preferred. */
  category?: IncidentCategory | null;
  limit?: number;
}

const K1 = 1.2;
const B = 0.75;

/** The relevance a hit needs before an agent will answer from it. Below this, it says it does not know. */
export const ANSWER_THRESHOLD = 0.34;

export function searchKnowledge(docs: readonly ReferenceDoc[], query: KnowledgeQuery): KnowledgeHit[] {
  const visible = docs.filter((d) => query.staff || d.audience === 'EVERYONE');
  const q = [...new Set(terms(query.text))];
  if (visible.length === 0 || q.length === 0) return [];

  const fields = visible.map((d) => ({
    doc: d,
    body: terms(d.body),
    title: terms(d.title),
    tags: new Set(d.tags.flatMap((t) => terms(t))),
  }));
  const avgLen = fields.reduce((n, f) => n + f.body.length, 0) / fields.length;
  const df = new Map<string, number>();
  for (const term of q) {
    df.set(term, fields.filter((f) => f.body.includes(term) || f.title.includes(term) || f.tags.has(term)).length);
  }
  const idf = (term: string) => {
    const n = df.get(term) ?? 0;
    return Math.log(1 + (fields.length - n + 0.5) / (n + 0.5));
  };
  // The best a document could score: every query term present as a tag, in the title and in the body.
  const ceiling = q.reduce((sum, term) => sum + idf(term) * (2 + 1.5 + (K1 + 1) / (1 + K1)), 0);

  const hits: KnowledgeHit[] = [];
  for (const f of fields) {
    let score = 0;
    const matched: string[] = [];
    for (const term of q) {
      const tf = f.body.filter((t) => t === term).length;
      const inTitle = f.title.includes(term);
      const inTags = f.tags.has(term);
      if (tf === 0 && !inTitle && !inTags) continue;
      matched.push(term);
      const bm25 = tf === 0 ? 0 : (tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * f.body.length) / avgLen));
      score += idf(term) * (bm25 + (inTitle ? 1.5 : 0) + (inTags ? 2 : 0));
    }
    if (matched.length === 0) continue;
    if (query.category && f.doc.categories.includes(query.category)) score += ceiling * 0.25;
    hits.push({ doc: f.doc, score: Math.min(1, score / ceiling), matched, snippet: bestSnippet(f.doc.body, matched) });
  }
  hits.sort((a, b) => b.score - a.score || a.doc.id.localeCompare(b.doc.id));
  return hits.slice(0, query.limit ?? 3);
}

/** Picks the one or two sentences that contain the most matched terms, in their original order. */
export function bestSnippet(body: string, matched: readonly string[], maxChars = 320): string {
  const sentences = body.match(/[^.!?]+[.!?]+/g)?.map((s) => s.trim()) ?? [body];
  const want = new Set(matched);
  const ranked = sentences
    .map((s, index) => ({ s, index, hits: terms(s).filter((t) => want.has(t)).length }))
    .sort((a, b) => b.hits - a.hits || a.index - b.index);
  const chosen = ranked.slice(0, 2).filter((r, i) => i === 0 || r.hits > 0);
  chosen.sort((a, b) => a.index - b.index);
  const text = chosen.map((c) => c.s).join(' ');
  return text.length > maxChars ? `${text.slice(0, maxChars - 1).trimEnd()}…` : text;
}

export function hitToReference(hit: KnowledgeHit): Reference {
  return {
    id: hit.doc.id,
    kind: hit.doc.audience === 'STAFF' ? 'STAFF_PROCEDURE' : 'EVENT_GUIDE',
    title: hit.doc.title,
    snippet: hit.snippet,
    url: null,
    score: Math.round(hit.score * 100) / 100,
  };
}
