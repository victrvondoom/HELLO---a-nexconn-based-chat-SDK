import type { ReactNode } from 'react';
import { loadEventViewer } from '@/lib/viewer';
import { EventNav } from '@/components/layout/EventNav';
import { ROLE_LABEL } from '@/components/ui/labels';
import { demoModeEnabled } from '@/lib/session';

export default async function EventLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  const viewer = await loadEventViewer(eventId);
  const operational = viewer.can('incident.read.operational');
  return (
    <div className="shell">
      <EventNav
        eventId={eventId}
        eventName={viewer.event.name}
        displayName={viewer.user?.displayName ?? 'Signed in'}
        roleLabel={ROLE_LABEL[viewer.membership.role]}
        operational={operational}
        canApprove={viewer.can('approval.decide')}
      />
      <div className="main">
        {viewer.event.isDemo && demoModeEnabled() ? (
          <div className="notice notice--demo" role="note" style={{ marginBottom: 16 }}>
            Demo event. All people, rooms, sessions, occupancy figures and incidents are seeded, illustrative data.
          </div>
        ) : null}
        {children}
      </div>
    </div>
  );
}
