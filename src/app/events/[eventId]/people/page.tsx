import Link from 'next/link';
import { loadEventViewer } from '@/lib/viewer';
import { discoverPeople } from '@/services/people';
import { directory, myNetwork } from '@/services/social';
import { ROLE_LABEL } from '@/components/ui/labels';
import { FollowButton } from '@/components/social/FollowButton';
import { Avatar } from '@/components/social/Avatar';

export const dynamic = 'force-dynamic';

type Tab = 'discover' | 'network';

export default async function PeoplePage({
  params,
  searchParams,
}: {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<{ q?: string; tab?: string }>;
}) {
  const { eventId } = await params;
  const { q, tab: rawTab } = await searchParams;
  const tab: Tab = rawTab === 'network' ? 'network' : 'discover';
  const query = (q ?? '').slice(0, 200).trim();
  const viewer = await loadEventViewer(eventId);
  const base = `/events/${eventId}/people`;

  const [people, network, matches] = await Promise.all([
    directory(viewer.ctx, eventId, viewer.userId),
    myNetwork(viewer.ctx, eventId, viewer.userId),
    query ? discoverPeople(viewer.ctx, eventId, viewer.userId, query) : Promise.resolve([]),
  ]);
  const matchReason = new Map(matches.map((m) => [m.userId, m.reason]));
  const shown = query ? people.filter((p) => matchReason.has(p.userId)) : people;
  const connections = network.following.filter((p) => p.connected).length;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <p className="eyebrow">Everyone connected</p>
          <h1>People</h1>
          <p>Only people who chose to be discoverable appear. Follow each other to connect; connections can message privately, end-to-end encrypted.</p>
        </div>
        <div className="net-stats" aria-label="Your network">
          <Link href={`${base}?tab=network`}>
            <strong>{network.followers.length}</strong> followers
          </Link>
          <Link href={`${base}?tab=network`}>
            <strong>{network.following.length}</strong> following
          </Link>
          <span>
            <strong>{connections}</strong> connections
          </span>
        </div>
      </div>

      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 16, gap: 12 }}>
        <nav className="segmented" aria-label="People views">
          <Link className={tab === 'discover' ? 'segmented__item is-active' : 'segmented__item'} href={base} aria-current={tab === 'discover' ? 'page' : undefined}>
            Discover
          </Link>
          <Link className={tab === 'network' ? 'segmented__item is-active' : 'segmented__item'} href={`${base}?tab=network`} aria-current={tab === 'network' ? 'page' : undefined}>
            Your network
          </Link>
        </nav>
        {tab === 'discover' ? (
          <form method="get" role="search" className="row" style={{ flex: '1 1 320px', maxWidth: 520 }}>
            <label htmlFor="people-q" className="visually-hidden">
              Search by declared interest
            </label>
            <input id="people-q" name="q" defaultValue={query} placeholder="Search by interest, e.g. satellite communication" maxLength={200} style={{ flex: 1 }} />
            <button type="submit" className="button button--sm">
              Search
            </button>
          </form>
        ) : null}
      </div>

      {tab === 'discover' ? (
        shown.length === 0 ? (
          <div className="empty card">
            <strong>{query ? `No discoverable person has declared “${query}”` : 'Nobody is discoverable yet'}</strong>
            <span>Results come only from interests people declared themselves. Nothing is inferred.</span>
          </div>
        ) : (
          <ul className="person-grid list-reset">
            {shown.map((p) => (
              <li key={p.userId} className="person-card">
                <Link href={`${base}/${p.userId}`} className="person-card__main">
                  <Avatar name={p.displayName} size={48} ring={p.relationship.connected} />
                  <span style={{ minWidth: 0 }}>
                    <strong className="person-card__name">{p.displayName}</strong>
                    <span className="person-card__headline">{p.headline ?? ROLE_LABEL[p.role]}</span>
                  </span>
                </Link>
                {matchReason.get(p.userId) ? <p className="xs muted">{matchReason.get(p.userId)}</p> : null}
                <div className="tags">
                  {p.interests.slice(0, 4).map((i) => (
                    <span key={i} className="tag">
                      {i}
                    </span>
                  ))}
                </div>
                <div className="person-card__foot">
                  <span className="xs faint">{p.relationship.connected ? 'Connected' : p.relationship.followsYou ? 'Follows you' : ROLE_LABEL[p.role]}</span>
                  <FollowButton eventId={eventId} userId={p.userId} name={p.displayName} initial={p.relationship} size="sm" />
                </div>
              </li>
            ))}
          </ul>
        )
      ) : (
        <div className="split split--even">
          {(['followers', 'following'] as const).map((key) => (
            <section key={key} className="card" aria-labelledby={`${key}-h`}>
              <div className="card__head">
                <h2 id={`${key}-h`}>{key === 'followers' ? 'Followers' : 'Following'}</h2>
                <span className="badge">{network[key].length}</span>
              </div>
              {network[key].length === 0 ? (
                <p className="card__body small muted">{key === 'followers' ? 'Nobody follows you yet.' : 'You are not following anyone yet.'}</p>
              ) : (
                <ul className="list-reset list-divided">
                  {network[key].map((p) => (
                    <li key={p.userId} style={{ padding: '12px 20px' }}>
                      <Link href={`${base}/${p.userId}`} className="row" style={{ gap: 12, color: 'var(--text)' }}>
                        <Avatar name={p.displayName} size={36} ring={p.connected} />
                        <span style={{ minWidth: 0, flex: 1 }}>
                          <strong className="small">{p.displayName}</strong>
                          <span className="xs faint" style={{ display: 'block' }}>
                            {p.connected ? 'Connected · can message privately' : (p.headline ?? '')}
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
          <p className="xs faint" style={{ gridColumn: '1 / -1' }}>
            Only you can see these lists. Other people see your follower and following counts, never who they are.
          </p>
        </div>
      )}
    </div>
  );
}
