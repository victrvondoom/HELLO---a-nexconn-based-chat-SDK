'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, errorText } from '@/components/live/client';

/**
 * "Hold my seat". Shown as held only after the server confirms: the server checks free seats and reserves
 * in one step, so a hold here is real.
 */
export function HoldSeat({ eventId, sessionId, heldUntil }: { eventId: string; sessionId: string; heldUntil: number | null }) {
  const router = useRouter();
  const [until, setUntil] = useState<number | null>(heldUntil);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clock = (ms: number) => new Date(ms).toISOString().slice(11, 16);

  async function release() {
    setBusy(true);
    try {
      await api(`/api/events/${eventId}/now/${sessionId}/hold`, 'DELETE');
      setUntil(null);
      router.refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function hold() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ expiresAt: number }>(`/api/events/${eventId}/now/${sessionId}/hold`, 'POST');
      setUntil(r.expiresAt);
      router.refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="stack" style={{ gap: 4 }}>
      {until ? (
        <span className="row" style={{ gap: 8, alignItems: 'center' }}>
          <span className="badge badge--success">Seat held until {clock(until)} UTC</span>
          <button
            type="button"
            className="button button--sm button--ghost"
            disabled={busy}
            onClick={() => {
              void release();
            }}
          >
            Release
          </button>
        </span>
      ) : (
        <button
          type="button"
          className="button button--sm"
          disabled={busy}
          onClick={() => {
            void hold();
          }}
        >
          {busy ? 'Checking seats…' : 'Hold my seat'}
        </button>
      )}
      {error ? <span role="alert" className="xs" style={{ color: 'var(--danger)' }}>{error}</span> : null}
    </span>
  );
}
