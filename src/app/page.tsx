import Link from 'next/link';
import { demoModeEnabled } from '@/lib/session';
import { getRuntime } from '@/lib/runtime';
import { DEMO_EVENT_ID } from '@/store/seed';
import { slaFor } from '@/domain/incidents/sla';
import { Halo } from '@/components/brand/Halo';
import { Wordmark } from '@/components/brand/Wordmark';
import { Icon, type IconName } from '@/components/ui/Icon';
import { AGENT_ROSTER, type AgentScope } from '@/agents/types';

// Demo availability depends on runtime configuration, so this page must not be prerendered.
export const dynamic = 'force-dynamic';

const FEATURES: Array<{ title: string; body: string; icon: IconName }> = [
  {
    icon: 'sessions',
    title: 'Understands the place, not just the words',
    body: 'HELLO matches the room, session and event from stored data. It asks a question only when it truly cannot tell which room is meant.',
  },
  {
    icon: 'incidents',
    title: 'Never repeats what is already known',
    body: 'A new report joins an open incident only when room, category and time all match. Each person’s report is kept, and the reporter sees the outcome.',
  },
  {
    icon: 'team',
    title: 'Routes to people who can act',
    body: 'Staff are ranked by skill, workload, availability and location, and every score states its reasons. Claims cannot collide.',
  },
  {
    icon: 'shield',
    title: 'Asks before changing anything published',
    body: 'Moving a session or publishing an announcement waits for an organiser. The approval and the execution are recorded separately.',
  },
  {
    icon: 'sparkle',
    title: 'Finds patterns across many reports',
    body: 'Three independent reports of the same fault in one room within ten minutes become an insight for review. HELLO never claims certainty it does not have.',
  },
  {
    icon: 'check',
    title: 'Closes the loop with the person who asked',
    body: 'When work is marked resolved, the reporter confirms it or reopens it. Nothing is closed on the team’s word alone.',
  },
];

async function liveFigures() {
  const { store, ctx } = await getRuntime();
  const now = ctx.now();
  const [incidents, sessions, announcements, people] = await Promise.all([
    store.listIncidents(DEMO_EVENT_ID),
    store.listSessions(DEMO_EVENT_ID),
    store.listAnnouncements(DEMO_EVENT_ID),
    store.listMemberships(DEMO_EVENT_ID),
  ]);
  const open = incidents.filter((i) => !['CLOSED', 'CANCELLED', 'CONFIRMED'].includes(i.status));
  return {
    open: open.length,
    overdue: open.filter((i) => slaFor(i, now).state === 'BREACHED').length,
    running: sessions.filter((s) => s.startsAt <= now && s.endsAt > now).length,
    announcements: announcements.length,
    people: people.length,
    clock: new Date(now).toISOString().slice(11, 16),
  };
}

const SCOPE_LABEL: Record<AgentScope, string> = {
  READ_ONLY: 'Read only',
  EXTERNAL_READ: 'Web, read only',
  ACTS_THROUGH_SERVICES: 'Acts via services',
};

