import type { ProviderStatus } from '@/services/ops/providers';

const LABEL: Record<ProviderStatus, string> = { LIVE_VERIFIED: 'Live and verified', LOCAL_SIMULATION: 'Local simulation', PREVIEW: 'Preview', PLANNED: 'Planned integration' };
const TONE: Record<ProviderStatus, string> = { LIVE_VERIFIED: 'badge badge--success', LOCAL_SIMULATION: 'badge badge--accent', PREVIEW: 'badge badge--warning', PLANNED: 'badge' };

/** The one honest status label every Operations Network panel carries. */
export function OpsStatus({ status }: { status: ProviderStatus }) {
  return <span className={TONE[status]}>{LABEL[status]}</span>;
}
