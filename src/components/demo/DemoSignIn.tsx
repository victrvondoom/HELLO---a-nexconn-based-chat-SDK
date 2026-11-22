'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface Account {
  userId: string;
  name: string;
  role: string;
}

/** The three ways in. Each maps to the first seeded person with that role; nothing else is asked. */
const WAYS = [
  { id: 'attend', label: 'Attending', roles: ['Attendee'] },
  { id: 'speak', label: 'Speaking', roles: ['Speaker'] },
  { id: 'team', label: 'On the team', roles: ['Organiser', 'Operations', 'Volunteer'] },
] as const;

/**
 * Entering the demo: one button. The role is a single optional choice beneath it, and choosing a specific
 * seeded person is folded away for people testing roles. The server decides access on every request.
 */
export function DemoSignIn({ eventId, accounts }: { eventId: string; accounts: Account[] }) {
  const router = useRouter();
  const [way, setWay] = useState<(typeof WAYS)[number]['id']>('attend');
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const firstFor = (roles: readonly string[]) => roles.map((r) => accounts.find((a) => a.role === r)).find(Boolean);
  const chosen = firstFor(WAYS.find((w) => w.id === way)?.roles ?? ['Attendee']) ?? accounts[0];

  async function signIn(userId: string) {
    setPending(userId);
    setError(null);
    try {
      const response = await fetch('/api/demo/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      const body = (await response.json()) as { ok: boolean; error?: { message: string } };
      if (!response.ok || !body.ok) {
        setError(body.error?.message ?? 'Sign-in failed.');
        setPending(null);
        return;
      }
      router.push(`/events/${eventId}`);
      router.refresh();
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
      setPending(null);
    }
  }

  return (
    <div className="enter">
      {error ? (
        <p role="alert" className="notice notice--error">
          {error}
        </p>
      ) : null}
      <button type="button" className="button button--lg enter__go" disabled={pending !== null || !chosen} onClick={() => chosen && void signIn(chosen.userId)}>
        {pending ? 'Opening…' : 'Enter HELLO'}
      </button>
      <div className="enter__ways" role="radiogroup" aria-label="I am">
        {WAYS.map((w) => (
          <button key={w.id} type="button" role="radio" aria-checked={way === w.id} className={way === w.id ? 'enter__way is-on' : 'enter__way'} onClick={() => { setWay(w.id); }}>
            {w.label}
          </button>
        ))}
      </div>
      <details className="enter__more">
        <summary>Someone specific</summary>
        <ul className="list-reset enter__people">
          {accounts.map((a) => (
            <li key={a.userId}>
              <button type="button" className="enter__person" disabled={pending !== null} onClick={() => void signIn(a.userId)} aria-label={`Continue as ${a.name}`}>
                <span>{a.name}</span>
                <span className="faint">{a.role}</span>
              </button>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
