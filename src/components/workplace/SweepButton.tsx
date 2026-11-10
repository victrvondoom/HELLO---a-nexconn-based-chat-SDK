'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useFeedback } from '@/components/ui/Feedback';

/** Runs the escalation sweep on the server. The result is reported as a summary, not assumed. */
export function SweepButton({ eventId }: { eventId: string }) {
  const router = useRouter();
  const { toast } = useFeedback();
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      const response = await fetch(`/api/events/${eventId}/sla/sweep`, { method: 'POST' });
      const json = (await response.json()) as
        | { ok: true; data: { escalated: Array<{ title: string }>; skipped: unknown[] } }
        | { ok: false; error: { message: string } };
      if (!json.ok) {
        toast('error', json.error.message);
        return;
      }
      const n = json.data.escalated.length;
      toast('success', n === 0 ? 'Sweep complete. Nothing is past its target.' : `Escalated ${n} overdue incident${n === 1 ? '' : 's'}.`);
      router.refresh();
    } catch {
      toast('error', 'The sweep could not run. Check the connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <button type="button" className="button button--ghost button--sm" onClick={() => void run()} disabled={busy}>
      {busy ? 'Checking…' : 'Run escalation check'}
    </button>
  );
}
