import Link from 'next/link';
import { demoModeEnabled } from '@/lib/session';
import { getRuntime } from '@/lib/runtime';
import { DEMO_EVENT_ID } from '@/store/seed';
import { slaFor } from '@/domain/incidents/sla';
import { Wordmark } from '@/components/brand/Wordmark';
import { Jharokha } from '@/components/brand/Jharokha';
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

const MOMENTS: Array<{ title: string; body: string; icon: IconName }> = [
  { icon: 'camera', title: 'Stories that leave after a day', body: 'Share a moment from a room, a talk or the coffee queue. It is deleted after 24 hours unless you keep it in a highlight.' },
  { icon: 'reels', title: 'MemoReels and a feed you can scroll', body: 'Pictures, videos and colourful text posts from the people around you, with double-tap likes, comments and saves.' },
  { icon: 'compass', title: 'Explore what the event is talking about', body: 'Tags trend only when at least three different people use them, so one loud account cannot fake a trend.' },
  { icon: 'info', title: 'A feed that tells you why', body: 'Six announced rules order the feed, and every post shows the rules that placed it. No hidden signals, no paid boosts.' },
];

async function liveFigures() {
  const { store, ctx } = await getRuntime();
  const now = ctx.now();
  const [incidents, sessions] = await Promise.all([store.listIncidents(DEMO_EVENT_ID), store.listSessions(DEMO_EVENT_ID)]);
  const open = incidents.filter((i) => !['CLOSED', 'CANCELLED', 'CONFIRMED'].includes(i.status));
  return {
    open: open.length,
    overdue: open.filter((i) => slaFor(i, now).state === 'BREACHED').length,
    running: sessions.filter((s) => s.startsAt <= now && s.endsAt > now).length,
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
      <section className="hero" aria-labelledby="hero-title">
        <header className="landing__nav">
          <Link href="/" className="landing__brand" aria-label="HELLO home">
            <Wordmark height={28} id="wm-top" />
          </Link>
          <nav className="landing__links" aria-label="Page">
            <a href="#how">How it works</a>
            <a href="#moments">Moments</a>
            <a href="#agents">Agents</a>
            <Link href="/guide">Guide</Link>
            {demo ? (
              <Link className="button button--sm" href="/demo">
                Open the demo
              </Link>
            ) : null}
          </nav>
        </header>
        <Jharokha>
          <h1 id="hero-title">
            One conversation. <em>Everyone</em> connected.
          </h1>
          <p className="hero__lead">
            Attendees describe a problem in their own words. HELLO finds the room, the session and the right people, and tells the
            person who asked when it is fixed.
          </p>
          <div className="hero__actions">
            {demo ? (
              <Link className="button button--lg" href="/demo">
                Enter the demo
              </Link>
            ) : null}
            <a className="button button--ghost button--lg" href="#agents">
              Meet the agents
            </a>
          </div>
        </Jharokha>
        {live ? (
          <p className="live-strip hero__live" aria-label="Live figures from the demo event">
            <span className="live">
              <span className="live__dot" aria-hidden="true" />
              Live demo, {live.clock} UTC
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
      </section>

      <section className="section" id="how" aria-labelledby="how-title">
        <div className="how">
          <div className="section__head">
            <h2 id="how-title">
              A message becomes an <em>accountable</em> workflow.
            </h2>
            <p>
              Every step is a record: who reported it, which open report it joined, who claimed it, and whether the person who asked agreed
              it was fixed.
            </p>
          </div>
          <figure className="flow" aria-label="Example of a message becoming a workflow">
            <div className="flow__msg">The microphone in Room 3 has stopped working.</div>
            <ol className="flow__steps">
              <li className="flow__step">
                <span className="flow__num">1</span>
                <span>Room 3, the current session and the event are resolved from stored data.</span>
              </li>
              <li className="flow__step">
                <span className="flow__num">2</span>
                <span>An open report about the same fault is found. Your report joins it, and you are linked to it.</span>
              </li>
              <li className="flow__step">
                <span className="flow__num">3</span>
                <span>The AV technician is recommended, with the reasons, and the AV procedure from the event guide is attached.</span>
              </li>
              <li className="flow__step">
                <span className="flow__num">4</span>
                <span>Work is recorded step by step. You are asked to confirm the fix.</span>
              </li>
            </ol>
          </figure>
        </div>
      </section>

      <section className="section section--moments" id="moments" aria-labelledby="moments-title">
        <div className="moments-intro">
          <div className="phone" aria-hidden="true">
            <div className="phone__screen">
              <div className="phone__bar">
                <span className="phone__title">Moments</span>
                <span className="phone__icons">
                  <Icon name="heart" size={18} />
                  <Icon name="send" size={18} />
                </span>
              </div>
              <div className="phone__stories">
                {[
                  ['You', 'grass', true],
                  ['Ines', 'sky', false],
                  ['Dev', 'sun', false],
                  ['Kiri', 'clay', false],
                  ['Chloe', 'grass', false],
                ].map(([name, tone, mine]) => (
                  <span key={String(name)} className={`phone__story${mine ? ' is-mine' : ''}`}>
                    <span className={`phone__ring phone__ring--${String(tone)}`}>
                      <span className="phone__face">{String(name).charAt(0)}</span>
                    </span>
                    <span className="phone__name">{String(name)}</span>
                  </span>
                ))}
              </div>
              <div className="phone__post">
                <div className="phone__post-head">
                  <span className="phone__face phone__face--sm">I</span>
                  <span>
                    <strong>Dr Ines</strong>
                    <small>Room 3 · 12 min</small>
                  </span>
                </div>
                <div className="phone__post-art">
                  <span>
                    Solar arrays fold like origami. Come see one open at 13:00. <b>#satellites</b>
                  </span>
                </div>
                <div className="phone__post-actions">
                  <Icon name="heart" size={18} />
                  <Icon name="comment" size={18} />
                  <Icon name="send" size={18} />
                  <span className="phone__why">Why: you follow them · fresh</span>
                </div>
              </div>
            </div>
          </div>
          <div className="moments-intro__copy">
            <h2 id="moments-title">
              The event, as it <em>happens</em>.
            </h2>
            <p className="muted">
              Stories, memoreels, a feed and explore, built for the people in the same building. Every moment travels as a Nexconn-shaped message:
              a story is an <code>HL:Story</code> on the event’s community channel, a like is a message reaction, and seeing a story is a read
              receipt.
            </p>
            <ul className="moments-list">
              {MOMENTS.map((m) => (
                <li key={m.title}>
                  <span className="moments-list__icon" aria-hidden="true">
                    <Icon name={m.icon} size={18} />
                  </span>
                  <span>
                    <strong>{m.title}</strong>
                    <span className="muted small">{m.body}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="section" id="agents" aria-labelledby="agents-title">
        <div className="section__head">
          <h2 id="agents-title">
            Seven small agents. <em>One</em> accountable answer.
          </h2>
          <p>
            Each agent has one job and a declared scope. Agents read, rank and cite. Only the coordinator changes anything, and it does so
            through the same permission checks as a person would. Every reply shows its sources and how it was reached.
          </p>
        </div>
        <div className="mesh">
          {AGENT_ROSTER.map((agent, index) => (
            <article key={agent.id} className="agent-card">
              <div className="agent-card__top">
                <span className="agent-card__num">{String(index + 1).padStart(2, '0')}</span>
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

      <section className="section" id="features" aria-labelledby="features-title">
        <div className="section__head">
          <h2 id="features-title">
            Calm, <em>careful</em> coordination.
          </h2>
        </div>
        <div className="features">
          {FEATURES.map((f) => (
            <article key={f.title} className="card feature">
              <span className="feature__icon" aria-hidden="true">
                <Icon name={f.icon} size={20} />
              </span>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </article>
          ))}
        </div>
      </section>

      {demo ? (
        <section className="section">
          <div className="cta-band">
            <div className="cta-band__copy">
              <h2>
                Step into a live demo event.
              </h2>
              <p>Seeded, fictional data for the HELLO Global Technology Summit. Switch roles to see what each person can do.</p>
            </div>
            <Link className="button button--sun button--lg" href="/demo">
              Enter the demo
            </Link>
          </div>
        </section>
      ) : null}

      <footer className="footer-note">
        HELLO is a working prototype. Messaging is not yet connected to Nexconn, AI and web search providers are optional, and data is held in
        memory. See the project README for the full status before any real use.
      </footer>
    </div>
  );
}
