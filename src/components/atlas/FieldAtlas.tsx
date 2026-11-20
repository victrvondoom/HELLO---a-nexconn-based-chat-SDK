'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { api, errorText, useLive } from '@/components/live/client';
import { useFeedback } from '@/components/ui/Feedback';
import type { MissionView, SeasonView, cabinetFor } from '@/services/field-atlas';
import type { AtlasHomeData } from '@/services/field-live';
import type { MissionPulse, SeasonPulse, SpaceCondition } from '@/domain/field/live';
import type { Answer, Recommendation } from '@/services/quest-director';
import { AtlasMap, type AtlasRoute } from './AtlasMap';
import { BadgeArt } from './BadgeArt';

/** Built by `atlasHome` (src/services/field-live.ts) for both the first render and every poll. */
export type AtlasHome = AtlasHomeData;

const CONDITION_WORD: Record<SpaceCondition['level'], string> = { CLEAR: 'Clear', BUSY: 'Busy', CAUTION: 'Caution', AVOID: 'Come back later' };

/** "12" or "fewer than 3": the pulse never shows a count small enough to point at one person. */
const pulseCount = (n: number | null, min: number) => (n === null ? `fewer than ${min}` : String(n));

function momentumText(p: MissionPulse | undefined, min: number): string {
  if (!p) return 'No activity recorded yet.';
  const parts = [
    p.verifiedLastHour !== null ? `${p.verifiedLastHour} verified in the last hour` : null,
    p.underwayNow !== null ? `${p.underwayNow} working on it now` : null,
    `${pulseCount(p.completedTotal, min)} completed in total`,
  ].filter(Boolean);
  return `${parts.join(' · ')}.`;
}

type Cabinet = Awaited<ReturnType<typeof cabinetFor>>;

const DIFFICULTY = { EASY: 'Easy', MEDIUM: 'Medium', HARD: 'Hard' } as const;
const CATEGORY = { EXPLORATION: 'Exploration', PARTICIPATION: 'Participation', CONTRIBUTION: 'Contribution', CONNECTION: 'Connection', COORDINATION: 'Coordination' } as const;

const dateOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function statusLabel(m: MissionView): string {
  switch (m.attempt.status) {
    case 'APPROVED':
      return 'Completed';
    case 'PENDING_REVIEW':
      return 'Waiting for review';
    case 'STARTED':
      return 'In progress';
    case 'REJECTED':
      return 'Needs another try';
    case 'NONE':
      break;
  }
  switch (m.availability.state) {
    case 'AVAILABLE':
      return 'Available';
    case 'LOCKED_LEVEL':
      return `Unlocks at level ${m.availability.requiredLevel}`;
    case 'LOCKED_PREREQUISITE':
      return 'Locked: finish the mission it builds on';
    case 'NOT_YET':
      return 'Opens later';
    case 'ENDED':
      return 'Ended';
    case 'PAUSED':
      return 'Paused';
    case 'DRAFT':
      return 'Not published';
  }
}

