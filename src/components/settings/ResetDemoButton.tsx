'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useFeedback } from '@/components/ui/Feedback';

export function ResetDemoButton({ eventId }: { eventId: string }) {
  const router = useRouter();
  const { toast, confirm } = useFeedback();
  const [busy, setBusy] = useState(false);

  async function reset() {
    const ok = await confirm({
      title: 'Reset the demo?',
      body: 'Every message, incident and approval created in this session is discarded. The seeded event returns to its starting state.',
      confirmLabel: 'Reset demo',
      tone: 'danger',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const response = await fetch('/api/demo/reset', { method: 'POST' });
      if (!response.ok) {
        toast('error', 'The demo could not be reset.');
        return;
      }
      toast('success', 'Demo data restored.');
      router.push(`/events/${eventId}/conversation`);
      router.refresh();
    } catch {
      toast('error', 'Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <button type="button" className="button button--ghost" onClick={() => void reset()} disabled={busy}>
      {busy ? 'Resetting…' : 'Reset demo data'}
    </button>
  );
}
