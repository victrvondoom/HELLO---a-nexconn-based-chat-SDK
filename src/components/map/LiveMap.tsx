'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ago, api, errorText, useLive } from '@/components/live/client';
import { useFeedback } from '@/components/ui/Feedback';
import type { MapPerson } from '@/services/location';

interface Shape {
  code: string;
  name: string;
  d: string;
}
interface MapData {
  now: number;
  me: MapPerson | null;
  people: MapPerson[];
  countries: Array<{ code: string; name: string; members: number }>;
  /** Countries with fewer than `minGroupSize` people, held back so a count cannot identify someone. */
  hiddenCountries: number;
  minGroupSize: number;
  myCountry: string | null;
}
type Audience = 'CONNECTIONS' | 'EVENT';

const W = 960;
const H = 480;

/**
 * World map with countries shaded by how many people at the event come from them, and a dot for
 * each person who chose to share a live location with you. Sharing is off until you turn it on.
 */
export function LiveMap({ eventId, shapes, initial }: { eventId: string; shapes: Shape[]; initial: MapData }) {
  const url = `/api/events/${eventId}/location`;
  const { toast } = useFeedback();
  const { data, refresh } = useLive<MapData>(url, initial, 5000);
  const [audience, setAudience] = useState<Audience>('CONNECTIONS');
  const [approximate, setApproximate] = useState(true);
  const [minutes, setMinutes] = useState<15 | 60 | 240>(60);
  const [focus, setFocus] = useState<{ x: number; y: number } | null>(null);
  const [starting, setStarting] = useState(false);
  const watch = useRef<number | null>(null);
  const lastSent = useRef(0);
  const settings = useRef({ audience, approximate, minutes });
  settings.current = { audience, approximate, minutes };

  const stopWatching = useCallback(() => {
    if (watch.current !== null) navigator.geolocation.clearWatch(watch.current);
    watch.current = null;
  }, []);
  useEffect(() => stopWatching, [stopWatching]);

  const sendPosition = useCallback(
    async (position: GeolocationPosition, force: boolean) => {
      if (!force && Date.now() - lastSent.current < 20_000) return;
      lastSent.current = Date.now();
      await api(url, 'POST', { ...settings.current, lat: position.coords.latitude, lng: position.coords.longitude });
      await refresh();
    },
    [refresh, url],
  );

  function start() {
    if (!('geolocation' in navigator)) {
      toast('error', 'This browser cannot share a location.');
      return;
    }
    setStarting(true);
    stopWatching();
    let first = true;
    watch.current = navigator.geolocation.watchPosition(
      (position) => {
        const force = first;
        first = false;
        sendPosition(position, force)
          .then(() => {
            if (force) toast('success', 'Your live location is now shared.');
          })
          .catch((e: unknown) => {
            // The share ended or was refused: stop asking the device for positions.
            stopWatching();
            toast('error', errorText(e));
          })
          .finally(() => { setStarting(false); });
      },
      () => {
        stopWatching();
        setStarting(false);
        toast('error', 'Location permission was not given, so nothing is shared.');
      },
      { enableHighAccuracy: !settings.current.approximate, maximumAge: 15_000 },
    );
  }

  async function stop() {
    stopWatching();
    try {
      await api(url, 'DELETE');
      toast('success', 'Location sharing stopped.');
      await refresh();
    } catch (e: unknown) {
      toast('error', errorText(e));
    }
  }

  async function saveCountry(country: string) {
    try {
      await api('/api/me/country', 'POST', { country: country || null });
      await refresh();
    } catch (e: unknown) {
      toast('error', errorText(e));
    }
  }

  const members = new Map(data.countries.map((c) => [c.code, c.members]));
  const zoom = 5;
  const viewBox = focus ? `${Math.min(W - W / zoom, Math.max(0, focus.x - W / zoom / 2))} ${Math.min(H - H / zoom, Math.max(0, focus.y - H / zoom / 2))} ${W / zoom} ${H / zoom}` : `0 0 ${W} ${H}`;
  const r = focus ? 1.6 : 5;

  return (
    <div className="split">
      <div className="stack" style={{ gap: 12 }}>
        <svg className="world" viewBox={viewBox} role="img" aria-label={`World map. ${data.people.length} live locations visible to you, ${data.countries.length} countries represented.`}>
          {shapes.map((s) => {
            const n = members.get(s.code) ?? 0;
            return (
              <path key={s.code} d={s.d} className={`${n >= 5 ? 'has-3' : n >= 2 ? 'has-2' : n === 1 ? 'has-1' : ''}${data.myCountry === s.code ? ' is-mine' : ''}`}>
                <title>{n > 0 ? `${s.name}: ${n} ${n === 1 ? 'person' : 'people'}` : s.name}</title>
              </path>
            );
          })}
          {data.people.map((p) => (
            <g key={p.userId}>
              <circle className="dot-halo" cx={p.x} cy={p.y} r={r * 2} />
              <circle className={p.isSelf ? 'dot dot--self' : 'dot'} cx={p.x} cy={p.y} r={r}>
                <title>{p.isSelf ? 'You' : p.name}</title>
              </circle>
            </g>
          ))}
        </svg>
        <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
          <span className="small muted">Shading shows how many people declared each country. Dots are people sharing a live location with you.</span>
          {focus ? (
            <button type="button" className="button button--ghost button--sm" onClick={() => { setFocus(null); }}>
              Whole world
            </button>
          ) : null}
        </div>
        <section className="panel" aria-labelledby="live-people">
          <div className="panel__head">
            <h2 id="live-people">Sharing with you now</h2>
            <span className="live" role="status">
              <span className="live__dot" aria-hidden="true" />
              Live · every 5s
            </span>
          </div>
          {data.people.length === 0 ? (
            <p className="panel__body small muted" style={{ margin: 0 }}>
              Nobody is sharing a location with you right now.
            </p>
          ) : (
            <ul className="score-list">
              {data.people.map((p) => (
                <li key={p.userId}>
                  <span>
                    <strong>{p.isSelf ? 'You' : p.name}</strong>{' '}
                    <span className="muted">
                      · {p.approximate ? 'approximate area' : 'exact'} · updated {ago(data.now, p.updatedAt)} · {p.audience === 'EVENT' ? 'everyone at the event' : 'connections only'}
                    </span>
                  </span>
                  <span className="row" style={{ gap: 6 }}>
                    <button type="button" className="button button--ghost button--sm" onClick={() => { setFocus({ x: p.x, y: p.y }); }}>
                      Show
                    </button>
                    <a className="button button--ghost button--sm" href={`https://maps.apple.com/?ll=${p.lat},${p.lng}&q=${encodeURIComponent(p.isSelf ? 'My location' : p.name)}`} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">
                      Open in Apple Maps
                    </a>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="stack" style={{ gap: 16 }}>
        <section className="panel" aria-labelledby="share-heading">
          <div className="panel__head">
            <h2 id="share-heading">Your live location</h2>
            <span className={data.me ? 'badge badge--success' : 'badge'}>{data.me ? 'Sharing' : 'Off'}</span>
          </div>
          <div className="panel__body stack">
            {data.me ? (
              <>
                <p className="small" style={{ margin: 0 }}>
                  Visible to {data.me.audience === 'EVENT' ? 'everyone at this event' : 'your connections only'}, {data.me.approximate ? 'rounded to about a kilometre' : 'at exact precision'}. Stops by itself in {Math.max(1, Math.round((data.me.expiresAt - data.now) / 60_000))} min.
                </p>
                <button type="button" className="button button--danger" onClick={() => void stop()}>
                  Stop sharing now
                </button>
              </>
            ) : (
              <>
                <p className="small muted" style={{ margin: 0 }}>
                  Off by default. Nothing is sent until you press the button and allow it in your browser. It always stops by itself.
                </p>
                <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
                  <legend className="label">Who can see it</legend>
                  <div className="radio-row">
                    <label>
                      <input type="radio" name="audience" checked={audience === 'CONNECTIONS'} onChange={() => { setAudience('CONNECTIONS'); }} /> Connections only
                    </label>
                    <label>
                      <input type="radio" name="audience" checked={audience === 'EVENT'} onChange={() => { setAudience('EVENT'); }} /> Everyone at the event
                    </label>
                  </div>
                </fieldset>
                <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
                  <legend className="label">For how long</legend>
                  <div className="radio-row">
                    {([15, 60, 240] as const).map((m) => (
                      <label key={m}>
                        <input type="radio" name="minutes" checked={minutes === m} onChange={() => { setMinutes(m); }} /> {m < 60 ? `${m} min` : `${m / 60} h`}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <label className="row" style={{ gap: 8 }}>
                  <input type="checkbox" checked={approximate} onChange={(e) => { setApproximate(e.target.checked); }} />
                  <span className="small">Share only my approximate area (about 1 km)</span>
                </label>
                <button type="button" className="button" disabled={starting} onClick={start}>
                  {starting ? 'Waiting for your browser…' : 'Share my live location'}
                </button>
              </>
            )}
          </div>
        </section>

        <section className="panel" aria-labelledby="country-heading">
          <div className="panel__head">
            <h2 id="country-heading">Where people are from</h2>
          </div>
          <div className="panel__body stack">
            <label className="field" style={{ margin: 0 }}>
              <span className="label">Your country (optional)</span>
              <select value={data.myCountry ?? ''} onChange={(e) => void saveCountry(e.target.value)}>
                <option value="">Not shown</option>
                {shapes
                  .map((s) => ({ code: s.code, name: s.name }))
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name}
                    </option>
                  ))}
              </select>
              <span className="xs faint">Counted in the country total. Your name is never listed against it.</span>
            </label>
          </div>
          {data.hiddenCountries > 0 ? (
            <p className="xs faint" style={{ margin: 0 }}>
              {data.hiddenCountries} {data.hiddenCountries === 1 ? 'country has' : 'countries have'} fewer than {data.minGroupSize} people and {data.hiddenCountries === 1 ? 'is' : 'are'} not shown, so nobody can be picked out.
            </p>
          ) : null}
          {data.countries.length > 0 ? (
            <ul className="score-list">
              {data.countries.map((c) => (
                <li key={c.code}>
                  <span>{c.name}</span>
                  <strong>{c.members}</strong>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      </div>
    </div>
  );
}
