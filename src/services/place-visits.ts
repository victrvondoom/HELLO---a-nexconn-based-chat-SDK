import { DomainError } from '../domain/errors';
import type { PlaceVisit } from '../domain/product';
import { requireCapability, type ServiceContext } from './context';
import { VersionConflictError } from '../store/store';

/**
 * Visits: places the person says they were. A visit exists only because the person checked in, at a venue space
 * they chose. There is no background detection and no device position. They can end a visit, correct its times, or
 * delete it. Another person's visit is reported as not found.
 */

const CLOCK_SKEW_MS = 60 * 1000;

async function ownVisit(ctx: ServiceContext, eventId: string, userId: string, visitId: string): Promise<PlaceVisit> {
  const visit = await ctx.store.docGet('placeVisits', visitId);
  if (!visit || visit.eventId !== eventId || visit.ownerId !== userId) throw new DomainError('NOT_FOUND', 'Visit not found.');
  return visit;
}

export async function checkIn(ctx: ServiceContext, input: { eventId: string; userId: string; spaceId: string; placeId?: string | null }): Promise<PlaceVisit> {
  await requireCapability(ctx, input.eventId, input.userId, 'event.read');
  const venue = await ctx.store.getVenue(input.eventId);
  if (!venue?.spaces.some((space) => space.id === input.spaceId)) {
    throw new DomainError('VALIDATION_FAILED', 'Choose a place on the venue map to check in to.');
  }
  if (input.placeId) {
    const place = await ctx.store.docGet('places', input.placeId);
    if (!place || place.eventId !== input.eventId || place.ownerId !== input.userId) throw new DomainError('NOT_FOUND', 'Place not found.');
  }
  const now = ctx.now();
  // A new check-in ends the previous open visit, because a person is in one place at a time.
  for (const visit of await ctx.store.docList('placeVisits', { eventId: input.eventId, ownerId: input.userId })) {
    if (visit.departedAt === null) {
      await ctx.store.docMutate('placeVisits', visit.id, (doc) =>
        doc.departedAt === null ? { ...doc, departedAt: Math.max(now, doc.arrivedAt), version: doc.version + 1 } : null,
      );
    }
  }
  const visit: PlaceVisit = {
    id: ctx.newId('plvisit'),
    eventId: input.eventId,
    ownerId: input.userId,
    spaceId: input.spaceId,
    placeId: input.placeId ?? null,
    arrivedAt: now,
    departedAt: null,
    method: 'CHECK_IN',
    correctedAt: null,
    version: 1,
  };
  await ctx.store.docPut('placeVisits', visit);
  return visit;
}

export async function endVisit(ctx: ServiceContext, input: { eventId: string; userId: string; visitId: string; expectedVersion: number }): Promise<PlaceVisit> {
  await requireCapability(ctx, input.eventId, input.userId, 'event.read');
  const current = await ownVisit(ctx, input.eventId, input.userId, input.visitId);
  if (current.version !== input.expectedVersion) throw new VersionConflictError('visit');
  if (current.departedAt !== null) throw new DomainError('ALREADY_HANDLED', 'That visit has already ended.');
  const now = ctx.now();
  const updated = await ctx.store.docMutate('placeVisits', input.visitId, (doc) =>
    doc.version === input.expectedVersion && doc.departedAt === null ? { ...doc, departedAt: Math.max(now, doc.arrivedAt), version: doc.version + 1 } : null,
  );
  if (!updated) throw new VersionConflictError('visit');
  return updated;
}

/** Corrects the times the person remembers. The end cannot be before the start, and times cannot be in the future. */
export async function correctVisit(
  ctx: ServiceContext,
  input: { eventId: string; userId: string; visitId: string; expectedVersion: number; arrivedAt: number; departedAt: number | null },
): Promise<PlaceVisit> {
  await requireCapability(ctx, input.eventId, input.userId, 'event.read');
  const current = await ownVisit(ctx, input.eventId, input.userId, input.visitId);
  if (current.version !== input.expectedVersion) throw new VersionConflictError('visit');
  const now = ctx.now();
  if (!Number.isFinite(input.arrivedAt) || input.arrivedAt > now + CLOCK_SKEW_MS) {
    throw new DomainError('VALIDATION_FAILED', 'The arrival time cannot be in the future.');
  }
  if (input.departedAt !== null && (!Number.isFinite(input.departedAt) || input.departedAt < input.arrivedAt || input.departedAt > now + CLOCK_SKEW_MS)) {
    throw new DomainError('VALIDATION_FAILED', 'The departure time must be after arrival and not in the future.');
  }
  const updated = await ctx.store.docMutate('placeVisits', input.visitId, (doc) =>
    doc.version === input.expectedVersion
      ? { ...doc, arrivedAt: input.arrivedAt, departedAt: input.departedAt, correctedAt: now, version: doc.version + 1 }
      : null,
  );
  if (!updated) throw new VersionConflictError('visit');
  return updated;
}

export async function deleteVisit(ctx: ServiceContext, input: { eventId: string; userId: string; visitId: string }): Promise<void> {
  await requireCapability(ctx, input.eventId, input.userId, 'event.read');
  await ownVisit(ctx, input.eventId, input.userId, input.visitId);
  await ctx.store.docDelete('placeVisits', input.visitId);
}
