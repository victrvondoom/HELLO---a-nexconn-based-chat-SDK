'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    try {
      await fetch('/api/demo/session', { method: 'DELETE' });
      router.push('/demo');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button type="button" className="button button--ghost" onClick={() => void signOut()} disabled={busy}>
        {busy ? 'Signing out…' : 'Switch demo account'}
      </button>
    </div>
  );
}
