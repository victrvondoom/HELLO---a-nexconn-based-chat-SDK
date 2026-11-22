'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, errorText } from '@/components/live/client';
import { Icon } from '@/components/ui/Icon';

/** Add a session to your plan, or take it out. The plan is private to you. */
export function PlanToggle({ eventId, sessionId, planned, compact = false }: { eventId: string; sessionId: string; planned: boolean; compact?: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(planned);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      const plan = await api<{ sessionIds: string[] }>(`/api/events/${eventId}/plan`, 'POST', { sessionId });
      setOn(plan.sessionIds.includes(sessionId));
      router.refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="plan-toggle">
      <button
        type="button"
        className={on ? 'button button--sm button--ghost' : 'button button--sm'}
        aria-pressed={on}
        disabled={busy}
        onClick={() => {
          void toggle();
        }}
      >
        <Icon name={on ? 'check' : 'plus'} size={14} /> {on ? (compact ? 'In plan' : 'In your plan') : compact ? 'Add' : 'Add to plan'}
      </button>
      {error ? <span role="alert" className="xs" style={{ color: 'var(--danger)' }}>{error}</span> : null}
    </span>
  );
}
