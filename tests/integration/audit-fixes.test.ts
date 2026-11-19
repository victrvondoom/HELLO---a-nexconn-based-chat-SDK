import { mkdtempSync, existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from './harness';
import { DomainError } from '@/domain/errors';
import { resetAllRateLimiters } from '@/lib/rate-limit';
import { consumeAction } from '@/lib/action-limits';
import { persistenceFromEnv } from '@/lib/persistence';
import { MemoryHelloStore } from '@/store/memory';
import { createToken, resolveToken } from '@/services/tokens';
import { handleMcp } from '@/services/mcp';
import { ingestReport } from '@/services/incidents';
import { handleMessage } from '@/services/pipeline';
import { requestApproval } from '@/services/approvals';
import { follow } from '@/services/social';
import { confirmPayment, draftPayment, PAYMENT_LIMITS } from '@/services/payments';
import { eraseMe } from '@/services/rights';
import { createPost, deletePost, readMedia, uploadMedia } from '@/services/feed';
import { createGame, playGame, viewGame } from '@/services/games';
import { GAME_OPEN_MS } from '@/domain/games/lifecycle';
import { mapView, setCountry } from '@/services/location';
import { DEMO_NOW } from '@/store/seed';

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'OK';
  } catch (e: unknown) {
    return e instanceof DomainError ? e.code : 'THROWN';
  }
}

beforeEach(() => {
  // The shared action limits are process-wide, like in the server. Each test starts with a full allowance.
  resetAllRateLimiters();
});

describe('MCP cannot bypass the app’s per-person limits', () => {
  it('counts MCP messages against the same allowance as the app, across all of a person’s tokens', async () => {
    const h = await createHarness();
    const ada = h.users.attendeeAda;
    const tokens = await Promise.all(
      [1, 2].map(async (n) => {
        const made = await createToken(h.ctx, ada, { name: `t${n}`, scope: 'WRITE', eventId: h.eventId });
        const token = await resolveToken(h.ctx, made.secret);
        if (!token) throw new Error('token did not resolve');
        return token;
      }),
    );
    // 15 messages through the app's own route...
    for (let i = 0; i < 15; i += 1) consumeAction('message.send', ada, h.eventId, h.now());
    // ...leave 5 for MCP, whichever token is used.
    const [first, second] = tokens;
    if (!first || !second) throw new Error('expected two tokens');
    const send = (i: number) =>
      handleMcp(h.ctx, i % 2 === 0 ? first : second, { jsonrpc: '2.0', id: i, method: 'tools/call', params: { name: 'hello_send_message', arguments: { text: `Is the coffee open yet? ${i}` } } }) as Promise<{ result: { isError: boolean; content: Array<{ text: string }> } }>;
    const results = [];
    for (let i = 0; i < 6; i += 1) results.push(await send(i));
    expect(results.slice(0, 5).every((r) => !r.result.isError)).toBe(true);
    expect(results[5]?.result.isError).toBe(true);
    expect(results[5]?.result.content[0]?.text).toMatch(/too quickly/);
  });

  it('limits workflow runs through MCP like runs from the canvas', async () => {
    const h = await createHarness();
    const made = await createToken(h.ctx, h.users.attendeeAda, { name: 'w', scope: 'WRITE', eventId: h.eventId });
    const token = await resolveToken(h.ctx, made.secret);
    if (!token) throw new Error('token did not resolve');
    const run = (i: number) =>
      handleMcp(h.ctx, token, { jsonrpc: '2.0', id: i, method: 'tools/call', params: { name: 'hello_run_workflow', arguments: { workflowId: 'my-day' } } }) as Promise<{ result: { isError: boolean } }>;
    for (let i = 0; i < 10; i += 1) expect((await run(i)).result.isError).toBe(false);
    expect((await run(10)).result.isError).toBe(true);
  });
});

describe('incidents', () => {
  it('two people reporting the same problem at the same moment are both attached', async () => {
    const h = await createHarness();
    const report = (reporterUserId: string) =>
      ingestReport(h.ctx, {
        eventId: h.eventId,
        reporterUserId,
        text: 'The microphone in Room 3 is crackling badly',
        category: 'AV',
        urgency: 'MEDIUM',
        roomId: 'r-3',
        roomName: 'Room 3',
        equipment: ['microphone', 'speaker'],
        overcrowded: false,
      });
    const [a, b] = await Promise.all([report(h.users.attendeeBen), report(h.users.attendeeChloe)]);
    expect(a.attached && b.attached).toBe(true);
    expect(a.incident.id).toBe('inc-seed-av-r3');
    const incident = await h.store.getIncident('inc-seed-av-r3');
    expect(incident?.equipment).toEqual(expect.arrayContaining(['microphone', 'speaker']));
    const attachedEntries = (await h.store.listTimeline('inc-seed-av-r3')).filter((t) => t.type === 'REPORT_ATTACHED');
    expect(attachedEntries).toHaveLength(2);
  });
});

