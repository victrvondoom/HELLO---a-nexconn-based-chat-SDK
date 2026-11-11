'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useFeedback } from '@/components/ui/Feedback';

interface Rel {
  following: boolean;
  followsYou: boolean;
  connected: boolean;
}

/** Follow, follow back, or unfollow. The server decides whether the follow is allowed. */
export function FollowButton({ eventId, userId, name, initial, size = 'md' }: { eventId: string; userId: string; name: string; initial: Rel; size?: 'sm' | 'md' }) {
  const router = useRouter();
  const { toast } = useFeedback();
  const [rel, setRel] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    const next = !rel.following;
    // Optimistic: the button answers at once, and is put back if the server says no.
    const previous = rel;
    setRel({ ...rel, following: next, connected: next && rel.followsYou });
    try {
      const response = await fetch(`/api/events/${eventId}/people/${userId}/follow`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ follow: next }),
      });
      const body = (await response.json()) as { ok: true; data: Rel } | { ok: false; error: { message: string } };
      if (!body.ok) {
        setRel(previous);
        toast('error', body.error.message);
        return;
      }
      setRel(body.data);
      if (body.data.connected && next) toast('success', `You and ${name} are now connected.`);
      router.refresh();
    } catch {
      setRel(previous);
      toast('error', 'Could not reach the server. Try again.');
    } finally {
      setBusy(false);
    }
  }

  const label = rel.following ? (rel.connected ? 'Connected' : 'Following') : rel.followsYou ? 'Follow back' : 'Follow';
  return (
    <button
      type="button"
      className={`${rel.following ? 'button button--ghost' : 'button'}${size === 'sm' ? ' button--sm' : ''} follow-button`}
      onClick={() => void toggle()}
      disabled={busy}
      aria-pressed={rel.following}
      aria-label={rel.following ? `Unfollow ${name}` : `${label} ${name}`}
      data-state={rel.following ? 'on' : 'off'}
    >
      <span className="follow-button__label">{label}</span>
      {rel.following ? <span className="follow-button__hover">Unfollow</span> : null}
    </button>
  );
}
