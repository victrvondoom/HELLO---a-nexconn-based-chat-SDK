import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { nexconnStatus } from '@/integrations/nexconn/status';
import { nexconnUserId, tokenIssuerFromEnv } from '@/integrations/nexconn/token';

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
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

  it('refuses to issue tokens until credentials and a verified issuer exist', () => {
    expect(tokenIssuerFromEnv({})).toMatchObject({ ready: false, reason: 'NOT_CONFIGURED' });
    expect(tokenIssuerFromEnv({ NEXCONN_APP_KEY: 'k' })).toMatchObject({ ready: false, reason: 'NO_APP_SECRET' });
    expect(tokenIssuerFromEnv({ NEXCONN_APP_KEY: 'k', NEXCONN_APP_SECRET: 's' })).toMatchObject({ ready: false, reason: 'TOKEN_API_NOT_IMPLEMENTED' });
    const issuer = { issue: () => Promise.resolve({ token: 't', expiresAt: null }) };
    expect(tokenIssuerFromEnv({ NEXCONN_APP_KEY: 'k', NEXCONN_APP_SECRET: 's' }, issuer)).toMatchObject({ ready: true, appKey: 'k' });
  });

  it('maps HELLO ids to safe Nexconn ids', () => {
    expect(nexconnUserId('u-att-ada')).toBe('u-att-ada');
    expect(nexconnUserId('a.b@c')).toBe('a_b_c');
  });

  it('never reads the App Secret in browser code', () => {
    const clientFiles = filesUnder('src').filter((f) => readFileSync(f, 'utf8').startsWith("'use client'"));
    for (const file of clientFiles) expect(readFileSync(file, 'utf8'), file).not.toContain('NEXCONN_APP_SECRET');
  });
});
