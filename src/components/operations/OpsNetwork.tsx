import Link from 'next/link';
import { agentsFromAnalysis, agentTimeline } from '@/domain/ops/agents';
import { BENCHMARKS } from '@/domain/ops/bench';
import { previewTimeline } from '@/domain/ops/preview';
import { visibleAt } from '@/domain/ops/temporal';
import { INCIDENT_DISRUPTION, worldFromEvent } from '@/domain/resilience/event-world';
import { resolve } from '@/domain/resilience/repair';
import { maskOf } from '@/domain/resilience/world';
import { isOpen } from '@/domain/incidents/lifecycle';
import type { ServiceContext } from '@/services/context';
import { ledgerEntries } from '@/services/ops/action-ledger';
import { PROVIDERS } from '@/services/ops/providers';
import { HandoffControls } from './HandoffControls';
import { LabRunner } from './LabRunner';
import { OpsStatus } from './OpsStatus';

const clock = (ms: number) => new Date(ms).toISOString().slice(11, 16);
const LOOP: Array<[string, Parameters<typeof OpsStatus>[0]['status']]> = [
  ['Incident', 'LIVE_VERIFIED'], ['Evidence', 'LIVE_VERIFIED'], ['Reconstruction', 'LOCAL_SIMULATION'], ['Recovery proposal', 'LIVE_VERIFIED'],
  ['Verification (256 subsets)', 'LIVE_VERIFIED'], ['Human approval', 'LIVE_VERIFIED'], ['Execution', 'LIVE_VERIFIED'], ['Confirmation', 'LIVE_VERIFIED'],
];

