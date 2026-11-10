'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useFeedback } from '@/components/ui/Feedback';

/** Staff propose announcements. Publication waits for another organiser to approve. */
export function AnnouncementForm({ eventId }: { eventId: string }) {
  const router = useRouter();
  const { toast } = useFeedback();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const valid = title.trim().length >= 3 && body.trim().length >= 10;

  async function submit(event: { preventDefault: () => void }) {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await fetch(`/api/events/${eventId}/announcements`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title, body }),
      });
      const json = (await response.json()) as { ok: true } | { ok: false; error: { message: string } };
      if (!json.ok) {
        toast('error', json.error.message);
        return;
      }
      setTitle('');
      setBody('');
      toast('success', 'Sent to organisers for approval. It is not published until another organiser approves it.');
      router.refresh();
    } catch {
      toast('error', 'Not sent. Check the connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" style={{ gap: 12 }} onSubmit={(e) => void submit(e)}>
      <div className="field">
        <label htmlFor="ann-title">Title</label>
        <input id="ann-title" value={title} maxLength={160} onChange={(e) => { setTitle(e.target.value); }} />
      </div>
      <div className="field">
        <label htmlFor="ann-body">Message</label>
        <textarea id="ann-body" rows={4} value={body} maxLength={4000} onChange={(e) => { setBody(e.target.value); }} />
      </div>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="xs faint">Needs approval from a second organiser before it is published.</span>
        <button type="submit" className="button" disabled={!valid || busy}>
          {busy ? 'Sending…' : 'Request publication'}
        </button>
      </div>
    </form>
  );
}
