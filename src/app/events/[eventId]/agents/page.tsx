import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadEventViewer } from '@/lib/viewer';
import { parseStoredOutcome } from '@/lib/validation/outcome';
import { AGENT_ROSTER, GROUNDING_LABEL, GROUNDING_LEVELS, type AgentScope, type Grounding } from '@/agents/types';
import { AgentTrace } from '@/components/conversation/AgentTrace';
import { formatUtc } from '@/components/ui/labels';
import { DATA_SOURCE_LABEL } from '@/domain/labels';

export const dynamic = 'force-dynamic';

const SCOPE_LABEL: Record<AgentScope, string> = {
  READ_ONLY: 'Read only',
  EXTERNAL_READ: 'Web, read only',
  ACTS_THROUGH_SERVICES: 'Acts via services',
};

/**
 * Agent mesh: who the agents are, what they may do, how they are configured, and what they did
 * recently. Staff only. Every figure is computed from stored message traces when the page loads.
 */
export default async function AgentsPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const viewer = await loadEventViewer(eventId);
  if (!viewer.can('incident.read.operational')) notFound();

  const [messages, docs] = await Promise.all([viewer.store.listMessages(eventId), viewer.store.listReferenceDocs(eventId)]);
  const runs = messages
    .map((m) => ({ m, outcome: parseStoredOutcome(m.interpretation) }))
    .filter((r): r is { m: typeof r.m; outcome: NonNullable<typeof r.outcome> & { agents: NonNullable<NonNullable<typeof r.outcome>['agents']> } } =>
      Boolean(r.outcome?.agents),
    )
    .sort((a, b) => b.m.createdAt - a.m.createdAt);

  const counts = Object.fromEntries(GROUNDING_LEVELS.map((g) => [g, 0])) as Record<Grounding, number>;
  let webSearches = 0;
  let emergencies = 0;
  for (const r of runs) {
    counts[r.outcome.agents.grounding] += 1;
    if (r.outcome.agents.steps.some((s) => s.agent === 'web' && s.status !== 'SKIPPED')) webSearches += 1;
    if (r.outcome.agents.steps.some((s) => s.agent === 'sentinel' && s.confidence === 1)) emergencies += 1;
  }
  const answered = runs.length - counts.NO_ANSWER;
  const web = viewer.ctx.webSearch;
  const ai = viewer.ctx.intentProvider;
  const staffDocs = docs.filter((d) => d.audience === 'STAFF').length;

  const names = new Map<string, string>();
  for (const r of runs.slice(0, 12)) {
    if (!names.has(r.m.senderUserId)) names.set(r.m.senderUserId, (await viewer.store.getUser(r.m.senderUserId))?.displayName ?? 'Unknown');
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <p className="eyebrow">Operations</p>
          <h1>Agent mesh</h1>
          <p>
            Seven agents handle every message. They read, rank and cite; only the coordinator changes state, through the same permission
            checks as staff.
          </p>
        </div>
      </div>

      <div className="config-grid">
        <div className="config-tile">
          <span className="xs faint">Message understanding</span>
          <strong>{ai ? ai.name : 'Deterministic rules'}</strong>
          <span className="small muted">{ai ? 'Output is schema-checked; rules take over on any failure.' : 'No AI provider configured. Every reply says which source produced it.'}</span>
        </div>
        <div className="config-tile">
          <span className="xs faint">Web research</span>
          <strong>{web ? web.name : 'Not configured'}</strong>
          <span className="small muted">
            {web
              ? 'Only for outside-the-venue questions. Queries are redacted and cached for 10 minutes.'
              : (
                  <>
                    Set <code className="mono">HELLO_WEB_SEARCH_PROVIDER=tavily</code> and <code className="mono">HELLO_WEB_SEARCH_API_KEY</code> to enable.
                  </>
                )}
          </span>
        </div>
        <div className="config-tile">
          <span className="xs faint">Event guide</span>
          <strong>
            {docs.length} pages
          </strong>
          <span className="small muted">
            {staffDocs} staff-only procedures, never shown to attendees.
            {docs[0] ? ` Source: ${DATA_SOURCE_LABEL[docs[0].source]}.` : ''}
          </span>
        </div>
        <div className="config-tile">
          <span className="xs faint">Data at rest</span>
          <strong>{viewer.ctx.vault.ephemeral ? 'Ephemeral key' : 'Configured key'}</strong>
          <span className="small muted">
            Profile text is sealed with AES-256-GCM (key {viewer.ctx.vault.keyId}).
            {viewer.ctx.vault.ephemeral ? ' No HELLO_DATA_KEY is set, so sealed data is lost on restart.' : ''} Private messages are end-to-end encrypted and never
            readable here.
          </span>
        </div>
        <div className="config-tile">
          <span className="xs faint">Recent runs</span>
          <strong>
            {answered} of {runs.length} grounded
          </strong>
          <span className="small muted">
            {webSearches} web searches · {emergencies} emergencies raised
          </span>
        </div>
      </div>

      <h2 style={{ marginBottom: 12 }}>The agents</h2>
      <div className="mesh" style={{ marginBottom: 32 }}>
        {AGENT_ROSTER.map((agent, index) => (
          <article key={agent.id} className="agent-card">
            <div className="agent-card__top">
              <span className="orbit-chip__dot">{index + 1}</span>
              <span className={`scope scope--${agent.scope}`}>{SCOPE_LABEL[agent.scope]}</span>
            </div>
            <h3>{agent.name}</h3>
            <p>{agent.job}</p>
            <ul>
              {agent.never.map((n) => (
                <li key={n}>Never: {n.charAt(0).toLowerCase() + n.slice(1)}.</li>
              ))}
            </ul>
          </article>
        ))}
      </div>

      <div className="split">
        <section aria-labelledby="runs-heading">
          <h2 id="runs-heading" style={{ marginBottom: 12 }}>
            Recent runs
          </h2>
          {runs.length === 0 ? (
            <div className="card empty">
              <strong>No runs yet</strong>
              <span>
                Send a message in the <Link href={`/events/${eventId}/conversation`}>conversation</Link> and its trace appears here.
              </span>
            </div>
          ) : (
            <div className="runs">
              {runs.slice(0, 12).map(({ m, outcome }) => (
                <article key={m.id} className="card run">
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <span className="xs faint">
                      {names.get(m.senderUserId)} · {formatUtc(m.createdAt).slice(11)}
                    </span>
                    <span className={`grounding grounding--${outcome.agents.grounding}`}>{GROUNDING_LABEL[outcome.agents.grounding]}</span>
                  </div>
                  <p className="run__text">“{m.text}”</p>
                  <p className="small muted">{outcome.reply}</p>
                  <AgentTrace trace={outcome.agents} showSteps />
                </article>
              ))}
            </div>
          )}
        </section>

        <aside className="stack" aria-labelledby="guide-heading">
          <h2 id="guide-heading">Event guide pages</h2>
          <div className="card" style={{ overflow: 'hidden' }}>
            <ul className="list-reset list-divided">
              {docs.map((d) => (
                <li key={d.id} style={{ padding: '12px 16px' }}>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <strong className="small">{d.title}</strong>
                    <span className={d.audience === 'STAFF' ? 'badge badge--warning' : 'badge badge--accent'}>
                      {d.audience === 'STAFF' ? 'Staff only' : 'Everyone'}
                    </span>
                  </div>
                  <p className="xs faint" style={{ marginTop: 4 }}>
                    {d.tags.slice(0, 6).join(' · ')}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
