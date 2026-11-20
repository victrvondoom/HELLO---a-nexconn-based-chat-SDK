import Link from 'next/link';
import { loadEventViewer } from '@/lib/viewer';
import { listFeed } from '@/services/feed';
import { storyTray } from '@/services/moments';
import { FEED_CRITERIA } from '@/domain/moments/charter';
import { trendingTags } from '@/domain/moments/tags';
import { FeedView } from '@/components/feed/FeedView';
import { StoriesTray } from '@/components/moments/StoriesTray';
import { MomentsNav } from '@/components/moments/MomentsNav';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Moments' };

/** Moments: stories at the top, the charter-ordered feed below, and what is trending at the side. */
export default async function MomentsPage({ params, searchParams }: { params: Promise<{ eventId: string }>; searchParams: Promise<{ compose?: string }> }) {
  const { eventId } = await params;
  const { compose } = await searchParams;
  const viewer = await loadEventViewer(eventId);
  const now = viewer.ctx.now();
  const [posts, tray, venue, allPosts] = await Promise.all([
    listFeed(viewer.ctx, eventId, viewer.userId, { scope: 'all', communityId: null, authorId: null }),
    storyTray(viewer.ctx, eventId, viewer.userId),
    viewer.store.getVenue(eventId),
    viewer.store.docList('posts', { eventId }),
  ]);
  // Places a story can be pinned to: rooms, halls and quiet spaces people can walk to (never a GPS position).
  const places = (venue?.spaces ?? []).filter((s) => s.kind !== 'CIRCULATION' && s.kind !== 'SERVICE').map((s) => ({ id: s.id, name: s.name }));
  const trending = trendingTags(allPosts, now).slice(0, 6);
  const canPost = viewer.can('message.send');

  return (
    <div className="page page--moments">
      <div className="page-header page-header--moments">
        <div>
          <p className="eyebrow">Everyone connected</p>
          <h1>Moments</h1>
        </div>
        <MomentsNav eventId={eventId} />
      </div>

      <StoriesTray eventId={eventId} initial={tray} places={places} canPost={canPost} composeOnLoad={compose === 'story'} />

      <div className="moments-layout">
        <FeedView eventId={eventId} initial={{ now, posts }} canPost={canPost} composeOnLoad={compose === 'post'} />
        <aside className="moments-aside" aria-label="About this feed">
          <section className="aside-card">
            <p className="eyebrow">Open Feed Charter</p>
            <h2 className="serif aside-card__title">No secret algorithm.</h2>
            <p className="small muted">“For you” adds up six announced rules. Every post says which ones placed it.</p>
            <ol className="charter-mini">
              {FEED_CRITERIA.map((c) => (
                <li key={c.id}>
                  <span>{c.label}</span>
                  <span className="charter-mini__pts">up to {c.max}</span>
                </li>
              ))}
            </ol>
            <Link className="small" href={`/events/${eventId}/feed/charter`}>
              Read the charter
            </Link>
          </section>
          {trending.length > 0 ? (
            <section className="aside-card">
              <p className="eyebrow">Trending today</p>
              <ul className="list-reset tag-chips tag-chips--stack">
                {trending.map((t) => (
                  <li key={t.tag}>
                    <Link className="tag-chip" href={`/events/${eventId}/feed/explore?tag=${encodeURIComponent(t.tag)}`}>
                      <strong>#{t.tag}</strong>
                      <span>{t.people} people</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
