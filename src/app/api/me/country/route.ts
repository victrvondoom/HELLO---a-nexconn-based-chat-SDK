import { viewerRoute } from '@/lib/api-handler';
import { jsonOk, parseBody } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { CountrySchema, setCountry } from '@/services/location';

export const POST = viewerRoute('me.country', async ({ userId, request }) => {
  const input = await parseBody(request, CountrySchema, 'Choose a country from the list.');
  const { ctx } = await getRuntime();
  await setCountry(ctx, userId, input.country);
  return jsonOk({ saved: true });
});
