import { describe, expect, it } from 'vitest';
import { FixedWindowRateLimiter, resetAllRateLimiters } from '@/lib/rate-limit';
import { DomainError } from '@/domain/errors';
import { errorResponse } from '@/lib/http';

describe('rate limiter', () => {
  it('reports when to retry and sends it as Retry-After', () => {
    const limiter = new FixedWindowRateLimiter(2, 60_000);
    limiter.consume('k', 0);
    limiter.consume('k', 1_000);
    let caught: unknown = null;
    try {
      limiter.consume('k', 15_000);
    } catch (e: unknown) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(DomainError);
    expect((caught as DomainError).retryAfterSeconds).toBe(45);
    const response = errorResponse(caught, 'test');
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('45');
    expect(limiter.retryAfterSeconds('k', 60_000)).toBe(0);
  });

  it('drops expired windows instead of keeping every key forever', () => {
    const limiter = new FixedWindowRateLimiter(5, 1_000);
    for (let i = 0; i < 1024; i += 1) limiter.consume(`old-${i}`, 0);
    expect(limiter.size).toBe(1024);
    limiter.consume('new', 5_000);
    expect(limiter.size).toBe(1);
  });

  it('shares one registry across module copies, so a reset clears every limiter', () => {
    const limiter = new FixedWindowRateLimiter(1, 60_000);
    limiter.consume('k', 0);
    expect(() => {
      limiter.consume('k', 1);
    }).toThrow(DomainError);
    const registry = (globalThis as { __helloRateLimiters?: Set<FixedWindowRateLimiter> }).__helloRateLimiters;
    expect(registry?.has(limiter)).toBe(true);
    resetAllRateLimiters();
    expect(() => {
      limiter.consume('k', 2);
    }).not.toThrow();
  });
});
