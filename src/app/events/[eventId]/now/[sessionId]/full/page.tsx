import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { loadEventViewer } from '@/lib/viewer';
import { Qr } from '@/components/companion/Qr';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Room full' };

/**
 * The room-full display for a door screen. Its QR code opens Today with this session's Plan B, so each person
 * who scans it sees their own best alternatives and can hold a seat.
 */
export default async function RoomFullPage({ params }: { params: Promise<{ eventId: string; sessionId: string }> }) {
  const { eventId, sessionId } = await params;
  const viewer = await loadEventViewer(eventId);
  if (!viewer.can('incident.read.operational')) notFound();
  const session = await viewer.store.getSession(sessionId);
  if (!session || session.eventId !== eventId) notFound();
  const h = await headers();
  const origin = `${h.get('x-forwarded-proto') ?? 'http'}://${h.get('host') ?? 'localhost'}`;
  return (
    <div className="page room-full">
      <p className="eyebrow">Room full</p>
      <h1>{session.title}</h1>
      <p className="muted">Scan for your best alternative, with a seat held for you.</p>
      <Qr value={`${origin}/events/${eventId}?planb=${sessionId}`} label={`QR code: Plan B for ${session.title}`} size={280} />
    </div>
  );
}
