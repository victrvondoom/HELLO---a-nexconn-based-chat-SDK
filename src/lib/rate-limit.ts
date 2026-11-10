import { DomainError } from '@/domain/errors';

/**
 * Fixed-window rate limiter for sensitive endpoints (messages, decisions).
 * In-memory: correct for one process only. Multi-instance deployments need a shared
 * store (for example a Postgres table); this is documented in docs/security.md.
 */
export class FixedWindowRateLimiter {
  private readonly hits = new Map<string, { start: number; count: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Throws a RATE_LIMITED DomainError (HTTP 429) when the key exceeds the limit in this window. */
  consume(key: string, now: number): void {
    const current = this.hits.get(key);
    if (!current || now - current.start >= this.windowMs) {
      this.hits.set(key, { start: now, count: 1 });
      return;
    }
    if (current.count >= this.limit) {
      throw new DomainError('RATE_LIMITED', 'You are sending messages too quickly. Wait a moment and try again.');
    }
    current.count += 1;
  }
}
