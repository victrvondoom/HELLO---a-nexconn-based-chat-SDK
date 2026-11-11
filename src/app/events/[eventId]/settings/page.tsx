import { loadEventViewer } from '@/lib/viewer';
import { nexconnStatus } from '@/integrations/nexconn/status';
import { DATA_SOURCE_LABEL } from '@/domain/labels';
import { ROLE_LABEL } from '@/components/ui/labels';
import { demoModeEnabled } from '@/lib/session';
import { STAFF_ROLES } from '@/domain/types';
import { ProfileForm } from '@/components/workplace/ProfileForm';
import { ProfileTextForm } from '@/components/social/ProfileTextForm';
import { ownProfileText } from '@/services/social';
import { DataRights } from '@/components/social/DataRights';
import { AvailabilityControl } from '@/components/workplace/AvailabilityControl';
import { SignOutButton } from '@/components/settings/SignOutButton';
import { ResetDemoButton } from '@/components/settings/ResetDemoButton';

export const dynamic = 'force-dynamic';

export default async function SettingsPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const viewer = await loadEventViewer(eventId);
  const nexconn = nexconnStatus();
  const isStaff = STAFF_ROLES.includes(viewer.membership.role);
  const own = await ownProfileText(viewer.ctx, viewer.userId);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Profile and settings</h1>
          <p>
            {viewer.user?.displayName} · {ROLE_LABEL[viewer.membership.role]}
          </p>
        </div>
      </div>

      <div className="split">
        <div className="stack" style={{ gap: 20 }}>
          <section className="card card__body stack" aria-labelledby="profile-heading">
            <div>
              <h2 id="profile-heading">Profile and privacy</h2>
              <p className="small muted">These choices take effect immediately. You decide what others can see.</p>
            </div>
            {viewer.user ? (
              <ProfileForm
                initial={{
                  displayName: viewer.user.displayName,
                  interests: viewer.user.interests,
                  discoverable: viewer.user.discoverable,
                  accessibilityRequired: viewer.user.accessibilityRequired,
                }}
              />
            ) : null}
          </section>

          <section className="card card__body stack" aria-labelledby="public-profile-heading">
            <div>
              <h2 id="public-profile-heading">Your public profile</h2>
              <p className="small muted">
                What people see on your profile page. <a href={`/events/${eventId}/people/${viewer.userId}`}>View your profile</a>
              </p>
            </div>
            <ProfileTextForm initial={{ headline: own.text.headline, bio: own.text.bio, visibility: own.visibility }} />
          </section>

          <section className="card card__body stack" aria-labelledby="rights-heading">
            <div>
              <h2 id="rights-heading">Your data and your rights</h2>
              <p className="small muted">
                Download everything HELLO holds about you, or erase it. Private messages are end-to-end encrypted: HELLO can delete them but has never been able to read them.
              </p>
            </div>
            <DataRights userId={viewer.userId} />
          </section>

          {isStaff ? (
            <section className="card card__body stack" aria-labelledby="availability-heading">
              <div>
                <h2 id="availability-heading">Your availability</h2>
                <p className="small muted">
                  Off-shift staff are never recommended for new work. Busy staff are ranked lower.
                </p>
              </div>
              <AvailabilityControl eventId={eventId} current={viewer.membership.availability} />
            </section>
          ) : null}
        </div>

        <div className="stack" style={{ gap: 20 }}>
          <section className="card card__body stack" aria-labelledby="transport-heading">
            <h2 id="transport-heading">Messaging transport</h2>
            <div className={nexconn.state === 'NOT_CONFIGURED' ? 'notice notice--demo' : 'notice'} role="status">
              <strong>{nexconn.state === 'NOT_CONFIGURED' ? 'Not connected to Nexconn' : 'Nexconn key configured'}</strong>
              <p style={{ marginTop: 6 }}>{nexconn.message}</p>
            </div>
          </section>

          <section className="card card__body stack" aria-labelledby="data-heading">
            <h2 id="data-heading">Reading a figure</h2>
            <ul className="small" style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {Object.values(DATA_SOURCE_LABEL).map((label) => (
                <li key={label}>{label}</li>
              ))}
            </ul>
          </section>

          {demoModeEnabled() ? (
            <section className="card card__body stack" aria-labelledby="demo-heading">
              <h2 id="demo-heading">Demo</h2>
              <div className="row">
                <SignOutButton />
                <ResetDemoButton eventId={eventId} />
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
