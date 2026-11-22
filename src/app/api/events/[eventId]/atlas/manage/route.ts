import { z } from 'zod';
import { viewerRoute } from '@/lib/api-handler';
import { jsonOk, parseBody } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { adjustXp, dismissFlag, issueStation, manageSnapshot, saveLevels, saveMission, saveSeason, setMissionStatus } from '@/services/field-atlas';
import { draftMonthlyChallenge } from '@/services/quest-director';
import { DomainError } from '@/domain/errors';

/** Organiser snapshot: missions, seasons, levels, stations, the review queue, flags and real counts. */
export const GET = viewerRoute<{ eventId: string }>('atlas.manage.get', async ({ userId, params }) => {
  const { ctx } = await getRuntime();
  return jsonOk(await manageSnapshot(ctx, params.eventId, userId));
});

const ActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('saveMission'), mission: z.unknown() }),
  z.object({ action: z.literal('setMissionStatus'), missionId: z.string().max(60), status: z.enum(['PUBLISHED', 'PAUSED']) }),
  z.object({ action: z.literal('saveSeason'), season: z.unknown() }),
  z.object({ action: z.literal('saveLevels'), levels: z.unknown() }),
  z.object({
    action: z.literal('issueStation'),
    stationId: z.string().max(60),
    spaceId: z.string().max(60),
    name: z.string().max(120),
  }),
  z.object({ action: z.literal('adjustXp'), userId: z.string().max(80), amount: z.number(), reason: z.string().max(400) }),
  z.object({ action: z.literal('draftMonth'), year: z.number().int(), month: z.number().int() }),
  z.object({ action: z.literal('dismissFlag'), flagId: z.string().max(80) }),
]);

/** Organiser actions. Every action checks its own capability in the service, so this route adds no authority. */
export const POST = viewerRoute<{ eventId: string }>('atlas.manage.post', async ({ userId, params, request }) => {
  const input = await parseBody(request, ActionSchema, 'Choose a valid organiser action.');
  const { ctx } = await getRuntime();
  switch (input.action) {
    case 'saveMission':
      return jsonOk(await saveMission(ctx, params.eventId, userId, input.mission));
    case 'setMissionStatus':
      await setMissionStatus(ctx, params.eventId, userId, input.missionId, input.status);
      return jsonOk({ ok: true });
    case 'saveSeason':
      return jsonOk(await saveSeason(ctx, params.eventId, userId, input.season));
    case 'saveLevels':
      return jsonOk(await saveLevels(ctx, params.eventId, userId, input.levels));
    case 'issueStation': {
      // The code is returned once, here. Only its hash is stored, so it cannot be shown again.
      const issued = await issueStation(ctx, params.eventId, userId, input.spaceId, input.name, input.stationId);
      return jsonOk(issued, 201);
    }
    case 'adjustXp':
      return jsonOk(await adjustXp(ctx, params.eventId, userId, input.userId, input.amount, input.reason));
    case 'draftMonth': {
      const outcome = await draftMonthlyChallenge(ctx, params.eventId, userId, { year: input.year, month: input.month });
      return jsonOk({ seasonId: outcome.seasonId, created: outcome.created, autoPublished: outcome.autoPublished, unavailable: outcome.unavailable, runId: outcome.run.id });
    }
    case 'dismissFlag':
      await dismissFlag(ctx, params.eventId, userId, input.flagId);
      return jsonOk({ ok: true });
  }
  throw new DomainError('VALIDATION_FAILED', 'Unknown action.');
});

export const dynamic = 'force-dynamic';
