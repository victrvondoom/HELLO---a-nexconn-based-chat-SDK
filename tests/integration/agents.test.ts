import { describe, expect, it } from 'vitest';
import { createHarness } from './harness';
import { handleMessage } from '@/services/pipeline';
import { parseStoredOutcome } from '@/lib/validation/outcome';
import type { WebSearchProvider } from '@/agents/web';
import { AGENT_IDS } from '@/agents/types';

function recordingProvider(results: unknown[]): WebSearchProvider & { queries: string[] } {
  const queries: string[] = [];
  return {
    name: 'Fake search',
    queries,
    search(query: string) {
      queries.push(query);
      return Promise.resolve({ results });
    },
  };
}

describe('agent mesh in the conversation', () => {
  it('runs every agent once, in order, and stores the trace with the message', async () => {
    const h = await createHarness();
    const res = await handleMessage(h.ctx, { eventId: h.eventId, userId: h.users.attendeeAda, text: 'The microphone in Room 3 has stopped working.' });
    expect(res.agents.steps.map((s) => s.agent)).toEqual([...AGENT_IDS]);
    expect(res.agents.grounding).toBe('VERIFIED_RECORDS');
    const stored = (await h.store.listMessages(h.eventId)).find((m) => m.id === res.messageId);
    const outcome = parseStoredOutcome(stored?.interpretation ?? null);
    expect(outcome?.agents?.steps).toHaveLength(AGENT_IDS.length);
  });

  it('answers an event question from the guide and cites the page', async () => {
    const h = await createHarness();
    const res = await handleMessage(h.ctx, { eventId: h.eventId, userId: h.users.attendeeAda, text: 'What is the wifi password?' });
    expect(res.agents.grounding).toBe('EVENT_GUIDE');
    expect(res.reply).toMatch(/badge/);
    expect(res.reply).toMatch(/\[1\]/);
    expect(res.agents.references[0]?.id).toBe('ref-wifi');
    expect(res.incidents).toHaveLength(0);
  });

  it('keeps event questions inside HELLO even when a web provider is configured', async () => {
    const web = recordingProvider([{ title: 't', url: 'https://x.example', content: 'c' }]);
    const h = await createHarness({ webSearch: web });
    await handleMessage(h.ctx, { eventId: h.eventId, userId: h.users.attendeeAda, text: 'When does lunch start?' });
    await handleMessage(h.ctx, { eventId: h.eventId, userId: h.users.attendeeAda, text: 'Who won the football yesterday?' });
    expect(web.queries).toHaveLength(0);
  });

  it('researches outside-the-venue questions on the web with a redacted, venue-scoped query', async () => {
    const web = recordingProvider([{ title: 'Farmácia Central', url: 'https://pharmacy.example/central', content: 'Open until 22:00, 300 m from the metro.' }]);
    const h = await createHarness({ webSearch: web });
    const res = await handleMessage(h.ctx, {
      eventId: h.eventId,
      userId: h.users.attendeeAda,
      text: 'Where is the nearest pharmacy? Text me on +351 912 345 678',
    });
    expect(web.queries).toEqual(['Where is the nearest pharmacy? Text me on Lisbon']);
    expect(res.agents.grounding).toBe('WEB_UNVERIFIED');
    expect(res.reply).toMatch(/not been checked by the organisers/);
    expect(res.agents.references.find((r) => r.kind === 'WEB')?.url).toBe('https://pharmacy.example/central');
  });

  it('says it does not know when no provider is configured, instead of guessing', async () => {
    const h = await createHarness();
    const res = await handleMessage(h.ctx, { eventId: h.eventId, userId: h.users.attendeeAda, text: 'Where is the nearest pharmacy?' });
    expect(res.agents.grounding).toBe('NO_ANSWER');
    expect(res.agents.steps.find((s) => s.agent === 'web')?.status).toBe('SKIPPED');
    expect(res.reply).toMatch(/will not guess/);
  });

  it('reports a failing web provider in the trace and still answers honestly', async () => {
    const h = await createHarness({ webSearch: { name: 'Broken', search: () => Promise.reject(new Error('down')) } });
    const res = await handleMessage(h.ctx, { eventId: h.eventId, userId: h.users.attendeeAda, text: 'Is there a supermarket nearby?' });
    expect(res.agents.steps.find((s) => s.agent === 'web')?.status).toBe('FAILED');
    expect(res.agents.grounding).toBe('NO_ANSWER');
  });

  it('treats an emergency as critical, logs it, and puts the guide’s emergency guidance first', async () => {
    const h = await createHarness();
    const res = await handleMessage(h.ctx, { eventId: h.eventId, userId: h.users.attendeeBen, text: 'Is anyone a doctor? A man has collapsed in the Main Hall.' });
    expect(res.incidents.length).toBeGreaterThan(0);
    expect(res.incidents.every((i) => i.urgency === 'CRITICAL')).toBe(true);
    expect(res.reply.startsWith('In an emergency')).toBe(true);
    expect(res.agents.steps.find((s) => s.agent === 'sentinel')?.summary).toMatch(/medical/);
  });

  it('offers a public guide page to a reporter while staff respond, but never a staff procedure', async () => {
    const h = await createHarness();
    const access = await handleMessage(h.ctx, { eventId: h.eventId, userId: h.users.attendeeChloe, text: 'I cannot find the accessible entrance.' });
    expect(access.reply).toMatch(/Meanwhile, the event guide says: The accessible entrance is on the east side/);
    const av = await handleMessage(h.ctx, { eventId: h.eventId, userId: h.users.attendeeDev, text: 'The projector in Room 4 has no signal.' });
    expect(av.agents.references.some((r) => r.kind === 'STAFF_PROCEDURE')).toBe(false);
    const staff = await handleMessage(h.ctx, { eventId: h.eventId, userId: h.users.opsKiri, text: 'The projector in Room 2 has no signal.' });
    expect(staff.agents.references.some((r) => r.id === 'ref-proc-av')).toBe(true);
  });

  it('parses messages stored before the agent mesh existed', () => {
    const legacy = {
      outcome: { reply: 'x', clarifyingQuestion: null, incidents: [], alternatives: [], approvalId: null, statusReport: null, people: [] },
    };
    expect(parseStoredOutcome(legacy)?.agents).toBeUndefined();
  });

  it('drops non-http links read back from storage', () => {
    const tampered = {
      outcome: {
        reply: 'x',
        clarifyingQuestion: null,
        incidents: [],
        alternatives: [],
        approvalId: null,
        statusReport: null,
        people: [],
        agents: {
          steps: [],
          references: [{ id: 'web-1', kind: 'WEB', title: 't', snippet: 's', url: 'javascript:alert(1)', score: 0.5 }],
          grounding: 'WEB_UNVERIFIED',
          totalMs: 1,
        },
      },
    };
    expect(parseStoredOutcome(tampered)?.agents?.references[0]?.url).toBeNull();
  });
});
