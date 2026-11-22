'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type SyntheticEvent } from 'react';
import { api, errorText } from '@/components/live/client';

/** Sign in, or create an account. The server decides both; this form only collects the fields. */
export function SignInForm({ demo }: { demo: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const signingIn = mode === 'login';

  async function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const { eventId } = await api<{ eventId: string }>(`/api/auth/${mode}`, 'POST', {
        handle: form.get('handle'),
        password: form.get('password'),
        ...(mode === 'register' ? { displayName: form.get('displayName') } : {}),
      });
      router.push(`/events/${eventId}`);
      router.refresh();
    } catch (e: unknown) {
      setError(errorText(e));
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <div className="panel__head">
        <nav className="segmented" aria-label="Sign in or create an account">
          <button type="button" className={signingIn ? 'segmented__item is-active' : 'segmented__item'} onClick={() => { setMode('login'); setError(null); }} aria-pressed={mode === 'login'}>
            Sign in
          </button>
          <button type="button" className={signingIn ? 'segmented__item' : 'segmented__item is-active'} onClick={() => { setMode('register'); setError(null); }} aria-pressed={mode === 'register'}>
            Create account
          </button>
        </nav>
      </div>
      <form className="panel__body" onSubmit={(e) => void submit(e)}>
        {error ? (
          <p role="alert" className="notice notice--error">
            {error}
          </p>
        ) : null}
        {mode === 'register' ? (
          <label className="field">
            <span className="label">Your name</span>
            <input name="displayName" required maxLength={80} autoComplete="name" />
          </label>
        ) : null}
        <label className="field">
          <span className="label">Handle</span>
          <input name="handle" required minLength={3} maxLength={24} pattern="[A-Za-z0-9_]{3,24}" autoComplete="username" autoCapitalize="none" spellCheck={false} />
          {mode === 'register' ? <span className="xs faint">3 to 24 letters, digits or underscores.</span> : null}
        </label>
        <label className="field">
          <span className="label">Password</span>
          <input name="password" type="password" required minLength={mode === 'register' ? 10 : 1} maxLength={200} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} />
          {mode === 'register' ? <span className="xs faint">At least 10 characters.</span> : null}
        </label>
        <button type="submit" className="button" disabled={busy}>
          {busy ? 'One moment…' : mode === 'login' ? 'Sign in' : 'Create account and join'}
        </button>
        {demo ? (
          <p className="small muted" style={{ margin: 0 }}>
            Just looking? <Link href="/demo">Try a demo role</Link> without an account.
          </p>
        ) : null}
      </form>
    </div>
  );
}
