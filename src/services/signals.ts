import { DomainError } from '../domain/errors';
import { detectPatterns, type SignalReport } from '../domain/intelligence/signals';
import type { SignalPattern } from '../domain/types';
import { audit, requireCapability, type ServiceContext } from './context';

/**
 * Signal Intelligence service. Reads only stored reports and writes only
 * suggestions. Human review is the only path to a decision.
 */

export async function refreshSignals(ctx: ServiceContext, eventId: string, actorUserId: string): Promise<SignalPattern[]> {
  await requireCapability(ctx, eventId, actorUserId, 'signal.read');
  const reports = await ctx.store.listReportsForEvent(eventId);
  const incidents = await ctx.store.listIncidents(eventId);
  const rooms = await ctx.store.listRooms(eventId);
  const incidentById = new Map(incidents.map((i) => [i.id, i] as const));
  const roomById = new Map(rooms.map((r) => [r.id, r] as const));

  const signalReports: SignalReport[] = [];
  for (const report of reports) {
    const incident = incidentById.get(report.incidentId);
    if (!incident) continue;
    const room = incident.roomId ? roomById.get(incident.roomId) ?? null : null;
    signalReports.push({
      reportId: report.id,
      incidentId: incident.id,
      reporterUserId: report.reporterUserId,
      roomId: incident.roomId,
      roomName: room?.name ?? null,
      category: incident.category,
      createdAt: report.createdAt,
    });
  }

  const patterns = detectPatterns(signalReports, { eventId });
  await ctx.store.upsertSignalPatterns(patterns);
  await audit(ctx, eventId, actorUserId, 'signals.refreshed', 'event', eventId, `${patterns.length} patterns detected.`);
  return ctx.store.listSignalPatterns(eventId);
}

export async function reviewPattern(
  ctx: ServiceContext,
  eventId: string,
  actorUserId: string,
  patternId: string,
  decision: 'ACCEPTED' | 'REJECTED',
): Promise<SignalPattern> {
  // Only organisers may decide on suggested operational insights.
  await requireCapability(ctx, eventId, actorUserId, 'signal.review');
  const pattern = await ctx.store.getSignalPattern(patternId);
  if (!pattern || pattern.eventId !== eventId) {
    throw new DomainError('NOT_FOUND', 'Signal pattern not found.');
  }
  if (pattern.reviewStatus !== 'PENDING_REVIEW') {
    throw new DomainError('INVALID_TRANSITION', 'This insight has already been reviewed.');
  }
  const updated = await ctx.store.updateSignalPattern(patternId, {
    reviewStatus: decision,
    reviewedByUserId: actorUserId,
    reviewedAt: ctx.now(),
  });
  await audit(ctx, eventId, actorUserId, `signals.${decision.toLowerCase()}`, 'signal_pattern', patternId, pattern.explanation);
  return updated;
}
