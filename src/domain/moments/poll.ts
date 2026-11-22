import type { Poll } from '../product';

/**
 * Polls on posts. Pure rules: no storage, no clock.
 *
 * - 2 to 4 options, each up to 40 characters, no two alike.
 * - Open for 5 minutes to 7 days.
 * - One vote per person, which cannot be changed (a changeable vote can be pushed around by whoever asks last).
 * - Who voted for what is never shown. Counts are shown to a person once they have voted, to the author at any
 *   time, and to everyone once the poll has closed. Until then a visitor sees the options and nothing else, so the
 *   first votes do not herd the rest.
 */
export const POLL_MIN_OPTIONS = 2;
export const POLL_MAX_OPTIONS = 4;
export const POLL_OPTION_MAX = 40;
export const POLL_MIN_MINUTES = 5;
export const POLL_MAX_MINUTES = 7 * 24 * 60;
export const POLL_DEFAULT_MINUTES = 24 * 60;

export type PollProblem = 'OPTION_COUNT' | 'OPTION_EMPTY' | 'OPTION_LONG' | 'OPTION_DUPLICATE' | 'DURATION';

export const POLL_PROBLEM_TEXT: Record<PollProblem, string> = {
  OPTION_COUNT: `A poll needs ${POLL_MIN_OPTIONS} to ${POLL_MAX_OPTIONS} options.`,
  OPTION_EMPTY: 'Every poll option needs some text.',
  OPTION_LONG: `Poll options can be up to ${POLL_OPTION_MAX} characters.`,
  OPTION_DUPLICATE: 'Two poll options are the same.',
  DURATION: 'A poll can stay open from 5 minutes to 7 days.',
};

/** Returns the cleaned labels, or the first problem found. */
export function cleanPollOptions(raw: readonly string[], minutes: number): { ok: true; labels: string[] } | { ok: false; problem: PollProblem } {
  const labels = raw.map((label) => label.trim().replace(/\s+/g, ' '));
  if (labels.length < POLL_MIN_OPTIONS || labels.length > POLL_MAX_OPTIONS) return { ok: false, problem: 'OPTION_COUNT' };
  if (labels.some((label) => label.length === 0)) return { ok: false, problem: 'OPTION_EMPTY' };
  if (labels.some((label) => label.length > POLL_OPTION_MAX)) return { ok: false, problem: 'OPTION_LONG' };
  if (new Set(labels.map((label) => label.toLowerCase())).size !== labels.length) return { ok: false, problem: 'OPTION_DUPLICATE' };
  if (!Number.isInteger(minutes) || minutes < POLL_MIN_MINUTES || minutes > POLL_MAX_MINUTES) return { ok: false, problem: 'DURATION' };
  return { ok: true, labels };
}

export interface PollView {
  /** `votes` and `percent` are null while results are hidden from this viewer. */
  options: Array<{ id: string; label: string; votes: number | null; percent: number | null }>;
  /** Total votes, or null while results are hidden. */
  total: number | null;
  closesAt: number;
  closed: boolean;
  /** The option this viewer chose, or null. */
  myVote: string | null;
  resultsVisible: boolean;
}

export function isPollClosed(poll: Poll, now: number): boolean {
  return now >= poll.closesAt;
}

export function pollView(poll: Poll, viewerId: string, authorId: string, now: number): PollView {
  const closed = isPollClosed(poll, now);
  const myVote = poll.votes[viewerId] ?? null;
  const resultsVisible = closed || myVote !== null || viewerId === authorId;
  const counts = new Map<string, number>(poll.options.map((option) => [option.id, 0]));
  for (const choice of Object.values(poll.votes)) counts.set(choice, (counts.get(choice) ?? 0) + 1);
  const total = Object.keys(poll.votes).length;
  return {
    options: poll.options.map((option) => {
      const votes = counts.get(option.id) ?? 0;
      return {
        id: option.id,
        label: option.label,
        votes: resultsVisible ? votes : null,
        percent: resultsVisible ? (total === 0 ? 0 : Math.round((votes / total) * 100)) : null,
      };
    }),
    total: resultsVisible ? total : null,
    closesAt: poll.closesAt,
    closed,
    myVote,
    resultsVisible,
  };
}

/** "closes in 3 h", "closes in 12 min", "closed". */
export function closesText(closesAt: number, now: number): string {
  const left = closesAt - now;
  if (left <= 0) return 'closed';
  const minutes = Math.ceil(left / 60_000);
  if (minutes < 60) return `closes in ${minutes} min`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 48) return `closes in ${hours} h`;
  return `closes in ${Math.ceil(hours / 24)} days`;
}
