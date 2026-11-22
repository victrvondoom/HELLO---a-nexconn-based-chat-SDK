import { headers } from 'next/headers';
import { loadEventViewer } from '@/lib/viewer';
import { liveRoom } from '@/services/live-room';
import { LiveRoomView } from '@/components/companion/LiveRoomView';
import { Qr } from '@/components/companion/Qr';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Live room' };

/** One session room: questions, "can't hear" and "can't see", the speaker, and the room's QR code. */
export default async function LiveRoomPage({ params }: { params: Promise<{ eventId: string; sessionId: string }> }) {
  const { eventId, sessionId } = await params;
  const viewer = await loadEventViewer(eventId);
  const room = await liveRoom(viewer.ctx, eventId, viewer.userId, sessionId);
  const h = await headers();
  const origin = `${h.get('x-forwarded-proto') ?? 'http'}://${h.get('host') ?? 'localhost'}`;
  return (
    <div className="page live-room">
      <LiveRoomView eventId={eventId} initial={room} canAsk={viewer.can('message.send')} canSignal={viewer.can('incident.report')} />
      <details className="live-room__qr">
        <summary className="small">This room’s QR code</summary>
        <Qr value={`${origin}/events/${eventId}/now/${sessionId}`} label={`QR code that opens the live room for ${room.session.title}`} />
        <p className="xs faint">Opens this live room. It grants no membership: people still sign in to HELLO. Contact cards use a different code.</p>
      </details>
    </div>
  );
}
