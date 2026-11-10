'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function ResetDemoButton({ eventId }: { eventId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reset() {
    if (!window.confirm('Reset the demo? Every message, incident and approval you created will be discarded.')) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/demo/reset', { method: 'POST' });
      if (!response.ok) {
        setError('The demo could not be reset.');
        return;
      }
      router.push(`/events/${eventId}/conversation`);
      router.refresh();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack" style={{ gap: 6 }}>
      <button type="button" className="button button--ghost" onClick={() => void reset()} disabled={busy}>
        {busy ? 'Resetting…' : 'Reset demo data'}
      </button>
      {error ? (
        <span role="alert" className="xs" style={{ color: 'var(--danger)' }}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