describe('conversation', () => {
  it('a question about a room lists each session with its time', async () => {
    const h = await createHarness();
    const r = await handleMessage(h.ctx, { eventId: h.eventId, userId: h.users.attendeeAda, text: 'What is on in Room 4 today?' });
    expect(r.reply).toMatch(/Edge Computing at Scale at \d{2}:\d{2} UTC/);
    expect(r.reply).not.toMatch(/ at [;.]/);
  });
});

/** Turns `src/app/events/[eventId]/incidents/[incidentId]/page.tsx` into a regex for `/events/x/incidents/y`. */
function pageRoutes(): RegExp[] {
  const root = join(process.cwd(), 'src', 'app');
  const out: RegExp[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === 'page.tsx') {
        const route = `/${relative(root, dir).split(sep).join('/')}`.replace(/\/$/, '');
        const pattern = route.replace(/\[[^\]]+\]/g, '[^/]+');
        out.push(new RegExp(`^${pattern === '' ? '/' : pattern}$`));
      }
    }
  };
  walk(root);
  return out;
}

describe('notification links', () => {
  it('every notification the app writes links to a page that exists', async () => {
    const h = await createHarness();
    // Raise notifications from several services: approvals, incidents, the conversation.
    await requestApproval(h.ctx, { eventId: h.eventId, requestedByUserId: h.users.opsKiri, actionType: 'PUBLISH_ANNOUNCEMENT', payload: { title: 'Doors', body: 'Doors open at nine.' }, justification: 'Test', linkedIncidentId: null });
    await handleMessage(h.ctx, { eventId: h.eventId, userId: h.users.attendeeBen, text: 'The projector in Room 2 is broken' });
    const routes = pageRoutes();
    const users = Object.values(h.users);
    const hrefs = new Set<string>();
    for (const u of users) for (const n of await h.store.listNotifications(u)) hrefs.add(n.href);
    expect(hrefs.size).toBeGreaterThan(3);
    const dead = [...hrefs].filter((href) => !routes.some((r) => r.test(href.split('#')[0] ?? href)));
    expect(dead).toEqual([]);
    expect([...hrefs].some((href) => href.endsWith('/operations#approvals'))).toBe(true);
  });
});

describe('payments', () => {
  it('two drafts confirmed at the same moment cannot pass the daily cap together', async () => {
    const h = await createHarness();
    const { attendeeAda: ada, attendeeBen: ben } = h.users;
    await follow(h.ctx, h.eventId, ada, ben);
    await follow(h.ctx, h.eventId, ben, ada);
    // Each draft is under the per-payment cap; together they are over the daily cap.
    const amount = PAYMENT_LIMITS.perPaymentMinor;
    const drafts = await Promise.all(
      Array.from({ length: 5 }, () => draftPayment(h.ctx, h.eventId, ada, ben, { amountMinor: amount, currency: 'INR', note: null, origin: 'TYPED' })),
    );
    const results = await Promise.allSettled(drafts.map((d) => confirmPayment(h.ctx, h.eventId, ada, d.id, d.version)));
    const paid = (await h.store.listPaymentsFrom(ada)).filter((p) => p.status === 'SUCCEEDED');
    expect(paid.reduce((sum, p) => sum + p.amountMinor, 0)).toBeLessThanOrEqual(PAYMENT_LIMITS.perDayMinor);
    expect(results.some((r) => r.status === 'rejected')).toBe(true);
    // A refused draft is given back, not lost, and nothing is left half-charged.
    expect((await h.store.listPaymentsFrom(ada)).some((p) => p.status === 'PROCESSING')).toBe(false);
  });
});

describe('erasure', () => {
  it('removes the person’s notifications and the notes they wrote on payments', async () => {
    const h = await createHarness();
    const { attendeeAda: ada, attendeeBen: ben } = h.users;
    await follow(h.ctx, h.eventId, ada, ben);
    await follow(h.ctx, h.eventId, ben, ada);
    const draft = await draftPayment(h.ctx, h.eventId, ada, ben, { amountMinor: 1500, currency: 'INR', note: 'Lunch at the corner place', origin: 'TYPED' });
    await confirmPayment(h.ctx, h.eventId, ada, draft.id, draft.version);
    expect((await h.store.listNotifications(ada)).length).toBeGreaterThan(0);
    const report = await eraseMe(h.ctx, ada);
    expect(report.notifications).toBeGreaterThan(0);
    expect(report.paymentNotesRedacted).toBe(1);
    expect(await h.store.listNotifications(ada)).toEqual([]);
    const kept = await h.store.getPayment(draft.id);
    expect(kept?.status).toBe('SUCCEEDED');
    expect(kept?.note).not.toContain('Lunch');
  });
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46]);
const HTML = new TextEncoder().encode('<html><script>alert(1)</script></html>');

