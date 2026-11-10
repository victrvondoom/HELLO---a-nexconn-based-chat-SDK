import { loadEventViewer } from '@/lib/viewer';
import { discoverPeople } from '@/services/people';
import { ROLE_LABEL } from '@/components/ui/labels';

export const dynamic = 'force-dynamic';

export default async function PeoplePage({
  params,
  searchParams,
}: {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { eventId } = await params;
  const { q } = await searchParams;
  const query = (q ?? '').slice(0, 200);
  const viewer = await loadEventViewer(eventId);
  const matches = query.trim() ? await discoverPeople(viewer.ctx, eventId, viewer.userId, query) : [];

  return (
    <>
      <h1>People</h1>
      <p className="muted small">
        Search by a declared interest or area of expertise. Only people who chose to be discoverable appear. Contact
        details are never shown here.
      </p>
      <form method="get" className="card card__body row" role="search" style={{ marginBottom: 16 }}>
        <div className="field" style={{ flex: '1 1 320px' }}>
          <label htmlFor="people-q">Who do you want to speak with?</label>
          <input id="people-q" name="q" defaultValue={query} placeholder="For example: satellite communication" maxLength={200} />
        </div>
        <button type="submit" className="button" style={{ alignSelf: 'flex-end' }}>
          Search
        </button>
      </form>

      {query.trim() === '' ? (
        <div className="empty">Describe the expertise you are looking for.</div>
      ) : matches.length === 0 ? (
        <div className="empty">No discoverable person has declared that interest. Results come only from declared interests.</div>
      ) : (
        <ul className="stack" style={{ listStyle: 'none', padding: 0 }}>
          {matches.map((m) => (
            <li key={m.userId} className="card card__body stack">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <strong>{m.displayName}</strong>
                <span className="badge">{ROLE_LABEL[m.role]}</span>
              </div>
              <div className="small">{m.reason}</div>
              <div className="small muted">Declared: {m.declaredInterests.join(', ')}</div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
