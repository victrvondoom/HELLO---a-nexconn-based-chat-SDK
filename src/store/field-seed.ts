import { createHash, randomBytes } from 'node:crypto';
import type { MemoryHelloStore } from './memory';
import type { FieldMission, FieldSeason, FieldStation } from '../domain/product';
import { monthWindow } from '../domain/field/rules';

/**
 * Development seed for HELLO Field Atlas. Labelled DEMO_SEED. It is loaded only with the demo event.
 *
 * Stations are created with a random code that nobody knows. Attendees therefore cannot check in until an
 * organiser issues a code from the Field Atlas manage page. That is deliberate: no demo check-in can succeed
 * without a staff action.
 */
export async function seedFieldAtlas(store: MemoryHelloStore, eventId: string, now: number): Promise<void> {
  const window = monthWindow(2026, 11);
  const season: FieldSeason = {
    id: 'season-2026-11',
    eventId,
    year: 2026,
    month: 11,
    title: 'November: The First Explorer',
    theme: 'Find your way around, then help others find theirs.',
    description: 'Four missions take you through the venue and the workflow canvas. Finish them all in November to earn the badge.',
    startsAt: window.startsAt,
    endsAt: window.endsAt,
    artwork: 'compass',
    bonusXp: 100,
    missionIds: ['fm-plan-day', 'fm-find-registration', 'fm-main-hall', 'fm-room-3'],
    requiredMissionIds: ['fm-plan-day', 'fm-find-registration', 'fm-main-hall', 'fm-room-3'],
    status: 'PUBLISHED',
    source: 'DEMO_SEED',
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
  const base = { eventId, startsAt: null, endsAt: null, status: 'PUBLISHED' as const, maxCompletionsPerPerson: 1 as const, source: 'DEMO_SEED' as const, version: 1, createdAt: now, updatedAt: now };
  const missions: FieldMission[] = [
    {
      ...base,
      id: 'fm-find-registration',
      title: 'Find registration',
      description: 'Walk to registration in the lobby and check in at the station there. Staff give you the current code.',
      whyItMatters: 'Registration holds lost property and can answer almost any question about the day.',
      category: 'EXPLORATION',
      difficulty: 'EASY',
      requiredLevel: 0,
      xp: 30,
      seasonId: season.id,
      spaceId: 'sp-lobby',
      nonLocation: false,
      prerequisiteIds: [],
      verification: { method: 'CHECK_IN', stationId: 'st-registration' },
      estimateMinutes: 5,
      accessibilityNote: 'Step-free from the accessible entrance on the east side.',
      endsAt: window.endsAt,
    },
    {
      ...base,
      id: 'fm-plan-day',
      title: 'Plan your day',
      description: 'Run the day planner on the workflow canvas. It reads the schedule and your open requests and sends you a summary.',
      whyItMatters: 'Knowing what is on next makes the rest of the event easier to use.',
      category: 'PARTICIPATION',
      difficulty: 'EASY',
      requiredLevel: 0,
      xp: 25,
      seasonId: season.id,
      spaceId: null,
      nonLocation: true,
      prerequisiteIds: [],
      verification: { method: 'WORKFLOW_RUN', workflowId: 'my-day' },
      estimateMinutes: 3,
      accessibilityNote: '',
      endsAt: window.endsAt,
    },
    {
      ...base,
      id: 'fm-main-hall',
      title: 'Find the Main Hall',
      description: 'Go to the Main Hall, where the keynote is held, and check in at the station by the doors.',
      whyItMatters: 'The keynote and the largest sessions are held here, so knowing the way in saves time later.',
      category: 'EXPLORATION',
      difficulty: 'EASY',
      requiredLevel: 0,
      xp: 40,
      seasonId: season.id,
      spaceId: 'sp-main',
      nonLocation: false,
      prerequisiteIds: ['fm-find-registration'],
      verification: { method: 'CHECK_IN', stationId: 'st-main-hall' },
      estimateMinutes: 10,
      accessibilityNote: 'Step-free through the lobby and atrium.',
      endsAt: window.endsAt,
    },
    {
      ...base,
      id: 'fm-room-3',
      title: 'Attend a workshop in Room 3',
      description: 'Check in at the Room 3 station during a workshop. Workshops on the schedule are listed on the sessions page.',
      whyItMatters: 'Workshops are where the smaller discussions happen, and Room 3 is step-free.',
      category: 'PARTICIPATION',
      difficulty: 'MEDIUM',
      requiredLevel: 0,
      xp: 60,
      seasonId: season.id,
      spaceId: 'sp-r3',
      nonLocation: false,
      prerequisiteIds: ['fm-main-hall'],
      verification: { method: 'CHECK_IN', stationId: 'st-room-3' },
      estimateMinutes: 15,
      accessibilityNote: 'Room 3 is step-free from the workshop corridor.',
      endsAt: window.endsAt,
    },
    {
      ...base,
      id: 'fm-gallery-route',
      title: 'Walk the step-free route to the gallery',
      description: 'Walk from the east entrance up to the first-floor gallery by the lift, then describe the route you took.',
      whyItMatters: 'Sharing a step-free route helps the next person who cannot take the stairs.',
      category: 'CONTRIBUTION',
      difficulty: 'EASY',
      requiredLevel: 1,
      xp: 35,
      seasonId: null,
      spaceId: 'sp-gallery',
      nonLocation: false,
      prerequisiteIds: [],
      verification: { method: 'MANUAL_REVIEW', evidencePrompt: 'Describe the route: where you started, how you went up, and how long it took.' },
      estimateMinutes: 10,
      accessibilityNote: 'This mission is the step-free alternative to the stairs.',
      endsAt: window.endsAt,
    },
    {
      ...base,
      id: 'fm-introduce',
      title: 'Introduce yourself to someone new',
      description: 'Start a conversation with someone you have not met at this event, then describe what you talked about.',
      whyItMatters: 'Introductions help people find the others they need during the event.',
      category: 'CONNECTION',
      difficulty: 'MEDIUM',
      requiredLevel: 2,
      xp: 60,
      seasonId: null,
      spaceId: null,
      nonLocation: true,
      prerequisiteIds: [],
      verification: { method: 'MANUAL_REVIEW', evidencePrompt: 'Say who you met and what you talked about, in your own words.' },
      estimateMinutes: 20,
      accessibilityNote: 'Can be done from any seat, online or in person.',
      endsAt: null,
    },
  ];
  const station = (id: string, spaceId: string, name: string): FieldStation => {
    // A code nobody knows: the station exists, but nobody can check in until staff issue a real code.
    const unknown = randomBytes(12).toString('hex');
    return {
      id,
      eventId,
      spaceId,
      name,
      codeHash: createHash('sha256').update(`${id}:${unknown}`).digest('hex'),
      // 0 means no code has been issued yet. A zero expiry is always in the past, so nothing can verify.
      codeIssuedAt: 0,
      codeExpiresAt: 0,
      rotations: 0,
      createdBy: 'seed',
      version: 1,
    };
  };
  const stations = [station('st-registration', 'sp-lobby', 'Registration'), station('st-main-hall', 'sp-main', 'Main Hall doors'), station('st-room-3', 'sp-r3', 'Room 3 door')];
  await store.docPut('fieldSeasons', season);
  for (const m of missions) await store.docPut('fieldMissions', m);
  for (const s of stations) await store.docPut('fieldStations', s);
}