describe('media', () => {
  it('accepts a file only when its bytes match the claimed type', async () => {
    const h = await createHarness();
    const ada = h.users.attendeeAda;
    expect(await codeOf(uploadMedia(h.ctx, h.eventId, ada, 'image/png', PNG))).toBe('OK');
    expect(await codeOf(uploadMedia(h.ctx, h.eventId, ada, 'image/jpeg', JPEG))).toBe('OK');
    // A JPEG claiming to be a PNG, and a page claiming to be a picture, are refused.
    expect(await codeOf(uploadMedia(h.ctx, h.eventId, ada, 'image/png', JPEG))).toBe('VALIDATION_FAILED');
    expect(await codeOf(uploadMedia(h.ctx, h.eventId, ada, 'image/png', HTML))).toBe('VALIDATION_FAILED');
    expect(await codeOf(uploadMedia(h.ctx, h.eventId, ada, 'text/html', HTML))).toBe('VALIDATION_FAILED');
  });

  it('keeps a picture used by another post when one of them is deleted', async () => {
    const h = await createHarness();
    const ada = h.users.attendeeAda;
    const media = await uploadMedia(h.ctx, h.eventId, ada, 'image/png', PNG);
    const first = await createPost(h.ctx, h.eventId, ada, { text: 'Morning', mediaId: media.id, communityId: null, repostOf: null });
    const second = await createPost(h.ctx, h.eventId, ada, { text: 'Again', mediaId: media.id, communityId: null, repostOf: null });
    await deletePost(h.ctx, first);
    expect((await readMedia(h.ctx, h.eventId, ada, media.id)).bytes.byteLength).toBe(PNG.byteLength);
    await deletePost(h.ctx, second);
    expect(await codeOf(readMedia(h.ctx, h.eventId, ada, media.id))).toBe('NOT_FOUND');
  });
});

describe('games', () => {
  it('closed quizzes stop counting, so five quiz rounds cannot lock a person out of games', async () => {
    const h = await createHarness();
    const ada = h.users.attendeeAda;
    for (let i = 0; i < 5; i += 1) await createGame(h.ctx, h.eventId, ada, 'QUIZ');
    expect(await codeOf(createGame(h.ctx, h.eventId, ada, 'FOUR'))).toBe('VALIDATION_FAILED');
    h.setNow(DEMO_NOW + GAME_OPEN_MS);
    const game = await createGame(h.ctx, h.eventId, ada, 'FOUR');
    expect(game.status).toBe('WAITING');
  });

  it('a closed quiz refuses answers and keeps its scores', async () => {
    const h = await createHarness();
    const quiz = await createGame(h.ctx, h.eventId, h.users.attendeeAda, 'QUIZ');
    await playGame(h.ctx, h.eventId, h.users.attendeeBen, quiz.id, { action: 'answer', question: 0, choice: 0 });
    h.setNow(DEMO_NOW + GAME_OPEN_MS + 1);
    expect(await codeOf(playGame(h.ctx, h.eventId, h.users.attendeeBen, quiz.id, { action: 'answer', question: 1, choice: 0 }))).toBe('INVALID_TRANSITION');
    const view = await viewGame(h.ctx, h.eventId, h.users.attendeeBen, quiz.id);
    expect(view.status).toBe('FINISHED');
    expect(view.players.find((p) => p.isSelf)?.answered).toBe(1);
  });
});

describe('live map', () => {
  it('does not show a country count small enough to identify someone', async () => {
    const h: Harness = await createHarness();
    const iceland = '352';
    await setCountry(h.ctx, h.users.attendeeAda, iceland);
    await setCountry(h.ctx, h.users.attendeeBen, iceland);
    let view = await mapView(h.ctx, h.eventId, h.users.attendeeChloe);
    expect(view.countries.some((c) => c.code === iceland)).toBe(false);
    expect(view.hiddenCountries).toBeGreaterThanOrEqual(1);
    await setCountry(h.ctx, h.users.attendeeChloe, iceland);
    view = await mapView(h.ctx, h.eventId, h.users.attendeeChloe);
    expect(view.countries.find((c) => c.code === iceland)?.members).toBe(3);
  });
});

describe('disk persistence', () => {
  it('writes a pending save at once when flushed, as on process exit', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hello-persist-'));
    try {
      const disk = persistenceFromEnv({ HELLO_DATA_DIR: dir });
      if (!disk) throw new Error('persistence did not start');
      const store = disk.attach(new MemoryHelloStore(), () => 1);
      await store.docPut('prefs', { id: 'u-test', country: '352' });
      // The debounced save has not run yet...
      expect(existsSync(join(dir, 'state.json'))).toBe(false);
      disk.flush();
      // ...and flush wrote it immediately.
      expect(readFileSync(join(dir, 'state.json'), 'utf8')).toContain('u-test');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('memory store', () => {
  it('copies patches on the way in, so a caller cannot change stored state afterwards', async () => {
    const h = await createHarness();
    const interests = ['robotics'];
    await h.store.updateUser(h.users.attendeeAda, { interests });
    interests.push('injected');
    expect((await h.store.getUser(h.users.attendeeAda))?.interests).toEqual(['robotics']);
  });
});
