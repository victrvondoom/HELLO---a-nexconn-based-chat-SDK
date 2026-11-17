'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      router.push('/signin');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button type="button" className="button button--ghost" onClick={() => void signOut()} disabled={busy}>
        {busy ? 'Signing out…' : 'Sign out'}
      </button>
    </div>
  );
}
