'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useFeedback } from '@/components/ui/Feedback';

type Visibility = 'EVENT' | 'CONNECTIONS' | 'ONLY_ME';

const OPTIONS: Array<{ value: Visibility; label: string; hint: string }> = [
  { value: 'EVENT', label: 'Everyone at the event', hint: 'Anyone who can see you in People.' },
  { value: 'CONNECTIONS', label: 'Connections only', hint: 'People you follow who also follow you.' },
  { value: 'ONLY_ME', label: 'Only me', hint: 'Nobody else sees your headline or bio.' },
];

export function ProfileTextForm({ initial }: { initial: { headline: string; bio: string; visibility: Visibility } }) {
  const router = useRouter();
  const { toast } = useFeedback();
  const [headline, setHeadline] = useState(initial.headline);
  const [bio, setBio] = useState(initial.bio);
  const [visibility, setVisibility] = useState<Visibility>(initial.visibility);
  const [busy, setBusy] = useState(false);
  const dirty = headline !== initial.headline || bio !== initial.bio || visibility !== initial.visibility;

  async function save(event: { preventDefault: () => void }) {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await fetch('/api/me/profile', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ headline, bio, visibility }),
      });
      const body = (await response.json()) as { ok: boolean; error?: { message: string } };
      if (!body.ok) {
        toast('error', body.error?.message ?? 'Not saved.');
        return;
      }
      toast('success', 'Profile saved and encrypted at rest.');
      router.refresh();
    } catch {
      toast('error', 'Could not reach the server. Your text is still here.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={(e) => void save(e)}>
      <div className="field">
        <label htmlFor="pf-headline">Headline</label>
        <input id="pf-headline" value={headline} maxLength={120} onChange={(e) => { setHeadline(e.target.value); }} placeholder="What you do, in a line" />
      </div>
      <div className="field">
        <label htmlFor="pf-bio">About you</label>
        <textarea id="pf-bio" value={bio} maxLength={600} rows={4} onChange={(e) => { setBio(e.target.value); }} placeholder="What you are here for, and what you would like to talk about" />
        <span className="xs faint">{bio.length}/600</span>
      </div>
      <fieldset className="field" style={{ border: 'none', padding: 0, margin: 0 }}>
        <legend className="label">Who can read it</legend>
        <div className="choice-grid">
          {OPTIONS.map((o) => (
            <label key={o.value} className={visibility === o.value ? 'choice is-active' : 'choice'}>
              <input type="radio" name="pf-visibility" value={o.value} checked={visibility === o.value} onChange={() => { setVisibility(o.value); }} />
              <strong>{o.label}</strong>
              <span className="xs muted">{o.hint}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="xs faint">Stored encrypted (AES-256-GCM), bound to your account.</span>
        <button type="submit" className="button" disabled={busy || !dirty}>
          {busy ? 'Saving…' : 'Save public profile'}
        </button>
      </div>
    </form>
  );
}
