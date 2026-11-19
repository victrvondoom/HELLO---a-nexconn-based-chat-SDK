import type { CollectionName } from '@/domain/product';
import type {
  ApprovalRequest,
  AuditEntry,
  Follow,
  Incident,
  IncidentReport,
  IncidentTimelineEntry,
  KeyBundle,
  Membership,
  Message,
  Notification,
  Payment,
  SealedMessage,
  SignalPattern,
} from '@/domain/types';
import { EVERYONE, people, type LiveAudience, type LiveEvent } from './bus';

/**
 * Turns store writes into live events. Wraps any HelloStore (memory, memory-on-disk, Postgres), so every
 * service that writes through the store produces nudges with no change to the service.
 *
 * `describeWrite` is the whole policy: for each write method, the topic, the event and who may be told.
 * It is pure and unit tested. A write it does not list produces no event.
 */

type Draft = Omit<LiveEvent, 'at' | 'origin'>;

const PERSONAL_DOCS = new Set<CollectionName>(['fieldAttempts', 'fieldLedger', 'fieldBadges']);
const EVENT_DOCS = new Set<CollectionName>(['posts', 'comments', 'communities', 'calls', 'games', 'locations', 'fieldMissions', 'fieldSeasons', 'fieldStations', 'fieldLevels', 'questRuns']);
/** Sign-in records, tokens and raw media metadata never produce events: their timing alone is sensitive. */

function docEvent(collection: CollectionName, doc: Record<string, unknown> | null): Draft | null {
  const eventId = typeof doc?.eventId === 'string' ? doc.eventId : null;
  if (collection === 'prefs') return { eventId: null, topic: 'locations', audience: EVERYONE };
  if (EVENT_DOCS.has(collection)) return { eventId, topic: collection, audience: EVERYONE };
  if (PERSONAL_DOCS.has(collection)) return { eventId, topic: collection, audience: people([doc?.userId as string | undefined], true) };
  if (collection === 'workflowRuns') return { eventId, topic: collection, audience: people([doc?.actorId as string | undefined], true) };
  if (collection === 'fieldFlags') return { eventId, topic: collection, audience: people([], true) };
  return null;
}

const staffAnd = (...userIds: Array<string | null | undefined>): LiveAudience => people(userIds, true);
const only = (...userIds: Array<string | null | undefined>): LiveAudience => people(userIds, false);

