'use client';

import { useState } from 'react';
import { api, errorText } from '@/components/live/client';
import { useFeedback } from '@/components/ui/Feedback';
import { closesText, type PollView } from '@/domain/moments/poll';

/**
 * A poll on a post. Before you vote you see the options only; after you vote (or when it closes, or if you wrote it)
 * you see the bars. The vote is sent to the server, which decides; this component only shows what came back.
 */
export function PollBlock({ eventId, postId, poll, now, onChanged }: { eventId: string; postId: string; poll: PollView; now: number; onChanged: () => Promise<void> }) {
  const { toast } = useFeedback();
  const [busy, setBusy] = useState<string | null>(null);
  const canVote = !poll.closed && poll.myVote === null;

  async function vote(optionId: string) {
    setBusy(optionId);
    try {
      await api(`/api/events/${eventId}/feed/${postId}`, 'POST', { action: 'vote', optionId });
      await onChanged();
    } catch (e: unknown) {
      toast('error', errorText(e));
      await onChanged();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="poll-block" role="group" aria-label="Poll">
      {poll.options.map((option) => {
        const chosen = poll.myVote === option.id;
        if (canVote) {
          return (
            <button
              key={option.id}
              type="button"
              className="poll-option poll-option--open"
              disabled={busy !== null}
              onClick={() => {
                void vote(option.id);
              }}
            >
              {busy === option.id ? 'Voting…' : option.label}
            </button>
          );
        }
        return (
          <div key={option.id} className={chosen ? 'poll-option poll-option--chosen' : 'poll-option'}>
            <span className="poll-option__bar" style={{ width: `${option.percent ?? 0}%` }} aria-hidden="true" />
            <span className="poll-option__label">
              {option.label}
              {chosen ? <span className="visually-hidden"> (your vote)</span> : null}
            </span>
            <span className="poll-option__pct">{option.percent ?? 0}%</span>
          </div>
        );
      })}
      <p className="poll-foot xs faint">
        {poll.total === null ? 'Vote to see the results' : `${poll.total} ${poll.total === 1 ? 'vote' : 'votes'}`} · {closesText(poll.closesAt, now)}
      </p>
    </div>
  );
}
