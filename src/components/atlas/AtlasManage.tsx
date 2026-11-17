'use client';

import { useState } from 'react';
import { api, errorText, useLive } from '@/components/live/client';
import { useFeedback } from '@/components/ui/Feedback';
import type { LevelDefinition } from '@/domain/field/rules';
import type { ManageSnapshot } from '@/services/field-atlas';

export interface ManageInitial {
  snapshot: ManageSnapshot;
  spaces: Array<{ id: string; name: string; floor: number }>;
  workflows: Array<{ id: string; name: string }>;
  people: Array<{ id: string; name: string }>;
}

const MANAGE_URL = (eventId: string) => `/api/events/${eventId}/atlas/manage`;
const dateOf = (ms: number) => new Date(ms).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

const blankMission = {
  id: '',
  title: '',
  description: '',
  whyItMatters: '',
  category: 'EXPLORATION',
  difficulty: 'EASY',
  requiredLevel: '0',
  xp: '30',
  spaceId: '',
  seasonId: '',
  method: 'MANUAL_REVIEW',
  workflowId: 'my-day',
  stationId: '',
  evidencePrompt: 'Describe what you did, in your own words.',
  estimateMinutes: '',
  accessibilityNote: '',
  status: 'DRAFT',
};

const blankSeason = {
  id: '',
  year: '2026',
  month: '12',
  title: '',
  theme: '',
  description: '',
  artwork: 'compass',
  bonusXp: '100',
  missionIds: '',
  requiredMissionIds: '',
  status: 'DRAFT',
};

const list = (text: string) => text.split(',').map((s) => s.trim()).filter(Boolean);

