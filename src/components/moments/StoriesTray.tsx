'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';
import { useLive } from '@/components/live/client';
import { Icon } from '@/components/ui/Icon';
import { Avatar } from '@/components/social/Avatar';
import type { RingView, StoryTray } from '@/services/moments';
import { StoryViewer, startOf } from './StoryViewer';
import { StoryComposer, type Place } from './StoryComposer';
import { firstName } from './meta';

/**
 * The row of story rings. A bright ring means stories you have not seen; a pale ring means you have seen
 * them all. The order follows the announced tray rules (your ring, unseen, people you follow, newest).
 */
export function StoriesTray({ eventId, initial, places, canPost, composeOnLoad = false }: { eventId: string; initial: StoryTray; places: Place[]; canPost: boolean; composeOnLoad?: boolean }) {
  const { data, refresh } = useLive<StoryTray>(`/api/events/${eventId}/moments/stories`, initial, 30_000);
  // The viewer plays a snapshot of the rings taken when it opened: a background refresh reorders the tray
  // (seen rings move back), and that must not make an open story jump to someone else.
  const [open, setOpen] = useState<{ rings: RingView[]; ring: number; story: number } | null>(null);
  const [composing, setComposing] = useState(composeOnLoad && canPost);
  const rings = data.rings;
  const closeViewer = useCallback(() => {
    setOpen(null);
    void refresh();
  }, [refresh]);
  const closeComposer = useCallback(() => {
    setComposing(false);
  }, []);

  return (
    <section className="stories" aria-label="Stories">
      <div className="stories__row">
        {rings.map((ring, index) => {
          const empty = ring.stories.length === 0;
          if (ring.isYou) {
            return (
              <div key={ring.author.id} className="story-ring story-ring--you">
                <button
                  type="button"
                  className={empty ? 'ring ring--empty' : ring.hasUnseen ? 'ring' : 'ring ring--seen'}
                  aria-label={empty ? 'Add to your story' : 'Open your story'}
                  onClick={() => {
                    if (empty) setComposing(canPost);
                    else setOpen({ rings, ring: index, story: 0 });
                  }}
                  disabled={empty && !canPost}
                >
                  <Avatar name={ring.author.name} size={62} />
                </button>
                {canPost ? (
                  <button type="button" className="story-ring__add" aria-label="New story" onClick={() => { setComposing(true); }}>
                    <Icon name="plus" size={14} />
                  </button>
                ) : null}
                <span className="story-ring__name">Your story</span>
              </div>
            );
          }
          return (
            <div key={ring.author.id} className="story-ring">
              <button type="button" className={ring.hasUnseen ? 'ring' : 'ring ring--seen'} aria-label={`Stories by ${ring.author.name}${ring.hasUnseen ? ', new' : ''}`} onClick={() => { setOpen({ rings, ring: index, story: startOf(ring) }); }}>
                <Avatar name={ring.author.name} size={62} />
              </button>
              <span className="story-ring__name">{firstName(ring.author.name)}</span>
            </div>
          );
        })}
        {rings.length <= 1 ? <p className="stories__empty small muted">No stories yet. Share the first one from the event.</p> : null}
      </div>
      <p className="stories__rule xs">
        Stories leave after 24 hours. <Link href={`/events/${eventId}/feed/charter`}>How the row is ordered</Link>
      </p>

      {open ? <StoryViewer eventId={eventId} rings={open.rings} start={{ ring: open.ring, story: open.story }} now={data.now} onClose={closeViewer} onChanged={refresh} /> : null}
      {composing ? <StoryComposer eventId={eventId} places={places} onClose={closeComposer} onShared={refresh} /> : null}
    </section>
  );
}
