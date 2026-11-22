'use client';

import { useState, type SyntheticEvent } from 'react';
import { api, errorText, useLive } from '@/components/live/client';
import { useFeedback } from '@/components/ui/Feedback';
import { INGEST_KINDS } from '@/domain/kingdom/rules';
import { MAX_STEP, ROOF_COLOURS, isWalkable } from '@/domain/kingdom/world';
import type { KingdomAction, KingdomView } from '@/services/kingdoms';
import { KingdomWorld, type Placed } from './KingdomWorld';

type Mode = 'walk' | 'forge';

export function Kingdom({ eventId, initial }: { eventId: string; initial: KingdomView }) {
  const url = `/api/events/${eventId}/kingdom`;
  const { data: view, refresh } = useLive<KingdomView>(url, initial, 5000);
  const { toast } = useFeedback();
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<Mode>('walk');
  const [wish, setWish] = useState('');
  const [name, setName] = useState('');
  const [motto, setMotto] = useState('');
  const [decree, setDecree] = useState('');
  const [title, setTitle] = useState('');
  const [homeName, setHomeName] = useState('');
  const [roof, setRoof] = useState<(typeof ROOF_COLOURS)[number]>(ROOF_COLOURS[0]);
  const [ingestWho, setIngestWho] = useState('');
  const [ingestKind, setIngestKind] = useState<(typeof INGEST_KINDS)[number]>('RAID');
  const [ingestAmount, setIngestAmount] = useState(10);

  const run = async (body: KingdomAction, ok?: string) => {
    setBusy(true);
    try {
      await api(url, 'POST', body);
      if (ok) toast('success', ok);
      await refresh();
    } catch (e: unknown) {
      toast('error', errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const found = async (e: SyntheticEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api(url, 'PUT', { name, motto });
      toast('success', 'The kingdom is founded.');
      await refresh();
    } catch (err: unknown) {
      toast('error', errorText(err));
    } finally {
      setBusy(false);
    }
  };

  if (!view.kingdom) {
    return (
      <section className="card" aria-labelledby="found-h">
        <h2 id="found-h">Found the kingdom</h2>
        <p>This event has no kingdom yet. Whoever founds it becomes its monarch and can approve what citizens forge. There is one kingdom per event.</p>
        {view.you.canFound ? (
          <form onSubmit={(e) => { void found(e); }} className="stack" style={{ maxWidth: 420 }}>
            <label>
              Name
              <input value={name} onChange={(e) => { setName(e.target.value); }} maxLength={40} required />
            </label>
            <label>
              Motto (optional)
              <input value={motto} onChange={(e) => { setMotto(e.target.value); }} maxLength={120} />
            </label>
            <button className="button" disabled={busy || !name.trim()}>
              Found it
            </button>
          </form>
        ) : (
          <p>You do not have permission to found one.</p>
        )}
      </section>
    );
  }

  const me = view.you.citizen;
  const { kingdom } = view;
  const seed = kingdom.seed;

  const onTile = (tile: Placed) => {
    if (!me) return;
    if (mode === 'walk') {
      if (!isWalkable(seed, tile.x, tile.z)) {
        toast('error', 'You cannot walk there.');
        return;
      }
      if (Math.max(Math.abs(tile.x - me.x), Math.abs(tile.z - me.z)) > MAX_STEP) {
        toast('error', `Walk at most ${MAX_STEP} tiles at a time.`);
        return;
      }
      void run({ action: 'move', x: tile.x, z: tile.z });
    } else {
      if (!isWalkable(seed, tile.x, tile.z)) {
        toast('error', 'Things can only be placed on dry, open ground.');
        return;
      }
      if (!wish.trim()) {
        toast('error', 'Write what you wish for first.');
        return;
      }
      void run({ action: 'forge', prompt: wish, x: tile.x, z: tile.z }, view.you.isMonarch ? 'It stands in the kingdom.' : 'Sent to the monarch for approval.').then(() => { setWish(''); });
    }
  };

  const pending = view.forges.filter((f) => f.status === 'PENDING');
  const key = (e: React.KeyboardEvent) => {
    if (!me || mode !== 'walk') return;
    const d: Record<string, [number, number]> = { ArrowUp: [-1, -1], ArrowDown: [1, 1], ArrowLeft: [-1, 1], ArrowRight: [1, -1] };
    const step = d[e.key];
    if (!step) return;
    e.preventDefault();
    if (isWalkable(seed, me.x + step[0], me.z + step[1])) void run({ action: 'move', x: me.x + step[0], z: me.z + step[1] });
  };

  return (
    <div className="stack" style={{ gap: 16 }}>
      <section className="card" aria-labelledby="k-h">
        <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <div>
            <h2 id="k-h" style={{ marginBottom: 0 }}>{kingdom.name}</h2>
            {kingdom.motto ? <p style={{ margin: 0 }}><em>{kingdom.motto}</em></p> : null}
            <p style={{ margin: '4px 0 0' }}>
              Ruled by {kingdom.monarchName} · {kingdom.citizenCount} of {kingdom.capacity} homes · gates {kingdom.openGates ? 'open' : 'closed'}
            </p>
          </div>
          <div className="row" style={{ gap: 6 }}>
            {view.you.isMonarch ? <span className="badge badge--accent">You rule this</span> : null}
            {!me && view.you.canJoin ? (
              <button type="button" className="button" disabled={busy} onClick={() => void run({ action: 'join' }, 'You have a home now.')}>
                Become a citizen
              </button>
            ) : null}
            {!me && !view.you.canJoin ? <span className="badge">Gates closed</span> : null}
            {me && !view.you.isMonarch && !me.banned ? (
              <button type="button" className="button button--ghost button--sm" disabled={busy} onClick={() => void run({ action: 'leave' })}>
                Leave
              </button>
            ) : null}
          </div>
        </div>
      </section>

      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
        <section className="card" style={{ gridColumn: '1 / -1' }} aria-label="World" tabIndex={0} onKeyDown={key}>
          {me ? (
            <div className="row" role="group" aria-label="Click mode" style={{ gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
              <button type="button" className={mode === 'walk' ? 'button button--sm' : 'button button--ghost button--sm'} aria-pressed={mode === 'walk'} onClick={() => { setMode('walk'); }}>
                Walk
              </button>
              <button type="button" className={mode === 'forge' ? 'button button--sm' : 'button button--ghost button--sm'} aria-pressed={mode === 'forge'} onClick={() => { setMode('forge'); }}>
                Forge
              </button>
              {mode === 'forge' ? (
                <input aria-label="What do you wish for?" placeholder="e.g. a red lantern, a fountain, un árbol" value={wish} onChange={(e) => { setWish(e.target.value); }} maxLength={120} style={{ minWidth: 240 }} />
              ) : (
                <span>Click ground within {MAX_STEP} tiles, or focus here and use the arrow keys.</span>
              )}
            </div>
          ) : null}
          <KingdomWorld view={view} onTile={onTile} />
          <p style={{ fontSize: 13, marginBottom: 0 }}>You are the amber dot. The monarch is red. Homes are placed by lot and never move.</p>
        </section>

        <section className="card" aria-labelledby="c-h">
          <h3 id="c-h">Citizens ({view.citizens.length})</h3>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {view.citizens.map((c) => (
              <li key={c.userId} className="row" style={{ justifyContent: 'space-between', gap: 8, padding: '4px 0' }}>
                <span>
                  {c.name}
                  {c.isYou ? ' (you)' : ''} · <em>{c.title}</em>
                  {c.banned ? ' · banished' : ''}
                  {c.home ? ` · lot ${c.home.lot + 1}` : ''}
                </span>
                {view.you.canGovern && !c.isMonarch ? (
                  <button type="button" className="button button--ghost button--sm" disabled={busy} onClick={() => void run(c.banned ? { action: 'pardon', userId: c.userId } : { action: 'banish', userId: c.userId, reason: '' })}>
                    {c.banned ? 'Pardon' : 'Banish'}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          {me && !view.you.isMonarch ? (
            <form
              className="row"
              style={{ gap: 6, marginTop: 8 }}
              onSubmit={(e) => {
                e.preventDefault();
                void run({ action: 'title', title }, 'Title updated.').then(() => { setTitle(''); });
              }}
            >
              <input aria-label="Your title" placeholder="Your title, e.g. Baker" value={title} onChange={(e) => { setTitle(e.target.value); }} maxLength={30} />
              <button className="button button--sm" disabled={busy || !title.trim()}>
                Set
              </button>
            </form>
          ) : null}
        </section>

        {me?.home ? (
          <section className="card" aria-labelledby="h-h">
            <h3 id="h-h">Your home</h3>
            <p>
              {me.home.name} · {me.home.tier} · {me.home.followers} followers. Homes grow with followers: House at 5, Manor at 20.
            </p>
            <form
              className="row"
              style={{ gap: 6, flexWrap: 'wrap' }}
              onSubmit={(e) => {
                e.preventDefault();
                void run({ action: 'home', name: homeName, roof }, 'Home updated.');
              }}
            >
              <input aria-label="Home name" placeholder="Name your home" value={homeName} onChange={(e) => { setHomeName(e.target.value); }} maxLength={30} />
              <select aria-label="Roof colour" value={roof} onChange={(e) => { setRoof(e.target.value as (typeof ROOF_COLOURS)[number]); }}>
                {ROOF_COLOURS.map((c) => (
                  <option key={c} value={c} style={{ color: c }}>{c}</option>
                ))}
              </select>
              <button className="button button--sm" disabled={busy || !homeName.trim()}>Save</button>
            </form>
          </section>
        ) : null}

        <section className="card" aria-labelledby="ch-h">
          <h3 id="ch-h">Chronicle</h3>
          {view.chronicle.length === 0 ? <p>Nothing has happened yet.</p> : null}
          <ol style={{ listStyle: 'none', padding: 0, margin: 0, maxHeight: 280, overflow: 'auto' }}>
            {view.chronicle.map((c) => (
              <li key={c.id} style={{ padding: '4px 0' }}>
                <span aria-hidden="true">{c.kind === 'DECREE' ? '📜 ' : c.kind === 'CARAVAN' ? '🐪 ' : c.kind === 'CHEER' ? '🎆 ' : c.kind === 'FORGED' ? '🔨 ' : '• '}</span>
                {c.text}
              </li>
            ))}
          </ol>
        </section>

        {view.you.canGovern ? (
          <section className="card" aria-labelledby="t-h">
            <h3 id="t-h">The throne</h3>
            <div className="stack" style={{ gap: 10 }}>
              <button type="button" className="button button--ghost button--sm" disabled={busy} onClick={() => void run({ action: 'gates', open: !kingdom.openGates })}>
                {kingdom.openGates ? 'Close the gates' : 'Open the gates'}
              </button>
              <form
                className="stack"
                style={{ gap: 6 }}
                onSubmit={(e) => {
                  e.preventDefault();
                  void run({ action: 'decree', text: decree }, 'Decree issued.').then(() => { setDecree(''); });
                }}
              >
                <label>
                  Decree
                  <textarea value={decree} onChange={(e) => { setDecree(e.target.value); }} maxLength={280} rows={2} />
                </label>
                <button className="button button--sm" disabled={busy || !decree.trim()}>
                  Proclaim
                </button>
              </form>
              <form
                className="stack"
                style={{ gap: 6 }}
                onSubmit={(e) => {
                  e.preventDefault();
                  void run({ action: 'ingest', kind: ingestKind, who: ingestWho, amount: ingestAmount }, 'The kingdom took note.').then(() => { setIngestWho(''); });
                }}
              >
                <strong>Tell the kingdom what happened outside</strong>
                <p style={{ margin: 0, fontSize: 13 }}>For example a raid from another stream becomes a caravan at the gate. Entered by hand: no live Twitch connection exists yet.</p>
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  <select aria-label="Kind" value={ingestKind} onChange={(e) => { setIngestKind(e.target.value as (typeof INGEST_KINDS)[number]); }}>
                    {INGEST_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {k.toLowerCase()}
                      </option>
                    ))}
                  </select>
                  <input aria-label="From" placeholder="From (name)" value={ingestWho} onChange={(e) => { setIngestWho(e.target.value); }} maxLength={40} />
                  <input aria-label="Amount" type="number" min={1} max={100000} value={ingestAmount} onChange={(e) => { setIngestAmount(Math.max(1, Number(e.target.value) || 1)); }} style={{ width: 90 }} />
                  <button className="button button--sm" disabled={busy || !ingestWho.trim()}>
                    Record
                  </button>
                </div>
              </form>
            </div>
          </section>
        ) : null}

        {pending.length > 0 || view.forges.some((f) => f.mine) ? (
          <section className="card" aria-labelledby="f-h">
            <h3 id="f-h">Forge requests</h3>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {view.forges
                .filter((f) => f.status === 'PENDING' || f.mine)
                .map((f) => (
                  <li key={f.id} className="row" style={{ justifyContent: 'space-between', gap: 8, padding: '4px 0' }}>
                    <span>
                      “{f.prompt}” → {f.kit.toLowerCase()} · {f.requester.name} · {f.status.toLowerCase()}
                      {f.decisionNote ? ` (${f.decisionNote})` : ''}
                    </span>
                    {view.you.canGovern && f.status === 'PENDING' ? (
                      <span className="row" style={{ gap: 4 }}>
                        <button type="button" className="button button--sm" disabled={busy} onClick={() => void run({ action: 'decide', forgeId: f.id, approve: true, note: '' })}>
                          Approve
                        </button>
                        <button type="button" className="button button--ghost button--sm" disabled={busy} onClick={() => void run({ action: 'decide', forgeId: f.id, approve: false, note: '' })}>
                          Refuse
                        </button>
                      </span>
                    ) : null}
                  </li>
                ))}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}
