import { loadEventViewer } from '@/lib/viewer';
import { flowSnapshot } from '@/services/workflows';
import { FlowCanvas } from '@/components/flow/FlowCanvas';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Workflow canvas' };

export default async function FlowPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const viewer = await loadEventViewer(eventId);
  const snapshot = await flowSnapshot(viewer.ctx, eventId, viewer.userId);
  return (
    <div className="page page--wide">
      <div className="page-header">
        <div>
          <p className="eyebrow">Live system</p>
          <h1>Workflow canvas</h1>
          <p>Everything in this event, as it is right now. Drag to arrange. Run a workflow with one click: each step acts with your own permissions and is recorded.</p>
        </div>
      </div>
      <FlowCanvas eventId={eventId} initial={snapshot} />
    </div>
  );
}
