import { loadEventViewer } from '@/lib/viewer';
import { Composer } from '@/components/conversation/Composer';
import { formatUtc } from '@/components/ui/labels';
import { STATUS_LABEL } from '@/domain/labels';

export const dynamic = 'force-dynamic';

export default async function ConversationPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const viewer = await loadEventViewer(eventId);
  const operational = viewer.can('incident.read.operational');

  // Attendees see their own messages. Operational viewers see the whole event conversation.
  const all = await viewer.store.listMessages(eventId);
  const visible = all
    .filter((m) => operational || m.senderUserId === viewer.userId)
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(-60);
  const senders = new Map<string, string>();
  for (const m of visible) {
    if (!senders.has(m.senderUserId)) {
      senders.set(m.senderUserId, (await viewer.store.getUser(m.senderUserId))?.displayName ?? 'Unknown');
    }
  }
  const rooms = await viewer.store.listRooms(eventId);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Conversation</h1>
          <p className="muted small" style={{ margin: 0 }}>
            Describe what is happening in ordinary words. HELLO works out the room, session and team it concerns.
          </p>
        </div>
        <span className="badge badge--demo">Local demo transport · not Nexconn</span>
      </div>

      <div className="grid-2">
        <section className="panel stack" aria-labelledby="history-heading">
          <h2 id="history-heading">Your messages</h2>
          {visible.length === 0 ? (
            <div className="empty">No messages yet. Try “The microphone in Room 3 has stopped working.”</div>
          ) : (
            <div className="messages" role="log" aria-live="polite">
              {visible.map((m) => {
                const mine = m.senderUserId === viewer.userId;
                const intent = typeof m.interpretation?.intent === 'string' ? m.interpretation.intent : null;
                return (
                  <article key={m.id} className={mine ? 'message message--mine' : 'message'}>
                    <div className="message__meta">
                      {senders.get(m.senderUserId) ?? 'Unknown'} · {formatUtc(m.createdAt)}
                      {intent ? ` · ${intent.replace(/_/g, ' ').toLowerCase()}` : ''}
                    </div>
                    <div>{m.text}</div>
                    {m.linkedIncidentId ? (
                      <div className="small" style={{ marginTop: 4 }}>
                        <a href={`/events/${eventId}/incidents/${m.linkedIncidentId}`}>Open linked incident</a>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <aside className="stack" aria-label="Compose and results">
          <Composer eventId={eventId} />
          <section className="panel stack">
            <h3>Rooms in this event</h3>
            <ul className="stack small" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {rooms.map((r) => (
                <li key={r.id}>
                  <strong>{r.name}</strong> <span className="muted">· {r.zone}</span>
                  {r.accessible ? <span className="badge" style={{ marginLeft: 6 }}>Accessible</span> : null}
                </li>
              ))}
            </ul>
            <p className="small muted" style={{ margin: 0 }}>
              Incident statuses: {Object.values(STATUS_LABEL).slice(0, 3).join(' · ')} …
            </p>
          </section>
        </aside>
      </div>
    </>
  );
}
