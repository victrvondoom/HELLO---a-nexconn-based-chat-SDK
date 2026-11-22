'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useFeedback } from '@/components/ui/Feedback';
import { formatUtc, fromUtcInput, postJson, toUtcInput } from './api';
import type { PlaceVisit } from '@/domain/product';
import type { PlaceListing } from '@/services/places';

/**
 * Visits: places the person checked in to. HELLO records a visit only when the person checks in; nothing is detected
 * from a device. The person can end a visit, correct its times, or delete it, and every change is checked on the server.
 */

interface Props {
  eventId: string;
  listing: PlaceListing;
}

export function PlaceVisits({ eventId, listing }: Props) {
  const router = useRouter();
  const { toast, confirm } = useFeedback();
  const [spaceId, setSpaceId] = useState(listing.spaces[0]?.id ?? '');
  const [placeId, setPlaceId] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [arrived, setArrived] = useState('');
  const [departed, setDeparted] = useState('');

  const spaceName = (id: string) => listing.spaces.find((space) => space.id === id)?.name ?? 'A venue place';

  async function checkIn() {
    if (!spaceId) return;
    setBusy('check-in');
    try {
      const outcome = await postJson(`/api/events/${eventId}/places/visits`, { spaceId, placeId: placeId || null });
      if (!outcome.ok) {
        toast('error', outcome.message);
        return;
      }
      toast('success', `Checked in at ${spaceName(spaceId)}.`);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function act(visit: PlaceVisit, body: Record<string, unknown>, success: string): Promise<boolean> {
    setBusy(visit.id);
    try {
      const outcome = await postJson(`/api/events/${eventId}/places/visits/${visit.id}`, body);
      if (!outcome.ok) {
        toast('error', outcome.message);
        return false;
      }
      toast('success', success);
      router.refresh();
      return true;
    } finally {
      setBusy(null);
    }
  }

  function startEditing(visit: PlaceVisit) {
    setEditing(visit.id);
    setArrived(toUtcInput(visit.arrivedAt));
    setDeparted(visit.departedAt === null ? '' : toUtcInput(visit.departedAt));
  }

  async function saveTimes(visit: PlaceVisit) {
    const arrivedAt = fromUtcInput(arrived);
    const departedAt = departed === '' ? null : fromUtcInput(departed);
    if (!Number.isFinite(arrivedAt)) {
      toast('error', 'Enter the arrival time.');
      return;
    }
    const saved = await act(visit, { action: 'correct', expectedVersion: visit.version, arrivedAt, departedAt }, 'Visit times corrected.');
    if (saved) setEditing(null);
  }

  async function remove(visit: PlaceVisit) {
    const ok = await confirm({
      title: 'Delete this visit?',
      body: `The visit to ${spaceName(visit.spaceId)} on ${formatUtc(visit.arrivedAt)} will be removed from your history.`,
      confirmLabel: 'Delete visit',
      tone: 'danger',
    });
    if (!ok) return;
    setBusy(visit.id);
    try {
      const outcome = await postJson(`/api/events/${eventId}/places/visits/${visit.id}`, { action: 'delete' });
      if (!outcome.ok) {
        toast('error', outcome.message);
        return;
      }
      toast('success', 'Visit deleted.');
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="card" aria-labelledby="visits">
      <div className="card__body stack">
        <h2 id="visits">Where I have been</h2>
        <p className="small muted">
          Check in when you arrive somewhere on the venue map. HELLO does not track your position in the background.
        </p>
        {listing.spaces.length === 0 ? (
          <p className="empty">The venue has no map yet, so there is nowhere to check in to.</p>
        ) : (
          <div className="row">
            <label className="field">
              <span>Check in at</span>
              <select value={spaceId} onChange={(event) => { setSpaceId(event.target.value); }}>
                {listing.spaces.map((space) => (
                  <option key={space.id} value={space.id}>
                    {space.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Linked to one of my places (optional)</span>
              <select value={placeId} onChange={(event) => { setPlaceId(event.target.value); }}>
                <option value="">None</option>
                {listing.places.map((place) => (
                  <option key={place.id} value={place.id}>
                    {place.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="button" disabled={busy !== null} onClick={() => void checkIn()}>
              Check in here
            </button>
          </div>
        )}

        {listing.visits.length === 0 ? (
          <p className="small faint">No visits recorded yet.</p>
        ) : (
          <ul className="stack list-reset" aria-label="Your visits">
            {listing.visits.map((visit) => (
              <li key={visit.id} className="card">
                <div className="card__body stack">
                  <div className="row">
                    <strong>{spaceName(visit.spaceId)}</strong>
                    {visit.departedAt === null ? <span className="badge badge--warning">Here now</span> : <span className="badge">Visited</span>}
                    {visit.correctedAt !== null ? <span className="badge">Times corrected</span> : null}
                  </div>
                  <p className="small muted">
                    Arrived {formatUtc(visit.arrivedAt)}
                    {visit.departedAt !== null ? ` · left ${formatUtc(visit.departedAt)}` : ''}
                  </p>
                  {editing === visit.id ? (
                    <div className="row">
                      <label className="field">
                        <span>Arrived (UTC)</span>
                        <input type="datetime-local" value={arrived} onChange={(event) => { setArrived(event.target.value); }} />
                      </label>
                      <label className="field">
                        <span>Left (UTC, empty if still here)</span>
                        <input type="datetime-local" value={departed} onChange={(event) => { setDeparted(event.target.value); }} />
                      </label>
                      <button type="button" className="button" disabled={busy !== null} onClick={() => void saveTimes(visit)}>
                        Save times
                      </button>
                      <button type="button" className="button button--ghost" onClick={() => { setEditing(null); }}>
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="row">
                      {visit.departedAt === null ? (
                        <button
                          type="button"
                          className="button button--ghost"
                          disabled={busy !== null}
                          onClick={() => void act(visit, { action: 'end', expectedVersion: visit.version }, 'Marked as left.')}
                        >
                          I have left
                        </button>
                      ) : null}
                      <button type="button" className="button button--ghost" disabled={busy !== null} onClick={() => { startEditing(visit); }}>
                        Correct times
                      </button>
                      <button type="button" className="button button--ghost" disabled={busy !== null} onClick={() => void remove(visit)}>
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
