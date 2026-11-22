'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useFeedback } from '@/components/ui/Feedback';

export function CaughtUpButton({ eventId }: { eventId: string }) {
  const router = useRouter();
  const { toast } = useFeedback();
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      const response = await fetch(`/api/events/${eventId}/catch-up/seen`, { method: 'POST' });
      if (!response.ok) {
        toast('error', 'Could not save that you are caught up.');
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button type="button" className="button button--ghost button--sm" onClick={() => void run()} disabled={busy}>
      I am caught up
    </button>
  );
}
