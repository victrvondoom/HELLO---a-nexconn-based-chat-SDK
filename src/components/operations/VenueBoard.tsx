'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, errorText } from '@/components/live/client';
import type { VenueBoardRow } from '@/services/live-room';

const time = (ms: number) => new Date(ms).toISOString().slice(11, 16);

/**
 * The staff venue board: seats, Plan B holds and AV signals per upcoming session. Occupancy is shown with its
 * source; nothing here tracks phones. "Mark full" puts up the room-full QR, which sends each person to their
 * own Plan B.
 */
export function VenueBoard({ eventId, board }: { eventId: string; board: VenueBoardRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(sessionId: string, closed: boolean) {
    setBusy(sessionId);
    setError(null);
    try {
      await api(`/api/events/${eventId}/now/${sessionId}/full`, 'POST', { closed });
      router.refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="card ops-table" aria-labelledby="venue-heading" style={{ overflow: 'hidden' }}>
      <div className="card__head">
        <h2 id="venue-heading">Venue and AV</h2>
        <span className="xs faint">Seats = capacity − enrolled − Plan B holds · AV counts are distinct people in the last 60 s</span>
      </div>
      {error ? <p role="alert" className="notice notice--error" style={{ margin: 12 }}>{error}</p> : null}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Session</th>
              <th scope="col">Seats</th>
              <th scope="col">AV signals</th>
              <th scope="col">Room</th>
            </tr>
          </thead>
          <tbody>
            {board.map((r) => (
              <tr key={r.sessionId}>
                <td>
                  <Link href={`/events/${eventId}/now/${r.sessionId}`}>{r.title}</Link>
                  <div className="xs faint">
                    {r.room} · {r.live ? 'running now' : time(r.startsAt)} UTC
                  </div>
                </td>
                <td className="small">
                  <strong>{r.free}</strong> free of {r.capacity}
                  <div className="xs faint">
                    {r.enrolled} enrolled · {r.holds} held
                    {r.occupancy !== null ? ` · occupancy ${r.occupancy} (${r.occupancySource === 'DEMO_SEED' ? 'seeded' : 'reported'})` : ''}
                  </div>
                </td>
                <td className="small">
                  {r.cantHear + r.cantSee === 0 ? <span className="faint">None</span> : `${r.cantHear} can't hear · ${r.cantSee} can't see`}
                  {r.openAv.map((i) => (
                    <div key={i.id} className="xs">
                      <Link href={`/events/${eventId}/incidents/${i.id}`}>{i.title}</Link>
                    </div>
                  ))}
                </td>
                <td>
                  <button type="button" className={r.closed ? 'button button--sm' : 'button button--sm button--ghost'} disabled={busy !== null} onClick={() => void toggle(r.sessionId, !r.closed)}>
                    {r.closed ? 'Open again' : 'Mark full'}
                  </button>
                  {r.closed ? (
                    <div className="xs">
                      <Link href={`/events/${eventId}/now/${r.sessionId}/full`}>Room-full QR</Link>
                    </div>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
