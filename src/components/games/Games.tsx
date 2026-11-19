'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, errorText, useLive } from '@/components/live/client';
import { useFeedback } from '@/components/ui/Feedback';
import type { GameView } from '@/services/games';

const KIND = { FOUR: 'Four in a row', QUIZ: 'Schedule quiz' } as const;

function statusText(g: GameView): string {
  if (g.kind === 'QUIZ') return `${g.status === 'FINISHED' ? 'Closed · ' : ''}${g.players.length} played · ${g.total} questions`;
  if (g.status === 'FINISHED') return 'Closed';
  if (g.status === 'WAITING') return g.seat === 0 ? 'Waiting for an opponent' : 'Open: needs an opponent';
  if (g.status === 'WON') return g.youWon ? 'You won' : `${g.winner ?? 'Someone'} won`;
  if (g.status === 'DRAW') return 'Draw';
  return g.seat === g.turn ? 'Your move' : `${g.players[g.turn]?.name ?? 'Opponent'} to move`;
}

export function GameLobby({ eventId, initial, canPlay }: { eventId: string; initial: GameView[]; canPlay: boolean }) {
  const router = useRouter();
  const { toast } = useFeedback();
  const { data } = useLive(`/api/events/${eventId}/games`, { games: initial }, 4000);
  const start = (kind: 'FOUR' | 'QUIZ') => {
    api<{ id: string }>(`/api/events/${eventId}/games`, 'POST', { kind })
      .then((g) => { router.push(`/events/${eventId}/games/${g.id}`); })
      .catch((e: unknown) => { toast('error', errorText(e)); });
  };
  return (
    <div className="stack" style={{ gap: 20 }}>
      {canPlay ? (
        <div className="tile-grid">
          <div className="panel tile">
            <h3>{KIND.FOUR}</h3>
            <p className="small muted" style={{ margin: 0 }}>Two players take turns dropping discs. First to line up four wins. Anyone at the event can take the open seat.</p>
            <div className="tile__foot">
              <span className="xs faint">2 players · live</span>
              <button type="button" className="button button--sm" onClick={() => { start('FOUR'); }}>New game</button>
            </div>
          </div>
          <div className="panel tile">
            <h3>{KIND.QUIZ}</h3>
            <p className="small muted" style={{ margin: 0 }}>Questions written from this event’s live schedule and rooms. Everyone can play the same round and compare scores.</p>
            <div className="tile__foot">
              <span className="xs faint">Any number of players</span>
              <button type="button" className="button button--sm" onClick={() => { start('QUIZ'); }}>New quiz</button>
            </div>
          </div>
        </div>
      ) : null}
      <section className="panel" aria-labelledby="games-heading">
        <div className="panel__head">
          <h2 id="games-heading">Games at this event</h2>
        </div>
        {data.games.length === 0 ? (
          <p className="panel__body small muted" style={{ margin: 0 }}>No games yet. Start one above.</p>
        ) : (
          <ul className="score-list">
            {data.games.map((g) => (
              <li key={g.id}>
                <span>
                  <Link href={`/events/${eventId}/games/${g.id}`}>{KIND[g.kind]}</Link> <span className="muted">· started by {g.host}</span>
                </span>
                <span className={g.canJoin || (g.status === 'ACTIVE' && g.seat === g.turn && g.kind === 'FOUR') ? 'badge badge--accent' : 'badge'}>{statusText(g)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export function GameBoard({ eventId, initial }: { eventId: string; initial: GameView }) {
  const url = `/api/events/${eventId}/games/${initial.id}`;
  const { toast } = useFeedback();
  const live = useLive(url, { game: initial }, 1500);
  const g = live.data.game;

  const play = async (body: unknown) => {
    try {
      await api(url, 'POST', body);
      await live.refresh();
    } catch (e: unknown) {
      toast('error', errorText(e));
    }
  };

  if (g.kind === 'QUIZ') {
    const next = g.questions.findIndex((q) => q.yours === null);
    const mine = g.players.find((p) => p.isSelf);
    return (
      <div className="split">
        <div className="stack" style={{ gap: 16 }}>
          {g.questions.map((q, i) =>
            i > (next === -1 ? g.total : next) ? null : (
              <section key={i} className="panel panel__body" aria-label={`Question ${i + 1}`}>
                <span className="xs faint">Question {i + 1} of {g.total}</span>
                <h3 style={{ margin: '4px 0 0' }}>{q.prompt}</h3>
                <div className="quiz-options">
                  {q.options.map((option, choice) => (
                    <button
                      key={choice}
                      type="button"
                      className={`quiz-option${q.answer === choice ? ' is-right' : q.yours === choice ? ' is-wrong' : ''}`}
                      disabled={q.yours !== null || g.status === 'FINISHED'}
                      onClick={() => void play({ action: 'answer', question: i, choice })}
                    >
                      {option}
                      {q.answer === choice ? ' ✓' : q.yours === choice ? ' ✕' : ''}
                    </button>
                  ))}
                </div>
              </section>
            ),
          )}
          {next === -1 ? <p className="notice" role="status">You scored {mine?.score ?? 0} of {g.total}.</p> : null}
          {g.status === 'FINISHED' && next !== -1 ? <p className="notice" role="status">This quiz has closed. The scores stand.</p> : null}
        </div>
        <Scores game={g} />
      </div>
    );
  }

  const myTurn = g.status === 'ACTIVE' && g.seat === g.turn;
  return (
    <div className="split">
      <div className="stack" style={{ gap: 12, alignItems: 'flex-start' }}>
        <p className={myTurn ? 'notice notice--info' : 'notice'} role="status" style={{ margin: 0 }}>
          {statusText(g)}
          {g.seat === -1 && g.status !== 'WAITING' ? ' · you are watching' : ''}
        </p>
        {g.canJoin ? (
          <button type="button" className="button" onClick={() => void play({ action: 'join' })}>Take the open seat</button>
        ) : null}
        <div className="four" role="group" aria-label="Game board">
          {Array.from({ length: 7 }, (_, col) => (
            <button key={col} type="button" className="four__col" disabled={!myTurn || g.board[col] !== 0} aria-label={`Drop a disc in column ${col + 1}`} onClick={() => void play({ action: 'move', col })}>
              {Array.from({ length: 6 }, (_, row) => {
                const cell = row * 7 + col;
                return <span key={row} className={`four__cell four__cell--${g.board[cell] ?? 0}${g.line.includes(cell) ? ' is-win' : ''}`} />;
              })}
            </button>
          ))}
        </div>
      </div>
      <Scores game={g} />
    </div>
  );
}

function Scores({ game }: { game: GameView }) {
  const players = game.kind === 'QUIZ' ? [...game.players].sort((a, b) => b.score - a.score) : game.players;
  return (
    <section className="panel" aria-labelledby="players-heading">
      <div className="panel__head">
        <h2 id="players-heading">{game.kind === 'QUIZ' ? 'Scores' : 'Players'}</h2>
      </div>
      {players.length === 0 ? (
        <p className="panel__body small muted" style={{ margin: 0 }}>Nobody has played yet.</p>
      ) : (
        <ul className="score-list">
          {players.map((p, i) => (
            <li key={p.id}>
              <span>
                {game.kind === 'FOUR' ? <span className={`four__cell four__cell--${i + 1}`} style={{ display: 'inline-block', width: 14, verticalAlign: -2, marginRight: 8 }} aria-hidden="true" /> : null}
                {p.name}
                {p.isSelf ? ' (you)' : ''}
              </span>
              {game.kind === 'QUIZ' ? <strong>{p.score} / {p.answered}</strong> : <span className="muted">{i === 0 ? 'Moves first' : 'Moves second'}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
