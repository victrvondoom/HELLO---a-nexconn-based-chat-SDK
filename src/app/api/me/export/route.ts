import { NextResponse } from 'next/server';
import { viewerRoute } from '@/lib/api-handler';
import { getRuntime } from '@/lib/runtime';
import { exportMyData } from '@/services/rights';

export const GET = viewerRoute('me.export', async ({ userId }) => {
  const { ctx } = await getRuntime();
  const data = await exportMyData(ctx, userId);
  return new NextResponse(JSON.stringify(data, null, 2), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="hello-my-data-${new Date(ctx.now()).toISOString().slice(0, 10)}.json"`,
      'cache-control': 'no-store',
    },
  });
});
