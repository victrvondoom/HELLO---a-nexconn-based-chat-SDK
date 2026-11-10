import Link from 'next/link';
import { loadEventViewer } from '@/lib/viewer';
import { parseStoredOutcome } from '@/lib/validation/outcome';
import { ChatComposer } from '@/components/conversation/ChatComposer';
import { OutcomeCards } from '@/components/conversation/OutcomeCards';
import { ScrollToEnd } from '@/components/conversation/ScrollToEnd';
import { LiveRefresh } from '@/components/workplace/LiveRefresh';
import { Icon } from '@/components/ui/Icon';
import { formatUtc, minutesAgo } from '@/components/ui/labels';
import { IncidentBadge } from '@/components/incidents/IncidentBadge';
import { listIncidentsForViewer } from '@/services/incidents';
import { getOperationsOverview } from '@/services/sessions';
import { STATUS_LABEL } from '@/domain/labels';
import { reporterAction } from '@/domain/incidents/workflow';

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

export default async function ConversationPage({
  params,
  searchParams,
}: {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { eventId } = await params;
  const { q } = await searchParams;
  const term = (q ?? '').trim().toLowerCase();
  const viewer = await loadEventViewer(eventId);
  const operational = viewer.can('incident.read.operational');
  const now = viewer.ctx.now();

  const all = await viewer.store.listMessages(eventId);
  const visible = all
    .filter((m) => operational || m.senderUserId === viewer.userId)
    .filter((m) => term === '' || m.text.toLowerCase().includes(term))
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(-120);

  const names = new Map<string, string>();
  for (const m of visible) {
    if (!names.has(m.senderUserId)) {
      names.set(m.senderUserId, (await viewer.store.getUser(m.senderUserId))?.displayName ?? 'Unknown');
    }
  }

  const mineAll = (await listIncidentsForViewer(viewer.ctx, eventId, viewer.userId)).filter((r) => r.isMine);
  const mine = mineAll.slice(0, 5);
  const rooms = operational ? await getOperationsOverview(viewer.ctx, eventId, viewer.userId) : [];
  const waiting = mineAll
    .map((r) => ({ incident: r.incident, action: reporterAction(r.incident.status) }))
    .filter((w): w is { incident: (typeof mineAll)[number]['incident']; action: 'SUPPLY_ROOM' | 'CONFIRM_OR_REOPEN' } => w.action !== null);

  return (
    <div className="chat">
      <section className="thread" aria-label="Conversation">
        <div className="thread__head">
          <form role="search" method="get" className="row" style={{ flex: 1 }}>
            <label htmlFor="thread-search" className="visually-hidden">Search this conversation</label>
            <input id="thread-search" name="q" defaultValue={q ?? ''} placeholder="Search your conversation" />
          </form>
          <LiveRefresh seconds={8} />
        </div>
        <div className="thread__scroll" role="log" aria-live="polite" aria-label="Messages">
          {visible.length === 0 ? (
            <div className="empty" style={{ margin: 'auto' }}>
              {term ? (
                <>
                  <strong>No messages match “{q}”</strong>
                  <span>Clear the search to see the whole conversation.</span>
                </>
              ) : (
                <>
              <Icon name="conversation" size={22} />
              <strong>Tell HELLO what is happening.</strong>
              <span>
                Describe a problem, ask for help, or ask a question in ordinary words. HELLO finds the room, the session
                and the right team, and keeps you informed until it is resolved.
              </span>
                </>
              )}
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
        {waiting.length > 0 ? (
          <section className="context__section" aria-labelledby="waiting-heading">
            <h2 id="waiting-heading">Waiting on you</h2>
            <ul className="list-reset stack" style={{ gap: 8 }}>
              {waiting.map(({ incident, action }) => (
                <li key={incident.id} className="ocard ocard--warn">
                  <Link href={`/events/${eventId}/incidents/${incident.id}`} className="ocard__title" style={{ color: 'var(--text)' }}>
                    {incident.title}
                  </Link>
                  <span className="ocard__meta">
                    {action === 'SUPPLY_ROOM'
                      ? 'Reply here with the room name, for example “Room 3”.'
                      : 'The team says this is fixed. Confirm it, or reopen it if the problem continues.'}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

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
