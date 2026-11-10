import Link from 'next/link';
import { demoModeEnabled } from '@/lib/session';

// Demo availability depends on runtime configuration, so this page must not be prerendered.
export const dynamic = 'force-dynamic';

const FEATURES = [
  {
    title: 'Understands the place, not just the words',
    body: 'HELLO matches the room, session and event from stored data. It asks a question only when it truly cannot tell which room is meant.',
  },
  {
    title: 'Never repeats what is already known',
    body: 'A new report joins an open incident only when room, category and time all match. Each person’s report is kept, and the reporter sees the outcome.',
  },
  {
    title: 'Routes to people who can act',
    body: 'Staff are ranked by skill, workload, availability and location, and every score states its reasons. Claims cannot collide.',
  },
  {
    title: 'Asks before changing anything published',
    body: 'Moving a session or publishing an announcement waits for an organiser. The approval and the execution are recorded separately.',
  },
  {
    title: 'Finds patterns across many reports',
    body: 'Three independent reports of the same fault in one room within ten minutes become an insight for review. HELLO never claims certainty it does not have.',
  },
  {
    title: 'Closes the loop with the person who asked',
    body: 'When work is marked resolved, the reporter confirms it or reopens it. Nothing is closed on the team’s word alone.',
  },
];

export default function LandingPage() {
  const demo = demoModeEnabled();
  return (
    <div className="landing">
      <header className="landing__nav">
        <Link href="/" className="brand" aria-label="HELLO home">
          <span className="brand__mark" aria-hidden="true">H</span>
          <span>HELLO</span>
        </Link>
        {demo ? (
          <Link className="button" href="/demo">
            Open the demo event
          </Link>
        ) : null}
      </header>

      <section className="hero" aria-labelledby="hero-title">
        <div>
          <p className="eyebrow">AI-assisted event coordination</p>
          <h1 id="hero-title" style={{ marginTop: 12 }}>
            One conversation. Everyone connected.
          </h1>
          <p className="lead">
            Attendees describe a problem in ordinary words. HELLO works out the room, the session and the team concerned,
            coordinates the response, and tells the person who asked when it is fixed.
          </p>
          <div className="row" style={{ marginTop: 28 }}>
            {demo ? (
              <Link className="button" href="/demo">
                Enter the demo
              </Link>
            ) : null}
            <a className="button button--ghost" href="#how">
              How it works
            </a>
          </div>
          {demo ? (
            <p className="small faint" style={{ marginTop: 16 }}>
              The demo uses seeded, fictional data for the HELLO Global Technology Summit. No real event is connected.
            </p>
          ) : null}
        </div>

        <figure className="flow" id="how" aria-label="Example of a message becoming a workflow">
          <div className="flow__msg">The microphone in Room 3 has stopped working.</div>
          <div className="flow__step">
            <span className="flow__num">1</span>
            <span>Room 3, the current session and the event are resolved from stored data.</span>
          </div>
          <div className="flow__step">
            <span className="flow__num">2</span>
            <span>An open report about the same fault is found. Your report joins it, and the reporter is linked.</span>
          </div>
          <div className="flow__step">
            <span className="flow__num">3</span>
            <span>The AV technician is recommended, with the reasons. A staff member claims it.</span>
          </div>
          <div className="flow__step">
            <span className="flow__num">4</span>
            <span>Work is recorded step by step. The reporter is asked to confirm the fix.</span>
          </div>
        </figure>
      </section>

      <section className="features" aria-label="What HELLO does">
        {FEATURES.map((f) => (
          <article key={f.title} className="card card__body feature">
            <h3>{f.title}</h3>
            <p>{f.body}</p>
          </article>
        ))}
      </section>

      <footer className="footer-note">
        HELLO is a working prototype. Messaging is not yet connected to Nexconn, AI providers are optional, and data is held in
        memory. See the project README for the full status before any real use.
      </footer>
    </div>
  );
}
