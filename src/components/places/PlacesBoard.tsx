'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useFeedback } from '@/components/ui/Feedback';
import {
  MAX_PLACE_ADDRESS,
  MAX_PLACE_DESCRIPTION,
  PLACE_CATEGORY_LABEL,
  PLACE_CATEGORY_VALUES,
  PLACE_STATUS_LABEL,
  PLACE_STATUS_VALUES,
  filterPlaces,
} from '@/domain/places/rules';
import type { PlaceCategory, PlaceCollection, PlaceStatus } from '@/domain/product';
import type { PlaceListing, PlaceView } from '@/services/places';
import { PlaceCapture } from './PlaceCapture';
import { PlaceVisits } from './PlaceVisits';

/**
 * My places: the person's own private place memory for this event. Every control posts to a route that checks
 * ownership on the server; hiding anything here is never the security boundary. The list is the primary view;
 * the plan is a supplement that pins places in the venue.
 */

interface Props {
  eventId: string;
  initial: PlaceListing;
}

type Outcome = { ok: true; data: unknown } | { ok: false; message: string };

async function send(url: string, body: unknown): Promise<Outcome> {
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const json = (await response.json()) as { ok: true; data: unknown } | { ok: false; error: { message: string } };
  return json.ok ? { ok: true, data: json.data } : { ok: false, message: json.error.message };
}

interface FormState {
  name: string;
  description: string;
  category: PlaceCategory;
  status: PlaceStatus;
  favourite: boolean;
  rating: string;
  spaceId: string;
  latitude: string;
  longitude: string;
  address: string;
  tags: string;
  privateNote: string;
  collectionIds: string[];
}

function formFrom(place: PlaceView | null): FormState {
  return {
    name: place?.name ?? '',
    description: place?.description ?? '',
    category: place?.category ?? 'FOOD',
    status: place?.status ?? 'SAVED',
    favourite: place?.favourite ?? false,
    rating: place?.rating ? String(place.rating) : '',
    spaceId: place?.spaceId ?? '',
    latitude: place?.latitude !== null && place?.latitude !== undefined ? String(place.latitude) : '',
    longitude: place?.longitude !== null && place?.longitude !== undefined ? String(place.longitude) : '',
    address: place?.address ?? '',
    tags: place?.tags.join(', ') ?? '',
    privateNote: place?.privateNote ?? '',
    collectionIds: place?.collectionIds ?? [],
  };
}

function toPayload(form: FormState) {
  const num = (value: string): number | null => (value.trim() === '' ? null : Number(value));
  return {
    name: form.name,
    description: form.description.trim() === '' ? null : form.description,
    category: form.category,
    status: form.status,
    favourite: form.favourite,
    rating: num(form.rating),
    spaceId: form.spaceId === '' ? null : form.spaceId,
    latitude: num(form.latitude),
    longitude: num(form.longitude),
    address: form.address.trim() === '' ? null : form.address,
    tags: form.tags.split(',').map((tag) => tag.trim()).filter((tag) => tag.length > 0),
    privateNote: form.privateNote.trim() === '' ? null : form.privateNote,
    collectionIds: form.collectionIds,
  };
}

function centroid(outline: ReadonlyArray<readonly [number, number]>): [number, number] {
  const x = outline.reduce((sum, [px]) => sum + px, 0) / Math.max(1, outline.length);
  const y = outline.reduce((sum, [, py]) => sum + py, 0) / Math.max(1, outline.length);
  return [x, y];
}

