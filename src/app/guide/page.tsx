import type { Metadata } from 'next';
import Link from 'next/link';
import { demoModeEnabled } from '@/lib/session';
import { Wordmark } from '@/components/brand/Wordmark';
import { countByStatus, FIRST_STEPS, GUIDE, STATUS_LABEL } from '@/domain/guide/map';
import { GuideFilter } from './GuideFilter';

export const metadata: Metadata = {
  title: 'Guide: everything HELLO does',
  description: 'Every feature in HELLO in plain words, where to find it, and whether it works yet.',
};

// Demo availability depends on runtime configuration.
export const dynamic = 'force-dynamic';

export default function GuidePage() {
  const demo = demoModeEnabled();
  const counts = countByStatus();
  return (
    <main className="guide-page">
      <div className="guide-top">
        <Link href="/" aria-label="HELLO home">
          <Wordmark height={28} id="wm-guide" />
        </Link>
        {demo ? (
          <Link className="button button--sun button--sm" href="/demo">
            Open the demo
          </Link>
        ) : (
          <Link className="button button--sm" href="/signin">
            Sign in
          </Link>
        )}
      </div>

      <section className="guide-hero">
        <h1>One place for everything an event needs.</h1>
        <p>
          Share, talk, play, find your way and run the event, all in one app that works on a phone. This page lists every feature, where it lives, and
          whether it works yet. Nothing here is hidden or renamed.
        </p>
        <div className="guide-counts" aria-label="How much is built">
          {(Object.keys(counts) as Array<keyof typeof counts>).map((status) => (
            <span key={status} className="guide-count">
              <strong>{counts[status]}</strong> {STATUS_LABEL[status].toLowerCase()}
            </span>
          ))}
        </div>
      </section>

      <h2 className="guide-sr">Start in four steps</h2>
      <ol className="guide-steps">
        {FIRST_STEPS.map((step) => (
          <li key={step.title} className="guide-step">
            <strong>{step.title}</strong>
            <span>{step.body}</span>
          </li>
        ))}
      </ol>

      <GuideFilter />

      {GUIDE.map((area) => (
        <section key={area.id} className="guide-area" aria-labelledby={`guide-${area.id}`}>
          <h2 id={`guide-${area.id}`}>{area.title}</h2>
          <p>{area.blurb}</p>
          <ul className="guide-list">
            {area.features.map((feature) => (
              <li key={feature.name} className="guide-item" data-status={feature.status}>
                <h3>
                  {feature.name}
                  <span className="guide-badge" data-status={feature.status}>
                    {STATUS_LABEL[feature.status]}
                  </span>
                  {feature.like ? <span className="guide-like">like {feature.like}</span> : null}
                </h3>
                <p>{feature.what}</p>
                {feature.note ? <p className="guide-note">{feature.note}</p> : null}
              </li>
            ))}
          </ul>
        </section>
      ))}

      <p className="guide-foot">
        This list is the single source for the product: <code>src/domain/guide/map.ts</code>. The same list is written out, with the build plan, in <code>docs/PROJECT_PATH.md</code>.
      </p>
    </main>
  );
}
