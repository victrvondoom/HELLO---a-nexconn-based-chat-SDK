import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="status-page">
      <p className="eyebrow">404</p>
      <h1>This page does not exist in HELLO</h1>
      <p className="muted">
        The address may be mistyped, or the event may not include you. Event pages are only shown to people who belong to them.
      </p>
      <div className="row" style={{ marginTop: 8 }}>
        <Link className="button" href="/">
          Go to the start page
        </Link>
      </div>
    </main>
  );
}
