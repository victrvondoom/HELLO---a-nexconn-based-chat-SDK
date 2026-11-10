import type { SlaSnapshot } from '@/domain/incidents/sla';

const TONE: Record<SlaSnapshot['state'], string> = {
  MET: 'badge badge--success',
  ON_TRACK: 'badge badge--accent',
  AT_RISK: 'badge badge--warning',
  BREACHED: 'badge badge--danger',
  NOT_APPLICABLE: 'badge',
};

export function SlaChip({ sla }: { sla: SlaSnapshot }) {
  return (
    <span className={TONE[sla.state]} title={`Target: ${sla.targetMinutes} minutes to acknowledge`}>
      {sla.label}
    </span>
  );
}
