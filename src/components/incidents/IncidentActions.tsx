'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ACTION_LABEL } from '@/domain/labels';
import { useFeedback } from '@/components/ui/Feedback';

interface Props {
  eventId: string;
  incidentId: string;
  version: number;
  status: string;
  allowedNext: string[];
  canClaim: boolean;
}

const DESTRUCTIVE = new Set(['CANCELLED']);

/**
 * Only transitions the server already allowed for this viewer are offered. The server repeats every
 * check, so a stale page cannot force an illegal move. Outcomes are reported with toasts, and
 * anything irreversible asks first.
 */
export function IncidentActions({ eventId, incidentId, version, status, allowedNext, canClaim }: Props) {
  const router = useRouter();
  const { toast, confirm } = useFeedback();
  const [pending, setPending] = useState<string | null>(null);
  const [note, setNote] = useState('');

  async function call(body: Record<string, unknown>, label: string, success: string): Promise<boolean> {
    setPending(label);
    try {
      const response = await fetch(`/api/events/${eventId}/incidents/${incidentId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = (await response.json()) as { ok: true } | { ok: false; error: { message: string } };
      if (!json.ok) {
        toast('error', json.error.message);
        router.refresh();
        return false;
      }
      toast('success', success);
      router.refresh();
      return true;
    } catch {
      toast('error', 'The change was not saved because the connection failed. Nothing has changed; try again.');
      return false;
    } finally {
      setPending(null);
    }
  }

  async function claim() {
    await call({ action: 'claim', expectedVersion: version }, 'claim', 'You have claimed this incident.');
  }

  async function transition(to: string) {
    if (DESTRUCTIVE.has(to)) {
      const ok = await confirm({
        title: 'Cancel this incident?',
        body: 'Reporters will be told it was cancelled. You can reopen it later only from the reporter side.',
        confirmLabel: 'Cancel incident',
        tone: 'danger',
      });
      if (!ok) return;
    }
    const body: Record<string, unknown> = { action: 'transition', to, expectedVersion: version };
    if (to === 'RESOLVED') body.resolutionNote = note.trim();
    await call(body, to, `Moved to ${(ACTION_LABEL[to as keyof typeof ACTION_LABEL] ?? to).toLowerCase()}.`);
  }

  const transitions = allowedNext.filter((s) => s !== 'ASSIGNED');

  return (
    <div className="stack" style={{ gap: 12 }}>
      {canClaim ? (
        <button
          type="button"
          className="button"
          disabled={pending !== null}
          onClick={() => void claim()}
        >
          {pending === 'claim' ? 'Claiming…' : 'Claim this incident'}
        </button>
      ) : null}

      {transitions.includes('RESOLVED') ? (
        <div className="stack" style={{ gap: 6 }}>
          <label htmlFor="resolution-note" className="label">
            What was done?
          </label>
          <textarea
            id="resolution-note"
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
            }}
            maxLength={1000}
            rows={3}
            placeholder="For example: Replaced the lapel microphone and retested Room 3."
            aria-describedby="resolution-help"
          />
          <span id="resolution-help" className="xs faint">
            Required to mark resolved. The reporter sees this note.
          </span>
          <div>
            <button
              type="button"
              className="button"
              disabled={pending !== null || note.trim().length < 5}
              onClick={() => void transition('RESOLVED')}
            >
              {pending === 'RESOLVED' ? 'Saving…' : 'Mark resolved'}
            </button>
          </div>
        </div>
      ) : null}

      {transitions.filter((t) => t !== 'RESOLVED').length > 0 ? (
        <div className="row">
          {transitions
            .filter((t) => t !== 'RESOLVED')
            .map((to) => (
              <button
                key={to}
                type="button"
                className={DESTRUCTIVE.has(to) ? 'button button--ghost button--quiet-danger' : 'button button--ghost'}
                disabled={pending !== null}
                onClick={() => void transition(to)}
              >
                {pending === to ? 'Saving…' : (ACTION_LABEL[to as keyof typeof ACTION_LABEL] ?? to)}
              </button>
            ))}
        </div>
      ) : null}

      {!canClaim && transitions.length === 0 ? (
        <p className="small muted">
          {status === 'CLOSED' || status === 'CANCELLED'
            ? 'This incident is finished. The reporter can reopen it if the problem continues.'
            : 'No actions are available to you for this incident right now.'}
        </p>
      ) : null}
    </div>
  );
}
