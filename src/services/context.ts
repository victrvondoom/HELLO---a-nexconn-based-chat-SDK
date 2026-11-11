import { authorize, type Capability } from '../domain/permissions';
import { DomainError } from '../domain/errors';
import type { AuditEntry, Membership, Notification } from '../domain/types';
import { buildDedupeKey } from '../domain/notifications/dedupe';
import type { HelloStore } from '../store/store';
import type { IntentProvider } from '../ai/intent';
import type { WebSearchProvider } from '../agents/web';

/** Everything a service needs. Passed explicitly so tests can control time and IDs. */
export interface ServiceContext {
  store: HelloStore;
  now: () => number;
  newId: (prefix: string) => string;
  intentProvider: IntentProvider | null;
  intentTimeoutMs: number;
  /** Web research provider for the web agent. Null means the agent reports that it is not configured. */
  webSearch: WebSearchProvider | null;
  webSearchTimeoutMs: number;
}

export function createContext(
  store: HelloStore,
  options: Partial<Omit<ServiceContext, 'store'>> = {},
): ServiceContext {
  return {
    store,
    now: options.now ?? (() => Date.now()),
    newId: options.newId ?? ((prefix) => `${prefix}-${crypto.randomUUID()}`),
    intentProvider: options.intentProvider ?? null,
    intentTimeoutMs: options.intentTimeoutMs ?? 4000,
    webSearch: options.webSearch ?? null,
    webSearchTimeoutMs: options.webSearchTimeoutMs ?? 5000,
  };
}

/**
 * Loads the actor's membership in `eventId` and checks `capability`.
 * Anything other than an allowed membership is reported as FORBIDDEN, and the
 * message does not reveal whether the event or the resource exists.
 */
export async function requireCapability(
  ctx: ServiceContext,
  eventId: string,
  userId: string,
  capability: Capability,
): Promise<Membership> {
  const membership = await ctx.store.findMembership(eventId, userId);
  const decision = authorize(membership, capability, eventId);
  if (!decision.allowed || !membership) {
    throw new DomainError('FORBIDDEN', 'You do not have permission to do that in this event.');
  }
  return membership;
}

export async function audit(
  ctx: ServiceContext,
  eventId: string,
  actorUserId: string | null,
  action: string,
  targetType: string,
  targetId: string,
  detail: string,
): Promise<void> {
  const entry: AuditEntry = {
    id: ctx.newId('aud'),
    eventId,
    actorUserId,
    action,
    targetType,
    targetId,
    detail,
    at: ctx.now(),
  };
  await ctx.store.appendAudit(entry);
}

export interface NotifyInput {
  eventId: string;
  recipientUserId: string;
  kind: string;
  body: string;
  href: string;
  /** Parts that identify the event being announced; the state must be included so new states are announced. */
  dedupeParts: ReadonlyArray<string | number>;
}

/** Writes a notification once per dedupe key. Returns true if a new notification was created. */
export async function notify(ctx: ServiceContext, input: NotifyInput): Promise<boolean> {
  const notification: Notification = {
    id: ctx.newId('ntf'),
    eventId: input.eventId,
    recipientUserId: input.recipientUserId,
    kind: input.kind,
    body: input.body,
    href: input.href,
    dedupeKey: buildDedupeKey([input.kind, input.recipientUserId, ...input.dedupeParts]),
    createdAt: ctx.now(),
    readAt: null,
  };
  return ctx.store.insertNotificationIfNew(notification);
}
