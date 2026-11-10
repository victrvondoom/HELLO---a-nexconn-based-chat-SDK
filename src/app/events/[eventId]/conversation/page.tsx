import Link from 'next/link';
import { loadEventViewer } from '@/lib/viewer';
import { parseStoredOutcome } from '@/lib/validation/outcome';
import { ChatComposer } from '@/components/conversation/ChatComposer';
import { OutcomeCards } from '@/components/conversation/OutcomeCards';
import { ScrollToEnd } from '@/components/conversation/ScrollToEnd';
import { Icon } from '@/components/ui/Icon';
import { formatUtc, minutesAgo } from '@/components/ui/labels';
import { IncidentBadge } from '@/components/incidents/IncidentBadge';
import { listIncidentsForViewer } from '@/services/incidents';
import { getOperationsOverview } from '@/services/sessions';
import { STATUS_LABEL } from '@/domain/labels';

export const dynamic = 'force-dynamic';

function initials(name: string): string {
  return name
    .replace(/\(.*?\)/g, '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p.charAt(0).toUpperCase())
    .join('');
}

export default async function ConversationPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const viewer = await loadEventViewer(eventId);
  const operational = viewer.can('incident.read.operational');
  const now = viewer.ctx.now();

  const all = await viewer.store.listMessages(eventId);
  const visible = all
    .filter((m) => operational || m.senderUserId === viewer.userId)
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(-120);

  const names = new Map<string, string>();
  for (const m of visible) {
    if (!names.has(m.senderUserId)) {
      names.set(m.senderUserId, (await viewer.store.getUser(m.senderUserId))?.displayName ?? 'Unknown');
    }
  }

  const mine = (await listIncidentsForViewer(viewer.ctx, eventId, viewer.userId)).filter((r) => r.isMine).slice(0, 5);
  const rooms = operational ? await getOperationsOverview(viewer.ctx, eventId, viewer.userId) : [];

  return (
    <div className="chat">
      <section className="thread" aria-label="Conversation">
        <div className="thread__scroll" role="log" aria-live="polite" aria-label="Messages">
          {visible.length === 0 ? (
            <div className="empty" style={{ margin: 'auto' }}>
              <Icon name="conversation" size={22} />
              <strong>Tell HELLO what is happening.</strong>
              <span>
                Describe a problem, ask for help, or ask a question in ordinary words. HELLO finds the room, the session
                and the right team, and keeps you informed until it is resolved.
              </span>
            </div>
          ) : (
            visible.map((m) => {
              const isMine = m.senderUserId === viewer.userId;
              const outcome = parseStoredOutcome(m.interpretation);
              const name = names.get(m.senderUserId) ?? 'Unknown';
              return (
                <div key={m.id} className="stack" style={{ gap: 10 }}>
                  <div className={isMine ? 'msg msg--me' : 'msg'}>
                    {isMine ? null : <div className="avatar" aria-hidden="true">{initials(name)}</div>}
                    <div className="msg__body">
                      <span className="msg__meta">
                        {isMine ? 'You' : name} · {formatUtc(m.createdAt).slice(11)}
                      </span>
                      <div className={isMine ? 'bubble bubble--me' : 'bubble'}>{m.text}</div>
                    </div>
                  </div>
                  {outcome ? (
                    <div className="msg">
                      <div className="avatar avatar--hello" aria-hidden="true">H</div>
                      <div className="msg__body" style={{ flex: 1 }}>
                        <span className="msg__meta">HELLO · {formatUtc(m.createdAt).slice(11)}</span>
                        <div className="bubble bubble--hello">{outcome.reply}</div>
                        {outcome.clarifyingQuestion ? (
                          <div className="notice notice--info" role="status">
                            {outcome.clarifyingQuestion}
                          </div>
                        ) : null}
                        <OutcomeCards eventId={eventId} outcome={outcome} />
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
          <ScrollToEnd />
        </div>
        <div className="thread__composer">
          <ChatComposer eventId={eventId} />
        </div>
      </section>

      <aside className="context" aria-label="Context">
        <section className="context__section">
          <h2>Your requests</h2>
          {mine.length === 0 ? (
            <p className="small muted">Nothing reported yet. When you report something, its status appears here.</p>
          ) : (
            <ul className="list-plain">
              {mine.map(({ incident }) => (
                <li key={incident.id}>
                  <Link href={`/events/${eventId}/incidents/${incident.id}`}>{incident.title}</Link>
                  <div className="row" style={{ marginTop: 4 }}>
                    <IncidentBadge status={incident.status} />
                    <span className="xs faint">{minutesAgo(now, incident.updatedAt)}</span>
                  </div>
                  <div className="xs faint" style={{ marginTop: 2 }}>
                    {STATUS_LABEL[incident.status]}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {operational ? (
          <section className="context__section">
            <h2>Rooms right now</h2>
            <ul className="list-plain">
              {rooms.map((r) => (
                <li key={r.room.id}>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <strong>{r.room.name}</strong>
                    {r.openIncidentCount > 0 ? (
                      <span className="badge badge--warning">{r.openIncidentCount} open</span>
                    ) : (
                      <span className="badge">Clear</span>
                    )}
                  </div>
                  <div className="xs faint">
                    {r.occupancyLabel} · {r.room.zone}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <section className="context__section">
            <h2>Tips</h2>
            <ul className="small muted" style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <li>Name the room if you can. “Room 3” or “Main Hall” both work.</li>
              <li>You are told when your request changes status. You do not need to repeat it.</li>
              <li>Only you and event staff can see your messages.</li>
            </ul>
          </section>
        )}
      </aside>
    </div>
  );
}
