import { FEED_CRITERIA, type CriterionId } from '@/domain/moments/charter';
import type { Backdrop, ReactionId } from '@/domain/product';

/** Names people see for each backdrop swatch. The scenes themselves are drawn in moments.css. */
export const BACKDROP_LABEL: Record<Backdrop, string> = {
  meadow: 'Meadow',
  sky: 'Open sky',
  dusk: 'Dusk',
  sun: 'Sunshine',
  night: 'Night',
  clover: 'Clover',
};

/** The six quick reactions. Ids are what Nexconn would carry (each is under its 16-character limit). */
export const REACTION_EMOJI: Record<ReactionId, string> = {
  heart: '❤️',
  fire: '🔥',
  clap: '👏',
  laugh: '😂',
  wow: '😮',
  sprout: '🌱',
};

export const REACTION_LABEL: Record<ReactionId, string> = {
  heart: 'Love it',
  fire: 'Fire',
  clap: 'Applause',
  laugh: 'Funny',
  wow: 'Wow',
  sprout: 'Growing',
};

const CRITERION_LABEL = new Map<string, string>(FEED_CRITERIA.map((c) => [c.id, c.label]));

/** "You follow them · Fresh": the announced criteria that placed a post, in the charter's own words. */
export function becauseText(because: readonly CriterionId[]): string {
  return because.map((id) => CRITERION_LABEL.get(id) ?? id).join(' · ');
}

/** Splits post text into plain runs and #tags, so tags can link to Explore without any HTML injection. */
export function tagRuns(text: string): Array<{ kind: 'text' | 'tag'; value: string }> {
  const out: Array<{ kind: 'text' | 'tag'; value: string }> = [];
  const re = /#([\p{L}\p{N}_]{2,30})/gu;
  let last = 0;
  for (const match of text.matchAll(re)) {
    const at = match.index;
    if (at > last) out.push({ kind: 'text', value: text.slice(last, at) });
    out.push({ kind: 'tag', value: match[1] ?? '' });
    last = at + match[0].length;
  }
  if (last < text.length) out.push({ kind: 'text', value: text.slice(last) });
  return out;
}

export function firstName(name: string): string {
  return (
    name
      .replace(/\(.*?\)/g, '')
      .replace(/^(dr|prof|mr|mrs|ms|mx)\.?\s+/i, '')
      .trim()
      .split(/\s+/)[0] ?? name
  );
}