export default async function LandingPage() {
  const demo = demoModeEnabled();
  const live = demo ? await liveFigures() : null;
  return (
    <div className="landing">
      <header className="landing__nav">
        <Link href="/" className="brand" aria-label="HELLO home">
          <Wordmark height={30} id="wm-top" />
        </Link>
        <nav className="landing__links" aria-label="Page">
          <a href="#how">How it works</a>
          <a href="#agents">Agent mesh</a>
          <a href="#features">Features</a>
          {demo ? (
            <Link className="button button--sm" href="/demo">
              Open the demo
            </Link>
          ) : null}
        </nav>
      </header>

      <section className="hero" aria-labelledby="hero-title">
        <div>
          <p className="eyebrow">Event coordination for physical events</p>
          <Wordmark height={86} id="wm-hero" className="hero__wordmark" title="HELLO" />
          <h1 id="hero-title">
            One conversation. <span className="text-sky">Everyone connected.</span>
          </h1>
          <p className="lead">
            Attendees describe a problem in ordinary words. A team of HELLO agents works out the room, the session and the people
            concerned, checks the event guide, coordinates the response, and tells the person who asked when it is fixed.
          </p>
          <div className="row" style={{ marginTop: 28, gap: 12 }}>
            {demo ? (
              <Link className="button" href="/demo">
                Enter the demo <Icon name="arrow" />
              </Link>
            ) : null}
            <a className="button button--ghost" href="#agents">
              Meet the agents
            </a>
          </div>
          {live ? (
            <p className="live-strip" style={{ marginTop: 24, display: 'inline-flex', flexWrap: 'wrap' }} aria-label="Live figures from the demo event">
              <span className="live">
                <span className="live__dot" aria-hidden="true" />
                Live demo · {live.clock} UTC
              </span>
              <span>
                <strong>{live.open}</strong> open
              </span>
              <span>
                <strong>{live.overdue}</strong> past target
              </span>
              <span>
                <strong>{live.running}</strong> sessions running
              </span>
            </p>
          ) : null}
        </div>

        <div className="halo-stage">
          <Halo />
          <div className="orbit-chip orbit-chip--1" aria-hidden="true">
            <span className="orbit-chip__dot">1</span>
            <span>
              Triage
              <small>Microphone fault · Room 3</small>
            </span>
          </div>
          <div className="orbit-chip orbit-chip--2" aria-hidden="true">
            <span className="orbit-chip__dot">2</span>
            <span>
              Event guide
              <small>AV procedure cited</small>
            </span>
          </div>
          <div className="orbit-chip orbit-chip--3" aria-hidden="true">
            <span className="orbit-chip__dot">3</span>
            <span>
              Coordinator
              <small>Kiri recommended · claimed</small>
            </span>
          </div>
        </div>
      </section>

      <section className="section" id="how" aria-labelledby="how-title">
        <div className="how">
          <div className="section__head" style={{ marginBottom: 0 }}>
            <p className="eyebrow">How it works</p>
            <h2 id="how-title">A message becomes an accountable workflow.</h2>
            <p>
              Every step is a record: who reported it, which open report it joined, who claimed it, and whether the person who
              asked agreed it was fixed.
            </p>
          </div>
          <figure className="flow" aria-label="Example of a message becoming a workflow">
            <div className="flow__msg">The microphone in Room 3 has stopped working.</div>
            <div className="flow__step">
              <span className="flow__num">1</span>
              <span>Room 3, the current session and the event are resolved from stored data.</span>
            </div>
            <div className="flow__step">
              <span className="flow__num">2</span>
              <span>An open report about the same fault is found. Your report joins it, and you are linked to it.</span>
            </div>
            <div className="flow__step">
              <span className="flow__num">3</span>
              <span>The AV technician is recommended, with the reasons, and the AV procedure from the event guide is attached.</span>
            </div>
            <div className="flow__step">
              <span className="flow__num">4</span>
              <span>Work is recorded step by step. You are asked to confirm the fix.</span>
            </div>
          </figure>
        </div>
      </section>

      <section className="section" id="agents" aria-labelledby="agents-title">
        <div className="section__head">
          <p className="eyebrow">The agent mesh</p>
          <h2 id="agents-title">Seven small agents. One accountable answer.</h2>
          <p>
            Each agent has one job and a declared scope. Agents read, rank and cite. Only the coordinator changes anything, and it
            does so through the same permission checks as a person would. Every reply shows its sources and how it was reached.
          </p>
        </div>
        <div className="mesh">
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
      </section>

      <section className="section features" id="features" aria-label="What HELLO does" style={{ display: 'grid' }}>
        {FEATURES.map((f) => (
          <article key={f.title} className="card card__body feature">
            <span className="feature__icon" aria-hidden="true">
              <Icon name={f.icon} size={18} />
            </span>
            <h3>{f.title}</h3>
            <p>{f.body}</p>
          </article>
        ))}
      </section>

      {demo ? (
        <section className="section">
          <div className="cta-band">
            <div>
              <h2>See it with a live demo event.</h2>
              <p className="muted" style={{ marginTop: 6 }}>
                Seeded, fictional data for the HELLO Global Technology Summit. Switch roles to see what each person can do.
              </p>
            </div>
            <Link className="button" href="/demo">
              Enter the demo <Icon name="arrow" />
            </Link>
          </div>
        </section>
      ) : null}

      <footer className="footer-note">
        HELLO is a working prototype. Messaging is not yet connected to Nexconn, AI and web search providers are optional, and data
        is held in memory. See the project README for the full status before any real use.
      </footer>
    </div>
  );
}
