'use client';

import { useCallback, useState } from 'react';
import { useLive } from '@/components/live/client';
import type { HighlightView, RingView } from '@/services/moments';
import { StoryViewer } from './StoryViewer';

interface HighlightsData {
  highlights: HighlightView[];
}

/**
 * Story highlights on a profile: stories their author kept after the 24 hours. Each one plays in the same
 * viewer as live stories, under the same audience rules (the server leaves out what this viewer may not see).
 */
export function ProfileHighlights({
  eventId,
  owner,
  isSelf,
  now,
  initial,
}: {
  eventId: string;
  owner: { id: string; name: string };
  isSelf: boolean;
  now: number;
  initial: HighlightView[];
}) {
  const { data, refresh } = useLive<HighlightsData>(`/api/events/${eventId}/moments/highlights?owner=${encodeURIComponent(owner.id)}`, { highlights: initial }, 60_000);
  const [open, setOpen] = useState<RingView | null>(null);
  const close = useCallback(() => {
    setOpen(null);
    void refresh();
  }, [refresh]);
  const shown = data.highlights.filter((h) => h.stories.length > 0);
  if (shown.length === 0) {
    return isSelf ? <p className="xs faint highlights__hint">Keep a story from the story viewer and it stays here after 24 hours.</p> : null;
  }

  return (
    <section className="highlights" aria-label="Highlights">
      <ul className="list-reset highlights__row">
        {shown.map((h) => {
          const cover = h.cover ?? h.stories[0];
          return (
            <li key={h.id}>
              <button
                type="button"
                className="highlight"
                aria-label={`Highlight: ${h.title}, ${String(h.stories.length)} ${h.stories.length === 1 ? 'story' : 'stories'}`}
                onClick={() => {
                  setOpen({ author: owner, isYou: isSelf, hasUnseen: false, latestAt: h.stories.at(-1)?.createdAt ?? null, stories: h.stories });
                }}
              >
                <span className="highlight__ring">
                  {cover?.media?.kind === 'IMAGE' ? (
                    <img src={cover.media.url} alt="" className="highlight__cover" />
                  ) : (
                    <span className={`highlight__cover backdrop backdrop--${cover?.backdrop ?? 'meadow'}`} aria-hidden="true" />
                  )}
                </span>
                <span className="highlight__title">{h.title}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {open ? <StoryViewer eventId={eventId} rings={[open]} start={{ ring: 0, story: 0 }} now={now} onClose={close} onChanged={refresh} /> : null}
    </section>
  );
}