/** Operations → Network: the core loop, each panel labelled with what it really is. */
export async function OpsNetwork({ ctx, eventId, viewerId, canRun }: { ctx: ServiceContext; eventId: string; viewerId: string; canRun: boolean }) {
  const [incidents, rooms, sessions, entries, owners] = await Promise.all([ctx.store.listIncidents(eventId), ctx.store.listRooms(eventId), ctx.store.listSessions(eventId), ledgerEntries(ctx.store, eventId), ctx.store.docList('incidentOwnership', { eventId })]);
  const open = incidents.filter((i) => isOpen(i.status));
  const focus = open.find((i) => i.roomId) ?? null;
  const ew = worldFromEvent({ eventId, rooms, sessions, now: ctx.now(), incidentRoomId: focus?.roomId ?? null });
  const records = focus && ew.world.sessions.length ? agentsFromAnalysis(resolve(ew.world, ew.baseline, maskOf([INCIDENT_DISRUPTION[focus.category]])), `incident:${focus.id}`) : [];
  const start = Math.min(...sessions.map((s) => s.startsAt));
  const preview = previewTimeline(Number.isFinite(start) ? start : ctx.now());
  const ownerOf = new Map(owners.map((o) => [o.id, o] as const));

  return (
    <div className="stack" style={{ gap: 16 }}>
      <section className="card card__body stack" aria-labelledby="loop-heading" style={{ gap: 8 }}>
        <h2 id="loop-heading">The core loop</h2>
        <p className="small muted" style={{ margin: 0 }}>An event should not collapse because something went wrong. HELLO detects, reconstructs, verifies and coordinates what happens next.</p>
        <ol className="list-reset row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {LOOP.map(([stage, status], i) => (
            <li key={stage} className="row" style={{ gap: 4, alignItems: 'center' }}>
              <span className="small">{i + 1}. {stage}</span> <OpsStatus status={status} />
            </li>
          ))}
        </ol>
      </section>

      <section className="card card__body stack" aria-labelledby="agents-heading" style={{ gap: 8 }}>
        <div className="split-meta"><h2 id="agents-heading">Agent team</h2><OpsStatus status="LOCAL_SIMULATION" /></div>
        <p className="xs faint" style={{ margin: 0 }}>Derived deterministically from a real Steadfast run{focus ? ` for “${focus.title}”` : ''}. No language model is configured; no agent can approve or execute.</p>
        {records.length === 0 ? <p className="small muted" style={{ margin: 0 }}>No open room incident with upcoming sessions to investigate.</p> : (
          <>
            <ol className="list-reset row" style={{ gap: 4, flexWrap: 'wrap' }} aria-label="Agent activity">
              {agentTimeline(records).map((t) => <li key={t.step} className="xs faint">{t.step}. {t.role.toLowerCase()} · {t.state.toLowerCase().replace(/_/g, ' ')}</li>)}
            </ol>
            <ul className="list-reset list-divided">
              {records.map((r) => (
                <li key={r.id} style={{ padding: '8px 0' }}>
                  <div className="split-meta"><strong className="small">{r.role.charAt(0) + r.role.slice(1).toLowerCase()}</strong><span className="xs faint">{r.state.toLowerCase().replace(/_/g, ' ')} · confidence {r.confidence}</span></div>
                  <p className="small" style={{ margin: '2px 0' }}>{r.conclusion}</p>
                  <p className="xs faint" style={{ margin: 0 }}>Evidence: {r.evidence.join(', ')}{r.rejectedAlternatives.length ? ` · ${r.rejectedAlternatives.length} rejected alternative(s)` : ''}</p>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="card card__body stack" aria-labelledby="handoff-heading" style={{ gap: 8 }}>
        <div className="split-meta"><h2 id="handoff-heading">Incident ownership</h2><OpsStatus status="LIVE_VERIFIED" /></div>
        <p className="xs faint" style={{ margin: 0 }}>Stored in HELLO and enforced on the server. The incident keeps one conversation; automation runs only in AI triage. Mirroring into a Nexconn channel is planned.</p>
        <ul className="list-reset list-divided">
          {open.slice(0, 6).map((i) => {
            const o = ownerOf.get(i.id);
            return (
              <li key={i.id} className="split-meta" style={{ padding: '8px 0', gap: 8, flexWrap: 'wrap' }}>
                <span><Link href={`/events/${eventId}/incidents/${i.id}`}>{i.title}</Link><span className="xs faint"> · {(o?.state ?? 'AI_TRIAGE').toLowerCase().replace(/_/g, ' ')}{o?.ownerUserId ? ` · owner ${o.ownerUserId === viewerId ? 'you' : 'staff'}` : ''}</span></span>
                <HandoffControls eventId={eventId} incidentId={i.id} state={o?.state ?? 'AI_TRIAGE'} viewerId={viewerId} />
              </li>
            );
          })}
        </ul>
      </section>

      <section className="card card__body stack" aria-labelledby="ledger-heading" style={{ gap: 8 }}>
        <div className="split-meta"><h2 id="ledger-heading">Action ledger</h2><OpsStatus status="LIVE_VERIFIED" /></div>
        <p className="xs faint" style={{ margin: 0 }}>Append-only, sequence-numbered, idempotent. Steadfast approvals and rejections are recorded here.</p>
        {entries.length === 0 ? <p className="small muted" style={{ margin: 0 }}>No consequential action has been decided yet.</p> : (
          <ol className="list-reset list-divided">
            {entries.slice(-8).reverse().map((e) => <li key={e.id} className="small" style={{ padding: '6px 0' }}>#{e.seq} {e.kind.toLowerCase().replace(/_/g, ' ')} · {e.outcome.toLowerCase()} · v{e.versionBefore}→v{e.versionAfter} · {clock(e.at)} UTC</li>)}
          </ol>
        )}
      </section>

      <section className="card card__body stack" aria-labelledby="timeline-heading" style={{ gap: 8 }}>
        <div className="split-meta"><h2 id="timeline-heading">Event timeline</h2><OpsStatus status="PREVIEW" /></div>
        <p className="xs faint" style={{ margin: 0 }}>Sample events, not live Nexconn messages. Ordered by the real temporal engine: intended time, then sequence; held messages appear only at their release time.</p>
        <ol className="list-reset list-divided">
          {visibleAt(preview, Number.POSITIVE_INFINITY).map((e) => <li key={e.id} className="small" style={{ padding: '6px 0' }}><span className="today__time">{clock(e.intendedAt)}</span> #{e.seq} {e.text} <span className="xs faint">(released {clock(e.releaseAt)})</span></li>)}
        </ol>
      </section>

      <section className="card card__body stack" aria-labelledby="lab-heading" style={{ gap: 8 }}>
        <div className="split-meta"><h2 id="lab-heading">Reliability Lab</h2><OpsStatus status="LOCAL_SIMULATION" /></div>
        <p className="xs faint" style={{ margin: 0 }}>{BENCHMARKS.length} benchmarks over HELLO&apos;s real code on an isolated scratch store: {BENCHMARKS.map((b) => b.title.toLowerCase()).join(', ')}.</p>
        {canRun ? <LabRunner eventId={eventId} /> : <p className="small muted" style={{ margin: 0 }}>Operations staff and organisers can run it.</p>}
        <div className="table-wrap">
          <table>
            <thead><tr><th scope="col">Comparison</th><th scope="col">Result</th></tr></thead>
            <tbody>
              <tr><td>HELLO</td><td className="small">Run above; reproduce with <code>npx vitest run tests/reliability/lab.test.ts</code></td></tr>
              <tr><td>External baselines</td><td className="small muted">None submitted. Only reproducible results with their commands are listed; none are estimated.</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="card card__body stack" aria-labelledby="providers-heading" style={{ gap: 8 }}>
        <h2 id="providers-heading">Integration contracts</h2>
        <ul className="list-reset list-divided">
          {PROVIDERS.map((p) => (
            <li key={p.name} style={{ padding: '6px 0' }}>
              <div className="split-meta"><strong className="small">{p.name}</strong><OpsStatus status={p.status} /></div>
              <p className="xs faint" style={{ margin: 0 }}>{p.implementation} Remaining: {p.remaining}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
