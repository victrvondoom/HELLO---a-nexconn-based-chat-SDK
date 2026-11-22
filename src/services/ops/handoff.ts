import { z } from 'zod';
import { DomainError } from '@/domain/errors';
import { HANDOFF_ACTIONS, startOwnership, transition, type Ownership } from '@/domain/ops/handoff';
import type { IncidentOwnership } from '@/domain/product';
import { roleHasCapability } from '@/domain/permissions';
import { audit, requireCapability, type ServiceContext } from '../context';

export const HandoffSchema = z.object({ action: z.enum(HANDOFF_ACTIONS), assigneeId: z.string().min(1).max(80).nullable().optional() });

/** Ownership of an incident's response. The conversation is the incident's own record; it never changes. */
export async function getOwnership(ctx: ServiceContext, eventId: string, userId: string, incidentId: string): Promise<IncidentOwnership> {
  await requireCapability(ctx, eventId, userId, 'incident.read.operational');
  const incident = await ctx.store.getIncident(incidentId);
  if (!incident || incident.eventId !== eventId) throw new DomainError('NOT_FOUND', 'Incident not found.');
  return (await ctx.store.docGet('incidentOwnership', incidentId)) ?? { id: incidentId, eventId, ...startOwnership(incidentId) };
}

export async function handOff(ctx: ServiceContext, eventId: string, userId: string, incidentId: string, input: z.infer<typeof HandoffSchema>): Promise<IncidentOwnership> {
  const membership = await requireCapability(ctx, eventId, userId, 'incident.read.operational');
  const staff = roleHasCapability(membership.role, 'incident.claim');
  if (input.assigneeId) {
    const assignee = await ctx.store.findMembership(eventId, input.assigneeId);
    if (!assignee || !roleHasCapability(assignee.role, 'incident.claim')) throw new DomainError('VALIDATION_FAILED', 'The responder must be staff at this event.');
  }
  const current = await getOwnership(ctx, eventId, userId, incidentId);
  await ctx.store.docPutIfAbsent('incidentOwnership', current);
  const why: { refused: string | null } = { refused: null };
  const next = await ctx.store.docMutate('incidentOwnership', incidentId, (doc) => {
    const r = transition(doc as Ownership, input.action, { userId, staff }, ctx.now(), input.assigneeId ?? null);
    if ('refused' in r) {
      why.refused = r.refused;
      return null;
    }
    return { ...doc, ...r };
  });
  if (!next) throw new DomainError('INVALID_TRANSITION', why.refused ?? 'That change is not allowed now.');
  await audit(ctx, eventId, userId, `handoff.${input.action.toLowerCase()}`, 'incident', incidentId, `${next.transitions.at(-1)?.from} → ${next.state}`);
  return next;
}
