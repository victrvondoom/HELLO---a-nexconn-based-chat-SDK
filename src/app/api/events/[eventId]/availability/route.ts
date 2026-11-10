import { viewerRoute } from '@/lib/api-handler';
import { jsonError, jsonOk, readJson } from '@/lib/http';
import { AvailabilityBody } from '@/lib/validation/api';
import { getRuntime } from '@/lib/runtime';
import { setAvailability } from '@/services/workplace';

export const POST = viewerRoute<{ eventId: string }>('availability.set', async ({ userId, params, request }) => {
  const parsed = AvailabilityBody.safeParse(await readJson(request));
  if (!parsed.success) return jsonError('VALIDATION_FAILED', 'Choose available, busy or off shift.', 422);
  const { ctx } = await getRuntime();
  return jsonOk(await setAvailability(ctx, params.eventId, userId, parsed.data.availability));
});
