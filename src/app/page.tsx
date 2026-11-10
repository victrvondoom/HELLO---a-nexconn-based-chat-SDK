import Link from 'next/link';
import { demoModeEnabled } from '@/lib/session';

export default function LandingPage() {
  const demo = demoModeEnabled();
  return (
    <main className="main" style={{ maxWidth: 760, margin: '0 auto', padding: '64px 24px' }}>
      <p className="small muted" style={{ letterSpacing: '0.08em', textTransform: 'uppercase' }}>
        HELLO
      </p>
      <h1 style={{ fontSize: 32, marginBottom: 12 }}>One conversation. Everyone connected.</h1>
      <p className="muted" style={{ fontSize: 17 }}>
        Attendees describe a problem in ordinary words. HELLO works out which room, session and team it concerns,
        checks whether someone already reported it, routes it to the right staff member, and asks the reporter
        to confirm when it is fixed.
      </p>

      <div className="panel stack" style={{ margin: '24px 0' }}>
        <h2>What happens to a message</h2>
        <ol className="stack" style={{ paddingLeft: 20, margin: 0 }}>
          <li>The event, room and session are resolved from stored event data.</li>
          <li>Duplicates are matched on room, category and time, never on wording alone.</li>
          <li>Staff with the right skill are ranked, with each score explained.</li>
          <li>Changes to published schedules wait for an organiser’s approval.</li>
          <li>Status updates reach the reporter only after they are recorded.</li>
        </ol>
      </div>

      {demo ? (
        <div className="notice notice--demo stack" role="note">
          <strong>Demo mode.</strong>
          <span>
            Everything here is seeded, fictional demo data for the HELLO Global Technology Summit. Occupancy figures are
            illustrative. No real event is connected.
          </span>
        </div>
      ) : null}

      <p style={{ marginTop: 24 }}>
        <Link className="button" href="/demo" style={{ display: 'inline-block' }}>
          Enter the demo event
        </Link>
      </p>
    </main>
  );
}
