import { notFound } from 'next/navigation';
import { loadEventViewer } from '@/lib/viewer';
import { listTeam } from '@/services/workplace';
import { DomainError } from '@/domain/errors';
import { ROLE_LABEL } from '@/components/ui/labels';
import { LiveRefresh } from '@/components/workplace/LiveRefresh';

export const dynamic = 'force-dynamic';

const AVAILABILITY_LABEL = { AVAILABLE: 'Available', BUSY: 'Busy', OFF_SHIFT: 'Off shift' } as const;

export default async function TeamPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const viewer = await loadEventViewer(eventId);
  let rows;
  try {
    rows = await listTeam(viewer.ctx, eventId, viewer.userId);
  } catch (error: unknown) {
    if (error instanceof DomainError && error.code === 'FORBIDDEN') notFound();
    throw error;
  }
  const available = rows.filter((r) => r.availability === 'AVAILABLE').length;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Team</h1>
          <p>
            {available} of {rows.length} available. Load is the number of open assignments against a limit of 3.
          </p>
        </div>
        <LiveRefresh seconds={15} />
      </div>

      <div className="card" style={{ overflow: 'hidden' }}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Person</th>
                <th scope="col">Availability</th>
                <th scope="col">Skills</th>
                <th scope="col">Zone</th>
                <th scope="col">Load</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const pct = Math.min(100, Math.round((r.openAssignments / r.capacity) * 100));
                return (
                  <tr key={r.membershipId} className={r.availability === 'OFF_SHIFT' ? 'muted-row' : undefined}>
                    <td>
                      <strong>{r.displayName}</strong>
                      <div className="xs faint">{ROLE_LABEL[r.role]}</div>
                    </td>
                    <td>
                      <span className={r.availability === 'AVAILABLE' ? 'badge badge--success' : r.availability === 'BUSY' ? 'badge badge--warning' : 'badge'}>
                        {AVAILABILITY_LABEL[r.availability]}
                      </span>
                    </td>
                    <td className="small">{r.skills.length > 0 ? r.skills.join(', ') : <span className="faint">None recorded</span>}</td>
                    <td className="small">{r.zone ?? <span className="faint">Unassigned</span>}</td>
                    <td>
                      <div className="load" aria-label={`${r.openAssignments} of ${r.capacity} assignments`}>
                        <div className="load__track">
                          <div className={pct >= 100 ? 'load__fill is-full' : 'load__fill'} style={{ width: `${pct}%` }} />
                        </div>
                        <span className="xs faint">
                          {r.openAssignments}/{r.capacity}
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
