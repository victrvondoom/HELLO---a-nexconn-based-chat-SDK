'use client';

import Link from 'next/link';

/** Last-resort boundary. Shows a calm message and a way back; technical detail stays out of the page. */
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="status-page">
      <p className="eyebrow">Something went wrong</p>
      <h1>We could not load this page</h1>
      <p className="muted">
        Nothing has been changed by this error. Try again, or return to the start page. If it keeps happening, the team
        running the event can see it in the logs.
      </p>
      <div className="row" style={{ marginTop: 8 }}>
        <button type="button" className="button" onClick={() => { reset(); }}>
          Try again
        </button>
        <Link className="button button--ghost" href="/">
          Start page
        </Link>
      </div>
    </main>
  );
}
