'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ACTION_LABEL } from '@/domain/labels';

interface Props {
  eventId: string;
  incidentId: string;
  version: number;
  status: string;
  allowedNext: string[];
  canClaim: boolean;
}

type ApiResult = { ok: true } | { ok: false; message: string };

/**
 * Buttons only offer transitions the server already said are allowed for this viewer.
 * The server repeats every check, so a stale page cannot force an illegal move.
 */
export function IncidentActions({ eventId, incidentId, version, status, allowedNext, canClaim }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');

  async function call(body: Record<string, unknown>, label: string): Promise<ApiResult> {
    setPending(label);
    setError(null);
    try {
      const response = await fetch(`/api/events/${eventId}/incidents/${incidentId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = (await response.json()) as { ok: true } | { ok: false; error: { message: string } };
      if (!json.ok) {
        setError(json.error.message);
        router.refresh();
        return { ok: false, message: json.error.message };
      }
      router.refresh();
      return { ok: true };
    } catch {
      const message = 'The change was not saved because the connection failed. Nothing has been changed; try again.';
      setError(message);
      return { ok: false, message };
    } finally {
      setPending(null);
    }
  }

  const transitions = allowedNext.filter((s) => s !== 'ASSIGNED');

  return (
    <div className="stack">
      {error ? (
        <p role="alert" className="notice notice--error" style={{ margin: 0 }}>
          {error}
        </p>
      ) : null}

      {canClaim ? (
        <button
          type="button"
          className="button"
          disabled={pending !== null}
          onClick={() => void call({ action: 'claim', expectedVersion: version }, 'claim')}
        >
          {pending === 'claim' ? 'Claiming…' : 'Claim this incident'}
        </button>
      ) : null}

      {transitions.length > 0 ? (
        <div className="row">
          {transitions.map((to) => {
            if (to === 'RESOLVED') {
              return (
                <div key={to} className="stack" style={{ width: '100%' }}>
                  <label htmlFor="resolution-note" className="small">
                    What was done? (required)
                  </label>
                  <textarea
                    id="resolution-note"
                    value={note}
                    onChange={(e) => { setNote(e.target.value); }}
                    maxLength={1000}
                    placeholder="For example: Replaced the lapel microphone and retested Room 3."
                  />
                  <button
                    type="button"
                    className="button"
                    disabled={pending !== null || note.trim().length < 5}
                    onClick={() => void call({ action: 'transition', to, expectedVersion: version, resolutionNote: note.trim() }, to)}
                  >
                    {pending === to ? 'Saving…' : ACTION_LABEL.RESOLVED ?? 'Mark resolved'}
                  </button>
                </div>
              );
            }
            const danger = to === 'CANCELLED';
            return (
              <button
                key={to}
                type="button"
                className={danger ? 'button button--danger' : 'button button--ghost'}
                disabled={pending !== null}
                onClick={() => {
                  if (danger && !window.confirm('Cancel this incident? Reporters will be told it was cancelled.')) return;
                  void call({ action: 'transition', to, expectedVersion: version }, to);
                }}
              >
                {pending === to ? 'Saving…' : (ACTION_LABEL[to as keyof typeof ACTION_LABEL] ?? to)}
              </button>
            );
          })}
        </div>
      ) : null}

      {!canClaim && transitions.length === 0 ? (
        <p className="small muted" style={{ margin: 0 }}>
          {status === 'CLOSED' || status === 'CANCELLED'
            ? 'This incident is finished. Reporters can reopen it if the problem continues.'
            : 'No actions are available to you for this incident right now.'}
        </p>
      ) : null}
    </div>
  );
}
