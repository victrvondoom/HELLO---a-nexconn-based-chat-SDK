import type { ReactNode } from 'react';
import { loadEventViewer } from '@/lib/viewer';
import { EventNav } from '@/components/layout/EventNav';
import { TopBar } from '@/components/layout/TopBar';
import { ROLE_LABEL } from '@/components/ui/labels';
import { demoModeEnabled } from '@/lib/session';
import { notificationFeed } from '@/services/workplace';
import { DeviceKey } from '@/components/social/DeviceKey';
import { OfflineCare } from '@/components/companion/OfflineCare';

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
  const displayName = viewer.user?.displayName ?? 'Signed in';
  const nav = {
    eventId,
    operational: viewer.can('incident.read.operational'),
    canApprove: viewer.can('approval.decide'),
    canAudit: viewer.can('audit.read'),
    canManageAtlas: viewer.can('field.manage') || viewer.can('field.review'),
    unread: feed.unread,
  };
  return (
    <div className="app">
      <DeviceKey userId={viewer.userId} />
      <OfflineCare eventId={eventId} />
      <EventNav {...nav} eventName={viewer.event.name} displayName={displayName} roleLabel={roleLabel} isDemo={viewer.event.isDemo} canPost={viewer.can('message.send')} />
      <div className="workspace">
        <TopBar {...nav} eventName={viewer.event.name} isDemo={viewer.event.isDemo} displayName={displayName} roleLabel={roleLabel} />
        {viewer.event.isDemo && demoModeEnabled() ? (
          <div className="demo-band" role="note">
            <span className="badge badge--demo">Demo</span>
            <span className="only-lg">People, rooms, sessions, occupancy figures and incidents are seeded, illustrative data. Nothing here is a real event.</span>
            <span className="only-sm">Seeded, illustrative data. Not a real event.</span>
          </div>
        ) : null}
        <main id="main" className="main">
          {children}
        </main>
      </div>
    </div>
  );
}

export const dynamic = 'force-dynamic';
