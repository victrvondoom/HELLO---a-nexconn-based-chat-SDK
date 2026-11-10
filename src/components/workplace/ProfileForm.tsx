'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useFeedback } from '@/components/ui/Feedback';

interface Props {
  initial: { displayName: string; interests: string[]; discoverable: boolean; accessibilityRequired: boolean };
}

/**
 * Consent controls. Turning discoverability off removes the person from people search immediately,
 * which the server enforces on every search.
 */
export function ProfileForm({ initial }: Props) {
  const router = useRouter();
  const { toast } = useFeedback();
  const [name, setName] = useState(initial.displayName);
  const [interests, setInterests] = useState(initial.interests.join(', '));
  const [discoverable, setDiscoverable] = useState(initial.discoverable);
  const [access, setAccess] = useState(initial.accessibilityRequired);
  const [busy, setBusy] = useState(false);

  const list = interests.split(',').map((s) => s.trim()).filter(Boolean);
  const dirty =
    name !== initial.displayName ||
    list.join('|') !== initial.interests.join('|') ||
    discoverable !== initial.discoverable ||
    access !== initial.accessibilityRequired;

  async function save(event: { preventDefault: () => void }) {
    event.preventDefault();
    if (name.trim().length === 0) {
      toast('error', 'Your name cannot be empty.');
      return;
    }
    setBusy(true);
    try {
      const response = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ displayName: name, interests: list, discoverable, accessibilityRequired: access }),
      });
      const json = (await response.json()) as { ok: true } | { ok: false; error: { message: string } };
      if (!json.ok) {
        toast('error', json.error.message);
        return;
      }
      toast('success', discoverable ? 'Profile saved. You appear in people search.' : 'Profile saved. You are hidden from people search.');
      router.refresh();
    } catch {
      toast('error', 'Profile not saved. Check the connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" style={{ gap: 16 }} onSubmit={(e) => void save(e)}>
      <div className="field">
        <label htmlFor="profile-name">Name shown to others</label>
        <input id="profile-name" value={name} maxLength={80} onChange={(e) => { setName(e.target.value); }} />
      </div>
      <div className="field">
        <label htmlFor="profile-interests">Interests and expertise</label>
        <input
          id="profile-interests"
          value={interests}
          placeholder="For example: audio systems, staging"
          onChange={(e) => { setInterests(e.target.value); }}
          aria-describedby="interests-help"
        />
        <span id="interests-help" className="xs faint">
          Comma-separated. These are the only things people search matches against.
        </span>
      </div>
      <label className="toggle">
        <input type="checkbox" checked={discoverable} onChange={(e) => { setDiscoverable(e.target.checked); }} />
        <span>
          <strong>Appear in people search</strong>
          <span className="xs faint" style={{ display: 'block' }}>
            Others can find you by your declared interests. Your contact details are never shown.
          </span>
        </span>
      </label>
      <label className="toggle">
        <input type="checkbox" checked={access} onChange={(e) => { setAccess(e.target.checked); }} />
        <span>
          <strong>I need accessible routes and seating</strong>
          <span className="xs faint" style={{ display: 'block' }}>
            Session recommendations will only offer accessible rooms to you.
          </span>
        </span>
      </label>
      <div className="row">
        <button type="submit" className="button" disabled={busy || !dirty}>
          {busy ? 'Saving…' : 'Save profile'}
        </button>
        {!dirty ? <span className="xs faint">No changes to save</span> : null}
      </div>
    </form>
  );
}
