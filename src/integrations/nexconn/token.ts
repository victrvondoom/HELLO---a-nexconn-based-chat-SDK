import { nexconnStatus } from './status';

/**
 * Server-side Nexconn user tokens. The App Secret stays here; a browser receives only the App Key and a
 * token bound to the signed-in HELLO person (docs/nexconn-integration.md, "Tokens").
 *
 * The Platform Chat API call that issues a token (its URL, signing scheme and body) is not written yet:
 * the official documentation (docs.nexconn.ai) could not be reached from the build environment, and HELLO
 * does not guess at a signing scheme. Implement `NexconnTokenIssuer.issue` from that documentation, return it
 * from `tokenIssuerFromEnv`, and nothing else changes: the route, the client and the tests already use this
 * boundary.
 */
export interface NexconnTokenIssuer {
  issue(person: { userId: string; displayName: string }): Promise<{ token: string; expiresAt: number | null }>;
}

export type TokenIssuerState =
  | { ready: true; appKey: string; issuer: NexconnTokenIssuer }
  | { ready: false; reason: 'NOT_CONFIGURED' | 'NO_APP_SECRET' | 'TOKEN_API_NOT_IMPLEMENTED'; message: string };

/** Nexconn user ids: HELLO's own id, which is opaque and never an email or a handle. */
export function nexconnUserId(helloUserId: string): string {
  return helloUserId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
}

export function tokenIssuerFromEnv(env: Record<string, string | undefined> = process.env, implementation: NexconnTokenIssuer | null = null): TokenIssuerState {
  const status = nexconnStatus(env);
  if (status.state === 'NOT_CONFIGURED') return { ready: false, reason: 'NOT_CONFIGURED', message: status.message };
  if (status.state === 'KEY_ONLY') return { ready: false, reason: 'NO_APP_SECRET', message: status.message };
  if (!implementation) {
    return {
      ready: false,
      reason: 'TOKEN_API_NOT_IMPLEMENTED',
      message: 'Nexconn credentials are set, but the token call to the Platform Chat API has not been written from the official documentation yet.',
    };
  }
  return { ready: true, appKey: (env.NEXCONN_APP_KEY ?? '').trim(), issuer: implementation };
}
