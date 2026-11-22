// SPDX-License-Identifier: AGPL-3.0-only
// Adapted from Offleak (https://github.com/azharizz/offleak, commit 24e6a77, app/offleak/twitch/monitor.py), AGPL-3.0.

/**
 * Twitch rules, pure. The monitor (src/integrations/twitch/monitor.ts) does the networking.
 *
 * - Scope: only `user:read:chat`. No client secret is used; the person's access token stays in server memory.
 * - `stream.online` / `stream.offline` set the live flag.
 * - `channel.chat.message`: only the broadcaster or a moderator in their own channel raises a privacy alert, and only
 *   with exactly `!privacy`. The chat message itself is public on Twitch; the alert is private to the broadcaster.
 */

export const EVENTSUB_URL = 'wss://eventsub.wss.twitch.tv/ws';
export const HELIX = 'https://api.twitch.tv/helix';
export const VALIDATE_URL = 'https://id.twitch.tv/oauth2/validate';
export const AUTHORIZE_URL = 'https://id.twitch.tv/oauth2/authorize';
export const SCOPE = 'user:read:chat';
export const PRIVACY_COMMAND = '!privacy';
/** Twitch requires an app to validate its token every hour. */
export const VALIDATE_EVERY_MS = 3_600_000;
/** An OAuth start is good for five minutes, once. */
export const OAUTH_TTL_MS = 300_000;

export interface ChatEvent {
  broadcaster_user_id?: unknown;
  chatter_user_id?: unknown;
  chatter_user_name?: unknown;
  badges?: unknown;
  message?: { text?: unknown } | null;
}

export function acceptedPrivacyCommand(event: ChatEvent, broadcasterId: string): boolean {
  const badges = new Set(
    (Array.isArray(event.badges) ? event.badges : [])
      .filter((b): b is { set_id?: unknown } => typeof b === 'object' && b !== null)
      .map((b) => b.set_id),
  );
  const text = typeof event.message?.text === 'string' ? event.message.text : '';
  return (
    event.broadcaster_user_id === broadcasterId &&
    (event.chatter_user_id === broadcasterId || badges.has('moderator') || badges.has('broadcaster')) &&
    text.trim().toLowerCase() === PRIVACY_COMMAND
  );
}

/** A client id is a short ASCII alphanumeric string (upstream check). */
export function validClientId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 100 && /^[A-Za-z0-9]+$/.test(value);
}

export function authorizeUrl(clientId: string, redirectUri: string, state: string): string {
  const query = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'token', scope: SCOPE, state });
  return `${AUTHORIZE_URL}?${query.toString()}`;
}

/** Only Twitch's own EventSub host may be a reconnect target (no credentials, no other port). */
export function validReconnectUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'wss:' && parsed.hostname === 'eventsub.wss.twitch.tv' && !parsed.username && !parsed.password && (parsed.port === '' || parsed.port === '443');
  } catch {
    return false;
  }
}

export interface TwitchValidation {
  client_id?: unknown;
  scopes?: unknown;
  user_id?: unknown;
  login?: unknown;
}

/** The token must belong to this client id, carry the chat scope and name a user. */
export function validationProblem(valid: TwitchValidation, clientId: string): string | null {
  if (valid.client_id !== clientId || !Array.isArray(valid.scopes) || !valid.scopes.includes(SCOPE) || typeof valid.user_id !== 'string' || !valid.user_id) {
    return 'Twitch authorization is missing chat access or has the wrong client ID.';
  }
  return null;
}

/** The subscriptions one connection makes, in order. */
export function subscriptions(userId: string, sessionId: string): Array<Record<string, unknown>> {
  return [
    ['stream.online', { broadcaster_user_id: userId }],
    ['stream.offline', { broadcaster_user_id: userId }],
    ['channel.chat.message', { broadcaster_user_id: userId, user_id: userId }],
  ].map(([type, condition]) => ({ type, version: '1', condition, transport: { method: 'websocket', session_id: sessionId } }));
}

export type TwitchStep =
  | { kind: 'ignore' }
  | { kind: 'live'; live: boolean }
  | { kind: 'alert'; sender: string }
  | { kind: 'reconnect'; url: string }
  | { kind: 'revoked' };

/** What one EventSub message means for the monitor. Throws on a malformed reconnect (fail: drop the connection). */
export function interpret(message: unknown, broadcasterId: string): TwitchStep {
  const m = (typeof message === 'object' && message !== null ? message : {}) as { metadata?: { message_type?: unknown }; payload?: Record<string, unknown> };
  const kind = m.metadata?.message_type;
  if (kind === 'revocation') return { kind: 'revoked' };
  if (kind === 'session_reconnect') {
    const url = (m.payload?.session as { reconnect_url?: unknown } | undefined)?.reconnect_url;
    if (!validReconnectUrl(url)) throw new Error('invalid Twitch reconnect URL');
    return { kind: 'reconnect', url };
  }
  if (kind !== 'notification') return { kind: 'ignore' };
  const type = (m.payload?.subscription as { type?: unknown } | undefined)?.type;
  const event = (m.payload?.event ?? {}) as ChatEvent;
  if (type === 'stream.online' || type === 'stream.offline') return { kind: 'live', live: type === 'stream.online' };
  if (type === 'channel.chat.message' && acceptedPrivacyCommand(event, broadcasterId)) {
    const name = typeof event.chatter_user_name === 'string' && event.chatter_user_name ? event.chatter_user_name.slice(0, 40) : 'Moderator';
    return { kind: 'alert', sender: name };
  }
  return { kind: 'ignore' };
}
