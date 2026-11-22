/**
 * AI-to-human incident handoff (pattern: one shared conversation with explicit ownership). The conversation id
 * never changes; ownership moves through explicit, recorded transitions; automation runs only in AI_TRIAGE.
 *
 *   AI_TRIAGE ─request─▶ STAFF_REQUESTED ─assign─▶ ASSIGNED ─take_over─▶ HUMAN_OWNED ─resolve─▶ RESOLVED
 *        ▲                                                                    │                   │
 *        └──────────────────────────── hand_back (owner only) ◀───────────────┴───────────────────┘
 */
export const OWNERSHIP_STATES = ['AI_TRIAGE', 'STAFF_REQUESTED', 'ASSIGNED', 'HUMAN_OWNED', 'RESOLVED'] as const;
export type OwnershipState = (typeof OWNERSHIP_STATES)[number];
export const HANDOFF_ACTIONS = ['REQUEST_STAFF', 'ASSIGN', 'TAKE_OVER', 'RESOLVE', 'HAND_BACK'] as const;
export type HandoffAction = (typeof HANDOFF_ACTIONS)[number];

export interface Ownership {
  conversationId: string;
  state: OwnershipState;
  ownerUserId: string | null;
  transitions: Array<{ from: OwnershipState; to: OwnershipState; action: HandoffAction; actorId: string; at: number; ownerUserId: string | null }>;
}

export interface Actor {
  userId: string;
  staff: boolean;
}

export const automationAllowed = (o: Pick<Ownership, 'state'>) => o.state === 'AI_TRIAGE';

export function startOwnership(conversationId: string): Ownership {
  return { conversationId, state: 'AI_TRIAGE', ownerUserId: null, transitions: [] };
}

/** One transition, or a refusal reason. Permission rules here are mirrored by the service's capability checks. */
export function transition(o: Ownership, action: HandoffAction, actor: Actor, at: number, assigneeId: string | null = null): Ownership | { refused: string } {
  const go = (to: OwnershipState, owner: string | null): Ownership => ({ ...o, state: to, ownerUserId: owner, transitions: [...o.transitions, { from: o.state, to, action, actorId: actor.userId, at, ownerUserId: owner }] });
  switch (action) {
    case 'REQUEST_STAFF':
      return o.state === 'AI_TRIAGE' ? go('STAFF_REQUESTED', null) : { refused: 'Staff can only be requested while the AI is handling it.' };
    case 'ASSIGN':
      if (!actor.staff) return { refused: 'Only staff can assign a responder.' };
      if (!assigneeId) return { refused: 'Name the responder.' };
      return o.state === 'STAFF_REQUESTED' || o.state === 'AI_TRIAGE' ? go('ASSIGNED', assigneeId) : { refused: 'Already owned or resolved.' };
    case 'TAKE_OVER':
      if (!actor.staff) return { refused: 'Only staff can take over.' };
      if (o.state !== 'ASSIGNED') return { refused: 'Assign a responder first.' };
      return o.ownerUserId === actor.userId ? go('HUMAN_OWNED', actor.userId) : { refused: 'Only the assigned responder can take over.' };
    case 'RESOLVE':
      return o.state === 'HUMAN_OWNED' && o.ownerUserId === actor.userId ? go('RESOLVED', actor.userId) : { refused: 'Only the human owner can resolve.' };
    case 'HAND_BACK':
      return (o.state === 'HUMAN_OWNED' || o.state === 'RESOLVED') && o.ownerUserId === actor.userId ? go('AI_TRIAGE', null) : { refused: 'Only the human owner can hand back to automation.' };
  }
}
