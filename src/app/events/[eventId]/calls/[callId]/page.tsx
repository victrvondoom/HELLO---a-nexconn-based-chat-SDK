import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadEventViewer } from '@/lib/viewer';
import { DomainError } from '@/domain/errors';
import { getCall } from '@/services/calls';
import { CallRoom } from '@/components/calls/CallRoom';

export const dynamic = 'force-dynamic';

export default async function CallPage({ params }: { params: Promise<{ eventId: string; callId: string }> }) {
  const { eventId, callId } = await params;
  const viewer = await loadEventViewer(eventId);
  const call = await getCall(viewer.ctx, eventId, viewer.userId, callId).catch((error: unknown) => {
    if (error instanceof DomainError && error.code === 'NOT_FOUND') notFound();
    throw error;
  });
  return (
    <div className="page page--wide">
      <p className="eyebrow">
        <Link href={`/events/${eventId}/calls`}>Calls</Link> / {call.title}
      </p>
      <div className="page-header">
        <h1>{call.title}</h1>
      </div>
      {call.ended ? (
        <div className="empty">
          <strong>This call has ended</strong>
        </div>
      ) : (
        <CallRoom eventId={eventId} callId={call.id} title={call.title} isHost={call.isHost} canAlert={call.canAlert} userId={viewer.userId} myName={viewer.user?.displayName ?? 'You'} />
      )}
    </div>
  );
}
