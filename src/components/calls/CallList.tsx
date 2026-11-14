'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { SyntheticEvent } from 'react';
import { api, errorText, useLive } from '@/components/live/client';
import { useFeedback } from '@/components/ui/Feedback';

interface CallRow {
  id: string;
  title: string;
  host: string;
  isHost: boolean;
  people: number;
}

export function CallList({ eventId, initial, canStart }: { eventId: string; initial: CallRow[]; canStart: boolean }) {
  const router = useRouter();
  const { toast } = useFeedback();
  const { data } = useLive(`/api/events/${eventId}/calls`, { calls: initial }, 4000);

  async function start(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const call = await api<{ id: string }>(`/api/events/${eventId}/calls`, 'POST', { title: new FormData(event.currentTarget).get('title'), communityId: null });
      router.push(`/events/${eventId}/calls/${call.id}`);
    } catch (e: unknown) {
      toast('error', errorText(e));
    }
  }

  return (
    <div className="stack" style={{ gap: 20 }}>
      {canStart ? (
        <form className="panel panel__body inline-form" onSubmit={(e) => void start(e)} aria-label="Start a call">
          <label className="field">
            <span className="label">Call name</span>
            <input name="title" required minLength={3} maxLength={80} placeholder="e.g. Speakers’ check-in" />
          </label>
          <button type="submit" className="button">
            Start a call
          </button>
        </form>
      ) : null}
      {data.calls.length === 0 ? (
        <div className="empty">
          <strong>No open calls</strong>
          <p>Start one, or start a group call from a community.</p>
        </div>
      ) : (
        <div className="tile-grid">
          {data.calls.map((c) => (
            <article key={c.id} className="panel tile">
              <h3>
                <Link href={`/events/${eventId}/calls/${c.id}`}>{c.title}</Link>
              </h3>
              <span className="small muted">Started by {c.isHost ? 'you' : c.host}</span>
              <div className="tile__foot">
                <span className={c.people > 0 ? 'badge badge--success' : 'badge'}>{c.people > 0 ? `${c.people} in call` : 'Empty'}</span>
                <Link className="button button--sm" href={`/events/${eventId}/calls/${c.id}`}>
                  Join
                </Link>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
