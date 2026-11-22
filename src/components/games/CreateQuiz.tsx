'use client';

import { useRouter } from 'next/navigation';
import { useState, type SyntheticEvent } from 'react';
import { api, errorText } from '@/components/live/client';

interface Draft {
  prompt: string;
  options: string[];
  answer: number;
}

const blank = (): Draft => ({ prompt: '', options: ['', '', '', ''], answer: 0 });

/**
 * Create a game: write your own quiz, 3 to 10 questions with 2 to 4 options each. The server keeps the
 * answers and scores every player, so a quiz written here is as cheat-proof as the schedule quiz.
 */
export function CreateQuiz({ eventId }: { eventId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [questions, setQuestions] = useState<Draft[]>([blank(), blank(), blank()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (i: number, patch: Partial<Draft>) => { setQuestions((qs) => qs.map((q, j) => (j === i ? { ...q, ...patch } : q))); };

  async function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const cleaned = questions.map((q) => {
      const kept = q.options.map((o, i) => ({ o: o.trim(), i })).filter((x) => x.o.length > 0);
      return { prompt: q.prompt.trim(), options: kept.map((x) => x.o), answer: Math.max(0, kept.findIndex((x) => x.i === q.answer)) };
    });
    try {
      const g = await api<{ id: string }>(`/api/events/${eventId}/games`, 'POST', { kind: 'QUIZ', custom: { title: title.trim(), questions: cleaned } });
      router.push(`/events/${eventId}/games/${g.id}`);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="panel tile">
        <h3>Create a game</h3>
        <p className="small muted" style={{ margin: 0 }}>Write your own quiz for the people around you: your questions, your answers, live scores.</p>
        <div className="tile__foot">
          <span className="xs faint">3 to 10 questions</span>
          <button type="button" className="button button--sm" onClick={() => { setOpen(true); }}>
            Create
          </button>
        </div>
      </div>
    );
  }

  return (
    <form className="panel" onSubmit={(e) => void submit(e)} aria-label="Create a quiz" style={{ gridColumn: '1 / -1' }}>
      <div className="panel__head">
        <h3>Create a quiz</h3>
        <button type="button" className="button button--sm button--ghost" onClick={() => { setOpen(false); }}>
          Cancel
        </button>
      </div>
      <div className="panel__body stack" style={{ gap: 16 }}>
        <label className="field">
          <span className="label">Title</span>
          <input value={title} onChange={(e) => { setTitle(e.target.value); }} required minLength={3} maxLength={80} placeholder="e.g. Robotics lunch quiz" />
        </label>
        {questions.map((q, i) => (
          <fieldset key={i} className="field" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="label">Question {i + 1}</legend>
            <input value={q.prompt} onChange={(e) => { set(i, { prompt: e.target.value }); }} required minLength={5} maxLength={200} aria-label={`Question ${i + 1}`} />
            <div className="stack" style={{ gap: 6, marginTop: 6 }}>
              {q.options.map((o, k) => (
                <label key={k} className="row" style={{ gap: 8, alignItems: 'center' }}>
                  <input type="radio" name={`answer-${i}`} checked={q.answer === k} onChange={() => { set(i, { answer: k }); }} aria-label={`Option ${k + 1} is right`} />
                  <input
                    value={o}
                    onChange={(e) => { set(i, { options: q.options.map((x, j) => (j === k ? e.target.value : x)) }); }}
                    maxLength={80}
                    required={k < 2}
                    placeholder={k < 2 ? `Option ${k + 1}` : `Option ${k + 1} (optional)`}
                    aria-label={`Question ${i + 1}, option ${k + 1}`}
                    style={{ flex: 1 }}
                  />
                </label>
              ))}
            </div>
          </fieldset>
        ))}
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="button button--sm button--ghost" disabled={questions.length >= 10} onClick={() => { setQuestions([...questions, blank()]); }}>
            Add a question
          </button>
          {questions.length > 3 ? (
            <button type="button" className="button button--sm button--ghost" onClick={() => { setQuestions(questions.slice(0, -1)); }}>
              Remove the last
            </button>
          ) : null}
        </div>
        <p className="xs faint" style={{ margin: 0 }}>Pick the right option with the circle beside it.</p>
        {error ? (
          <p role="alert" className="notice notice--error" style={{ margin: 0 }}>
            {error}
          </p>
        ) : null}
        <button type="submit" className="button" disabled={busy}>
          {busy ? 'Creating…' : 'Create and play'}
        </button>
      </div>
    </form>
  );
}
