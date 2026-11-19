import { currentUserId } from '@/lib/session';
import { errorResponse, jsonError } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { requireCapability } from '@/services/context';
import { roleHasCapability } from '@/domain/permissions';
import { EVERYONE, liveBus, visibleTo, type LiveEvent } from '@/lib/live/bus';
import { presenceRegistry } from '@/lib/live/presence';

/**
 * The live stream for one event (Server-Sent Events). It carries nudges, never content: a page that
 * receives `change` for a topic it shows re-reads it through the normal API. `typing` reaches only the
 * person being typed to. While the stream is open, the person counts as online (see presence).
 *
 * Only members of the event may open it, and each event is filtered by `visibleTo`, so staff-only and
 * personal topics reach only the people they concern.
 */
export const dynamic = 'force-dynamic';

/** Streams per person per instance: enough for several tabs, not enough to exhaust the server. */
const MAX_STREAMS_PER_PERSON = 8;
const HEARTBEAT_MS = 25_000;

type GlobalWithStreams = typeof globalThis & { __helloStreams?: Map<string, number> };
const g = globalThis as GlobalWithStreams;
const openStreams: Map<string, number> = (g.__helloStreams ??= new Map<string, number>());

export async function GET(request: Request, context: { params: Promise<{ eventId: string }> }): Promise<Response> {
  const userId = await currentUserId();
  if (!userId) return jsonError('UNAUTHENTICATED', 'Sign in to continue.', 401);
  const { eventId } = await context.params;
  const runtime = await getRuntime();
  let staff: boolean;
  try {
    const membership = await requireCapability(runtime.ctx, eventId, userId, 'event.read');
    staff = roleHasCapability(membership.role, 'incident.read.operational');
  } catch (error: unknown) {
    return errorResponse(error, 'live.stream');
  }
  if ((openStreams.get(userId) ?? 0) >= MAX_STREAMS_PER_PERSON) {
    return jsonError('RATE_LIMITED', 'Too many open live connections. Close a tab and try again.', 429);
  }

  const bus = liveBus();
  const presence = presenceRegistry();
  const viewer = { eventId, userId, staff };
  const encoder = new TextEncoder();
  let cleanup: () => void = () => undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };
      const send = (name: string, data: unknown) => {
        write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      openStreams.set(userId, (openStreams.get(userId) ?? 0) + 1);
      // The browser reconnects after 3 s if the connection drops.
      write('retry: 3000\n\n');
      send('ready', { at: runtime.ctx.now() });

      const unsubscribe = bus.subscribe((event: LiveEvent) => {
        if (!visibleTo(event, viewer)) return;
        if (event.topic === 'typing') send('typing', { from: event.data?.from ?? null, at: event.at });
        else send('change', { topic: event.topic, at: event.at });
      });

      const joined = presence.join(eventId, userId);
      if (joined.changed) {
        bus.publish({ eventId, topic: 'presence', audience: EVERYONE, at: runtime.ctx.now() });
        runtime.fanout?.reportPresence(eventId);
      }

      const heartbeat = setInterval(() => {
        write(': ping\n\n');
      }, HEARTBEAT_MS);

      cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        openStreams.set(userId, Math.max(0, (openStreams.get(userId) ?? 1) - 1));
        if (openStreams.get(userId) === 0) openStreams.delete(userId);
        if (joined.leave()) {
          bus.publish({ eventId, topic: 'presence', audience: EVERYONE, at: runtime.ctx.now() });
          runtime.fanout?.reportPresence(eventId);
        }
        try {
          controller.close();
        } catch {
          // already closed by the client
        }
      };
      request.signal.addEventListener('abort', () => {
        cleanup();
      });
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      // Proxies such as nginx must not buffer the stream.
      'x-accel-buffering': 'no',
    },
  });
}
