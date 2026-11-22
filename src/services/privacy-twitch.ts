import { randomBytes, timingSafeEqual } from 'node:crypto';
import { DomainError } from '../domain/errors';
import { OAUTH_TTL_MS, authorizeUrl, validClientId } from '../domain/privacy-filter/twitch';
import { TwitchMonitor, openWebSocket, type TwitchDeps, type TwitchState } from '../integrations/twitch/monitor';
import { requireCapability, type ServiceContext } from './context';
import { raiseTwitchPrivacyAlert } from './privacy-filter';

/**
 * Connect Twitch to the privacy filter (from Offleak's dock: /twitch/start, /twitch/finish, /twitch/disconnect).
 *
 * The person registers their own Twitch app (client id only, no secret) with `<HELLO origin>/twitch/callback` as
 * the redirect URL. Twitch's implicit flow hands the access token to that page in the URL fragment; the page posts
 * it here once, with the one-time state, and removes it from the address bar. The token then lives only in this
 * server's memory: it is lost on restart (reconnect), and it is per instance, like upstream's controller memory.
 */

interface Pending {
  nonce: string;
  clientId: string;
  eventId: string;
  expires: number;
}

interface Registry {
  monitors: Map<string, { monitor: TwitchMonitor; eventId: string }>;
  pending: Map<string, Pending>;
  deps: Omit<TwitchDeps, 'onAlert'> | null;
}

const g = globalThis as typeof globalThis & { __helloTwitch?: Registry };
const registry: Registry = (g.__helloTwitch ??= { monitors: new Map(), pending: new Map(), deps: null });

const defaultDeps = (): Omit<TwitchDeps, 'onAlert'> => ({
  fetch: (...args) => fetch(...args),
  open: openWebSocket,
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
});

/** Tests replace the network with fakes. */
export function setTwitchDeps(deps: Omit<TwitchDeps, 'onAlert'> | null): void {
  registry.deps = deps;
}

export function resetTwitch(): void {
  for (const { monitor } of registry.monitors.values()) monitor.disconnect();
  registry.monitors.clear();
  registry.pending.clear();
}

export async function startTwitch(ctx: ServiceContext, eventId: string, userId: string, clientId: unknown, redirectUri: string): Promise<{ url: string }> {
  await requireCapability(ctx, eventId, userId, 'event.read');
  if (!validClientId(clientId)) throw new DomainError('VALIDATION_FAILED', 'A Twitch client ID is letters and digits only.');
  const nonce = randomBytes(32).toString('base64url');
  registry.pending.set(userId, { nonce, clientId, eventId, expires: ctx.now() + OAUTH_TTL_MS });
  return { url: authorizeUrl(clientId, redirectUri, nonce) };
}

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Single use: the pending start is consumed whether or not the finish succeeds. */
export async function finishTwitch(ctx: ServiceContext, userId: string, state: unknown, token: unknown): Promise<{ eventId: string; channel: string }> {
  const pending = registry.pending.get(userId);
  registry.pending.delete(userId);
  if (typeof state !== 'string' || typeof token !== 'string' || !token || token.length > 2048 || !pending || ctx.now() > pending.expires || !same(state, pending.nonce)) {
    throw new DomainError('FORBIDDEN', 'That Twitch sign-in has expired or was not started here. Start it again.');
  }
  await requireCapability(ctx, pending.eventId, userId, 'event.read');
  registry.monitors.get(userId)?.monitor.disconnect();
  registry.monitors.delete(userId);
  const eventId = pending.eventId;
  const monitor = new TwitchMonitor({
    ...(registry.deps ?? defaultDeps()),
    onAlert: async (sender) => {
      await raiseTwitchPrivacyAlert(ctx, eventId, userId, sender);
    },
  });
  try {
    await monitor.connect(token, pending.clientId);
  } catch {
    throw new DomainError('VALIDATION_FAILED', 'Twitch did not accept that sign-in. Check the client ID and try again.');
  }
  registry.monitors.set(userId, { monitor, eventId });
  return { eventId, channel: monitor.state.channel };
}

export function disconnectTwitch(userId: string): boolean {
  registry.pending.delete(userId);
  const entry = registry.monitors.get(userId);
  entry?.monitor.disconnect();
  registry.monitors.delete(userId);
  return Boolean(entry);
}

export async function twitchState(ctx: ServiceContext, eventId: string, userId: string): Promise<TwitchState & { eventId: string | null }> {
  await requireCapability(ctx, eventId, userId, 'event.read');
  const entry = registry.monitors.get(userId);
  if (!entry) return { connection: 'disconnected', live: null, channel: '', alert: null, eventId: null };
  return { ...entry.monitor.state, eventId: entry.eventId };
}