function PlaceForm({
  eventId,
  listing,
  place,
  onDone,
}: {
  eventId: string;
  listing: PlaceListing;
  place: PlaceView | null;
  onDone: () => void;
}) {
  const router = useRouter();
  const { toast } = useFeedback();
  const [form, setForm] = useState<FormState>(() => formFrom(place));
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => { setForm((state) => ({ ...state, [key]: value })); };

  async function submit() {
    setBusy(true);
    try {
      const payload = toPayload(form);
      const outcome = place
        ? await send(`/api/events/${eventId}/places/${place.id}`, { action: 'update', expectedVersion: place.version, patch: payload })
        : await send(`/api/events/${eventId}/places`, payload);
      if (!outcome.ok) {
        toast('error', outcome.message);
        return;
      }
      toast('success', place ? 'Place updated.' : 'Place saved to My places.');
      onDone();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="stack"
      aria-label={place ? 'Edit place' : 'New place'}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <label className="field">
        <span>Name</span>
        <input value={form.name} maxLength={80} required onChange={(event) => { set('name', event.target.value); }} />
      </label>
      <div className="row">
        <label className="field">
          <span>Kind</span>
          <select value={form.category} onChange={(event) => { set('category', event.target.value as PlaceCategory); }}>
            {PLACE_CATEGORY_VALUES.map((value) => (
              <option key={value} value={value}>
                {PLACE_CATEGORY_LABEL[value]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Status</span>
          <select value={form.status} onChange={(event) => { set('status', event.target.value as PlaceStatus); }}>
            {PLACE_STATUS_VALUES.map((value) => (
              <option key={value} value={value}>
                {PLACE_STATUS_LABEL[value]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Rating</span>
          <select value={form.rating} onChange={(event) => { set('rating', event.target.value); }}>
            <option value="">Not rated</option>
            {[1, 2, 3, 4, 5].map((value) => (
              <option key={value} value={value}>
                {value} of 5
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="field">
        <span>On the venue map</span>
        <select value={form.spaceId} onChange={(event) => { set('spaceId', event.target.value); }}>
          <option value="">Not on the venue map</option>
          {listing.spaces.map((space) => (
            <option key={space.id} value={space.id}>
              {space.name}
            </option>
          ))}
        </select>
      </label>
      <div className="row">
        <label className="field">
          <span>Latitude (optional)</span>
          <input inputMode="decimal" value={form.latitude} onChange={(event) => { set('latitude', event.target.value); }} />
        </label>
        <label className="field">
          <span>Longitude (optional)</span>
          <input inputMode="decimal" value={form.longitude} onChange={(event) => { set('longitude', event.target.value); }} />
        </label>
      </div>
      <label className="field">
        <span>Address (optional)</span>
        <input value={form.address} maxLength={MAX_PLACE_ADDRESS} onChange={(event) => { set('address', event.target.value); }} />
      </label>
      <label className="field">
        <span>Description (optional)</span>
        <textarea rows={2} value={form.description} maxLength={MAX_PLACE_DESCRIPTION} onChange={(event) => { set('description', event.target.value); }} />
      </label>
      <label className="field">
        <span>Tags, separated by commas (optional)</span>
        <input value={form.tags} onChange={(event) => { set('tags', event.target.value); }} />
      </label>
      <label className="field">
        <span>Private note. Only you can see this.</span>
        <textarea rows={2} value={form.privateNote} onChange={(event) => { set('privateNote', event.target.value); }} />
      </label>
      <label className="row">
        <input type="checkbox" checked={form.favourite} onChange={(event) => { set('favourite', event.target.checked); }} />
        <span>Favourite</span>
      </label>
      {listing.collections.length > 0 ? (
        <fieldset className="stack">
          <legend>Collections</legend>
          {listing.collections.map((collection) => (
            <label key={collection.id} className="row">
              <input
                type="checkbox"
                checked={form.collectionIds.includes(collection.id)}
                onChange={(event) => { set(
                    'collectionIds',
                    event.target.checked ? [...form.collectionIds, collection.id] : form.collectionIds.filter((id) => id !== collection.id),
                  ); }
                }
              />
              <span>{collection.name}</span>
            </label>
          ))}
        </fieldset>
      ) : null}
      <div className="row">
        <button type="submit" className="button" disabled={busy || form.name.trim().length === 0}>
          {busy ? 'Saving…' : place ? 'Save changes' : 'Save place'}
        </button>
        <button type="button" className="button button--ghost" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function PlacesBoard({ eventId, initial }: Props) {
  const router = useRouter();
  const { toast, confirm } = useFeedback();
  const [editing, setEditing] = useState<PlaceView | 'new' | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<PlaceStatus | ''>('');
  const [favouritesOnly, setFavouritesOnly] = useState(false);
  const [collectionId, setCollectionId] = useState('');
  const [floor, setFloor] = useState<number>(initial.spaces[0]?.floor ?? 0);
  const [selected, setSelected] = useState<string | null>(null);
  const [newCollection, setNewCollection] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const visible = useMemo(
    () => filterPlaces(initial.places, { status: status || null, favouritesOnly, collectionId: collectionId || null, query }),
    [initial.places, status, favouritesOnly, collectionId, query],
  );
  const floors = useMemo(() => [...new Set(initial.spaces.map((space) => space.floor))].sort(), [initial.spaces]);
  const onPlan = visible.filter((place) => place.spaceId !== null && initial.spaces.some((space) => space.id === place.spaceId));
  const selectedPlace = initial.places.find((place) => place.id === selected) ?? null;

  async function run(key: string, action: () => Promise<Outcome>, success: string): Promise<boolean> {
    setBusy(key);
    try {
      const outcome = await action();
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

  function quickUpdate(place: PlaceView, patch: Record<string, unknown>, success: string) {
    void run(`place:${place.id}`, () => send(`/api/events/${eventId}/places/${place.id}`, { action: 'update', expectedVersion: place.version, patch }), success);
  }

  async function remove(place: PlaceView) {
    const ok = await confirm({
      title: 'Delete this place?',
      body: `“${place.name}” and its private note will be removed. This cannot be undone.`,
      confirmLabel: 'Delete place',
      tone: 'danger',
    });
    if (!ok) return;
    if (selected === place.id) setSelected(null);
    await run(`delete:${place.id}`, () => send(`/api/events/${eventId}/places/${place.id}`, { action: 'delete' }), 'Place deleted.');
  }

  async function addCollection() {
    const name = newCollection.trim();
    if (name.length === 0) return;
    const created = await run('collection', () => send(`/api/events/${eventId}/places/collections`, { name }), 'Collection created.');
    if (created) setNewCollection('');
  }

  async function removeCollection(collection: PlaceCollection) {
    const ok = await confirm({
      title: `Delete the “${collection.name}” collection?`,
      body: 'Its places stay in My places. Only the grouping is removed.',
      confirmLabel: 'Delete collection',
      tone: 'danger',
    });
    if (!ok) return;
    if (collectionId === collection.id) setCollectionId('');
    await run(`collection:${collection.id}`, () => send(`/api/events/${eventId}/places/collections/${collection.id}`, {}), 'Collection deleted.');
  }

  const atLimit = initial.places.length >= initial.limits.places;

  return (
    <div className="stack">
      <div className="row">
        <button type="button" className="button" disabled={atLimit} onClick={() => { setEditing('new'); }}>
          Add a place
        </button>
        <span className="small muted">
          {initial.places.length} of {initial.limits.places} places · {initial.collections.length} collections
        </span>
      </div>

      {editing ? (
        <section className="card" aria-labelledby="place-editor">
          <div className="card__body stack">
            <h2 id="place-editor">{editing === 'new' ? 'Add a place' : 'Edit place'}</h2>
            <PlaceForm eventId={eventId} listing={initial} place={editing === 'new' ? null : editing} onDone={() => { setEditing(null); }} />
          </div>
        </section>
      ) : null}

      <PlaceCapture eventId={eventId} listing={initial} />

      <PlaceVisits eventId={eventId} listing={initial} />

      <section className="card" aria-labelledby="filters">
        <div className="card__body stack">
          <h2 id="filters">Find a place</h2>
          <div className="row">
            <label className="field">
              <span>Search</span>
              <input value={query} onChange={(event) => { setQuery(event.target.value); }} placeholder="Name, tag, kind or address" />
            </label>
            <label className="field">
              <span>Status</span>
              <select value={status} onChange={(event) => { setStatus(event.target.value as PlaceStatus | ''); }}>
                <option value="">All</option>
                {PLACE_STATUS_VALUES.map((value) => (
                  <option key={value} value={value}>
                    {PLACE_STATUS_LABEL[value]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Collection</span>
              <select value={collectionId} onChange={(event) => { setCollectionId(event.target.value); }}>
                <option value="">All collections</option>
                {initial.collections.map((collection) => (
                  <option key={collection.id} value={collection.id}>
                    {collection.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="row">
              <input type="checkbox" checked={favouritesOnly} onChange={(event) => { setFavouritesOnly(event.target.checked); }} />
              <span>Favourites only</span>
            </label>
          </div>
          <div className="row">
            <label className="field">
              <span>New collection</span>
              <input value={newCollection} maxLength={60} placeholder="e.g. Food to try" onChange={(event) => { setNewCollection(event.target.value); }} />
            </label>
            <button type="button" className="button button--ghost" disabled={busy !== null || newCollection.trim().length === 0} onClick={() => void addCollection()}>
              Create collection
            </button>
          </div>
          {initial.collections.length > 0 ? (
            <ul className="row list-reset" aria-label="Your collections">
              {initial.collections.map((collection) => (
                <li key={collection.id} className="row">
                  <span className="badge">{collection.name}</span>
                  <button type="button" className="button button--ghost" disabled={busy !== null} onClick={() => void removeCollection(collection)}>
                    Delete {collection.name}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </section>

      <section className="card" aria-labelledby="place-list">
        <div className="card__body stack">
          <h2 id="place-list">Places ({visible.length} shown)</h2>
          {initial.places.length === 0 ? (
            <div className="empty">
              <strong>No places yet</strong>
              <span>Add a place you want to remember. Pin it to the venue map if it is inside the event.</span>
            </div>
          ) : visible.length === 0 ? (
            <p className="empty">No place matches these filters.</p>
          ) : (
            <ul className="stack list-reset">
              {visible.map((place) => (
                <li key={place.id} className="card">
                  <div className="card__body stack">
                    <div className="row">
                      <button type="button" className="button button--ghost" aria-pressed={selected === place.id} onClick={() => { setSelected(place.id); }}>
                        {place.favourite ? '★ ' : ''}
                        {place.name}
                      </button>
                      <span className="badge">{PLACE_CATEGORY_LABEL[place.category]}</span>
                      <span className="badge">{PLACE_STATUS_LABEL[place.status]}</span>
                      {place.rating ? <span className="badge">{place.rating} of 5</span> : null}
                    </div>
                    <p className="small muted">
                      {place.spaceId ? (initial.spaces.find((space) => space.id === place.spaceId)?.name ?? 'On the venue map') : 'Not on the venue map'}
                      {place.address ? ` · ${place.address}` : ''}
                      {place.latitude !== null && place.longitude !== null ? ` · ${place.latitude}, ${place.longitude}` : ''}
                    </p>
                    {place.description ? <p className="small">{place.description}</p> : null}
                    {place.tags.length > 0 ? <p className="small faint">{place.tags.map((tag) => `#${tag}`).join(' ')}</p> : null}
                    {place.privateNote ? (
                      <p className="small">
                        <strong>Your note:</strong> {place.privateNote}
                      </p>
                    ) : null}
                    <div className="row">
                      <button
                        type="button"
                        className="button button--ghost"
                        disabled={busy !== null}
                        onClick={() => { quickUpdate(place, { favourite: !place.favourite }, place.favourite ? 'Removed from favourites.' : 'Added to favourites.'); }}
                      >
                        {place.favourite ? 'Unfavourite' : 'Favourite'}
                      </button>
                      <label className="row">
                        <span className="small">Status</span>
                        <select value={place.status} disabled={busy !== null} onChange={(event) => { quickUpdate(place, { status: event.target.value }, 'Status updated.'); }}>
                          {PLACE_STATUS_VALUES.map((value) => (
                            <option key={value} value={value}>
                              {PLACE_STATUS_LABEL[value]}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button type="button" className="button button--ghost" onClick={() => { setEditing(place); }}>
                        Edit
                      </button>
                      <button type="button" className="button button--ghost" disabled={busy !== null} onClick={() => void remove(place)}>
                        Delete
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="card" aria-labelledby="place-plan">
        <div className="card__body stack">
          <h2 id="place-plan">On the venue map</h2>
          {initial.spaces.length === 0 ? (
            <p className="empty">The venue has no map yet, so places can only be listed.</p>
          ) : (
            <>
              <div className="row">
                {floors.map((value) => (
                  <button key={value} type="button" className="button button--ghost" aria-pressed={floor === value} onClick={() => { setFloor(value); }}>
                    Floor {value + 1}
                  </button>
                ))}
              </div>
              <PlanSvg
                spaces={initial.spaces.filter((space) => space.floor === floor)}
                pins={onPlan.filter((place) => initial.spaces.find((space) => space.id === place.spaceId)?.floor === floor)}
                selected={selected}
                onSelect={setSelected}
              />
              {selectedPlace ? (
                <p className="small">
                  Selected: <strong>{selectedPlace.name}</strong>
                </p>
              ) : (
                <p className="small faint">Select a place in the list or on the plan to see it here.</p>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}

function PlanSvg({
  spaces,
  pins,
  selected,
  onSelect,
}: {
  spaces: PlaceListing['spaces'];
  pins: PlaceView[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const points = spaces.flatMap((space) => space.outline);
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const minX = Math.min(0, ...xs) - 2;
  const minY = Math.min(0, ...ys) - 2;
  const width = Math.max(...xs, 10) - minX + 2;
  const height = Math.max(...ys, 10) - minY + 2;
  return (
    <svg role="img" aria-label="Venue plan with your places pinned" viewBox={`${minX} ${minY} ${width} ${height}`} style={{ width: '100%', maxWidth: 720, height: 'auto' }}>
      {spaces.map((space) => (
        <polygon key={space.id} points={space.outline.map(([x, y]) => `${x},${y}`).join(' ')} fill="#f3f4f6" stroke="#6b7280" strokeOpacity={0.5} strokeWidth={0.4}>
          <title>{space.name}</title>
        </polygon>
      ))}
      {pins.map((place) => {
        const space = spaces.find((candidate) => candidate.id === place.spaceId);
        if (!space) return null;
        const [cx, cy] = centroid(space.outline);
        const isSelected = selected === place.id;
        return (
          <g key={place.id} onClick={() => { onSelect(place.id); }} style={{ cursor: 'pointer' }}>
            <circle cx={cx} cy={cy} r={isSelected ? 2.6 : 2} fill={isSelected ? '#111827' : '#2563eb'} />
            <title>{place.name}</title>
          </g>
        );
      })}
    </svg>
  );
}
