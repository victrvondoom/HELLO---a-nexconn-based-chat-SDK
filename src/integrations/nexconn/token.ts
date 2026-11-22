import { createHash, randomBytes } from 'node:crypto';
import { nexconnStatus } from './status';

/**
 * Server-side Nexconn user tokens. The App Secret stays here; a browser receives only the App Key, the data
 * centre and a token bound to the signed-in HELLO person.
 *
 * Written from the official Platform Chat API docs (docs.nexconn.ai, read 2026-11-22):
 *   - API request signature (/platform-chat-api/prepare-to-use-api/auth.md): headers App-Key, Nonce (≤ 18
 *     chars), Timestamp (Unix ms) and Signature = hex SHA-1 of AppSecret + Nonce + Timestamp. 401 on failure.
 *   - Base URL (/platform-chat-api/prepare-to-use-api/base-url.md): one primary and one backup host per data
 *     centre; switch to the backup after a 5 s timeout or an unexpected status; no long-lived keep-alive.
 *   - Register a user (/platform-chat-api/user/register.md): POST /v4/auth/access-token/issue with
 *     { userId, name, avatarUrl? } → { code: 0, result: { userId, accessToken } }. userId: letters and digits,
 *     at most 64 bytes, and not sequential. name: at most 64 characters.
 */
export interface NexconnTokenIssuer {
  issue(person: { userId: string; displayName: string }): Promise<{ token: string; expiresAt: number | null }>;
}

/** Nexconn data centres, as named by `AreaCode` in @nexconn/engine. The console shows which one the app is in. */
export const NEXCONN_AREAS = ['BJ', 'SG', 'NA', 'SG_B', 'SA', 'OM'] as const;
export type NexconnArea = (typeof NEXCONN_AREAS)[number];

/** Platform Chat API hosts per data centre, primary then backup. Only the centres the docs list. */
export const NEXCONN_API_HOSTS: Partial<Record<NexconnArea, readonly [string, string]>> = {
  SG: ['api.sg-light-api.com', 'api-b.sg-light-api.com'],
  NA: ['api.us-light-api.com', 'api-b.us-light-api.com'],
  SA: ['api.sau-light-api.com', 'api-b.sau-light-api.com'],
};

/**
 * The app's data centre, from NEXCONN_AREA. Defaults to SG (where this app was created). Always passed to the SDK
 * explicitly: the chat and engine type definitions disagree about the SDK's own default (SG vs BJ).
 */
export function nexconnArea(env: Record<string, string | undefined> = process.env): NexconnArea {
  const value = (env.NEXCONN_APP_AREA ?? env.NEXCONN_AREA ?? '').trim().toUpperCase();
  return (NEXCONN_AREAS as readonly string[]).includes(value) ? (value as NexconnArea) : 'SG';
}

/**
 * The Nexconn user id for a HELLO person: letters and digits only (Nexconn's rule), stable, and not sequential
 * or guessable from the HELLO id (Nexconn's advice). Every server that knows the HELLO id derives the same one.
 */
export function nexconnUserId(helloUserId: string): string {
  return `h${createHash('sha256').update(`hello-nexconn:${helloUserId}`).digest('hex').slice(0, 40)}`;
}

/** Signature = hex SHA-1 of AppSecret + Nonce + Timestamp. */
export function nexconnSignature(appSecret: string, nonce: string, timestamp: string): string {
  return createHash('sha1').update(`${appSecret}${nonce}${timestamp}`).digest('hex');
}

export class NexconnApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly code: number | null,
  ) {
    super(message);
    this.name = 'NexconnApiError';
  }
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{ status: number; json(): Promise<unknown> }>;

export interface SignedIssuerOptions {
  appKey: string;
  appSecret: string;
  hosts: readonly [string, string];
  fetch?: FetchLike;
  now?: () => number;
  nonce?: () => string;
  timeoutMs?: number;
}

/**
 * The real issuer: a signed POST to /v4/auth/access-token/issue, primary host first, then the backup after a
 * timeout, a network error or an unexpected status (as the docs advise). A 401 (bad signature or secret) is not
 * retried on the backup: the same credentials would fail there too.
 */
