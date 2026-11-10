import { loadEventViewer } from '@/lib/viewer';
import { nexconnStatus } from '@/integrations/nexconn/status';
import { DATA_SOURCE_LABEL } from '@/domain/labels';
import { ROLE_LABEL } from '@/components/ui/labels';
import { SignOutButton } from '@/components/settings/SignOutButton';
import { demoModeEnabled } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function SettingsPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const viewer = await loadEventViewer(eventId);
  const nexconn = nexconnStatus();

  return (
    <>
      <h1>Settings</h1>
      <section className="panel stack" aria-labelledby="account-heading">
        <h2 id="account-heading">Account</h2>
        <p style={{ margin: 0 }}>
          {viewer.user?.displayName} · {ROLE_LABEL[viewer.membership.role]}
        </p>
        <p className="small muted" style={{ margin: 0 }}>
          Discoverable in people search: {viewer.user?.discoverable ? 'yes' : 'no'}. Accessibility needs recorded:{' '}
          {viewer.user?.accessibilityRequired ? 'yes' : 'no'}.
        </p>
        {demoModeEnabled() ? <SignOutButton /> : null}
      </section>

      <section className="panel stack" style={{ marginTop: 24 }} aria-labelledby="transport-heading">
        <h2 id="transport-heading">Messaging transport</h2>
        <div className={nexconn.state === 'NOT_CONFIGURED' ? 'notice notice--demo' : 'notice'} role="status">
          <strong>{nexconn.state === 'NOT_CONFIGURED' ? 'Not connected to Nexconn' : 'Nexconn key configured'}</strong>
          <p style={{ margin: '6px 0 0' }}>{nexconn.message}</p>
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          The conversation here uses the local demo store. It is not an end-to-end messaging service. See docs/nexconn-integration.md for what is and is not implemented.
        </p>
      </section>

      <section className="panel stack" style={{ marginTop: 24 }} aria-labelledby="data-heading">
        <h2 id="data-heading">How to read a figure</h2>
        <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
          {Object.entries(DATA_SOURCE_LABEL).map(([key, label]) => (
            <li key={key}>
              <strong>{label}</strong>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
