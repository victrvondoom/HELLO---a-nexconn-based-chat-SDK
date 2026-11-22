'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useFeedback } from '@/components/ui/Feedback';
import { LIVE_CATEGORIES, LIVE_CATEGORY_LABEL, type LiveCategory } from '@/domain/live/rules';
import type { LiveFeed, LiveFeedItem, LiveHoldView } from '@/services/live';

/**
 * LiveScene and LiveShield, as one page. Attendees see live reports about places, with reporters anonymous.
 * Staff also see the moderation queue and the holds, and can act on them. Every action is checked again on the
 * server; hiding a control here is never the security boundary.
 */

interface SpaceOption {
  id: string;
  name: string;
  floor: number;
}

interface Props {
  eventId: string;
  initial: LiveFeed;
  spaces: SpaceOption[];
  zones: string[];
}

const PROMOTABLE: readonly LiveCategory[] = ['SAFETY', 'TECHNICAL', 'CROWD', 'ACCESSIBILITY'];

const RESOLUTION_LABEL: Record<LiveFeedItem['resolution'], string> = {
  REPORTED: 'Reported, not yet taken on',
  BEING_HANDLED: 'Being handled by the team',
  RESOLUTION_PENDING_CONFIRMATION: 'Marked resolved; waiting for the reporter to confirm',
  VERIFIED_RESOLVED: 'Resolved and confirmed by the reporter',
  CANCELLED: 'Cancelled',
  DISMISSED: 'Dismissed after review',
};

type Outcome = { ok: true; data: unknown } | { ok: false; message: string };

async function post(url: string, body: unknown): Promise<Outcome> {
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const json = (await response.json()) as { ok: true; data: unknown } | { ok: false; error: { message: string } };
  return json.ok ? { ok: true, data: json.data } : { ok: false, message: json.error.message };
}

function minutesFrom(later: number, earlier: number): number {
  return Math.max(0, Math.round((later - earlier) / 60000));
}

