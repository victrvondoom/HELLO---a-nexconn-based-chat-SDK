'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useFeedback } from '@/components/ui/Feedback';

const OPTIONS = [
  { value: 'AVAILABLE', label: 'Available' },
  { value: 'BUSY', label: 'Busy' },
  { value: 'OFF_SHIFT', label: 'Off shift' },
] as const;

/** Changing availability changes who is recommended for new work straight away. */
export function AvailabilityControl({ eventId, current }: { eventId: string; current: string }) {
  const router = useRouter();
  const { toast } = useFeedback();
  const [value, setValue] = useState(current);
  const [busy, setBusy] = useState(false);

  async function choose(next: string) {
    if (next === value) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/events/${eventId}/availability`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ availability: next }),
      });
      const json = (await response.json()) as { ok: true } | { ok: false; error: { message: string } };
      if (!json.ok) {
        toast('error', json.error.message);
        return;
      }
      setValue(next);
      toast('success', `You are now ${OPTIONS.find((o) => o.value === next)?.label.toLowerCase()}.`);
      router.refresh();
    } catch {
      toast('error', 'Availability not changed. Check the connection.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="segmented" role="radiogroup" aria-label="Your availability">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={value === o.value ? 'segmented__item is-active' : 'segmented__item'}
          disabled={busy}
          onClick={() => void choose(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
