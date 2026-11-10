import { beforeEach, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from './harness';
import { handleMessage } from '@/services/pipeline';
import { AWAITING_ROOM_WINDOW_MS } from '@/services/incidents';

let h: Harness;
beforeEach(async () => {
  h = await createHarness();
});

const say = (userId: string, text: string) => handleMessage(h.ctx, { eventId: h.eventId, userId, text });

describe('room follow-up continues the same incident', () => {
  it('asks for the room, then the answer completes that incident instead of opening another', async () => {
    const first = await say(h.users.attendeeBen, 'The microphone is broken.');
    const id = first.incidents[0]?.incidentId;
    expect(first.incidents[0]?.status).toBe('NEEDS_INFORMATION');
    expect(first.clarifyingQuestion).toContain('Which room');

    const second = await say(h.users.attendeeBen, 'It is in Room 2.');
    expect(second.incidents[0]?.incidentId).toBe(id);
    expect(second.incidents[0]?.status).toBe('TRIAGED');

    const stored = await h.store.getIncident(id ?? '');
    expect(stored?.roomId).toBe('r-2');
    expect(stored?.title).toContain('Room 2');
    const incidents = (await h.store.listIncidents(h.eventId)).filter((i) => i.createdByUserId === h.users.attendeeBen);
    expect(incidents).toHaveLength(1);
    const timeline = await h.store.listTimeline(id ?? '');
    expect(timeline.map((t) => t.toStatus)).toContain('TRIAGED');
  });

  it('does not treat an unrelated new concern as the answer to the question', async () => {
    const first = await say(h.users.attendeeBen, 'The microphone is broken.');
    const id = first.incidents[0]?.incidentId;
    const second = await say(h.users.attendeeBen, 'Room 4 is overcrowded.');
    expect(second.incidents[0]?.incidentId).not.toBe(id);
    expect((await h.store.getIncident(id ?? ''))?.status).toBe('NEEDS_INFORMATION');
  });

  it('stops applying the follow-up once the window has passed', async () => {
    const first = await say(h.users.attendeeBen, 'The microphone is broken.');
    const id = first.incidents[0]?.incidentId;
    h.setNow(h.now() + AWAITING_ROOM_WINDOW_MS + 60_000);
    const later = await say(h.users.attendeeBen, 'Room 2.');
    expect(later.incidents[0]?.incidentId).not.toBe(id);
  });

  it('only continues a report made by the same person', async () => {
    const first = await say(h.users.attendeeBen, 'The microphone is broken.');
    const id = first.incidents[0]?.incidentId;
    const other = await say(h.users.attendeeChloe, 'Room 2.');
    expect(other.incidents[0]?.incidentId).not.toBe(id);
  });
});
