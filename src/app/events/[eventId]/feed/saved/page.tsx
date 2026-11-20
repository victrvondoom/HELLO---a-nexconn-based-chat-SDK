import { loadEventViewer } from '@/lib/viewer';
import { listSaved } from '@/services/moments';
import { MomentsNav } from '@/components/moments/MomentsNav';
import { SavedView } from '@/components/moments/SavedView';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Saved' };

export default async function SavedPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const viewer = await loadEventViewer(eventId);
  const posts = await listSaved(viewer.ctx, eventId, viewer.userId);
  return (
    <div className="page page--moments">
      <div className="page-header page-header--moments">
        <div>
          <p className="eyebrow">Only you can see this</p>
          <h1>Saved</h1>
        </div>
        <MomentsNav eventId={eventId} />
      </div>
      <SavedView eventId={eventId} initial={{ now: viewer.ctx.now(), posts }} />
    </div>
  );
}
