import { z } from 'zod';
import type { Reference } from './types';

/**
 * Web research boundary.
 *
 * A provider returns raw JSON. It is never trusted: it must parse against `WebResultsSchema`,
 * every field is cleaned and length-capped, only http(s) links survive, and page text is treated
 * as quoted data, never as instructions. The query that leaves HELLO is redacted first, and the
 * agent only searches for questions about the world outside the venue.
 */

export interface WebSearchProvider {
  readonly name: string;
  search(query: string, signal: AbortSignal): Promise<unknown>;
}

export const WebResultsSchema = z.object({
  results: z
    .array(
      z.object({
        title: z.string().max(500),
        url: z.string().max(2000),
        content: z.string().max(20_000),
        score: z.number().optional(),
      }),
    )
    .max(20),
});

export type WebOutcome =
  | { status: 'OK'; query: string; references: Reference[]; cached: boolean }
  | { status: 'SKIPPED'; reason: string }
  | { status: 'FAILED'; reason: string };

/** Cues that a question is about the world outside the venue, which the event guide cannot answer. */
const OUTSIDE_CUES =
  /\b(nearest|nearby|near here|near the venue|around here|close by|in town|in the city|pharmacy|chemist|hospital|clinic|doctor|dentist|restaurant|restaurants|bar|bars|cafe|supermarket|shop|atm|bank|hotel|hostel|airport|weather|forecast|museum|sightseeing|tourist|currency|exchange rate|public holiday|embassy|consulate)\b/i;

export function isOutsideVenueQuestion(text: string): boolean {
  return OUTSIDE_CUES.test(text);
}

const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g;
const PHONE = /\+?\d[\d\s().-]{6,}\d/g;
const HANDLE = /(^|\s)@\w{2,}/g;

/**
 * Removes anything that identifies a person before a query leaves HELLO: emails, phone numbers,
 * @handles and the names of people in the event.
 */
export function redactQuery(text: string, knownNames: readonly string[] = []): string {
  let out = text.replace(EMAIL, ' ').replace(PHONE, ' ').replace(HANDLE, ' ');
  // Longest first, so "Ada (demo attendee)" is removed whole before "Ada" is.
  const names = knownNames.flatMap((raw) => [raw.trim(), raw.replace(/\(.*?\)/g, '').trim()]).filter((n) => n.length >= 3);
  for (const name of [...new Set(names)].sort((a, b) => b.length - a.length)) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`(^|[^\\w])${escaped}(?=$|[^\\w])`, 'gi'), '$1 ');
  }
  return out.replace(/\s+/g, ' ').trim().slice(0, 200);
}

// Control and invisible formatting characters are exactly what this pattern exists to remove.
// eslint-disable-next-line no-control-regex
const CONTROL = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028-\\u202e]', 'g');

/** Strips markup and control characters, collapses whitespace and caps length. */
export function cleanText(text: string, max: number): string {
  const plain = text
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(CONTROL, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > max ? `${plain.slice(0, max - 1).trimEnd()}…` : plain;
}

export function safeUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export interface WebSearchOptions {
  timeoutMs?: number;
  maxResults?: number;
}

/** Runs one web search and returns cleaned references. Never throws: every failure becomes FAILED. */
export async function searchWeb(
  provider: WebSearchProvider | null,
  query: string,
  options: WebSearchOptions = {},
): Promise<WebOutcome> {
  if (!provider) {
    return { status: 'SKIPPED', reason: 'No web search provider is configured.' };
  }
  if (query.length < 3) {
    return { status: 'SKIPPED', reason: 'Nothing left to search for after removing personal details.' };
  }
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  // The timeout does not rely on the provider honouring the signal: a hung provider still loses the race.
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('TIMEOUT'));
    }, options.timeoutMs ?? 5000);
  });
  let raw: unknown;
  try {
    raw = await Promise.race([provider.search(query, controller.signal), deadline]);
  } catch {
    const reason = controller.signal.aborted ? 'The search provider did not answer in time.' : 'The search provider returned an error.';
    return { status: 'FAILED', reason };
  } finally {
    clearTimeout(timer);
  }
  const parsed = WebResultsSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: 'FAILED', reason: 'The search provider returned data in an unexpected shape.' };
  }
  const seen = new Set<string>();
  const references: Reference[] = [];
  for (const [index, r] of parsed.data.results.entries()) {
    const url = safeUrl(r.url);
    if (!url) continue;
    const key = url.replace(/[#?].*$/, '');
    if (seen.has(key)) continue;
    seen.add(key);
    const snippet = cleanText(r.content, 300);
    if (snippet.length === 0) continue;
    references.push({
      id: `web-${index + 1}`,
      kind: 'WEB',
      title: cleanText(r.title, 120) || new URL(url).hostname,
      snippet,
      url,
      score: Math.round(Math.max(0, Math.min(1, r.score ?? 0.5)) * 100) / 100,
    });
    if (references.length >= (options.maxResults ?? 3)) break;
  }
  if (references.length === 0) {
    return { status: 'FAILED', reason: 'The search returned no usable results.' };
  }
  return { status: 'OK', query, references, cached: false };
}

/** Tavily search API adapter. The key is sent only in the Authorization header, never logged. */
export class TavilySearchProvider implements WebSearchProvider {
  readonly name = 'Tavily';

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async search(query: string, signal: AbortSignal): Promise<unknown> {
    const response = await this.fetchImpl('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ query, max_results: 5, search_depth: 'basic', include_answer: false }),
      signal,
    });
    if (!response.ok) {
      throw new Error(`Search failed with HTTP ${response.status}`);
    }
    return response.json();
  }
}

/**
 * Caches identical queries for ten minutes. Many attendees ask the same thing at the same event,
 * and one search should serve them all.
 */
export class CachedWebSearch implements WebSearchProvider {
  private readonly cache = new Map<string, { at: number; value: unknown }>();

  constructor(
    private readonly inner: WebSearchProvider,
    private readonly now: () => number = () => Date.now(),
    private readonly ttlMs = 10 * 60_000,
    private readonly maxEntries = 200,
  ) {}

  get name(): string {
    return this.inner.name;
  }

  has(query: string): boolean {
    const hit = this.cache.get(query.toLowerCase());
    return hit !== undefined && this.now() - hit.at < this.ttlMs;
  }

  async search(query: string, signal: AbortSignal): Promise<unknown> {
    const key = query.toLowerCase();
    const hit = this.cache.get(key);
    if (hit && this.now() - hit.at < this.ttlMs) return hit.value;
    const value = await this.inner.search(query, signal);
    if (this.cache.size >= this.maxEntries) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, { at: this.now(), value });
    return value;
  }
}

/** Builds the configured provider from environment variables, or null when none is configured. */
export function webSearchFromEnv(env: Record<string, string | undefined>): WebSearchProvider | null {
  const provider = (env.HELLO_WEB_SEARCH_PROVIDER ?? '').trim().toLowerCase();
  const key = (env.HELLO_WEB_SEARCH_API_KEY ?? '').trim();
  if (provider === 'tavily' && key.length > 0) {
    return new CachedWebSearch(new TavilySearchProvider(key));
  }
  return null;
}
