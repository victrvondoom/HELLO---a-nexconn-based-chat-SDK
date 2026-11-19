import { DomainError } from '@/domain/errors';

/**
 * Fixed-window rate limiter for sensitive endpoints (messages, decisions).
 * In-memory: correct for one process only. Multi-instance deployments need a shared
 * store (for example a Postgres table); this is documented in docs/security.md.
 */

/**
 * Every limiter in this process, so a demo reset can clear them all.
 *
 * The registry lives on `globalThis`, not in module scope. Next.js bundles each route separately, so every
 * route gets its own copy of this module. A module-scoped Set meant the demo-reset route only cleared the
 * limiters in its own bundle, and the submission limiter survived a reset (the Field Atlas browser journey
 * had to wait a minute because of it).
 */
type GlobalWithLimiters = typeof globalThis & { __helloRateLimiters?: Set<FixedWindowRateLimiter> };
const g = globalThis as GlobalWithLimiters;
const registry: Set<FixedWindowRateLimiter> = (g.__helloRateLimiters ??= new Set());

export function resetAllRateLimiters(): void {
  for (const limiter of registry) limiter.reset();
}

/** Above this many tracked keys, expired windows are swept before a new key is added. */
const SWEEP_THRESHOLD = 1024;

export class FixedWindowRateLimiter {
  private readonly hits = new Map<string, { start: number; count: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly message = 'You are sending messages too quickly. Wait a moment and try again.',
  ) {
    registry.add(this);
  }

  reset(): void {
    this.hits.clear();
  }

  /** Number of keys currently tracked. Exposed for tests of the eviction rule. */
  get size(): number {
    return this.hits.size;
  }

  /**
   * Seconds until `key` may try again, or 0 when it is not limited. Used for the Retry-After header.
   */
  retryAfterSeconds(key: string, now: number): number {
    const current = this.hits.get(key);
    if (!current || now - current.start >= this.windowMs || current.count < this.limit) return 0;
    return Math.max(1, Math.ceil((current.start + this.windowMs - now) / 1000));
  }

  /** Throws a RATE_LIMITED DomainError (HTTP 429) when the key exceeds the limit in this window. */
  consume(key: string, now: number): void {
    const current = this.hits.get(key);
    if (!current || now - current.start >= this.windowMs) {
      // Without eviction every distinct key (user, address, handle) stayed in memory for the life of the
      // process. Expired windows carry no information, so they are dropped once the map grows.
      if (!current && this.hits.size >= SWEEP_THRESHOLD) this.sweep(now);
      this.hits.set(key, { start: now, count: 1 });
      return;
    }
    if (current.count >= this.limit) {
      throw new DomainError('RATE_LIMITED', this.message, { retryAfterSeconds: this.retryAfterSeconds(key, now) });
    }
    current.count += 1;
  }

  private sweep(now: number): void {
    for (const [key, window] of this.hits) {
      if (now - window.start >= this.windowMs) this.hits.delete(key);
    }
  }
}