export function AtlasManage({ eventId, initial, canManage, canReview }: { eventId: string; initial: ManageInitial; canManage: boolean; canReview: boolean }) {
  const { toast } = useFeedback();
  const { data, refresh } = useLive<ManageSnapshot>(MANAGE_URL(eventId), initial.snapshot, 10000);
  const nameOf = new Map(initial.people.map((p) => [p.id, p.name]));
  const [mission, setMission] = useState(blankMission);
  const [season, setSeason] = useState(blankSeason);
  const [station, setStation] = useState({ stationId: '', spaceId: '', name: '' });
  const [issued, setIssued] = useState<{ id: string; code: string; expiresAt: number } | null>(null);
  const [adjust, setAdjust] = useState({ userId: '', amount: '', reason: '' });
  const [draft, setDraft] = useState({ year: '2026', month: '12' });
  const [draftResult, setDraftResult] = useState<{ seasonId: string; created: number; autoPublished: number; unavailable: string[] } | null>(null);
  const [levels, setLevels] = useState<LevelDefinition[]>(data.levels);
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const act = async <T,>(body: unknown, ok: string): Promise<T | null> => {
    setBusy(true);
    try {
      const out = await api<T>(MANAGE_URL(eventId), 'POST', body);
      toast('success', ok);
      await refresh();
      return out;
    } catch (error: unknown) {
      toast('error', errorText(error));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const review = (attempt: string, decision: 'APPROVE' | 'REJECT') => {
    setBusy(true);
    api(`/api/events/${eventId}/atlas/reviews/${encodeURIComponent(attempt)}`, 'POST', { decision, note: reviewNotes[attempt] ?? '' })
      .then(() => { toast('success', decision === 'APPROVE' ? 'Approved. XP awarded once.' : 'Sent back to the attendee.'); return refresh(); })
      .catch((e: unknown) => { toast('error', errorText(e)); })
      .finally(() => { setBusy(false); });
  };

  const saveMission = () => {
    const isWorkflow = mission.method === 'WORKFLOW_RUN';
    const isCheckIn = mission.method === 'CHECK_IN';
    const body = {
      action: 'saveMission',
      mission: {
        id: mission.id.trim(),
        title: mission.title,
        description: mission.description,
        whyItMatters: mission.whyItMatters,
        category: mission.category,
        difficulty: mission.difficulty,
        requiredLevel: Number(mission.requiredLevel),
        xp: Number(mission.xp),
        seasonId: mission.seasonId || null,
        spaceId: mission.spaceId || null,
        nonLocation: mission.spaceId === '',
        prerequisiteIds: [],
        verification: isWorkflow
          ? { method: 'WORKFLOW_RUN', workflowId: mission.workflowId }
          : isCheckIn
            ? { method: 'CHECK_IN', stationId: mission.stationId }
            : { method: 'MANUAL_REVIEW', evidencePrompt: mission.evidencePrompt },
        estimateMinutes: mission.estimateMinutes === '' ? null : Number(mission.estimateMinutes),
        accessibilityNote: mission.accessibilityNote,
        startsAt: null,
        endsAt: null,
        status: mission.status,
        maxCompletionsPerPerson: 1,
        source: 'ORGANISER',
      },
    };
    void act(body, 'Mission saved.').then((r) => { if (r) setMission(blankMission); });
  };

  const editMission = (m: ManageSnapshot['missions'][number]) => {
    setMission({
      id: m.id,
      title: m.title,
      description: m.description,
      whyItMatters: m.whyItMatters,
      category: m.category,
      difficulty: m.difficulty,
      requiredLevel: String(m.requiredLevel),
      xp: String(m.xp),
      spaceId: m.spaceId ?? '',
      seasonId: m.seasonId ?? '',
      method: m.verification.method,
      workflowId: m.verification.method === 'WORKFLOW_RUN' ? m.verification.workflowId : 'my-day',
      stationId: m.verification.method === 'CHECK_IN' ? m.verification.stationId : '',
      evidencePrompt: m.verification.method === 'MANUAL_REVIEW' ? m.verification.evidencePrompt : 'Describe what you did, in your own words.',
      estimateMinutes: m.estimateMinutes === null ? '' : String(m.estimateMinutes),
      accessibilityNote: m.accessibilityNote,
      status: m.status,
    });
  };

  const saveSeason = () => {
    const body = {
      action: 'saveSeason',
      season: {
        id: season.id.trim(),
        year: Number(season.year),
        month: Number(season.month),
        title: season.title,
        theme: season.theme,
        description: season.description,
        artwork: season.artwork,
        bonusXp: Number(season.bonusXp),
        missionIds: list(season.missionIds),
        requiredMissionIds: list(season.requiredMissionIds),
        status: season.status,
      },
    };
    void act(body, 'Season saved.').then((r) => { if (r) setSeason(blankSeason); });
  };

  const draftMonth = async () => {
    setBusy(true);
    try {
      const out = await api<{ seasonId: string; created: number; autoPublished: number; unavailable: string[] }>(MANAGE_URL(eventId), 'POST', { action: 'draftMonth', year: Number(draft.year), month: Number(draft.month) });
      setDraftResult(out);
      toast('success', `${out.created} drafts created. ${out.autoPublished} published automatically.`);
      await refresh();
    } catch (error: unknown) {
      toast('error', errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const issue = async () => {
    const out = await act<{ id: string; code: string; expiresAt: number }>({ action: 'issueStation', stationId: station.stationId.trim(), spaceId: station.spaceId, name: station.name }, 'Check-in code issued. Share it with staff at the station.');
    if (out) {
      setIssued(out);
      setStation({ stationId: '', spaceId: '', name: '' });
    }
  };

  const saveLevelTable = () => {
    void act({ action: 'saveLevels', levels }, 'Levels saved. Each change creates a new version.');
  };

  const adjustXp = async () => {
    const out = await act<{ xp: number }>({ action: 'adjustXp', userId: adjust.userId, amount: Number(adjust.amount), reason: adjust.reason }, 'XP adjusted and audited.');
    if (out) setAdjust({ userId: '', amount: '', reason: '' });
  };

  return (
    <div className="stack" style={{ gap: 18 }} aria-busy={busy}>
      <section className="panel" aria-labelledby="totals-heading">
        <h2 id="totals-heading" style={{ fontSize: '1rem', margin: '0 0 8px' }}>Participation</h2>
        <dl className="atlas-panel" style={{ margin: 0 }}>
          <dt>People who started a mission</dt><dd>{data.totals.participants}</dd>
          <dt>Missions verified</dt><dd>{data.totals.approvals}</dd>
          <dt>XP in circulation</dt><dd>{data.totals.xpAwarded}</dd>
          <dt>Waiting for review</dt><dd>{data.pendingReviews.length}</dd>
          <dt>Open flags</dt><dd>{data.flags.length}</dd>
        </dl>
        <p className="xs faint" style={{ margin: '8px 0 0' }}>Counts come from the attempt and ledger records. Flags are for review; none removes an award.</p>
      </section>

      {canReview ? (
        <section className="panel" aria-labelledby="queue-heading">
          <h2 id="queue-heading" style={{ fontSize: '1rem', margin: '0 0 10px' }}>Evidence waiting for review</h2>
          {data.pendingReviews.length === 0 ? <p className="small muted" style={{ margin: 0 }}>Nothing is waiting.</p> : (
            <ul className="stack" style={{ gap: 12, listStyle: 'none', padding: 0 }}>
              {data.pendingReviews.map((p) => (
                <li key={p.id} className="atlas-note" style={{ display: 'grid', gap: 8 }}>
                  <div className="small"><strong>{nameOf.get(p.userId) ?? 'Attendee'}</strong> · {data.missions.find((m) => m.id === p.missionId)?.title ?? p.missionId}{p.submittedAt ? ` · ${dateOf(p.submittedAt)}` : ''}</div>
                  <p className="small" style={{ margin: 0 }}>{p.text}</p>
                  <div className="field"><label htmlFor={`note-${p.id}`}>Note to the attendee (for a rejection)</label><input id={`note-${p.id}`} value={reviewNotes[p.id] ?? ''} maxLength={300} onChange={(e) => { setReviewNotes({ ...reviewNotes, [p.id]: e.target.value }); }} /></div>
                  <div className="stack" style={{ flexDirection: 'row', gap: 8 }}>
                    <button type="button" className="button" disabled={busy} onClick={() => { review(p.id, 'APPROVE'); }}>Approve</button>
                    <button type="button" className="button button--ghost" disabled={busy} onClick={() => { review(p.id, 'REJECT'); }}>Send back</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      <section className="panel" aria-labelledby="flags-heading">
        <h2 id="flags-heading" style={{ fontSize: '1rem', margin: '0 0 10px' }}>Flags to review</h2>
        <p className="xs faint" style={{ margin: '0 0 10px' }}>Automatic flags only. A flag asks for a look. It never removes XP or a badge.</p>
        {data.flags.length === 0 ? <p className="small muted" style={{ margin: 0 }}>No open flags.</p> : (
          <ul className="stack" style={{ gap: 8, listStyle: 'none', padding: 0 }}>
            {data.flags.map((f) => (
              <li key={f.id} className="small" style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'start' }}>
                <span><strong>{f.kind.replace(/_/g, ' ').toLowerCase()}</strong> · {f.detail} <span className="xs faint">{dateOf(f.createdAt)}</span></span>
                {canReview ? <button type="button" className="button button--ghost button--sm" disabled={busy} onClick={() => { void act({ action: 'dismissFlag', flagId: f.id }, 'Flag dismissed.'); }}>Dismiss</button> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {canManage ? (
        <>
          <section className="panel" aria-labelledby="stations-heading">
            <h2 id="stations-heading" style={{ fontSize: '1rem', margin: '0 0 10px' }}>Check-in stations</h2>
            <p className="xs faint" style={{ margin: '0 0 10px' }}>Issue a code for a station. It is shown once, expires after four hours, and only a hash is stored. Issuing again replaces the code.</p>
            <div className="atlas-form">
              <div className="field"><label htmlFor="st-id">Station id</label><input id="st-id" value={station.stationId} placeholder="st-registration" onChange={(e) => { setStation({ ...station, stationId: e.target.value }); }} /></div>
              <div className="field"><label htmlFor="st-name">Name</label><input id="st-name" value={station.name} maxLength={80} onChange={(e) => { setStation({ ...station, name: e.target.value }); }} /></div>
              <div className="field"><label htmlFor="st-space">Place</label><select id="st-space" value={station.spaceId} onChange={(e) => { setStation({ ...station, spaceId: e.target.value }); }}><option value="">Choose a place</option>{initial.spaces.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
              <button type="button" className="button" disabled={busy || !station.stationId || !station.spaceId || station.name.length < 2} onClick={() => { void issue(); }}>Issue code</button>
            </div>
            {issued ? (
              <div style={{ marginTop: 12 }} role="status">
                <p className="small" style={{ margin: '0 0 6px' }}>New code for <strong>{issued.id}</strong>. Valid until {dateOf(issued.expiresAt)}:</p>
                <span className="atlas-once" aria-label={`Check-in code ${issued.code.split('').join(' ')}`}>{issued.code}</span>
              </div>
            ) : null}
            <ul className="stack" style={{ gap: 6, listStyle: 'none', padding: 0, marginTop: 12 }}>
              {data.stations.map((s) => (
                <li key={s.id} className="small">{s.name} ({s.id}) · {s.codeExpiresAt === 0 ? 'no code issued yet' : `code valid until ${dateOf(s.codeExpiresAt)}`}</li>
              ))}
              {data.stations.length === 0 ? <li className="small muted">No stations yet. A check-in mission cannot be verified without one.</li> : null}
            </ul>
          </section>

          <section className="panel" aria-labelledby="missions-heading">
            <h2 id="missions-heading" style={{ fontSize: '1rem', margin: '0 0 10px' }}>Missions</h2>
            {data.missions.length === 0 ? <p className="small muted">No missions yet.</p> : (
              <div style={{ overflowX: 'auto' }}>
                <table className="atlas-table">
                  <caption className="sr-only">Missions and their completion counts</caption>
                  <thead><tr><th scope="col">Mission</th><th scope="col">Status</th><th scope="col">XP</th><th scope="col">Started</th><th scope="col">Verified</th><th scope="col">Waiting</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
                  <tbody>
                    {data.missions.map((m) => (
                      <tr key={m.id}>
                        <td><strong>{m.title}</strong><br /><span className="xs faint">{m.id}</span></td>
                        <td>{m.status}</td>
                        <td>{m.xp}</td>
                        <td>{m.started}</td>
                        <td>{m.approved}</td>
                        <td>{m.pending}</td>
                        <td>
                          <div className="stack" style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                            <button type="button" className="button button--ghost button--sm" onClick={() => { editMission(m); }}>Edit</button>
                            {m.status === 'PUBLISHED' ? <button type="button" className="button button--ghost button--sm" disabled={busy} onClick={() => { void act({ action: 'setMissionStatus', missionId: m.id, status: 'PAUSED' }, 'Mission paused.'); }}>Pause</button> : null}
                            {m.status !== 'PUBLISHED' ? <button type="button" className="button button--sm" disabled={busy} onClick={() => { void act({ action: 'setMissionStatus', missionId: m.id, status: 'PUBLISHED' }, 'Mission published.'); }}>Publish</button> : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <h3 style={{ fontSize: '0.95rem', margin: '18px 0 8px' }}>{mission.id ? `Edit ${mission.id}` : 'New mission'}</h3>
            <div className="atlas-form">
              <div className="field"><label htmlFor="m-id">Id</label><input id="m-id" value={mission.id} placeholder="fm-something" onChange={(e) => { setMission({ ...mission, id: e.target.value }); }} /></div>
              <div className="field"><label htmlFor="m-title">Title</label><input id="m-title" value={mission.title} maxLength={120} onChange={(e) => { setMission({ ...mission, title: e.target.value }); }} /></div>
              <div className="field wide"><label htmlFor="m-desc">Description</label><textarea id="m-desc" value={mission.description} maxLength={800} onChange={(e) => { setMission({ ...mission, description: e.target.value }); }} /></div>
              <div className="field wide"><label htmlFor="m-why">Why it matters</label><textarea id="m-why" value={mission.whyItMatters} maxLength={400} onChange={(e) => { setMission({ ...mission, whyItMatters: e.target.value }); }} /></div>
              <div className="field"><label htmlFor="m-cat">Category</label><select id="m-cat" value={mission.category} onChange={(e) => { setMission({ ...mission, category: e.target.value }); }}>{['EXPLORATION', 'PARTICIPATION', 'CONTRIBUTION', 'CONNECTION', 'COORDINATION'].map((c) => <option key={c} value={c}>{c.toLowerCase()}</option>)}</select></div>
              <div className="field"><label htmlFor="m-diff">Difficulty</label><select id="m-diff" value={mission.difficulty} onChange={(e) => { setMission({ ...mission, difficulty: e.target.value }); }}>{['EASY', 'MEDIUM', 'HARD'].map((c) => <option key={c} value={c}>{c.toLowerCase()}</option>)}</select></div>
              <div className="field"><label htmlFor="m-level">Required level (0 to 20)</label><input id="m-level" type="number" min={0} max={20} value={mission.requiredLevel} onChange={(e) => { setMission({ ...mission, requiredLevel: e.target.value }); }} /></div>
              <div className="field"><label htmlFor="m-xp">XP reward (1 to 500)</label><input id="m-xp" type="number" min={1} max={500} value={mission.xp} onChange={(e) => { setMission({ ...mission, xp: e.target.value }); }} /></div>
              <div className="field"><label htmlFor="m-space">Place (blank means no location)</label><select id="m-space" value={mission.spaceId} onChange={(e) => { setMission({ ...mission, spaceId: e.target.value }); }}><option value="">No location</option>{initial.spaces.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
              <div className="field"><label htmlFor="m-season">Monthly challenge</label><select id="m-season" value={mission.seasonId} onChange={(e) => { setMission({ ...mission, seasonId: e.target.value }); }}><option value="">None</option>{data.seasons.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}</select></div>
              <div className="field"><label htmlFor="m-method">How it is verified</label><select id="m-method" value={mission.method} onChange={(e) => { setMission({ ...mission, method: e.target.value }); }}><option value="MANUAL_REVIEW">Organiser reviews evidence</option><option value="CHECK_IN">Staff check-in code</option><option value="WORKFLOW_RUN">A real workflow run</option></select></div>
              {mission.method === 'WORKFLOW_RUN' ? <div className="field"><label htmlFor="m-wf">Workflow</label><select id="m-wf" value={mission.workflowId} onChange={(e) => { setMission({ ...mission, workflowId: e.target.value }); }}>{initial.workflows.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></div> : null}
              {mission.method === 'CHECK_IN' ? <div className="field"><label htmlFor="m-st">Station</label><select id="m-st" value={mission.stationId} onChange={(e) => { setMission({ ...mission, stationId: e.target.value }); }}><option value="">Choose a station</option>{data.stations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div> : null}
              {mission.method === 'MANUAL_REVIEW' ? <div className="field"><label htmlFor="m-prompt">What the attendee should describe</label><input id="m-prompt" value={mission.evidencePrompt} maxLength={240} onChange={(e) => { setMission({ ...mission, evidencePrompt: e.target.value }); }} /></div> : null}
              <div className="field"><label htmlFor="m-min">Minutes (optional)</label><input id="m-min" type="number" min={1} max={480} value={mission.estimateMinutes} onChange={(e) => { setMission({ ...mission, estimateMinutes: e.target.value }); }} /></div>
              <div className="field"><label htmlFor="m-acc">Accessibility note</label><input id="m-acc" value={mission.accessibilityNote} maxLength={400} onChange={(e) => { setMission({ ...mission, accessibilityNote: e.target.value }); }} /></div>
              <div className="field"><label htmlFor="m-status">Status</label><select id="m-status" value={mission.status} onChange={(e) => { setMission({ ...mission, status: e.target.value }); }}><option value="DRAFT">Draft (hidden)</option><option value="PUBLISHED">Published</option><option value="PAUSED">Paused</option></select></div>
              <div className="stack" style={{ flexDirection: 'row', gap: 8 }}>
                <button type="button" className="button" disabled={busy || !mission.id || !mission.title || !mission.description || !mission.whyItMatters} onClick={saveMission}>Save mission</button>
                {mission.id ? <button type="button" className="button button--ghost" onClick={() => { setMission(blankMission); }}>Clear</button> : null}
              </div>
            </div>
          </section>

          <section className="panel" aria-labelledby="seasons-heading">
            <h2 id="seasons-heading" style={{ fontSize: '1rem', margin: '0 0 10px' }}>Monthly challenges</h2>
            <ul className="stack" style={{ gap: 6, listStyle: 'none', padding: 0 }}>
              {data.seasons.map((s) => (
                <li key={s.id} className="small"><strong>{s.title}</strong> · {s.status} · {dateOf(s.startsAt).slice(0, 10)} to {dateOf(s.endsAt).slice(0, 10)} · {s.requiredMissionIds.length} required of {s.missionIds.length} · {s.source.toLowerCase()}</li>
              ))}
              {data.seasons.length === 0 ? <li className="small muted">No challenges yet.</li> : null}
            </ul>
            <div className="atlas-form" style={{ marginTop: 14 }}>
              <div className="field"><label htmlFor="d-year">Draft a month: year</label><input id="d-year" type="number" value={draft.year} onChange={(e) => { setDraft({ ...draft, year: e.target.value }); }} /></div>
              <div className="field"><label htmlFor="d-month">Month</label><input id="d-month" type="number" min={1} max={12} value={draft.month} onChange={(e) => { setDraft({ ...draft, month: e.target.value }); }} /></div>
              <button type="button" className="button" disabled={busy} onClick={() => { void draftMonth(); }}>Draft from the venue and schedule</button>
            </div>
            <p className="xs faint" style={{ margin: '6px 0 0' }}>Drafts come from real rooms, check-in stations, and workflows. Gaps are listed, not guessed. Only low-risk workflow missions publish themselves; the rest wait here.</p>
            {draftResult ? (
              <div className="atlas-note" style={{ marginTop: 10 }} role="status">
                <strong>{draftResult.created} drafts for {draftResult.seasonId}.</strong> {draftResult.autoPublished} published automatically.
                {draftResult.unavailable.length > 0 ? <ul className="xs" style={{ margin: '6px 0 0', paddingLeft: 18 }}>{draftResult.unavailable.map((u) => <li key={u}>Not available: {u}</li>)}</ul> : null}
              </div>
            ) : null}
            <h3 style={{ fontSize: '0.95rem', margin: '18px 0 8px' }}>{season.id ? `Edit ${season.id}` : 'New challenge'}</h3>
            <div className="atlas-form">
              <div className="field"><label htmlFor="s-id">Id</label><input id="s-id" value={season.id} placeholder="season-2026-12" onChange={(e) => { setSeason({ ...season, id: e.target.value }); }} /></div>
              <div className="field"><label htmlFor="s-year">Year</label><input id="s-year" type="number" value={season.year} onChange={(e) => { setSeason({ ...season, year: e.target.value }); }} /></div>
              <div className="field"><label htmlFor="s-month">Month (UTC)</label><input id="s-month" type="number" min={1} max={12} value={season.month} onChange={(e) => { setSeason({ ...season, month: e.target.value }); }} /></div>
              <div className="field"><label htmlFor="s-title">Title</label><input id="s-title" value={season.title} maxLength={120} onChange={(e) => { setSeason({ ...season, title: e.target.value }); }} /></div>
              <div className="field"><label htmlFor="s-theme">Theme</label><input id="s-theme" value={season.theme} maxLength={160} onChange={(e) => { setSeason({ ...season, theme: e.target.value }); }} /></div>
              <div className="field wide"><label htmlFor="s-desc">Description</label><textarea id="s-desc" value={season.description} maxLength={600} onChange={(e) => { setSeason({ ...season, description: e.target.value }); }} /></div>
              <div className="field"><label htmlFor="s-art">Badge artwork</label><select id="s-art" value={season.artwork} onChange={(e) => { setSeason({ ...season, artwork: e.target.value }); }}>{['compass', 'route', 'hands', 'lens', 'bridge'].map((a) => <option key={a} value={a}>{a}</option>)}</select></div>
              <div className="field"><label htmlFor="s-bonus">Bonus XP (0 to 1000)</label><input id="s-bonus" type="number" min={0} max={1000} value={season.bonusXp} onChange={(e) => { setSeason({ ...season, bonusXp: e.target.value }); }} /></div>
              <div className="field"><label htmlFor="s-missions">Mission ids (comma separated)</label><input id="s-missions" value={season.missionIds} onChange={(e) => { setSeason({ ...season, missionIds: e.target.value }); }} /></div>
              <div className="field"><label htmlFor="s-required">Required mission ids</label><input id="s-required" value={season.requiredMissionIds} onChange={(e) => { setSeason({ ...season, requiredMissionIds: e.target.value }); }} /></div>
              <div className="field"><label htmlFor="s-status">Status</label><select id="s-status" value={season.status} onChange={(e) => { setSeason({ ...season, status: e.target.value }); }}><option value="DRAFT">Draft (hidden)</option><option value="PUBLISHED">Published</option><option value="PAUSED">Paused</option></select></div>
              <button type="button" className="button" disabled={busy || !season.id || !season.title || !season.theme} onClick={saveSeason}>Save challenge</button>
            </div>
          </section>

          <section className="panel" aria-labelledby="levels-heading">
            <h2 id="levels-heading" style={{ fontSize: '1rem', margin: '0 0 10px' }}>Levels</h2>
            <p className="xs faint" style={{ margin: '0 0 10px' }}>Changing a level creates a new version. Attendees’ XP is never edited by this form.</p>
            <div style={{ overflowX: 'auto' }}>
              <table className="atlas-table">
                <caption className="sr-only">Level table</caption>
                <thead><tr><th scope="col">Name</th><th scope="col">Minimum XP</th><th scope="col">Active</th></tr></thead>
                <tbody>
                  {levels.map((l, i) => (
                    <tr key={l.id}>
                      <td><label className="sr-only" htmlFor={`lv-name-${l.id}`}>Name for {l.id}</label><input id={`lv-name-${l.id}`} value={l.name} maxLength={60} onChange={(e) => { setLevels(levels.map((x, j) => (j === i ? { ...x, name: e.target.value } : x))); }} /></td>
                      <td><label className="sr-only" htmlFor={`lv-xp-${l.id}`}>Minimum XP for {l.id}</label><input id={`lv-xp-${l.id}`} type="number" min={0} value={l.minXp} onChange={(e) => { setLevels(levels.map((x, j) => (j === i ? { ...x, minXp: Number(e.target.value) } : x))); }} /></td>
                      <td><label className="sr-only" htmlFor={`lv-on-${l.id}`}>{l.id} active</label><input id={`lv-on-${l.id}`} type="checkbox" checked={l.active} onChange={(e) => { setLevels(levels.map((x, j) => (j === i ? { ...x, active: e.target.checked } : x))); }} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button type="button" className="button" style={{ marginTop: 10 }} disabled={busy} onClick={saveLevelTable}>Save levels</button>
          </section>

          <section className="panel" aria-labelledby="adjust-heading">
            <h2 id="adjust-heading" style={{ fontSize: '1rem', margin: '0 0 10px' }}>Adjust XP (audited)</h2>
            <p className="xs faint" style={{ margin: '0 0 10px' }}>Adds a new, signed ledger entry with a reason. It never edits or deletes an existing entry.</p>
            <div className="atlas-form">
              <div className="field"><label htmlFor="adj-person">Person</label><select id="adj-person" value={adjust.userId} onChange={(e) => { setAdjust({ ...adjust, userId: e.target.value }); }}><option value="">Choose a person</option>{initial.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
              <div className="field"><label htmlFor="adj-amount">Change (−500 to 500, not 0)</label><input id="adj-amount" type="number" value={adjust.amount} onChange={(e) => { setAdjust({ ...adjust, amount: e.target.value }); }} /></div>
              <div className="field wide"><label htmlFor="adj-reason">Reason (kept in the audit trail)</label><input id="adj-reason" value={adjust.reason} maxLength={300} onChange={(e) => { setAdjust({ ...adjust, reason: e.target.value }); }} /></div>
              <button type="button" className="button" disabled={busy || !adjust.userId || adjust.amount === '' || adjust.reason.length < 10} onClick={() => { void adjustXp(); }}>Record adjustment</button>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