export function describeWrite(method: string, args: unknown[], result: unknown): Draft[] {
  const a0 = args[0];
  switch (method) {
    case 'insertMessage': {
      const m = a0 as Message;
      return [{ eventId: m.eventId, topic: 'messages', audience: staffAnd(m.senderUserId) }];
    }
    case 'insertIncident':
    case 'updateIncident': {
      const i = (method === 'insertIncident' ? a0 : result) as Incident;
      const drafts: Draft[] = [{ eventId: i.eventId, topic: 'incidents', audience: staffAnd(i.createdByUserId, i.assigneeUserId) }];
      // Field Conditions show every member a room's open issues as a category and a count. A change to an
      // incident in a room can change that public summary, so everyone gets a content-free nudge for it.
      if (i.roomId) drafts.push({ eventId: i.eventId, topic: 'conditions', audience: EVERYONE });
      return drafts;
    }
    case 'insertReport': {
      const r = a0 as IncidentReport;
      return [{ eventId: r.eventId, topic: 'incidents', audience: staffAnd(r.reporterUserId) }];
    }
    case 'appendTimeline': {
      const t = a0 as IncidentTimelineEntry;
      return [{ eventId: t.eventId, topic: 'incidents', audience: staffAnd(t.actorUserId) }];
    }
    case 'insertApproval':
    case 'updateApproval': {
      const ap = (method === 'insertApproval' ? a0 : result) as ApprovalRequest;
      return [{ eventId: ap.eventId, topic: 'approvals', audience: staffAnd(ap.requestedByUserId) }];
    }
    case 'insertAnnouncement':
      return [{ eventId: (a0 as { eventId: string }).eventId, topic: 'announcements', audience: EVERYONE }];
    case 'appendAudit':
      return [{ eventId: (a0 as AuditEntry).eventId, topic: 'audit', audience: staffAnd() }];
    case 'insertNotificationIfNew': {
      if (result !== true) return [];
      const n = a0 as Notification;
      return [{ eventId: n.eventId, topic: 'notifications', audience: only(n.recipientUserId) }];
    }
    case 'markNotificationsRead':
      return [{ eventId: args[1] as string, topic: 'notifications', audience: only(a0 as string) }];
    case 'deleteNotificationsFor':
      return [{ eventId: null, topic: 'notifications', audience: only(a0 as string) }];
    case 'updateUser':
    case 'insertUser':
    case 'putProfile':
    case 'deleteProfile':
      return [{ eventId: null, topic: 'people', audience: EVERYONE }];
    case 'updateMembership':
    case 'insertMembership': {
      const m = (method === 'insertMembership' ? a0 : result) as Membership;
      return [{ eventId: m.eventId, topic: 'memberships', audience: EVERYONE }];
    }
    case 'updateSession':
      return [{ eventId: null, topic: 'sessions', audience: EVERYONE }];
    case 'addFollow': {
      if (result !== true) return [];
      const f = a0 as Follow;
      return [{ eventId: null, topic: 'social', audience: only(f.followerId, f.followeeId) }];
    }
    case 'removeFollow':
      return result === true ? [{ eventId: null, topic: 'social', audience: only(a0 as string, args[1] as string) }] : [];
    case 'removeAllFollows':
      return [{ eventId: null, topic: 'social', audience: EVERYONE }];
    case 'putKeyBundle':
      // A new device key lets the person's connections reach that device; they re-read the thread.
      return [{ eventId: null, topic: 'dm', audience: EVERYONE, data: { keysOf: (a0 as KeyBundle).userId } }];
    case 'deleteKeyBundles':
    case 'deleteSealedInvolving':
      return [{ eventId: null, topic: 'dm', audience: EVERYONE }];
    case 'insertSealedMessage': {
      const s = a0 as SealedMessage;
      return [{ eventId: null, topic: 'dm', audience: only(s.senderId, s.recipientId) }];
    }
    case 'insertPayment':
    case 'updatePayment': {
      const p = (method === 'insertPayment' ? a0 : result) as Payment;
      return [{ eventId: p.eventId, topic: 'payments', audience: only(p.payerId, p.payeeId) }];
    }
    case 'redactMessagesFrom':
      return [{ eventId: null, topic: 'messages', audience: staffAnd(a0 as string) }];
    case 'redactReportsFrom':
      return [{ eventId: null, topic: 'incidents', audience: staffAnd(a0 as string) }];
    case 'redactPaymentNotesFrom':
      return [{ eventId: null, topic: 'payments', audience: only(a0 as string) }];
    case 'upsertSignalPatterns': {
      const first = (a0 as SignalPattern[])[0];
      return first ? [{ eventId: first.eventId, topic: 'signals', audience: staffAnd() }] : [];
    }
    case 'updateSignalPattern':
      return [{ eventId: (result as SignalPattern).eventId, topic: 'signals', audience: staffAnd() }];
    case 'docPut':
    case 'docPutIfAbsent': {
      if (method === 'docPutIfAbsent' && result !== true) return [];
      const draft = docEvent(a0 as CollectionName, args[1] as Record<string, unknown>);
      return draft ? [draft] : [];
    }
    case 'docMutate': {
      if (result === null || result === undefined) return [];
      const draft = docEvent(a0 as CollectionName, result as Record<string, unknown>);
      return draft ? [draft] : [];
    }
    case 'docDelete': {
      if (result !== true) return [];
      // Only the id is known, so the event is not tied to one event; the nudge carries nothing else.
      const draft = docEvent(a0 as CollectionName, null);
      return draft ? [{ ...draft, eventId: null }] : [];
    }
    default:
      return [];
  }
}

const READS = /^(get|list|find|count|docGet|docList|blobGet|snapshot|blobIds|isEmpty|getMeta)/;

/**
 * Wraps a store so that every successful write publishes its events. Reads pass straight through, and a
 * write that throws publishes nothing.
 */
export function withLiveEvents<T extends object>(store: T, publish: (event: LiveEvent) => void, now: () => number): T {
  return new Proxy(store, {
    get(target, prop) {
      const value: unknown = Reflect.get(target, prop, target);
      if (typeof value !== 'function') return value;
      const name = String(prop);
      const method = value as (...args: unknown[]) => unknown;
      if (READS.test(name)) return method.bind(target);
      return async (...args: unknown[]) => {
        const result = await method.apply(target, args);
        for (const draft of describeWrite(name, args, result)) publish({ ...draft, at: now() });
        return result;
      };
    },
  });
}
