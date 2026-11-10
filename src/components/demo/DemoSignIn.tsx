'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface Account {
  userId: string;
  name: string;
  role: string;
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
    <div className="stack">
      {error ? (
        <p role="alert" className="notice notice--error">
          {error}
        </p>
      ) : null}
      <ul className="stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {accounts.map((account) => (
          <li key={account.userId} className="panel row" style={{ justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontWeight: 600 }}>{account.name}</div>
              <div className="small muted">{account.role}</div>
            </div>
            <button
              type="button"
              className="button button--ghost"
              onClick={() => void signIn(account.userId)}
              disabled={pending !== null}
              aria-label={`Continue as ${account.name}`}
            >
              {pending === account.userId ? 'Signing in…' : 'Continue'}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
