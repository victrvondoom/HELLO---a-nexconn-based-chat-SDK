import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { nexconnStatus } from '@/integrations/nexconn/status';
import { createSignedTokenIssuer, NexconnApiError, nexconnArea, nexconnSignature, nexconnUserId, tokenIssuerFromEnv } from '@/integrations/nexconn/token';

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

type Call = { url: string; headers: Record<string, string>; body: string };
function fakeFetch(answers: Array<{ status: number; body?: unknown } | 'timeout' | 'network'>) {
  const calls: Call[] = [];
  const fetch = (url: string, init: { headers: Record<string, string>; body: string; signal: AbortSignal }) => {
    calls.push({ url, headers: init.headers, body: init.body });
    const a = answers[calls.length - 1] ?? { status: 500 };
    if (a === 'network') return Promise.reject(new Error('ECONNRESET'));
    if (a === 'timeout') return new Promise<never>((_, reject) => { init.signal.addEventListener('abort', () => { reject(new Error('aborted')); }); });
    return Promise.resolve({ status: a.status, json: () => Promise.resolve(a.body ?? {}) });
  };
  return { fetch, calls };
}

describe('Nexconn configuration', () => {
  it('reports each state without ever returning a credential', () => {
    expect(nexconnStatus({}).state).toBe('NOT_CONFIGURED');
    expect(nexconnStatus({ NEXCONN_APP_KEY: 'key-1' }).state).toBe('KEY_ONLY');
    const ready = nexconnStatus({ NEXCONN_APP_KEY: 'key-1', NEXCONN_APP_SECRET: 'secret-xyz' });
    expect(ready.state).toBe('READY_FOR_TOKENS');
    expect(JSON.stringify(ready)).not.toContain('secret-xyz');
    expect(JSON.stringify(ready)).not.toContain('key-1');
  });

  it('refuses to issue tokens without both credentials, or for a data centre with no documented API address', () => {
    expect(tokenIssuerFromEnv({})).toMatchObject({ ready: false, reason: 'NOT_CONFIGURED' });
    expect(tokenIssuerFromEnv({ NEXCONN_APP_KEY: 'k' })).toMatchObject({ ready: false, reason: 'NO_APP_SECRET' });
    expect(tokenIssuerFromEnv({ NEXCONN_APP_KEY: 'k', NEXCONN_APP_SECRET: 's', NEXCONN_AREA: 'OM' })).toMatchObject({ ready: false, reason: 'AREA_NOT_SUPPORTED' });
    expect(tokenIssuerFromEnv({ NEXCONN_APP_KEY: 'k', NEXCONN_APP_SECRET: 's' })).toMatchObject({ ready: true, appKey: 'k', area: 'SG' });
  });

  it('always names a data centre, defaulting to Singapore', () => {
    expect(nexconnArea({})).toBe('SG');
    expect(nexconnArea({ NEXCONN_AREA: 'na' })).toBe('NA');
    expect(nexconnArea({ NEXCONN_AREA: 'mars' })).toBe('SG');
  });

  it('derives letters-and-digits, stable, non-guessable Nexconn user ids', () => {
    const a = nexconnUserId('u-att-ada');
    expect(a).toMatch(/^[A-Za-z0-9]{1,64}$/);
    expect(nexconnUserId('u-att-ada')).toBe(a);
    expect(nexconnUserId('u-att-ben')).not.toBe(a);
    expect(a).not.toContain('ada');
  });

  it('never reads the App Secret in browser code', () => {
    const clientFiles = filesUnder('src').filter((f) => readFileSync(f, 'utf8').startsWith("'use client'"));
    for (const file of clientFiles) expect(readFileSync(file, 'utf8'), file).not.toContain('NEXCONN_APP_SECRET');
  });
});

describe('Nexconn token issuance (Platform Chat API, signed)', () => {
  const base = { appKey: 'pkTEST', appSecret: 'secretTEST', hosts: ['api.sg-light-api.com', 'api-b.sg-light-api.com'] as const, now: () => 1408710653491, nonce: () => '14314', timeoutMs: 50 };

  it('signs with SHA-1 of secret + nonce + timestamp and posts the documented body', async () => {
    expect(nexconnSignature('s', '1', '2')).toBe(createHash('sha1').update('s12').digest('hex'));
    const f = fakeFetch([{ status: 200, body: { code: 0, result: { userId: 'u1', accessToken: 'TOKEN-1' } } }]);
    const issued = await createSignedTokenIssuer({ ...base, fetch: f.fetch }).issue({ userId: 'u1', displayName: 'Ada' });
    expect(issued.token).toBe('TOKEN-1');
    const call = f.calls[0];
    expect(call?.url).toBe('https://api.sg-light-api.com/v4/auth/access-token/issue');
    expect(call?.headers).toMatchObject({ 'App-Key': 'pkTEST', Nonce: '14314', Timestamp: '1408710653491', Signature: nexconnSignature('secretTEST', '14314', '1408710653491'), 'Content-Type': 'application/json' });
    expect(JSON.parse(call?.body ?? '{}')).toEqual({ userId: 'u1', name: 'Ada' });
    expect(JSON.stringify(call)).not.toContain('secretTEST');
  });

  it('fails over to the backup host after a timeout, a network error or a server error', async () => {
    for (const first of ['timeout', 'network', { status: 503 }] as const) {
      const f = fakeFetch([first, { status: 200, body: { code: 0, result: { accessToken: 'TOKEN-B' } } }]);
      expect((await createSignedTokenIssuer({ ...base, fetch: f.fetch }).issue({ userId: 'u1', displayName: 'Ada' })).token).toBe('TOKEN-B');
      expect(f.calls.map((c) => new URL(c.url).host)).toEqual(['api.sg-light-api.com', 'api-b.sg-light-api.com']);
    }
  });

  it('does not retry a rejected signature, and reports Nexconn refusals without credentials', async () => {
    const bad = fakeFetch([{ status: 401 }]);
    const err = await createSignedTokenIssuer({ ...base, fetch: bad.fetch }).issue({ userId: 'u1', displayName: 'Ada' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NexconnApiError);
    expect((err as NexconnApiError).status).toBe(401);
    expect(bad.calls).toHaveLength(1);
    expect((err as Error).message).not.toContain('secretTEST');

    const refused = fakeFetch([{ status: 200, body: { code: 1002 } }]);
    const e2 = await createSignedTokenIssuer({ ...base, fetch: refused.fetch }).issue({ userId: 'u1', displayName: 'Ada' }).catch((e: unknown) => e);
    expect((e2 as NexconnApiError).code).toBe(1002);
    expect(refused.calls).toHaveLength(1);
  });
});
