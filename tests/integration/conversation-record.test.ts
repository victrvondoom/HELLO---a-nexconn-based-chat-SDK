import { beforeEach, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from './harness';
import { handleMessage } from '@/services/pipeline';
import { parseStoredOutcome } from '@/lib/validation/outcome';

let h: Harness;
beforeEach(async () => {
  h = await createHarness();
});

describe('conversation record', () => {
  it('stores the assistant answer with the message so it can be rebuilt after a reload', async () => {
    const res = await handleMessage(h.ctx, {
      eventId: h.eventId,
      userId: h.users.attendeeAda,
      text: 'The microphone is not working, and there are too many people in Room 3.',
    });

    const stored = (await h.store.listMessages(h.eventId)).find((m) => m.id === res.messageId);
    expect(stored).toBeDefined();
    const outcome = parseStoredOutcome(stored?.interpretation ?? null);
    expect(outcome).not.toBeNull();
    expect(outcome?.reply).toBe(res.reply);
    expect(outcome?.incidents.map((i) => i.incidentId)).toEqual(res.incidents.map((i) => i.incidentId));
    expect(outcome?.approvalId).toBe(res.approval?.id ?? null);
  });

  it('rejects stored outcomes that do not match the schema, so they render as plain text', () => {
    expect(parseStoredOutcome({ outcome: { reply: 'x', incidents: [{ incidentId: 1 }] } })).toBeNull();
    expect(parseStoredOutcome({ outcome: null })).toBeNull();
    expect(parseStoredOutcome(null)).toBeNull();
    expect(parseStoredOutcome({ intent: 'REPORT_INCIDENT' })).toBeNull();
  });
});
