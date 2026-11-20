import { FixedWindowRateLimiter } from './rate-limit';

/**
 * Per-person limits on actions that write for other people to see. They are shared by every way in:
 * the web app's routes and the MCP tools both consume the same counter for the same person.
 *
 * Before this, the MCP endpoint only limited calls per token (120 a minute), and a person can hold ten
 * write tokens, so `hello_send_message`, `hello_post` and `hello_run_workflow` could run up to 1,200
 * times a minute while the app itself allowed 20 messages a minute.
 *
 * The limiters live on `globalThis` so every route bundle that imports this module shares them.
 */
export type LimitedAction = 'message.send' | 'post.create' | 'workflow.run';

const SPEC: Record<LimitedAction, { limit: number; windowMs: number; message: string }> = {
  // 20 messages per minute per person and event: enough for a conversation, not enough to flood operations.
  'message.send': { limit: 20, windowMs: 60_000, message: 'You are sending messages too quickly. Wait a moment and try again.' },
  'post.create': { limit: 20, windowMs: 60_000, message: 'You are posting too quickly. Wait a moment and try again.' },
  'workflow.run': { limit: 10, windowMs: 60_000, message: 'You are running workflows too quickly. Wait a moment and try again.' },
};

type GlobalWithActionLimits = typeof globalThis & { __helloActionLimits?: Map<LimitedAction, FixedWindowRateLimiter> };
const g = globalThis as GlobalWithActionLimits;
const limiters: Map<LimitedAction, FixedWindowRateLimiter> = (g.__helloActionLimits ??= new Map<LimitedAction, FixedWindowRateLimiter>());

function limiterFor(action: LimitedAction): FixedWindowRateLimiter {
  let limiter = limiters.get(action);
  if (!limiter) {
    const spec = SPEC[action];
    limiter = new FixedWindowRateLimiter(spec.limit, spec.windowMs, spec.message);
    limiters.set(action, limiter);
  }
  return limiter;
}

/**
 * Counts one action by one person. Throws RATE_LIMITED (HTTP 429, or an MCP tool error) when the person
 * is over the limit. Messages are counted per event; posts and workflow runs per person.
 */
export function consumeAction(action: LimitedAction, userId: string, eventId: string, now: number): void {
  const key = action === 'message.send' ? `${userId}:${eventId}` : userId;
  limiterFor(action).consume(key, now);
}
