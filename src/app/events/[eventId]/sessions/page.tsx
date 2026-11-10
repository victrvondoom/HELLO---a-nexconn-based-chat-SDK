import { loadEventViewer } from '@/lib/viewer';
import { recommendAlternatives } from '@/services/sessions';
import { formatUtc } from '@/components/ui/labels';

export const dynamic = 'force-dynamic';

export default async function SessionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<{ current?: string }>;
}) {
  const { eventId } = await params;
  const { current } = await searchParams;
  const viewer = await loadEventViewer(eventId);
  const sessions = (await viewer.store.listSessions(eventId)).sort((a, b) => a.startsAt - b.startsAt);
  const rooms = await viewer.store.listRooms(eventId);
  const roomName = new Map(rooms.map((r) => [r.id, r.name] as const));
  const currentSession = current ? sessions.find((s) => s.id === current) ?? null : null;
  const alternatives = currentSession
    ? await recommendAlternatives(viewer.ctx, eventId, viewer.userId, currentSession.id)
    : null;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Sessions and rooms</h1>
          <p className="muted small" style={{ margin: 0 }}>
            Seat counts are the enrolment figures recorded by the organisers. They are not live sensor readings.
          </p>
        </div>
      </div>

      <div className="table-wrap panel" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th scope="col">Session</th>
              <th scope="col">Time</th>
              <th scope="col">Room</th>
              <th scope="col">Seats</th>
              <th scope="col">Options</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => {
              const full = s.enrolled >= s.capacity;
              return (
                <tr key={s.id}>
                  <td>
                    <strong>{s.title}</strong>
                    <div className="small muted">{s.topics.join(', ')}</div>
                  </td>
                  <td className="small">
                    {formatUtc(s.startsAt)}
                    <br />
                    to {formatUtc(s.endsAt).slice(11)}
                  </td>
                  <td>
                    {roomName.get(s.roomId)}
                    {s.accessible ? <div className="small muted">Accessible</div> : null}
                  </td>
                  <td>
                    {s.enrolled}/{s.capacity}
                    {full ? <div><span className="badge badge--danger">Full</span></div> : null}
                  </td>
                  <td>
                    <a href={`?current=${s.id}`}>Find alternatives</a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {alternatives ? (
        <section className="panel stack" style={{ marginTop: 24 }} aria-labelledby="alt-heading">
          <h2 id="alt-heading">Alternatives to “{currentSession?.title}”</h2>
          {alternatives.recommendations.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>No alternative sessions are open to you right now.</p>
          ) : (
            alternatives.recommendations.map((r) => (
              <div key={r.sessionId}>
                <strong>{r.title}</strong> · {r.roomName} · {formatUtc(r.startsAt)} · score {r.total.toFixed(2)}
                <ul className="muted small" style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                  {r.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </div>
            ))
          )}
          {alternatives.excluded.length > 0 ? (
            <details className="small">
              <summary>Why some sessions were not offered ({alternatives.excluded.length})</summary>
              <ul className="muted" style={{ paddingLeft: 18 }}>
                {alternatives.excluded.map((e) => (
                  <li key={e.sessionId}>
                    {e.title}: {e.reason.replace(/_/g, ' ').toLowerCase()}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
