import { describe, expect, it } from 'vitest';
import { ANSWER_THRESHOLD, bestSnippet, searchKnowledge, terms } from '@/agents/knowledge';
import { detectEmergency } from '@/agents/sentinel';
import {
  CachedWebSearch,
  cleanText,
  isOutsideVenueQuestion,
  redactQuery,
  safeUrl,
  searchWeb,
  webSearchFromEnv,
  type WebSearchProvider,
} from '@/agents/web';
import { AgentRun } from '@/agents/trace';
import { buildReferenceDocs, DEMO_EVENT_ID } from '@/store/seed';

const docs = buildReferenceDocs(DEMO_EVENT_ID, 0);

describe('event guide retrieval', () => {
  it('answers a plain question from the right page above the threshold', () => {
    const [top] = searchKnowledge(docs, { text: 'What is the wifi password?', staff: false });
    expect(top?.doc.id).toBe('ref-wifi');
    expect(top?.score).toBeGreaterThanOrEqual(ANSWER_THRESHOLD);
    expect(top?.snippet).toMatch(/password/i);
  });

  it('folds spelling variants and plurals', () => {
    expect(terms('Wi-Fi chargers')).toEqual(['wifi', 'charger']);
    expect(searchKnowledge(docs, { text: 'where are the toilets', staff: false })[0]?.doc.id).toBe('ref-toilets');
  });

  it('never returns staff procedures to attendees, even when they match best', () => {
    const attendee = searchKnowledge(docs, { text: 'microphone receiver pack battery hdmi', staff: false, limit: 10 });
    expect(attendee.every((h) => h.doc.audience === 'EVERYONE')).toBe(true);
    const staff = searchKnowledge(docs, { text: 'microphone receiver pack battery hdmi', staff: true });
    expect(staff[0]?.doc.id).toBe('ref-proc-av');
  });

  it('prefers the procedure for the incident category', () => {
    const [top] = searchKnowledge(docs, { text: 'room is full of people', staff: true, category: 'CAPACITY' });
    expect(top?.doc.id).toBe('ref-proc-capacity');
  });

  it('finds nothing confident for an unrelated question', () => {
    const top = searchKnowledge(docs, { text: 'Who won the football yesterday?', staff: false })[0];
    expect(top === undefined || top.score < ANSWER_THRESHOLD).toBe(true);
  });

  it('builds snippets from the sentences that match, in order', () => {
    const body = 'Alpha is first. Bravo has the lunch times. Charlie talks about coffee and lunch.';
    expect(bestSnippet(body, terms('lunch coffee'))).toBe('Bravo has the lunch times. Charlie talks about coffee and lunch.');
  });
});

describe('safety sentinel', () => {
  it('detects medical, fire and security emergencies', () => {
    expect(detectEmergency('Someone has collapsed near Room 3').kind).toBe('MEDICAL');
    expect(detectEmergency('There is smoke coming from the kitchen').kind).toBe('FIRE');
    expect(detectEmergency('There is an unattended bag by the lifts').kind).toBe('SECURITY');
  });

  it('ignores ordinary mentions of the same words', () => {
    expect(detectEmergency('Where is first aid?').emergency).toBe(false);
    expect(detectEmergency('Is the attack surface talk in Room 2?').emergency).toBe(false);
    expect(detectEmergency('The microphone in Room 3 has stopped working.').emergency).toBe(false);
  });
});