export function LiveScene({ eventId, initial, spaces, zones }: Props) {
  const router = useRouter();
  const { toast, confirm } = useFeedback();
  const [busy, setBusy] = useState<string | null>(null);
  const [spaceId, setSpaceId] = useState(spaces[0]?.id ?? '');
  const [category, setCategory] = useState<LiveCategory>('CROWD');
  const [text, setText] = useState('');
  const [guidance, setGuidance] = useState<string | null>(null);
  const [promoteAs, setPromoteAs] = useState<Record<string, LiveCategory>>({});
  const [dismissReason, setDismissReason] = useState<Record<string, string>>({});
  const [holdReason, setHoldReason] = useState<Record<string, string>>({});
  const [scopeKind, setScopeKind] = useState<'ZONE' | 'REPORT' | 'EVENT'>('ZONE');
  const [zone, setZone] = useState(zones[0] ?? '');
  const [reportForHold, setReportForHold] = useState(initial.queue[0]?.id ?? initial.reports[0]?.id ?? '');
  const [holdText, setHoldText] = useState('');
  const [holdMinutes, setHoldMinutes] = useState(60);

  const staff = initial.viewer === 'STAFF';
  const now = initial.now;

  function run(key: string, action: () => Promise<Outcome>, onSuccess: (data: unknown) => void): void {
    void execute(key, action, onSuccess);
  }

  async function execute(key: string, action: () => Promise<Outcome>, onSuccess: (data: unknown) => void) {
    setBusy(key);
    try {
      const outcome = await action();
      if (!outcome.ok) {
        toast('error', outcome.message);
        return;
      }
      onSuccess(outcome.data);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  function sendReport(event: { preventDefault: () => void }) {
    event.preventDefault();
    run(
      'report',
      () => post(`/api/events/${eventId}/live/reports`, { spaceId, category, text }),
      (data) => {
        const result = data as { guidance: string | null };
        setText('');
        setGuidance(result.guidance);
        toast('success', 'Report sent. It stays live for a limited time, then leaves this view.');
      },
    );
  }

  function promote(item: LiveFeedItem) {
    const chosen = promoteAs[item.id] ?? (PROMOTABLE.includes(item.category) ? item.category : 'TECHNICAL');
    run(
      `promote:${item.id}`,
      () => post(`/api/events/${eventId}/live/reports/${item.id}`, { action: 'promote', category: chosen }),
      (data) => {
        const result = data as { alreadyPromoted: boolean; attached: boolean };
        toast('success', result.alreadyPromoted ? 'Already an incident. Showing it.' : result.attached ? 'Attached to an existing incident.' : 'Opened as an incident.');
      },
    );
  }

  function dismiss(item: LiveFeedItem) {
    const reason = (dismissReason[item.id] ?? '').trim();
    if (reason.length < 5) {
      toast('error', 'Give the reason in at least five characters.');
      return;
    }
    run(
      `dismiss:${item.id}`,
      () => post(`/api/events/${eventId}/live/reports/${item.id}`, { action: 'dismiss', reason }),
      () => { toast('success', 'Dismissed. The reason is kept in the record.'); },
    );
  }

  async function placeHold() {
    if (holdText.trim().length < 10) {
      toast('error', 'Give the reason in at least ten characters.');
      return;
    }
    const scope =
      scopeKind === 'EVENT'
        ? { kind: 'EVENT' as const }
        : scopeKind === 'ZONE'
          ? { kind: 'ZONE' as const, zone }
          : { kind: 'REPORT' as const, reportId: reportForHold };
    const ok = await confirm({
      title: 'Suspend the public live view?',
      body: 'Attendees will not see live reports for this scope until a different organiser releases the hold. Private messages and other communities are not affected.',
      confirmLabel: 'Place hold',
      tone: 'danger',
    });
    if (!ok) return;
    run(
      'hold',
      () => post(`/api/events/${eventId}/live/holds`, { scope, reason: holdText.trim(), durationMinutes: holdMinutes }),
      () => {
        setHoldText('');
        toast('success', 'Hold placed. It needs a decision by the time shown.');
      },
    );
  }

  async function release(hold: LiveHoldView) {
    const reason = (holdReason[hold.id] ?? '').trim();
    if (reason.length < 5) {
      toast('error', 'Give the reason in at least five characters.');
      return;
    }
    const ok = await confirm({
      title: 'Restore the live view?',
      body: `The live view for ${hold.scopeLabel.toLowerCase()} will be shown again to attendees.`,
      confirmLabel: 'Release hold',
      tone: 'default',
    });
    if (!ok) return;
    run(
      `release:${hold.id}`,
      () => post(`/api/events/${eventId}/live/holds/${hold.id}`, { reason }),
      () => { toast('success', 'Hold released. The live view is shown again for its scope.'); },
    );
  }

  return (
    <div className="stack">
      {initial.state === 'HOLDS_UNAVAILABLE' ? (
        <div className="card" role="status">
          <div className="card__body">
            <p className="small">
              Safety status could not be checked just now, so attendees see only their own reports. Staff are told this
              on every page that depends on it.
            </p>
          </div>
        </div>
      ) : null}

      {guidance ? (
        <div className="card card--raised" role="alert">
          <div className="card__body stack">
            <strong>If someone is in danger now</strong>
            <p className="small">{guidance}</p>
            <button type="button" className="button button--ghost" onClick={() => { setGuidance(null); }}>
              Dismiss this message
            </button>
          </div>
        </div>
      ) : null}

      <section className="card" aria-labelledby="send-report">
        <div className="card__body stack">
          <h2 id="send-report">Report a place</h2>
          {spaces.length === 0 ? (
            <p className="small muted">The venue map has no places yet. Organisers add them on the venue map.</p>
          ) : (
            <form className="stack" onSubmit={sendReport}>
              <label className="field">
                <span>Place</span>
                <select value={spaceId} onChange={(event) => { setSpaceId(event.target.value); }}>
                  {spaces.map((space) => (
                    <option key={space.id} value={space.id}>
                      {space.name} (floor {space.floor + 1})
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>What is it?</span>
                <select value={category} onChange={(event) => { setCategory(event.target.value as LiveCategory); }}>
                  {LIVE_CATEGORIES.map((value) => (
                    <option key={value} value={value}>
                      {LIVE_CATEGORY_LABEL[value]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Describe it in a few words</span>
                <textarea value={text} maxLength={500} rows={2} onChange={(event) => { setText(event.target.value); }} required />
              </label>
              <p className="small faint">Your name is not shown with this report to other attendees. Staff can see who sent it.</p>
              <button type="submit" className="button" disabled={busy !== null || text.trim().length < 4}>
                {busy === 'report' ? 'Sending…' : 'Send report'}
              </button>
            </form>
          )}
        </div>
      </section>

      <section className="card" aria-labelledby="live-now">
        <div className="card__body stack">
          <h2 id="live-now">Live now</h2>
          {initial.reports.length === 0 ? (
            <p className="empty">Nothing live right now. Reports leave this list when their time is up.</p>
          ) : (
            <ul className="stack list-reset">
              {initial.reports.map((item) => (
                <li key={item.id} className="stack">
                  <div className="row">
                    <strong>{item.categoryLabel}</strong>
                    <span className="small muted">
                      {item.spaceName} · {minutesFrom(now, item.reportedAt)} min ago · live for {minutesFrom(item.expiresAt, now)} more min
                    </span>
                    {item.mine ? <span className="badge">Yours</span> : null}
                    {item.underReview ? <span className="badge badge--warning">Under review</span> : null}
                  </div>
                  {item.text ? <p className="small">{item.text}</p> : null}
                  <p className="small faint">{RESOLUTION_LABEL[item.resolution]}</p>
                  {item.clusterSize > 1 ? (
                    <p className="small faint">
                      Grouped with {item.clusterSize - 1} other report{item.clusterSize - 1 === 1 ? '' : 's'} by place, zone and time. This is a grouping, not confirmation that they are one problem.
                    </p>
                  ) : null}
                  {staff && item.reporterName ? <p className="small faint">Sent by {item.reporterName}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {staff ? (
        <section className="card" aria-labelledby="queue">
          <div className="card__body stack">
            <h2 id="queue">Safety queue</h2>
            <p className="small muted">Reports the safety check flagged. Each needs a decision: promote it to an incident, or dismiss it with a reason.</p>
            {initial.queue.length === 0 ? (
              <p className="empty">No safety report is waiting for a decision.</p>
            ) : (
              <ul className="stack list-reset">
                {initial.queue.map((item) => (
                  <li key={item.id} className="stack">
                    <div className="row">
                      <span className="badge badge--danger">{item.safetySignal ? `Flagged: ${item.safetySignal.toLowerCase()}` : 'Flagged'}</span>
                      <strong>{item.categoryLabel}</strong>
                      <span className="small muted">{item.spaceName}</span>
                    </div>
                    {item.text ? <p className="small">{item.text}</p> : null}
                    {item.reporterName ? <p className="small faint">Sent by {item.reporterName}</p> : null}
                    <div className="row">
                      {PROMOTABLE.includes(item.category) ? (
                        <>
                          <select
                            aria-label="Incident kind"
                            value={promoteAs[item.id] ?? item.category}
                            onChange={(event) => { setPromoteAs((state) => ({ ...state, [item.id]: event.target.value as LiveCategory })); }}
                          >
                            {PROMOTABLE.map((value) => (
                              <option key={value} value={value}>
                                {LIVE_CATEGORY_LABEL[value]}
                              </option>
                            ))}
                          </select>
                          <button type="button" className="button" disabled={busy !== null} onClick={() => { promote(item); }}>
                            Open incident
                          </button>
                        </>
                      ) : null}
                      <input
                        aria-label="Reason for dismissing"
                        placeholder="Reason to dismiss"
                        value={dismissReason[item.id] ?? ''}
                        onChange={(event) => { setDismissReason((state) => ({ ...state, [item.id]: event.target.value })); }}
                      />
                      <button type="button" className="button button--ghost" disabled={busy !== null} onClick={() => { dismiss(item); }}>
                        Dismiss
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      ) : null}

      {staff ? (
        <section className="card" aria-labelledby="holds">
          <div className="card__body stack">
            <h2 id="holds">Safety holds</h2>
            <p className="small muted">
              A hold suspends the public live view for its scope. It stays in force until a different organiser releases it. It does not
              touch private messages or other communities.
            </p>
            {initial.holds.length === 0 ? (
              <p className="empty">No hold is in force.</p>
            ) : (
              <ul className="stack list-reset">
                {initial.holds.map((hold) => (
                  <li key={hold.id} className="stack">
                    <div className="row">
                      <strong>{hold.scopeLabel}</strong>
                      {hold.overdue ? <span className="badge badge--danger">Decision overdue: still in force</span> : <span className="badge badge--warning">In force</span>}
                    </div>
                    <p className="small">
                      {hold.reason} · placed by {hold.placedByName} · decision due {new Date(hold.decisionDueAt).toISOString().slice(11, 16)} UTC
                    </p>
                    {hold.canRelease ? (
                      <div className="row">
                        <input
                          aria-label="Reason for releasing"
                          placeholder="Reason to release"
                          value={holdReason[hold.id] ?? ''}
                          onChange={(event) => { setHoldReason((state) => ({ ...state, [hold.id]: event.target.value })); }}
                        />
                        <button type="button" className="button" disabled={busy !== null} onClick={() => { void release(hold); }}>
                          Release hold
                        </button>
                      </div>
                    ) : (
                      <p className="small faint">Another organiser must release this hold.</p>
                    )}
                  </li>
                ))}
              </ul>
            )}

            <form
              className="stack"
              onSubmit={(event) => {
                event.preventDefault();
                void placeHold();
              }}
            >
              <h3>Place a hold</h3>
              <label className="field">
                <span>Scope</span>
                <select value={scopeKind} onChange={(event) => { setScopeKind(event.target.value as typeof scopeKind); }}>
                  <option value="ZONE">One zone</option>
                  <option value="REPORT">One report</option>
                  <option value="EVENT">Whole event (organisers only)</option>
                </select>
              </label>
              {scopeKind === 'ZONE' ? (
                <label className="field">
                  <span>Zone</span>
                  <select value={zone} onChange={(event) => { setZone(event.target.value); }}>
                    {zones.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {scopeKind === 'REPORT' ? (
                <label className="field">
                  <span>Report</span>
                  <select value={reportForHold} onChange={(event) => { setReportForHold(event.target.value); }}>
                    {[...initial.queue, ...initial.reports.filter((r) => !initial.queue.some((q) => q.id === r.id))].map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.categoryLabel} at {item.spaceName}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className="field">
                <span>Reason</span>
                <textarea rows={2} value={holdText} onChange={(event) => { setHoldText(event.target.value); }} required />
              </label>
              <label className="field">
                <span>Decision due in</span>
                <select value={holdMinutes} onChange={(event) => { setHoldMinutes(Number(event.target.value)); }}>
                  <option value={30}>30 minutes</option>
                  <option value={60}>1 hour</option>
                  <option value={120}>2 hours</option>
                  <option value={240}>4 hours</option>
                </select>
              </label>
              <button type="submit" className="button" disabled={busy !== null || holdText.trim().length < 10}>
                Place hold
              </button>
            </form>
          </div>
        </section>
      ) : null}

      <p className="small faint">Live as of {new Date(now).toISOString().slice(11, 16)} UTC. This page refreshes when something changes.</p>
    </div>
  );
}
