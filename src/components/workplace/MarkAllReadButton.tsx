'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useFeedback } from '@/components/ui/Feedback';

export function MarkAllReadButton({ eventId, unread }: { eventId: string; unread: number }) {
  const router = useRouter();
  const { toast } = useFeedback();
  const [busy, setBusy] = useState(false);
  if (unread === 0) return null;

  async function run() {
    setBusy(true);
    try {
      const response = await fetch(`/api/events/${eventId}/notifications/read`, { method: 'POST' });
      if (!response.ok) {
        toast('error', 'Could not mark notifications as read.');
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button type="button" className="button button--ghost button--sm" onClick={() => void run()} disabled={busy}>
      Mark {unread} as read
    </button>
  );
}