export function FieldAtlas({ eventId, initial, cabinetHref }: { eventId: string; initial: AtlasHome; cabinetHref: string }) {
  const { toast } = useFeedback();
  const { data, refresh } = useLive<AtlasHome>(`/api/events/${eventId}/atlas`, initial, 15000);
  const [tab, setTab] = useState<'map' | 'cabinet'>('map');
  const [floor, setFloor] = useState<number>(data.venue?.floors[0]?.id ?? 0);
  const [selected, setSelected] = useState<string | null>(null);
  const [startSpace, setStartSpace] = useState('');
  const [stepFree, setStepFree] = useState(false);
  const [minutes, setMinutes] = useState('');
  const [recs, setRecs] = useState<{ recommendations: Recommendation[]; routes: Record<string, NonNullable<Recommendation['route']>>; note: string } | null>(null);
  const [recError, setRecError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Answer[] | null>(null);
  const [evidence, setEvidence] = useState('');
  const [code, setCode] = useState('');
  const [result, setResult] = useState<{ tone: 'ok' | 'warn' | 'bad'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [cabinet, setCabinet] = useState<Cabinet | null>(null);
  const [cabinetError, setCabinetError] = useState<string | null>(null);

  const missions = data.missions;
  const current = missions.find((m) => m.id === selected) ?? null;
  const defaultSelected = useMemo(() => missions.find((m) => m.attempt.status === 'STARTED' || m.attempt.status === 'REJECTED') ?? missions.find((m) => m.availability.state === 'AVAILABLE') ?? missions[0] ?? null, [missions]);
  const focus = current ?? defaultSelected;

  // Changes whenever a place's condition or the pulse changes, so Quest Director re-ranks on the next poll.
  const liveKey = useMemo(
    () => JSON.stringify([Object.values(data.conditions).map((c) => [c.spaceId, c.level, c.accessIssue]), data.pulse.missions.map((p) => [p.missionId, p.verifiedLastHour, p.underwayNow])]),
    [data.conditions, data.pulse],
  );

  useEffect(() => {
    let live = true;
    const minuteValue = minutes === '' ? null : Number(minutes);
    api<{ recommendations: Recommendation[]; routes: Record<string, NonNullable<Recommendation['route']>>; note: string }>(`/api/events/${eventId}/atlas/recommend`, 'POST', {
      minutes: minuteValue,
      startSpaceId: startSpace || null,
      stepFree,
    })
      .then((r) => { if (live) { setRecs(r); setRecError(null); } })
      .catch((e: unknown) => { if (live) setRecError(errorText(e)); });
    return () => { live = false; };
  }, [eventId, startSpace, stepFree, minutes, data.player.xp, liveKey]);

  useEffect(() => {
    if (tab !== 'cabinet') return;
    let live = true;
    api<Cabinet>(`/api/events/${eventId}/atlas/cabinet`)
      .then((c) => { if (live) { setCabinet(c); setCabinetError(null); } })
      .catch((e: unknown) => { if (live) setCabinetError(errorText(e)); });
    return () => { live = false; };
  }, [tab, eventId, data.player.xp]);

  /**
   * Selecting another mission clears the evidence and code typed for the previous one (they used to carry
   * over, so a code meant for one station could be submitted for another) and shows the mission's floor.
   */
  const choose = (id: string) => {
    setSelected(id);
    setAnswers(null);
    setResult(null);
    setEvidence('');
    setCode('');
    const spaceId = missions.find((m) => m.id === id)?.spaceId;
    const space = spaceId ? data.venue?.spaces.find((x) => x.id === spaceId) : undefined;
    if (space) setFloor(space.floor);
  };

  const pulseOf = useMemo(() => new Map(data.pulse.missions.map((p) => [p.missionId, p])), [data.pulse]);

  const route: AtlasRoute | null = focus && recs?.routes[focus.id] ? recs.routes[focus.id] ?? null : null;

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch (error: unknown) {
      const text = errorText(error);
      setResult({ tone: 'bad', text });
      toast('error', text);
    } finally {
      setBusy(false);
      await refresh();
    }
  };

  const start = (m: MissionView) =>
    run(async () => {
      await api(`/api/events/${eventId}/atlas/missions/${m.id}/start`, 'POST');
      setResult({ tone: 'ok', text: `Started “${m.title}”. Complete the step, then submit.` });
      toast('success', 'Mission started.');
      setAnswers(null);
    });

  const submit = (m: MissionView) =>
    run(async () => {
      const r = await api<{ outcome: string; message: string; xpAwarded: number; levelUp: { to: string } | null; badges: Array<{ name: string }> }>(
        `/api/events/${eventId}/atlas/missions/${m.id}/submit`,
        'POST',
        { text: evidence, checkInCode: code },
      );
      if (r.outcome === 'APPROVED') {
        const extras = [r.levelUp ? 'Level up.' : '', ...r.badges.map((b) => `Badge earned: ${b.name}.`)].filter(Boolean).join(' ');
        setResult({ tone: 'ok', text: `${r.message} ${extras}`.trim() });
        toast('success', `${r.message} ${extras}`.trim());
        setEvidence('');
        setCode('');
      } else if (r.outcome === 'PENDING_REVIEW') {
        setResult({ tone: 'warn', text: r.message });
        toast('info', r.message);
      } else if (r.outcome === 'ALREADY_COMPLETE') {
        setResult({ tone: 'ok', text: r.message });
      } else {
        setResult({ tone: 'bad', text: r.message });
      }
    });

  const askGuide = (m: MissionView) =>
    run(async () => {
      const g = await api<{ answers: Answer[] }>(`/api/events/${eventId}/atlas/missions/${m.id}/guide`);
      setAnswers(g.answers);
    });

  const renderPanel = (m: MissionView) => {
    const canStart = m.attempt.status === 'NONE' && m.availability.state === 'AVAILABLE';
    const inProgress = m.attempt.status === 'STARTED' || m.attempt.status === 'REJECTED';
    const method = m.verification.method;
    return (
      <section className="panel atlas-panel" aria-labelledby="mission-title">
        <div>
          <p className="eyebrow" style={{ margin: 0 }}>{CATEGORY[m.category]} · {DIFFICULTY[m.difficulty]}</p>
          <h2 id="mission-title" style={{ margin: '4px 0 6px' }}>{m.title}</h2>
          <p style={{ margin: 0 }}>{m.description}</p>
        </div>
        <p className="small" style={{ margin: 0 }}><strong>Why it matters.</strong> {m.whyItMatters}</p>
        <dl>
          <dt>Reward</dt><dd>{m.xp} XP</dd>
          <dt>Status</dt><dd>{statusLabel(m)}</dd>
          <dt>Location</dt><dd>{m.nonLocation ? 'Anywhere' : (data.venue?.spaces.find((s) => s.id === m.spaceId)?.name ?? 'To be confirmed by staff')}</dd>
          <dt>Time</dt><dd>{m.estimateMinutes ? `About ${m.estimateMinutes} minutes` : 'Not estimated'}</dd>
          <dt>Requirement</dt><dd>{m.verification.detail}</dd>
          <dt>Accessibility</dt><dd>{m.accessibilityNote || 'No note recorded.'}</dd>
          {route ? <><dt>Route</dt><dd>About {route.metres} m{route.stepFree ? ', step-free' : ''}. {route.steps.slice(0, 3).join(' ')}</dd></> : null}
          {m.spaceId ? (
            <>
              <dt>Right now</dt>
              <dd data-testid="mission-condition">
                {(() => {
                  const c = data.conditions[m.spaceId];
                  if (!c) return 'Clear: nothing is reported there.';
                  return <><span className={`atlas-cond atlas-cond--${c.level.toLowerCase()}`}>{CONDITION_WORD[c.level]}</span> {c.signals.map((sig) => sig.text).join(' ')}</>;
                })()}
              </dd>
            </>
          ) : null}
          <dt>Momentum</dt><dd data-testid="mission-pulse">{momentumText(pulseOf.get(m.id), data.pulse.minCount)}</dd>
        </dl>
        {m.attempt.lastOutcome && m.attempt.status !== 'NONE' ? <p className={`atlas-note ${m.attempt.status === 'APPROVED' ? 'atlas-note--ok' : m.attempt.status === 'PENDING_REVIEW' ? 'atlas-note--warn' : ''}`} style={{ margin: 0 }}>{m.attempt.lastOutcome}</p> : null}
        {m.availability.state !== 'AVAILABLE' && m.attempt.status === 'NONE' ? (
          <p className="atlas-note" style={{ margin: 0 }}>
            {lockedMessage(m, missions)}
          </p>
        ) : null}
        {canStart ? (
          <button type="button" className="button" disabled={busy} onClick={() => { void start(m); }}>Start mission</button>
        ) : null}
        {inProgress ? (
          <div className="stack" style={{ gap: 10 }}>
            {method === 'MANUAL_REVIEW' ? (
              <div className="field">
                <label htmlFor="evidence">Your evidence</label>
                <textarea id="evidence" value={evidence} maxLength={500} onChange={(e) => { setEvidence(e.target.value); }} placeholder={m.verification.detail} />
                <span className="xs faint">Staff review this. It counts only after an organiser approves it.</span>
              </div>
            ) : null}
            {method === 'CHECK_IN' ? (
              <div className="field">
                <label htmlFor="checkin">Check-in code</label>
                <input id="checkin" value={code} maxLength={32} autoComplete="off" onChange={(e) => { setCode(e.target.value); }} placeholder="From the staff member at the station" />
                <span className="xs faint">Codes expire after four hours. Ask staff for the current one.</span>
              </div>
            ) : null}
            {method === 'WORKFLOW_RUN' ? (
              <p className="small" style={{ margin: 0 }}>Run the workflow on the <Link href={`/events/${eventId}/flow`}>workflow canvas</Link>, then check your progress.</p>
            ) : null}
            <button type="button" className="button" disabled={busy || (method === 'CHECK_IN' && code.trim().length === 0) || (method === 'MANUAL_REVIEW' && evidence.trim().length < 10)} onClick={() => { void submit(m); }}>
              {method === 'WORKFLOW_RUN' ? 'Check my progress' : 'Submit for verification'}
            </button>
          </div>
        ) : null}
        <div>
          <button type="button" className="button button--ghost button--sm" disabled={busy} onClick={() => { void askGuide(m); }} aria-expanded={answers !== null}>Ask the field guide</button>
          {answers ? (
            <div className="stack" style={{ gap: 10, marginTop: 10 }}>
              {answers.map((a) => (
                <div key={a.question} className="atlas-answer">
                  <strong className="small">{a.question}</strong>
                  <p className="small" style={{ margin: '2px 0 0' }}>{a.text}</p>
                  <small className="atlas-cites">{a.citations.map((c) => `${c.kind}:${c.id}.${c.field}`).join('  ') || 'No record cited.'}</small>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </section>
    );
  };

  const level = data.player.level;
  const pct = Math.round(data.player.progress * 100);
  const badgeGlyph = cabinet?.badges[0];

  return (
    <div className="atlas">
      <header className="atlas-head" aria-label="Your progress">
        <div className="atlas-level">
          <span className="atlas-mark" aria-hidden="true">{data.player.levelNumber}</span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <p className="eyebrow" style={{ margin: 0 }}>Level</p>
            <strong style={{ fontSize: '1.1rem' }}>{level.name}</strong>
            <p className="xs faint" style={{ margin: '2px 0 0' }}>{level.description}</p>
            <div
              className="atlas-bar"
              role="progressbar"
              aria-label="XP toward the next level"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct}
              aria-valuetext={data.player.next ? `${data.player.xp} XP. ${data.player.next.xpNeeded} XP to ${data.player.next.name}.` : `${data.player.xp} XP. Top level reached.`}
            >
              <span style={{ width: `${pct}%` }} />
            </div>
            <p className="xs faint" style={{ margin: '4px 0 0' }}>
              <span className="atlas-xp">{data.player.xp} XP</span>{data.player.next ? ` · ${data.player.next.xpNeeded} to ${data.player.next.name}` : ' · top level'}
            </p>
          </div>
        </div>
        <div className="stack" style={{ gap: 4, minWidth: 0 }}>
          <p className="eyebrow" style={{ margin: 0 }}>Monthly challenge</p>
          {data.season ? (
            <>
              <strong>{data.season.title}</strong>
              <span className="xs faint">
                {data.season.phase === 'ACTIVE' ? `Open until ${dateOf(data.season.endsAt)}` : data.season.phase === 'UPCOMING' ? `Opens ${dateOf(data.season.startsAt)}` : 'Ended'}
                {data.season.earned ? ' · badge earned' : data.season.requiredRemaining > 0 ? ` · ${data.season.requiredRemaining} required left` : ''}
              </span>
            </>
          ) : (
            <span className="small muted">No challenge is running this month.</span>
          )}
          {data.season ? <SeasonPulseLine pulse={data.pulse} /> : null}
        </div>
        <div className="atlas-chip" style={{ justifySelf: 'end' }}>
          {badgeGlyph ? <span style={{ width: 40, height: 40, display: 'inline-block' }}><BadgeArt artwork={badgeGlyph.artwork} label={`Latest badge: ${badgeGlyph.name}`} /></span> : <span className="xs faint">No badges yet</span>}
          <Link href={cabinetHref} className="button button--ghost button--sm" onClick={(e) => { e.preventDefault(); setTab('cabinet'); }}>Badge cabinet</Link>
        </div>
      </header>

      <div className="atlas-tabs" role="tablist" aria-label="Field Atlas views">
        <button type="button" role="tab" className="button button--ghost button--sm" aria-selected={tab === 'map'} aria-pressed={tab === 'map'} onClick={() => { setTab('map'); }}>Mission map</button>
        <button type="button" role="tab" className="button button--ghost button--sm" aria-selected={tab === 'cabinet'} aria-pressed={tab === 'cabinet'} onClick={() => { setTab('cabinet'); }}>My progress and badges</button>
      </div>

      {tab === 'map' ? (
        <div className="atlas-body">
          <div className="stack" style={{ gap: 14, minWidth: 0 }}>
            {data.venue ? (
              <AtlasMap
                venue={data.venue}
                missions={missions}
                floor={floor}
                selectedId={focus?.id ?? null}
                route={route}
                conditions={data.conditions}
                onFloor={setFloor}
                onSelect={choose}
              />
            ) : (
              <div className="empty card"><strong>No venue plan yet</strong><span>Missions still appear in the list. An organiser has not drawn the venue.</span></div>
            )}
            <section className="panel" aria-labelledby="list-heading">
              <h2 id="list-heading" style={{ fontSize: '1rem', margin: '0 0 10px' }}>Missions</h2>
              {missions.length === 0 ? (
                <p className="small muted" style={{ margin: 0 }}>No missions are published for this event yet.</p>
              ) : (
                <ul className="atlas-list">
                  {missions.map((m) => (
                    <li key={m.id}>
                      <button type="button" aria-current={focus?.id === m.id ? 'true' : undefined} onClick={() => { choose(m.id); }}>
                        <span><strong>{m.title}</strong><br /><span className="xs faint">{statusLabel(m)} · {m.xp} XP</span></span>
                        <span className="xs faint">{m.attempt.status === 'APPROVED' ? '✓' : ''}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="panel" aria-labelledby="next-heading">
              <h2 id="next-heading" style={{ fontSize: '1rem', margin: '0 0 6px' }}>Suggested next</h2>
              <p className="xs faint" style={{ margin: '0 0 10px' }}>Choose where you are and how long you have. Your location is not tracked.</p>
              <div className="atlas-form">
                <div className="field">
                  <label htmlFor="start-space">Starting place</label>
                  <select id="start-space" value={startSpace} onChange={(e) => { setStartSpace(e.target.value); }}>
                    <option value="">Not chosen</option>
                    {(data.venue?.spaces ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="minutes">Time available</label>
                  <select id="minutes" value={minutes} onChange={(e) => { setMinutes(e.target.value); }}>
                    <option value="">Any</option>
                    <option value="10">10 minutes</option>
                    <option value="20">20 minutes</option>
                    <option value="45">45 minutes</option>
                  </select>
                </div>
                <label className="small" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input type="checkbox" checked={stepFree} onChange={(e) => { setStepFree(e.target.checked); }} /> Step-free routes only
                </label>
              </div>
              {recError ? <p className="atlas-note atlas-note--bad" role="alert">{recError}</p> : null}
              {recs ? (
                recs.recommendations.length === 0 ? (
                  <p className="small muted">{recs.note}</p>
                ) : (
                  <ol className="stack" style={{ gap: 8, paddingLeft: 18, marginTop: 12 }}>
                    {recs.recommendations.map((r) => (
                      <li key={r.missionId}>
                        <button type="button" className="button button--ghost button--sm" onClick={() => { choose(r.missionId); }}>{r.title}</button>
                        <div className="xs faint">{r.reason}</div>
                      </li>
                    ))}
                  </ol>
                )
              ) : null}
              {recs && recs.recommendations.length > 0 ? <p className="xs faint" style={{ marginTop: 8 }}>{recs.note}</p> : null}
            </section>
          </div>
          <div className="stack" style={{ gap: 14, minWidth: 0 }} aria-live="polite">
            {focus ? renderPanel(focus) : <section className="panel"><p className="small muted">Select a mission on the map or in the list.</p></section>}
            {result ? <p className={`atlas-note ${result.tone === 'ok' ? 'atlas-note--ok' : result.tone === 'warn' ? 'atlas-note--warn' : 'atlas-note--bad'}`} role="status">{result.text}</p> : null}
          </div>
        </div>
      ) : (
        <CabinetView cabinet={cabinet} error={cabinetError} />
      )}
    </div>
  );
}

function lockedMessage(m: MissionView, missions: MissionView[]): string {
  const a = m.availability;
  if (a.state === 'LOCKED_LEVEL') return `Reach level ${a.requiredLevel} to start this mission.`;
  if (a.state === 'LOCKED_PREREQUISITE') {
    const first = missions.find((x) => x.id === a.missing[0]);
    return `Finish “${first?.title ?? 'the earlier mission'}” first.`;
  }
  return `${statusLabel(m)}.`;
}

function CabinetView({ cabinet, error }: { cabinet: Cabinet | null; error: string | null }) {
  if (error) return <p className="atlas-note atlas-note--bad" role="alert">{error}</p>;
  if (!cabinet) return <p className="small muted" role="status">Loading your cabinet…</p>;
  const monthly = cabinet.badges.filter((b) => b.kind === 'MONTHLY');
  const permanent = cabinet.badges.filter((b) => b.kind === 'PERMANENT');
  return (
    <div className="stack" style={{ gap: 18 }}>
      <section className="panel" aria-labelledby="season-heading">
        <h2 id="season-heading" style={{ fontSize: '1rem', margin: '0 0 8px' }}>Monthly challenges</h2>
        {cabinet.seasons.current ? (
          <SeasonBlock season={cabinet.seasons.current} />
        ) : (
          <p className="small muted" style={{ margin: 0 }}>No challenge is running this month. Past challenges are listed below.</p>
        )}
        {cabinet.seasons.history.length > 0 ? (
          <ul className="stack" style={{ gap: 6, paddingLeft: 0, listStyle: 'none', marginTop: 12 }}>
            {cabinet.seasons.history.map((s) => (
              <li key={s.id} className="xs faint">{s.title} · {s.phase === 'ENDED' ? 'ended' : s.phase.toLowerCase()} · {s.earned ? 'badge kept' : 'not earned'}</li>
            ))}
          </ul>
        ) : null}
      </section>
      <section className="panel" aria-labelledby="badge-heading">
        <h2 id="badge-heading" style={{ fontSize: '1rem', margin: '0 0 12px' }}>Badges</h2>
        <div className="atlas-grid-badges">
          {monthly.map((b) => (
            <div key={b.id} className="atlas-badge">
              <BadgeArt artwork={b.artwork} label={`${b.name} monthly badge`} />
              <strong className="small">{b.name}</strong>
              <span className="xs faint">Monthly · earned {dateOf(b.earnedAt)}</span>
            </div>
          ))}
          {permanent.map((b) => (
            <div key={b.id} className="atlas-badge">
              <BadgeArt artwork="achievement" label={`${b.name} achievement`} />
              <strong className="small">{b.name}</strong>
              <span className="xs faint">Permanent · earned {dateOf(b.earnedAt)}</span>
            </div>
          ))}
          {cabinet.achievementDefinitions.filter((a) => !permanent.some((p) => p.badgeId === a.id)).map((a) => (
            <div key={a.id} className="atlas-badge atlas-badge--locked">
              <BadgeArt artwork="achievement" label={`${a.name}, not yet earned`} earned={false} />
              <strong className="small">{a.name}</strong>
              <span className="xs faint">{a.description}</span>
            </div>
          ))}
        </div>
        {monthly.length === 0 && permanent.length === 0 ? <p className="small muted" style={{ marginTop: 12 }}>Badges appear here when a verified mission earns them.</p> : null}
      </section>
      <section className="panel" aria-labelledby="history-heading">
        <h2 id="history-heading" style={{ fontSize: '1rem', margin: '0 0 8px' }}>XP history</h2>
        {cabinet.history.length === 0 ? (
          <p className="small muted" style={{ margin: 0 }}>No XP yet. Complete a verified mission to see it here.</p>
        ) : (
          <table className="atlas-table">
            <caption className="visually-hidden">XP entries, newest first</caption>
            <thead><tr><th scope="col">Date</th><th scope="col">XP</th><th scope="col">What it was for</th></tr></thead>
            <tbody>
              {cabinet.history.map((h) => (
                <tr key={h.id}><td>{dateOf(h.at)}</td><td>{h.amount > 0 ? `+${h.amount}` : h.amount}</td><td>{h.reason}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function SeasonBlock({ season }: { season: SeasonView }) {
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div>
        <strong>{season.title}</strong>
        <p className="small" style={{ margin: '4px 0 0' }}>{season.theme}</p>
        <p className="xs faint" style={{ margin: '2px 0 0' }}>{dateOf(season.startsAt)} to {dateOf(season.endsAt)} · {season.phase.toLowerCase()} · {season.bonusXp} XP for completing it</p>
      </div>
      <ul className="stack" style={{ gap: 4, paddingLeft: 18 }}>
        {season.missions.map((m) => (
          <li key={m.id} className="small">{m.title}{m.required ? '' : ' (optional)'}: {m.status === 'APPROVED' ? 'completed' : m.status === 'PENDING_REVIEW' ? 'waiting for review' : m.status === 'STARTED' || m.status === 'REJECTED' ? 'in progress' : 'not started'}</li>
        ))}
      </ul>
      <p className="xs faint" style={{ margin: 0 }}>{season.earned ? 'You have earned this month’s badge.' : `${season.requiredRemaining} required mission(s) left.`}</p>
    </div>
  );
}

function SeasonPulseLine({ pulse }: { pulse: SeasonPulse }) {
  return (
    <span className="xs faint" data-testid="season-pulse">
      Season pulse: {pulseCount(pulse.participants, pulse.minCount)} taking part · {pulseCount(pulse.badgesEarned, pulse.minCount)} badges earned
    </span>
  );
}
