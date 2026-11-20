import { loadEventViewer } from '@/lib/viewer';
import { momentsCharter } from '@/services/moments';
import { MomentsNav } from '@/components/moments/MomentsNav';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'How Moments works' };

/**
 * The Open Feed Charter, rendered from the same constants the ranking code uses, so the page cannot say
 * one thing while the feed does another.
 */
export default async function CharterPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const viewer = await loadEventViewer(eventId);
  const charter = await momentsCharter(viewer.ctx, eventId, viewer.userId);
  return (
    <div className="page page--moments">
      <div className="page-header page-header--moments">
        <div>
          <p className="eyebrow">How Moments works</p>
          <h1>
            The Open Feed <em>Charter</em>
          </h1>
          <p>Everything that decides what you see in Moments, in the same words the code follows. Nothing else is used.</p>
        </div>
        <MomentsNav eventId={eventId} />
      </div>

      <div className="charter">
        <section className="charter__card charter__card--lead" aria-labelledby="ranking-title">
          <h2 id="ranking-title">How “For you” is ordered</h2>
          <p className="small muted">Each post gets the points below. Highest total first; ties go to the newer post, then a fixed order by id, so the same feed always comes out the same way.</p>
          <ol className="charter__rules">
            {charter.criteria.map((c, i) => (
              <li key={c.id}>
                <span className="charter__num">{i + 1}</span>
                <span className="grow">
                  <strong>{c.label}</strong>
                  <span className="small muted">{c.rule}</span>
                </span>
                <span className="charter__pts">
                  up to <strong>{c.max}</strong>
                </span>
              </li>
            ))}
          </ol>
        </section>

        <section className="charter__card" aria-labelledby="never-title">
          <h2 id="never-title">Never used</h2>
          <ul className="charter__never">
            {charter.neverUsed.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
          <p className="xs faint">The ranking function receives only the post’s author, time, community, commenters and likers. It cannot see anything else.</p>
        </section>

        <section className="charter__card" aria-labelledby="stories-title">
          <h2 id="stories-title">The story row</h2>
          <ol className="charter__list">
            {charter.storyOrder.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
          <p className="xs faint">Stories are deleted after 24 hours unless their author keeps them in a highlight.</p>
        </section>

        <section className="charter__card" aria-labelledby="posting-title">
          <h2 id="posting-title">Posting rules</h2>
          <p className="small muted">Checked by the server on every post and story. When one is broken, the message names the rule.</p>
          <ul className="charter__posting">
            {charter.postingRules.map((r) => (
              <li key={r.id}>
                <code>{r.id}</code>
                <span>
                  <strong>{r.label}.</strong> {r.rule}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="charter__card" aria-labelledby="nexconn-title">
          <h2 id="nexconn-title">Built on Nexconn messages</h2>
          <p className="small muted">
            Every moment is shaped as a Nexconn message: stories and posts are custom message types on the event’s community channel, likes and story
            reactions are message reactions, seeing a story is a read receipt, and a story reply is a reference message in a direct channel.
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Message type</th>
                  <th>Stored</th>
                  <th>Counts as unread</th>
                  <th>Media field</th>
                </tr>
              </thead>
              <tbody>
                {charter.nexconnTypes.map((t) => (
                  <tr key={t.messageType}>
                    <td>
                      <code>{t.messageType}</code>
                    </td>
                    <td>{t.isPersisted ? 'Yes' : 'No'}</td>
                    <td>{t.isCounted ? 'Yes' : 'No'}</td>
                    <td>{t.remoteFileUrlField ? <code>{t.remoteFileUrlField}</code> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="notice small" style={{ marginTop: 12 }}>
            {charter.nexconnNote}
          </p>
        </section>
      </div>
    </div>
  );
}
