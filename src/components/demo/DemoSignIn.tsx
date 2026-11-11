'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface Account {
  userId: string;
  name: string;
  role: string;
  blurb: string;
}

export function DemoSignIn({ eventId, accounts }: { eventId: string; accounts: Account[] }) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
        return;
      }
      router.push(`/events/${eventId}/conversation`);
      router.refresh();
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="stack" style={{ gap: 16 }}>
      {error ? (
        <p role="alert" className="notice notice--error">
          {error}
        </p>
      ) : null}
      <ul
        style={{
          listStyle: 'none',
          padding: 0,
          margin: 0,
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
          gap: 12,
        }}
      >
        {accounts.map((account) => (
          <li key={account.userId} className="card card--interactive role-card" style={{ display: 'flex', flexDirection: 'column' }}>
            <div className="card__body stack" style={{ gap: 8, flex: 1 }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <strong style={{ fontSize: 15 }}>{account.name}</strong>
                <span className="badge badge--accent">{account.role}</span>
              </div>
              <p className="small muted">{account.blurb}</p>
            </div>
            <div className="card__body" style={{ paddingTop: 0 }}>
              <button
                type="button"
                className="button button--ghost"
                style={{ width: '100%' }}
                onClick={() => void signIn(account.userId)}
                disabled={pending !== null}
                aria-label={`Continue as ${account.name}`}
              >
                {pending === account.userId ? 'Signing in…' : `Continue as ${account.role.toLowerCase()}`}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
