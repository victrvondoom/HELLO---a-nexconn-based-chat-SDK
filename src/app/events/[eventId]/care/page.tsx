import { loadEventViewer } from '@/lib/viewer';
import { careInfo } from '@/services/live-room';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'I need a break' };

/**
 * "I need a break": no questions, no reason asked, nothing shared. The page is plain server HTML so the
 * offline worker can keep a copy, and it still opens with no connection after one visit.
 */
export default async function CarePage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const viewer = await loadEventViewer(eventId);
  const care = await careInfo(viewer.ctx, eventId, viewer.userId);
  const list = (items: Array<{ name: string; floor: string; stepFree?: boolean }>) => (
    <ul className="list-reset care__list">
      {items.map((i) => (
        <li key={`${i.name}-${i.floor}`}>
          <strong>{i.name}</strong>
          <span>
            {i.floor}
            {i.stepFree ? ' · step-free' : ''}
          </span>
        </li>
      ))}
    </ul>
  );
  return (
    <div className="page care">
      <h1>Take a moment</h1>
      <section aria-labelledby="care-quiet">
        <h2 id="care-quiet">Quiet room</h2>
        {care.quiet.length ? list(care.quiet) : <p>Ask any staff member for a quiet space.</p>}
      </section>
      <section aria-labelledby="care-toilets">
        <h2 id="care-toilets">Toilets</h2>
        {list(care.toilets)}
      </section>
      <section aria-labelledby="care-step">
        <h2 id="care-step">Step-free access</h2>
        {list(care.stepFree)}
      </section>
      <section aria-labelledby="care-help">
        <h2 id="care-help">Help</h2>
        {list(care.help)}
      </section>
      <section className="care__card" aria-labelledby="care-card">
        <h2 id="care-card">Show this to staff</h2>
        <p className="care__show">I need a short break somewhere quiet. Please point me to the nearest quiet space.</p>
      </section>
      <p className="xs faint">Opening this page tells no one. It works offline once you have opened it.</p>
    </div>
  );
}
