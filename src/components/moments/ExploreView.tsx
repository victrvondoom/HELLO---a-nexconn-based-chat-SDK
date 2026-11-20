'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type SyntheticEvent } from 'react';
import { useLive } from '@/components/live/client';
import { Icon } from '@/components/ui/Icon';
import type { ExploreResult } from '@/services/moments';
import { PostGrid } from './PostGrid';

/**
 * Explore: what the event is talking about. Trending tags need at least three different people in the
 * last day (so one account cannot fake a trend); the grid is ordered by the same announced charter as
 * the feed. Searching a tag shows every post that uses it, newest first.
 */
export function ExploreView({ eventId, initial }: { eventId: string; initial: ExploreResult }) {
  const router = useRouter();
  const tag = initial.tag;
  const url = `/api/events/${eventId}/moments/explore${tag ? `?tag=${encodeURIComponent(tag)}` : ''}`;
  const { data, refresh } = useLive<ExploreResult>(url, initial, 20_000);
  const [query, setQuery] = useState(tag ?? '');
  const base = `/events/${eventId}/feed/explore`;

  function search(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const clean = query.trim().replace(/^#/, '').toLowerCase();
    router.push(clean ? `${base}?tag=${encodeURIComponent(clean)}` : base);
  }

  return (
    <div className="explore">
      <form className="explore__search" role="search" onSubmit={search}>
        <Icon name="search" size={18} />
        <label className="visually-hidden" htmlFor="explore-tag">
          Search a hashtag
        </label>
        <input id="explore-tag" value={query} placeholder="Search a #tag" autoComplete="off" onChange={(e) => { setQuery(e.target.value); }} />
        <button type="submit" className="button button--sm">
          Search
        </button>
      </form>

      <section className="explore__tags" aria-labelledby="trending-title">
        <h2 id="trending-title" className="explore__label">
          Trending now <span className="xs faint">· used by 3 or more people today</span>
        </h2>
        {data.tags.length === 0 ? (
          <p className="small muted">Nothing is trending yet. A tag trends once three different people use it.</p>
        ) : (
          <ul className="list-reset tag-chips">
            {data.tags.map((t) => (
              <li key={t.tag}>
                <Link className={data.tag === t.tag ? 'tag-chip is-on' : 'tag-chip'} href={`${base}?tag=${encodeURIComponent(t.tag)}`} aria-current={data.tag === t.tag ? 'true' : undefined}>
                  <strong>#{t.tag}</strong>
                  <span>{t.people} people</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {data.tag ? (
        <div className="explore__filter">
          <h2 className="explore__label">
            Posts tagged <span className="marker">#{data.tag}</span>
          </h2>
          <Link href={base} className="small">
            Clear
          </Link>
        </div>
      ) : null}

      <PostGrid
        eventId={eventId}
        posts={data.posts}
        now={data.now}
        onChanged={refresh}
        empty={data.tag ? `Nobody has used #${data.tag} yet.` : 'Pictures, videos and posts on a backdrop appear here.'}
      />
    </div>
  );
}
