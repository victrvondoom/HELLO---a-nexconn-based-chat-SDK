'use client';

import { useState, type SyntheticEvent } from 'react';
import { api, errorText, useLive } from '@/components/live/client';
import { Icon } from '@/components/ui/Icon';
import type { LiveRoom } from '@/services/live-room';
import { PlanToggle } from './PlanToggle';

const clock = (ms: number) => new Date(ms).toISOString().slice(11, 16);
const KIND = { CANT_HEAR: "Can't hear", CANT_SEE: "Can't see" } as const;
type Kind = keyof typeof KIND;

/**
 * The live session room. The attendee stays here for the whole talk: the timeline, questions grouped by
 * similarity, and two signals for the AV team. Captions, listen-in audio and slides need a media provider;
 * none is configured, so the room says so instead of showing anything invented.
 */
export function LiveRoomView({ eventId, initial, canAsk, canSignal }: { eventId: string; initial: LiveRoom; canAsk: boolean; canSignal: boolean }) {
  const { data, refresh } = useLive<LiveRoom>(`/api/events/${eventId}/now/${initial.session.id}`, initial, 4000);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const s = data.session;
  const progress = Math.max(0, Math.min(1, (data.now - s.startsAt) / Math.max(1, s.endsAt - s.startsAt)));

  async function act(key: string, run: () => Promise<string | null>) {
    setBusy(key);
    setNote(null);
    try {
      const message = await run();
      if (message) setNote({ tone: 'ok', text: message });
      await refresh();
    } catch (e) {
      setNote({ tone: 'error', text: errorText(e) });
    } finally {
      setBusy(null);
    }
  }

  const signal = (kind: Kind) =>
    act(kind, async () => {
      const r = await api<{ raised: boolean }>(`/api/events/${eventId}/now/${s.id}/signal`, 'POST', { kind });
      return r.raised ? 'Several people reported this. The AV team has a ticket.' : 'Thanks. If others notice it too, the AV team is called.';
    });

  const better = (kind: Kind, yes: boolean) => act(`${kind}-better`, async () => {
    await api(`/api/events/${eventId}/now/${s.id}/better`, 'POST', { kind, better: yes });
    return yes ? 'Glad it is fixed.' : 'Noted. It goes back to the AV team if others still have the problem.';
  });

  async function ask(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = text.trim();
    if (value.length < 3) return;
    await act('ask', async () => {
      await api(`/api/events/${eventId}/now/${s.id}/questions`, 'POST', { text: value });
      setText('');
      return 'Question sent.';
    });
  }

  return (
    <div className="live-room__grid">
      <section className="live-room__stage card card__body" aria-labelledby="room-title">
        <p className="eyebrow">
          {data.running ? (
            <span className="live">
              <span className="live__dot" aria-hidden="true" /> Live now
            </span>
          ) : data.now < s.startsAt ? (
            `Starts ${clock(s.startsAt)} UTC`
          ) : (
            'Ended'
          )}
        </p>
        <h1 id="room-title">{s.title}</h1>
        <p className="today__meta">
          {data.room?.name ?? 'Room to be confirmed'}
          {data.speaker ? ` · ${data.speaker.name}` : ''} · {clock(s.startsAt)}–{clock(s.endsAt)} UTC
        </p>
        <div className="live-room__timeline" role="progressbar" aria-label="Session progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
          <span style={{ width: `${progress * 100}%` }} />
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <PlanToggle eventId={eventId} sessionId={s.id} planned={data.planned} />
          {s.topics.map((t) => (
            <span key={t} className="chip">
              {t}
            </span>
          ))}
        </div>
        <div className="live-room__media">
          <div>
            <strong>Captions and listen-in audio</strong>
            <p className="xs faint">Not available at this event yet: no caption or audio provider is connected.</p>
          </div>
          <div>
            <strong>Slides</strong>
            <p className="xs faint">The speaker has not shared slides.</p>
          </div>
        </div>
      </section>

      {canSignal && data.running ? (
        <section className="live-room__signals card card__body" aria-labelledby="signals-title">
          <h2 id="signals-title">Trouble in the room?</h2>
          <div className="live-room__buttons">
            {(Object.keys(KIND) as Kind[]).map((kind) => (
              <button key={kind} type="button" className="live-room__signal" disabled={busy !== null} onClick={() => void signal(kind)}>
                <Icon name={kind === 'CANT_HEAR' ? 'mic' : 'video'} size={22} />
                {KIND[kind]}
              </button>
            ))}
          </div>
          {data.myAv.map((a) =>
            a.state === 'FIXED_ASK' ? (
              <div key={a.kind} className="notice" role="status">
                <strong>Better now?</strong> The AV team marked “{KIND[a.kind].toLowerCase()}” fixed.
                <span className="row" style={{ gap: 6, marginTop: 6 }}>
                  <button type="button" className="button button--sm" onClick={() => void better(a.kind, true)}>
                    Yes, better
                  </button>
                  <button type="button" className="button button--sm button--ghost" onClick={() => void better(a.kind, false)}>
                    Still bad
                  </button>
                </span>
              </div>
            ) : (
              <p key={a.kind} className="xs faint" style={{ margin: 0 }}>
                {KIND[a.kind]}: {a.state === 'WITH_AV_TEAM' ? 'the AV team is on it.' : a.state === 'BETTER' ? 'you said it is better.' : 'sent.'}
              </p>
            ),
          )}
          {data.staff ? (
            <p className="xs faint" style={{ margin: 0 }}>
              Staff view: {data.staff.avDistinct.CANT_HEAR} can't hear, {data.staff.avDistinct.CANT_SEE} can't see in the last minute.
            </p>
          ) : null}
        </section>
      ) : null}

      <section className="live-room__questions card card__body" aria-labelledby="questions-title">
        <h2 id="questions-title">Questions</h2>
        {canAsk ? (
          <form className="live-room__ask" onSubmit={(e) => void ask(e)}>
            <input value={text} onChange={(e) => { setText(e.target.value); }} maxLength={280} placeholder="Ask the speaker…" aria-label="Your question" />
            <button type="submit" className="button button--sm" disabled={busy !== null || text.trim().length < 3}>
              <Icon name="send" size={14} /> Ask
            </button>
          </form>
        ) : null}
        {note ? (
          <p role={note.tone === 'error' ? 'alert' : 'status'} className={note.tone === 'error' ? 'notice notice--error' : 'small muted'} style={{ margin: 0 }}>
            {note.text}
          </p>
        ) : null}
        {data.questions.length === 0 ? <p className="small muted">No questions yet.</p> : null}
        <ol className="list-reset live-room__groups">
          {data.questions.map((g) => (
            <li key={g.key}>
              {g.questions.length > 1 ? <p className="xs faint">{g.questions.length} similar questions</p> : null}
              <ul className="list-reset">
                {g.questions.map((q) => (
                  <li key={q.id} className={q.answered ? 'live-room__q is-answered' : 'live-room__q'}>
                    <span className="grow">
                      {q.text}
                      {q.mine ? <span className="xs faint"> · yours</span> : null}
                    </span>
                    <button
                      type="button"
                      className="chip"
                      aria-pressed={q.voted}
                      aria-label={`${q.voted ? 'Remove your vote' : 'Vote'}: ${q.votes} votes`}
                      onClick={() => void act(`v-${q.id}`, async () => {
                        await api(`/api/events/${eventId}/questions/${q.id}/vote`, 'POST');
                        return null;
                      })}
                    >
                      ▲ {q.votes}
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
