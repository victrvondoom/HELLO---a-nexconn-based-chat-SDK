import { NextResponse } from 'next/server';
import { currentUserId } from '@/lib/session';
import { errorResponse, jsonError } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { readMedia } from '@/services/feed';

/**
 * Serves an uploaded picture or video to members of its event. The type comes from our own record
 * of a checked upload, never from the request, and the response is sandboxed so a file can only
 * ever be displayed, not run as a page. Byte ranges are supported so videos can be scrubbed.
 */
export async function GET(request: Request, context: { params: Promise<{ eventId: string; mediaId: string }> }): Promise<Response> {
  const userId = await currentUserId();
  if (!userId) return jsonError('UNAUTHENTICATED', 'Sign in to continue.', 401);
  try {
    const { eventId, mediaId } = await context.params;
    const { ctx } = await getRuntime();
    const { meta, bytes } = await readMedia(ctx, eventId, userId, mediaId);
    const headers: Record<string, string> = {
      'Content-Type': meta.mime,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=3600',
      'Content-Disposition': 'inline',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    };
    const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') ?? '');
    if (range && (range[1] || range[2])) {
      const total = bytes.byteLength;
      const start = range[1] ? Number(range[1]) : Math.max(0, total - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), total - 1) : total - 1;
      if (start > end || start >= total) return new NextResponse(null, { status: 416, headers: { 'Content-Range': `bytes */${total}` } });
      return new NextResponse(Buffer.from(bytes.subarray(start, end + 1)), { status: 206, headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${total}`, 'Content-Length': String(end - start + 1) } });
    }
    return new NextResponse(Buffer.from(bytes), { status: 200, headers: { ...headers, 'Content-Length': String(bytes.byteLength) } });
  } catch (error: unknown) {
    return errorResponse(error, 'media.read');
  }
}
