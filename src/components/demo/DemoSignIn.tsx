'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Avatar } from '@/components/social/Avatar';

interface Account {
  userId: string;
  name: string;
  role: string;
  blurb: string;
}

/** Roles in the order the picker shows them: the public side of the event first, the back office last. */
const ROLE_ORDER = ['Attendee', 'Speaker', 'Volunteer', 'Operations', 'Organiser', 'Platform admin'];

function rank(role: string): number {
  const index = ROLE_ORDER.indexOf(role);
  return index === -1 ? ROLE_ORDER.length : index;
}

function slug(role: string): string {
  return role.toLowerCase().replace(/[^a-z]+/g, '-');
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
      <div className="role-groups">
        {[...new Set(accounts.map((a) => a.role))]
          .sort((a, b) => rank(a) - rank(b))
          .map((role, index) => {
            const members = accounts.filter((a) => a.role === role);
            const headingId = `role-group-${slug(role)}`;
            return (
              <section key={role} className={`role-group role-group--${slug(role)}`} aria-labelledby={headingId}>
                <div className="role-group__head">
                  <span className="role-group__n" aria-hidden="true">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <h2 id={headingId}>{members.length > 1 && !role.endsWith('s') ? `${role}s` : role}</h2>
                  <span className="role-group__count">
                    {members.length} {members.length === 1 ? 'account' : 'accounts'}
                  </span>
                </div>
                <ul className="role-grid">
                  {members.map((account) => (
                    <li key={account.userId} className="card card--interactive role-card">
                      <div className="role-card__top">
                        <Avatar name={account.name} size={44} />
                        <div className="role-card__who">
                          <strong>{account.name}</strong>
                          <span className="badge badge--accent">{account.role}</span>
                        </div>
                      </div>
                      <p className="role-card__blurb">{account.blurb}</p>
                      <button
                        type="button"
                        className="button button--ghost role-card__go"
                        onClick={() => void signIn(account.userId)}
                        disabled={pending !== null}
                        aria-label={`Continue as ${account.name}`}
                      >
                        {pending === account.userId ? 'Signing in…' : `Continue as ${account.role.toLowerCase()}`}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
      </div>
    </div>
  );
}
