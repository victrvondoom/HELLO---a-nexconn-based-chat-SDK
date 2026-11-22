import { viewerRoute } from '@/lib/api-handler';
import { jsonOk } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { FixedWindowRateLimiter } from '@/lib/rate-limit';
import { DomainError } from '@/domain/errors';
import { MEDIA_MAX_BYTES, uploadMedia } from '@/services/feed';
import { requireCapability } from '@/services/context';
import { assertUploadPrivacy } from '@/services/privacy-filter';
import { parseUploadPrivacy, UPLOAD_PRIVACY_HEADER } from '@/domain/privacy-filter/upload';

const limiter = new FixedWindowRateLimiter(12, 60_000);
const TOO_LARGE = 'That file is too large. Pictures can be up to 4 MB and videos up to 24 MB.';

/** Reads the body in chunks and stops as soon as it passes the limit, so an oversized upload is never held in memory. */
async function readCapped(request: Request, limit: number): Promise<Uint8Array> {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > limit) throw new DomainError('VALIDATION_FAILED', TOO_LARGE);
  const reader = request.body?.getReader();
  if (!reader) throw new DomainError('VALIDATION_FAILED', 'Choose a file to upload.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new DomainError('VALIDATION_FAILED', TOO_LARGE);
    }
    chunks.push(value);
  }
  // A body shorter than it declared was cut off on the way in: refuse it rather than keep a broken file.
  if (declared > 0 && size !== declared) throw new DomainError('VALIDATION_FAILED', 'The upload was interrupted. Try again.');
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export const POST = viewerRoute<{ eventId: string }>('media.upload', async ({ userId, params, request }) => {
  const { ctx } = await getRuntime();
  // Permission and rate are checked before a single byte of the file is read.
  await requireCapability(ctx, params.eventId, userId, 'message.send');
  limiter.consume(`media:${userId}`, ctx.now());
  // With the privacy filter on, only uploads that went through it (or that the person declined it for) are accepted.
  await assertUploadPrivacy(ctx, userId, parseUploadPrivacy(request.headers.get(UPLOAD_PRIVACY_HEADER)));
  const bytes = await readCapped(request, MEDIA_MAX_BYTES);
  const meta = await uploadMedia(ctx, params.eventId, userId, request.headers.get('content-type') ?? '', bytes);
  return jsonOk({ id: meta.id, kind: meta.kind }, 201);
});

export const dynamic = 'force-dynamic';