describe('web research boundary', () => {
  const ok = (results: unknown): WebSearchProvider => ({ name: 'Fake', search: () => Promise.resolve({ results }) });

  it('only treats questions about the outside world as web questions', () => {
    expect(isOutsideVenueQuestion('Where is the nearest pharmacy?')).toBe(true);
    expect(isOutsideVenueQuestion('What is the weather tomorrow?')).toBe(true);
    expect(isOutsideVenueQuestion('When does the robotics talk start?')).toBe(false);
  });

  it('removes personal details before a query leaves HELLO', () => {
    const q = redactQuery('Ada (demo attendee) here, ada@example.com +351 912 345 678 @ada_x nearest pharmacy', ['Ada (demo attendee)']);
    expect(q).toBe('here, nearest pharmacy');
  });

  it('cleans markup, control characters and unsafe links', () => {
    expect(cleanText('<b>Open</b>\u0007 <script>alert(1)</script>late', 100)).toBe('Open late');
    expect(safeUrl('javascript:alert(1)')).toBeNull();
    expect(safeUrl('https://user:pw@example.com/')).toBeNull();
    expect(safeUrl('https://example.com/a')).toBe('https://example.com/a');
  });

  it('returns cleaned, de-duplicated references', async () => {
    const out = await searchWeb(
      ok([
        { title: 'Pharmacy A', url: 'https://a.example/x?utm=1', content: 'Open <i>24h</i>.', score: 0.9 },
        { title: 'Pharmacy A again', url: 'https://a.example/x?utm=2', content: 'Duplicate.' },
        { title: 'Bad', url: 'ftp://b.example', content: 'Dropped.' },
        { title: '', url: 'https://c.example/', content: 'Second source.' },
      ]),
      'pharmacy',
    );
    expect(out.status).toBe('OK');
    if (out.status !== 'OK') return;
    expect(out.references.map((r) => r.url)).toEqual(['https://a.example/x?utm=1', 'https://c.example/']);
    expect(out.references[0]?.snippet).toBe('Open 24h .');
    expect(out.references[1]?.title).toBe('c.example');
    expect(out.references.every((r) => r.kind === 'WEB')).toBe(true);
  });

  it('turns every provider failure into a FAILED outcome', async () => {
    const throwing: WebSearchProvider = { name: 'x', search: () => Promise.reject(new Error('boom')) };
    const hanging: WebSearchProvider = { name: 'x', search: () => new Promise(() => undefined) };
    expect((await searchWeb(throwing, 'pharmacy')).status).toBe('FAILED');
    expect((await searchWeb(hanging, 'pharmacy', { timeoutMs: 20 })).status).toBe('FAILED');
    expect((await searchWeb(ok('not an array'), 'pharmacy')).status).toBe('FAILED');
    expect((await searchWeb(ok([]), 'pharmacy')).status).toBe('FAILED');
    expect((await searchWeb(null, 'pharmacy')).status).toBe('SKIPPED');
  });

  it('caches identical queries', async () => {
    let calls = 0;
    let clock = 0;
    const cached = new CachedWebSearch(
      { name: 'x', search: () => Promise.resolve({ results: [], n: ++calls }) },
      () => clock,
      1000,
    );
    const signal = new AbortController().signal;
    await cached.search('Pharmacy', signal);
    await cached.search('pharmacy', signal);
    expect(calls).toBe(1);
    clock = 2000;
    await cached.search('pharmacy', signal);
    expect(calls).toBe(2);
  });

  it('is configured only with a known provider and a key', () => {
    expect(webSearchFromEnv({})).toBeNull();
    expect(webSearchFromEnv({ HELLO_WEB_SEARCH_PROVIDER: 'tavily' })).toBeNull();
    expect(webSearchFromEnv({ HELLO_WEB_SEARCH_PROVIDER: 'other', HELLO_WEB_SEARCH_API_KEY: 'k' })).toBeNull();
    expect(webSearchFromEnv({ HELLO_WEB_SEARCH_PROVIDER: 'Tavily', HELLO_WEB_SEARCH_API_KEY: 'k' })?.name).toBe('Tavily');
  });
});

describe('agent run trace', () => {
  it('records a failing step as FAILED and continues', async () => {
    const run = new AgentRun();
    const value = await run.step('web', () => Promise.reject(new Error('x')), () => 'fallback');
    expect(value).toBe('fallback');
    run.record('grounding', 'DONE', 'ok');
    const trace = run.finish('NO_ANSWER');
    expect(trace.steps.map((s) => [s.agent, s.status])).toEqual([
      ['web', 'FAILED'],
      ['grounding', 'DONE'],
    ]);
  });
});
