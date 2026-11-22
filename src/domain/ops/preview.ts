import type { TimelineEvent } from './temporal';

/** PREVIEW FIXTURE. Sample timeline events, labelled as such wherever shown. Not Nexconn messages, not live data. */
export function previewTimeline(eventStartAt: number): TimelineEvent[] {
  const at = (min: number) => eventStartAt + min * 60_000;
  return [
    { id: 'pv-1', seq: 1, serverAt: at(-30), intendedAt: at(0), releaseAt: at(0), kind: 'ANNOUNCEMENT', text: 'Doors open (scheduled release at event start).' },
    { id: 'pv-2', seq: 2, serverAt: at(12), intendedAt: at(10), releaseAt: at(12), kind: 'INCIDENT', text: 'Three people report they cannot hear in Room 3.' },
    { id: 'pv-4', seq: 4, serverAt: at(20), intendedAt: at(19), releaseAt: at(20), kind: 'SCHEDULE_CHANGE', text: 'Approved: Satellite Power Systems moves to the Main Hall.' },
    { id: 'pv-3', seq: 3, serverAt: at(15), intendedAt: at(14), releaseAt: at(15), kind: 'MESSAGE', text: 'AV team: microphone replaced, checking now (arrived late, reordered by intended time).' },
    { id: 'pv-5', seq: 5, serverAt: at(21), intendedAt: at(45), releaseAt: at(40), kind: 'ANNOUNCEMENT', text: 'Reminder held until 40 minutes in: next sessions start soon.' },
  ];
}