export function createSignedTokenIssuer(options: SignedIssuerOptions): NexconnTokenIssuer {
  const doFetch: FetchLike = options.fetch ?? ((url, init) => fetch(url, init));
  const now = options.now ?? (() => Date.now());
  const nonce = options.nonce ?? (() => randomBytes(9).toString('hex').slice(0, 18));
  const timeoutMs = options.timeoutMs ?? 5000;

  return {
    async issue(person) {
      const body = JSON.stringify({ userId: person.userId, name: Array.from(new Intl.Segmenter().segment(person.displayName), (g) => g.segment).slice(0, 64).join('') || 'HELLO user' });
      let lastError: NexconnApiError | null = null;
      for (const host of options.hosts) {
        const n = nonce();
        const timestamp = String(now());
        const controller = new AbortController();
        const timer = setTimeout(() => { controller.abort(); }, timeoutMs);
        try {
          const response = await doFetch(`https://${host}/v4/auth/access-token/issue`, {
            method: 'POST',
            headers: {
              'App-Key': options.appKey,
              Nonce: n,
              Timestamp: timestamp,
              Signature: nexconnSignature(options.appSecret, n, timestamp),
              'X-Request-ID': randomBytes(16).toString('hex'),
              'Content-Type': 'application/json',
              Connection: 'close',
            },
            body,
            signal: controller.signal,
          });
          if (response.status === 401) throw new NexconnApiError('Nexconn rejected the signature: check NEXCONN_APP_KEY and NEXCONN_APP_SECRET.', 401, null);
          const json = (await response.json().catch(() => null)) as { code?: number; result?: { accessToken?: string } } | null;
          if (response.status === 200 && json?.code === 0 && typeof json.result?.accessToken === 'string') {
            return { token: json.result.accessToken, expiresAt: null };
          }
          lastError = new NexconnApiError(`Nexconn answered ${response.status} with code ${json?.code ?? 'none'}.`, response.status, json?.code ?? null);
          // A well-formed refusal (code ≠ 0 with HTTP 200) is the same on the backup host: stop here.
          if (response.status === 200) break;
        } catch (error) {
          if (error instanceof NexconnApiError && error.status === 401) throw error;
          lastError = error instanceof NexconnApiError ? error : new NexconnApiError(`Could not reach ${host}.`, null, null);
        } finally {
          clearTimeout(timer);
        }
      }
      throw lastError ?? new NexconnApiError('Nexconn did not answer.', null, null);
    },
  };
}

export type TokenIssuerState =
  | { ready: true; appKey: string; area: NexconnArea; issuer: NexconnTokenIssuer }
  | { ready: false; reason: 'NOT_CONFIGURED' | 'NO_APP_SECRET' | 'AREA_NOT_SUPPORTED'; message: string };

export function tokenIssuerFromEnv(env: Record<string, string | undefined> = process.env, implementation: NexconnTokenIssuer | null = null): TokenIssuerState {
  const status = nexconnStatus(env);
  if (status.state === 'NOT_CONFIGURED') return { ready: false, reason: 'NOT_CONFIGURED', message: status.message };
  if (status.state === 'KEY_ONLY') return { ready: false, reason: 'NO_APP_SECRET', message: status.message };
  const appKey = (env.NEXCONN_APP_KEY ?? '').trim();
  const area = nexconnArea(env);
  const hosts = NEXCONN_API_HOSTS[area];
  if (!implementation && !hosts) {
    return { ready: false, reason: 'AREA_NOT_SUPPORTED', message: `No Platform Chat API address is documented for the ${area} data centre. Set NEXCONN_AREA to SG, NA or SA.` };
  }
  const issuer = implementation ?? createSignedTokenIssuer({ appKey, appSecret: (env.NEXCONN_APP_SECRET ?? '').trim(), hosts: hosts as readonly [string, string] });
  return { ready: true, appKey, area, issuer };
}
