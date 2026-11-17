'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type SyntheticEvent } from 'react';
import { api, errorText, useLive } from '@/components/live/client';
import { useFeedback } from '@/components/ui/Feedback';
import type { CommunityView } from '@/services/communities';

interface Country {
  code: string;
  name: string;
}

export function CommunityActions({ eventId, community, onChanged }: { eventId: string; community: CommunityView; onChanged?: () => Promise<void> }) {
  const router = useRouter();
  const { toast } = useFeedback();
  const [busy, setBusy] = useState(false);
  const act = async (action: 'join' | 'leave' | 'delete') => {
    setBusy(true);
    try {
      await api(`/api/events/${eventId}/communities/${community.id}`, 'POST', { action });
      if (action === 'delete') router.push(`/events/${eventId}/communities`);
      await onChanged?.();
      router.refresh();
    } catch (e: unknown) {
      toast('error', errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="row" style={{ gap: 6 }}>
      {community.isOwner ? (
        <span className="badge badge--accent">You run this</span>
      ) : (
        <button type="button" className={community.joined ? 'button button--ghost button--sm' : 'button button--sm'} disabled={busy} onClick={() => void act(community.joined ? 'leave' : 'join')}>
          {community.joined ? 'Leave' : 'Join'}
        </button>
      )}
      {community.canDelete ? (
        <button type="button" className="button button--quiet-danger button--sm" disabled={busy} onClick={() => void act('delete')}>
          Delete
        </button>
      ) : null}
    </span>
  );
}

export function Communities({ eventId, initial, countries, canCreate }: { eventId: string; initial: CommunityView[]; countries: Country[]; canCreate: boolean }) {
  const { data, refresh } = useLive(`/api/events/${eventId}/communities`, { communities: initial }, 10_000);
  const { toast } = useFeedback();
  const countryName = new Map(countries.map((c) => [c.code, c.name]));

  async function create(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    try {
      await api(`/api/events/${eventId}/communities`, 'POST', { name: values.get('name'), description: values.get('description'), country: values.get('country') || null });
      form.reset();
      toast('success', 'Community created.');
      await refresh();
    } catch (e: unknown) {
      toast('error', errorText(e));
    }
  }

  return (
    <div className="stack" style={{ gap: 20 }}>
      {canCreate ? (
        <form className="panel panel__body inline-form" onSubmit={(e) => void create(e)} aria-label="Start a community">
          <label className="field">
            <span className="label">Name</span>
            <input name="name" required minLength={3} maxLength={60} />
          </label>
          <label className="field" style={{ flexGrow: 2 }}>
            <span className="label">What it is for</span>
            <input name="description" maxLength={300} />
          </label>
          <label className="field">
            <span className="label">Country (optional)</span>
            <select name="country" defaultValue="">
              <option value="">Worldwide</option>
              {countries.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="button">
            Start community
          </button>
        </form>
      ) : null}
      {data.communities.length === 0 ? (
        <div className="empty">
          <strong>No communities yet</strong>
          <p>Start one for a topic, a team or a country.</p>
        </div>
      ) : (
        <div className="tile-grid">
          {data.communities.map((c) => (
            <article key={c.id} className="panel tile">
              <h3>
                <Link href={`/events/${eventId}/communities/${c.id}`}>{c.name}</Link>
              </h3>
              {c.description ? <p className="small muted" style={{ margin: 0 }}>{c.description}</p> : null}
              <div className="tile__foot">
                <span className="xs faint">
                  {c.members} {c.members === 1 ? 'member' : 'members'} · {c.country ? (countryName.get(c.country) ?? 'Worldwide') : 'Worldwide'}
                </span>
                <CommunityActions eventId={eventId} community={c} onChanged={refresh} />
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

export function StartCallButton({ eventId, communityId, title }: { eventId: string; communityId: string | null; title: string }) {
  const router = useRouter();
  const { toast } = useFeedback();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="button button--sm"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        api<{ id: string }>(`/api/events/${eventId}/calls`, 'POST', { title, communityId })
          .then((call) => { router.push(`/events/${eventId}/calls/${call.id}`); })
          .catch((e: unknown) => {
            toast('error', errorText(e));
            setBusy(false);
          });
      }}
    >
      Start a call
    </button>
  );
}
