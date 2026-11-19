'use client';

import { useState } from 'react';
import { api, errorText, useLive } from '@/components/live/client';
import type { LeaderboardView } from '@/services/leaderboard';

const EMPTY: LeaderboardView = { optedIn: false, entries: [], self: null, participants: 0 };

/** Opt-in only: nobody is listed until they join, and leaving removes them at once. */
export function LeaderboardPanel({ eventId }: { eventId: string }) {
  const { data, refresh } = useLive<LeaderboardView>(`/api/events/${eventId}/atlas/leaderboard`, EMPTY, 30_000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/events/${eventId}/atlas/leaderboard`, 'POST', { optIn: !data.optedIn });
      await refresh();
    } catch (e: unknown) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const rows = data.self ? [...data.entries, data.self] : data.entries;
  return (
    <section className="panel" aria-labelledby="board-heading" data-testid="leaderboard">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h2 id="board-heading" style={{ fontSize: '1rem', margin: 0 }}>Leaderboard</h2>
        <button type="button" className="button button--ghost button--sm" disabled={busy} onClick={() => void toggle()}>
          {data.optedIn ? 'Leave the leaderboard' : 'Join the leaderboard'}
        </button>
      </div>
      <p className="xs faint" style={{ margin: '6px 0 10px' }}>
        Only people who choose to join are listed. {data.participants} {data.participants === 1 ? 'person has' : 'people have'} joined.
      </p>
      {error ? <p className="atlas-note atlas-note--bad" role="alert">{error}</p> : null}
      {rows.length > 0 ? (
        <table className="atlas-table">
          <caption className="sr-only">People who joined the leaderboard, by XP</caption>
          <thead><tr><th scope="col">#</th><th scope="col">Name</th><th scope="col">Level</th><th scope="col">XP</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.userId} aria-current={r.isSelf ? 'true' : undefined} style={r.isSelf ? { fontWeight: 600 } : undefined}>
                <td>{r.rank}</td><td>{r.isSelf ? `${r.name} (you)` : r.name}</td><td>{r.level}</td><td>{r.xp}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}
