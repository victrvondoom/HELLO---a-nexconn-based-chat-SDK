'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, errorText } from '@/components/live/client';

const NEXT: Record<string, Array<{ action: string; label: string }>> = {
  AI_TRIAGE: [{ action: 'REQUEST_STAFF', label: 'Request staff' }],
  STAFF_REQUESTED: [{ action: 'ASSIGN', label: 'Assign to me' }],
  ASSIGNED: [{ action: 'TAKE_OVER', label: 'Take over' }],
  HUMAN_OWNED: [{ action: 'RESOLVE', label: 'Resolve' }, { action: 'HAND_BACK', label: 'Hand back to automation' }],
  RESOLVED: [{ action: 'HAND_BACK', label: 'Hand back to automation' }],
};

/** Ownership actions for one incident. The server decides; a refusal is shown, not hidden. */
export function HandoffControls({ eventId, incidentId, state, viewerId }: { eventId: string; incidentId: string; state: string; viewerId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function act(action: string) {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/events/${eventId}/ops/handoff/${incidentId}`, 'POST', { action, ...(action === 'ASSIGN' ? { assigneeId: viewerId } : {}) });
      router.refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <span className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      {(NEXT[state] ?? []).map((n) => (
        <button key={n.action} type="button" className="button button--sm button--ghost" disabled={busy} onClick={() => { void act(n.action); }}>
          {n.label}
        </button>
      ))}
      {error ? <span role="alert" className="xs" style={{ color: 'var(--danger)' }}>{error}</span> : null}
    </span>
  );
}
