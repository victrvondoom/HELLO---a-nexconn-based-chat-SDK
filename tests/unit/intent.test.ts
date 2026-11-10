import { describe, expect, it } from 'vitest';
import {
  IntentResultSchema,
  interpretDeterministically,
  interpretMessage,
  ProviderRateLimitError,
  type IntentProvider,
  type IntentResult,
} from '@/ai/intent';

const ROOMS = ['Main Hall', 'Room 2', 'Room 3', 'Room 4'];

function scenario(text: string): IntentResult {
  return interpretDeterministically({ text, roomNames: ROOMS });
}

const VALID: IntentResult = {
  intent: 'REPORT_INCIDENT',
  category: 'AV',
  urgency: 'MEDIUM',
  entities: ['microphone'],
  roomHint: 'Room 3',
  missingInformation: [],
  requiresHumanApproval: false,
  confidence: 0.94,
};

function providerReturning(raw: unknown): IntentProvider {
  return { name: 'test', classify: () => Promise.resolve(raw) };
}

describe('deterministic interpretation of the judge scenarios', () => {
  it('routes an AV fault with its room', () => {
    const r = scenario('The microphone in Room 3 has stopped working.');
    expect(r.intent).toBe('REPORT_INCIDENT');
    expect(r.category).toBe('AV');
    expect(r.roomHint).toBe('Room 3');
    expect(r.entities).toEqual(['microphone']);
  });

  it('asks for the room when a room-scoped problem does not name one', () => {
    const r = scenario('This room is overcrowded.');
    expect(r.category).toBe('CAPACITY');
    expect(r.missingInformation).toEqual(['room']);
  });

  it('recognises a request for a person with a declared expertise', () => {
    expect(scenario('Can someone help me find a person who works on satellite communication?').intent).toBe('FIND_PERSON');
  });

  it('recognises a request for help from a volunteer', () => {
    expect(scenario('I need a volunteer to help me.').intent).toBe('REQUEST_ASSISTANCE');
  });

  it('recognises a follow-up on an earlier report', () => {
    expect(scenario('I reported this problem twenty minutes ago. Is anyone handling it?').intent).toBe('STATUS_CHECK');
  });

  it('recognises a schedule discrepancy', () => {
    const r = scenario('The schedule says 2 PM, but the speaker says 2:30 PM.');
    expect(r.intent).toBe('SCHEDULE_CONFLICT');
    expect(r.category).toBe('SCHEDULE');
  });

  it('answers a question rather than logging an incident', () => {
    const r = scenario('The presentation is too technical. Can someone explain it?');
    expect(r.intent).toBe('ASK_QUESTION');
  });

  it('answers a question about a named session rather than logging it as a fault', () => {
    const r = scenario('When does the Satellite Power Systems session start?');
    expect(r.intent).toBe('ASK_QUESTION');
    expect(r.category).toBeNull();
  });

  it('still treats a described power fault as a report', () => {
    expect(scenario('The power is out in Room 2.').intent).toBe('REPORT_INCIDENT');
    expect(scenario('The power is out in Room 2.').category).toBe('FACILITIES');
  });

  it('flags requests to change published things as needing approval', () => {
    const r = scenario('Please move the Satellite Power Systems session to the Main Hall.');
    expect(r.intent).toBe('CONSEQUENTIAL_REQUEST');
    expect(r.requiresHumanApproval).toBe(true);
  });
});

describe('AI provider boundary', () => {
  it('uses the deterministic interpreter when no provider is configured', async () => {
    const out = await interpretMessage({ text: 'Mic broken in Room 3', roomNames: ROOMS });
    expect(out.source).toBe('DETERMINISTIC_FALLBACK');
    expect(out.fallbackReason).toBe('NO_PROVIDER_CONFIGURED');
  });

  it('accepts a provider result only when it matches the schema', async () => {
    const out = await interpretMessage({ text: 'x', roomNames: ROOMS }, { provider: providerReturning(VALID) });
    expect(out.source).toBe('AI_PROVIDER');
    expect(out.result.category).toBe('AV');
  });

  it('rejects structurally invalid model output and falls back', async () => {
    const bad = { ...VALID, intent: 'DELETE_ALL_INCIDENTS' };
    const out = await interpretMessage(
      { text: 'The microphone in Room 3 has stopped working.', roomNames: ROOMS },
      { provider: providerReturning(bad) },
    );
    expect(out.fallbackReason).toBe('INVALID_STRUCTURED_OUTPUT');
    expect(out.result.category).toBe('AV');
  });

  it('rejects out-of-range confidence and unknown fields', () => {
    expect(IntentResultSchema.safeParse({ ...VALID, confidence: 1.5 }).success).toBe(false);
    expect(IntentResultSchema.safeParse({ ...VALID, entities: Array.from({ length: 21 }, () => 'x') }).success).toBe(false);
    expect(IntentResultSchema.safeParse(null).success).toBe(false);
  });

  it('times out a slow provider instead of waiting indefinitely', async () => {
    const never: IntentProvider = { name: 'slow', classify: () => new Promise<unknown>(() => undefined) };
    const out = await interpretMessage({ text: 'Mic broken in Room 3', roomNames: ROOMS }, { provider: never, timeoutMs: 20 });
    expect(out.fallbackReason).toBe('PROVIDER_TIMEOUT');
  });

  it('reports rate limits and provider errors as fallbacks', async () => {
    const limited: IntentProvider = { name: 'rl', classify: () => Promise.reject(new ProviderRateLimitError()) };
    const broken: IntentProvider = { name: 'err', classify: () => Promise.reject(new Error('502')) };
    expect((await interpretMessage({ text: 'x', roomNames: ROOMS }, { provider: limited })).fallbackReason).toBe('PROVIDER_RATE_LIMITED');
    expect((await interpretMessage({ text: 'x', roomNames: ROOMS }, { provider: broken })).fallbackReason).toBe('PROVIDER_ERROR');
  });
});
