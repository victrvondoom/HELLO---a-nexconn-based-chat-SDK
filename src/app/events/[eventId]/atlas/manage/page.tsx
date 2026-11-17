import { loadEventViewer } from '@/lib/viewer';
import { manageSnapshot } from '@/services/field-atlas';
import { WORKFLOWS } from '@/services/workflows';
import { AtlasManage, type ManageInitial } from '@/components/atlas/AtlasManage';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Field Atlas management' };

export default async function AtlasManagePage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const viewer = await loadEventViewer(eventId);
  const canManage = viewer.can('field.manage');
  const canReview = viewer.can('field.review');
  if (!canManage && !canReview) {
    return (
      <div className="page">
        <p className="eyebrow">Field Atlas</p>
        <h1>Management is for organisers and operations staff</h1>
        <p className="muted">Your role at this event does not include Field Atlas management. Missions and progress are on the Field Atlas page.</p>
      </div>
    );
  }
  const { ctx } = viewer;
  const [snapshot, venue, memberships] = await Promise.all([manageSnapshot(ctx, eventId, viewer.userId), ctx.store.getVenue(eventId), ctx.store.listMemberships(eventId)]);
  const people = await Promise.all(
    memberships.map(async (m) => ({ id: m.userId, name: (await ctx.store.getUser(m.userId))?.displayName ?? m.userId })),
  );
  const initial: ManageInitial = {
    snapshot: {
      ...snapshot,
      seasons: snapshot.seasons.map((s) => ({ ...s })),
    },
    spaces: (venue?.spaces ?? []).map((s) => ({ id: s.id, name: s.name, floor: s.floor })),
    workflows: WORKFLOWS.map((w) => ({ id: w.id, name: w.name })),
    people,
  };
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <p className="eyebrow">Field Atlas</p>
          <h1>Manage missions</h1>
          <p>Missions, monthly challenges, levels and check-in stations. Every change is written to the audit trail. Completed history cannot be edited.</p>
        </div>
      </div>
      <AtlasManage eventId={eventId} initial={initial} canManage={canManage} canReview={canReview} />
    </div>
  );
}
