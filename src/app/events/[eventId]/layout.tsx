import type { ReactNode } from 'react';
import { loadEventViewer } from '@/lib/viewer';
import { EventNav } from '@/components/layout/EventNav';
import { ROLE_LABEL } from '@/components/ui/labels';
import { demoModeEnabled } from '@/lib/session';
import { notificationFeed } from '@/services/workplace';
import { DeviceKey } from '@/components/social/DeviceKey';

export default async function EventLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  const viewer = await loadEventViewer(eventId);
  const roleLabel = ROLE_LABEL[viewer.membership.role];
  const feed = await notificationFeed(viewer.ctx, eventId, viewer.userId);
  return (
    <div className="app">
      <DeviceKey userId={viewer.userId} />
      <EventNav
        eventId={eventId}
        eventName={viewer.event.name}
        displayName={viewer.user?.displayName ?? 'Signed in'}
        roleLabel={roleLabel}
        operational={viewer.can('incident.read.operational')}
        canApprove={viewer.can('approval.decide')}
        canAudit={viewer.can('audit.read')}
        unread={feed.unread}
      />
      <div className="workspace">
        <header className="topbar">
          <div className="topbar__event">
            <span className="eyebrow">{viewer.event.isDemo ? 'Demo event' : 'Event'}</span>
            <strong>{viewer.event.name}</strong>
          </div>
          <div className="topbar__meta">
            <span className="badge badge--accent">{roleLabel}</span>
            <span className="badge hide-sm">{viewer.user?.displayName}</span>
          </div>
        </header>
        {viewer.event.isDemo && demoModeEnabled() ? (
          <div className="demo-band" role="note">
            <span className="badge badge--demo">Demo</span>
            <span className="only-lg">
              People, rooms, sessions, occupancy figures and incidents are seeded, illustrative data. Nothing here is a real event.
            </span>
            <span className="only-sm">Seeded, illustrative data. Not a real event.</span>
          </div>
        ) : null}
        <main id="main" className="page" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
          {children}
        </main>
      </div>
    </div>
  );
}
