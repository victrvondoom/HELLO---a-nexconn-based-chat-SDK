import { loadEventViewer } from '@/lib/viewer';
import { explore } from '@/services/moments';
import { MomentsNav } from '@/components/moments/MomentsNav';
import { ExploreView } from '@/components/moments/ExploreView';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Explore' };

export default async function ExplorePage({ params, searchParams }: { params: Promise<{ eventId: string }>; searchParams: Promise<{ tag?: string }> }) {
  const { eventId } = await params;
  const { tag } = await searchParams;
  const viewer = await loadEventViewer(eventId);
  const clean = typeof tag === 'string' && tag.trim() !== '' ? tag.trim().replace(/^#/, '') : null;
  // A tag that is not a valid hashtag shows the plain explore grid rather than an error page.
  const result = await explore(viewer.ctx, eventId, viewer.userId, { tag: clean }).catch(() => explore(viewer.ctx, eventId, viewer.userId, { tag: null }));
  return (
    <div className="page page--moments">
      <div className="page-header page-header--moments">
        <div>
          <p className="eyebrow">Moments</p>
          <h1>Explore</h1>
        </div>
        <MomentsNav eventId={eventId} />
      </div>
      <ExploreView key={result.tag ?? 'all'} eventId={eventId} initial={result} />
    </div>
  );
}
