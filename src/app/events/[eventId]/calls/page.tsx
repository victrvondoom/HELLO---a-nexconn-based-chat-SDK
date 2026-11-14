import { loadEventViewer } from '@/lib/viewer';
import { listCalls } from '@/services/calls';
import { CallList } from '@/components/calls/CallList';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Calls' };

export default async function CallsPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const viewer = await loadEventViewer(eventId);
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <p className="eyebrow">Face to face</p>
          <h1>Calls</h1>
          <p>Video, voice and screen sharing for up to 8 people. Media goes directly between the people in the call.</p>
        </div>
      </div>
      <CallList eventId={eventId} initial={await listCalls(viewer.ctx, eventId, viewer.userId)} canStart={viewer.can('message.send')} />
    </div>
  );
}
