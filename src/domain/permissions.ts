import type { Membership, Role } from './types';

/**
 * Capabilities are the only thing server code checks. The UI may hide controls
 * using the same table, but hiding is never the security boundary: every
 * service method calls `authorize` with a membership loaded from the store.
 */
export const CAPABILITIES = [
  'event.read',
  'message.send',
  'incident.report',
  'incident.read.own',
  'incident.read.operational',
  'incident.confirm.own',
  'incident.claim',
  'incident.progress',
  'incident.escalate',
  'incident.cancel',
  'incident.triage',
  'assignment.recommend.view',
  'signal.read',
  'signal.review',
  'session.read',
  'session.discover',
  'session.manage',
  'approval.request',
  'approval.decide',
  'announcement.publish',
  'people.discover',
  'audit.read',
  'member.manage',
] as const;
export type Capability = (typeof CAPABILITIES)[number];

const ROLE_CAPABILITIES: Record<Role, readonly Capability[]> = {
  ATTENDEE: [
    'event.read',
    'message.send',
    'incident.report',
    'incident.read.own',
    'incident.confirm.own',
    'session.read',
    'session.discover',
    'people.discover',
  ],
  SPEAKER: [
    'event.read',
    'message.send',
    'incident.report',
    'incident.read.own',
    'incident.confirm.own',
    'session.read',
    'session.discover',
    'people.discover',
  ],
  VOLUNTEER: [
    'event.read',
    'message.send',
    'incident.report',
    'incident.read.own',
    'incident.read.operational',
    'incident.confirm.own',
    'incident.claim',
    'incident.progress',
    'incident.escalate',
    'assignment.recommend.view',
    'session.read',
    'session.discover',
    'people.discover',
  ],
  OPERATIONS_STAFF: [
    'event.read',
    'message.send',
    'incident.report',
    'incident.read.own',
    'incident.read.operational',
    'incident.confirm.own',
    'incident.claim',
    'incident.progress',
    'incident.escalate',
    'incident.triage',
    'assignment.recommend.view',
    'approval.request',
    'signal.read',
    'session.read',
    'session.discover',
    'people.discover',
  ],
  // Organisers hold every event-scoped capability for their own event.
  ORGANISER: [...CAPABILITIES],
  // Platform administrators manage configuration and audit access. They have no
  // implicit read access to a specific event's data: they need an event membership.
  PLATFORM_ADMIN: ['event.read', 'audit.read', 'member.manage'],
};

export function roleHasCapability(role: Role, capability: Capability): boolean {
  return ROLE_CAPABILITIES[role].includes(capability);
}

export type AuthorizationResult =
  | { allowed: true }
  | { allowed: false; reason: 'NOT_A_MEMBER' | 'WRONG_EVENT' | 'MISSING_CAPABILITY' };

/**
 * Decide whether `membership` may perform `capability` on a resource that belongs
 * to `resourceEventId`. A membership from another event never grants access.
 */
export function authorize(
  membership: Membership | null,
  capability: Capability,
  resourceEventId: string,
): AuthorizationResult {
  if (!membership) {
    return { allowed: false, reason: 'NOT_A_MEMBER' };
  }
  if (membership.eventId !== resourceEventId) {
    return { allowed: false, reason: 'WRONG_EVENT' };
  }
  if (!roleHasCapability(membership.role, capability)) {
    return { allowed: false, reason: 'MISSING_CAPABILITY' };
  }
  return { allowed: true };
}
