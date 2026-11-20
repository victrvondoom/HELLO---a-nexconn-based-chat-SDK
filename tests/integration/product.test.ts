import { describe, expect, it } from 'vitest';
import { landing, winningLine } from '@/domain/games/four';
import { DomainError } from '@/domain/errors';
import { MemoryHelloStore } from '@/store/memory';
import { endSession, register, sessionUser, signIn, startSession } from '@/services/auth';
import { actOnPost, createPost, listFeed } from '@/services/feed';
import { createCommunity } from '@/services/communities';
import { mapView, shareLocation } from '@/services/location';
import { createGame, playGame, viewGame } from '@/services/games';
import { flowSnapshot, runWorkflow } from '@/services/workflows';
import { createToken, resolveToken, revokeToken } from '@/services/tokens';
import { handleMcp } from '@/services/mcp';
import { eraseMe } from '@/services/rights';
import { createHarness } from './harness';

const code = async (run: Promise<unknown>) => run.then(() => 'OK', (e: unknown) => (e instanceof DomainError ? e.code : 'THROWN'));
const all = { scope: 'all', communityId: null, authorId: null } as const;
const text = (t: string) => ({ text: t, mediaId: null, communityId: null, repostOf: null });

describe('four in a row rules', () => {
  it('lands discs at the bottom and finds lines in every direction', () => {
    const board = new Array<number>(42).fill(0);
    expect(landing(board, 3)).toBe(38);
    for (const cell of [35, 36, 37, 38]) board[cell] = 1;
    expect(winningLine(board, 36)).toEqual([35, 36, 37, 38]);
    const diagonal = new Array<number>(42).fill(0);
    for (const cell of [35, 29, 23, 17]) diagonal[cell] = 2;
    expect(winningLine(diagonal, 23)).toHaveLength(4);
    expect(winningLine(diagonal, 0)).toEqual([]);
  });
});

describe('accounts and sessions', () => {
  it('registers, signs in, and never accepts a wrong password or a duplicate handle', async () => {
    const h = await createHarness();
    const userId = await register(h.ctx, { handle: 'ana', displayName: 'Ana', password: 'long enough password' });
    expect(await signIn(h.ctx, { handle: 'ana', password: 'long enough password' })).toBe(userId);
    expect(await code(signIn(h.ctx, { handle: 'ana', password: 'wrong' }))).toBe('FORBIDDEN');
    expect(await code(signIn(h.ctx, { handle: 'nobody', password: 'long enough password' }))).toBe('FORBIDDEN');
    expect(await code(register(h.ctx, { handle: 'ana', displayName: 'Other', password: 'another password' }))).toBe('VALIDATION_FAILED');
    const account = await h.store.docGet('accounts', 'ana');
    expect(account?.passwordHash).not.toContain('long enough password');
  });

  it('stores only a hash of the session token, and expires sessions', async () => {
    const h = await createHarness();
    const token = await startSession(h.ctx, h.users.attendeeAda);
    expect((await h.store.docList('authSessions')).some((s) => s.id === token)).toBe(false);
    expect((await sessionUser(h.ctx, token))?.userId).toBe(h.users.attendeeAda);
    expect(await sessionUser(h.ctx, 'not-a-token')).toBeNull();
    h.setNow(h.now() + 9 * 60 * 60 * 1000);
    expect(await sessionUser(h.ctx, token)).toBeNull();
    await endSession(h.ctx, token);
  });
});

describe('feed, communities and location respect who may see and change what', () => {
  it('refuses people outside the event, and deletes only for the author or an organiser', async () => {
    const h = await createHarness();
    const post = await createPost(h.ctx, h.eventId, h.users.attendeeAda, text('hello'));
    expect(await code(listFeed(h.ctx, h.eventId, 'u-stranger', all))).toBe('FORBIDDEN');
    expect(await code(listFeed(h.ctx, 'evt-other', h.users.attendeeAda, all))).toBe('FORBIDDEN');
    expect(await code(actOnPost(h.ctx, h.eventId, h.users.attendeeBen, post.id, { action: 'delete' }))).toBe('FORBIDDEN');
    expect(await code(actOnPost(h.ctx, h.eventId, h.users.organiserNadia, post.id, { action: 'delete' }))).toBe('OK');
  });

  it('lets only community members post in a community', async () => {
    const h = await createHarness();
    const community = await createCommunity(h.ctx, h.eventId, h.users.attendeeAda, { name: 'Makers', description: '', country: null });
    expect(await code(createPost(h.ctx, h.eventId, h.users.attendeeBen, { ...text('hi'), communityId: community.id }))).toBe('FORBIDDEN');
  });

  it('shows a connections-only location to nobody else, seals it at rest, and expires it', async () => {
    const h = await createHarness();
    await shareLocation(h.ctx, h.eventId, h.users.attendeeHana, { audience: 'CONNECTIONS', lat: 48.8566, lng: 2.3522, approximate: true, minutes: 15 });
    const stored = await h.store.docGet('locations', `${h.eventId}:${h.users.attendeeHana}`);
    expect(stored?.sealed).not.toContain('48.8');
    const stranger = await register(h.ctx, { handle: 'stranger', displayName: 'Stranger', password: 'long enough password' });
    expect((await mapView(h.ctx, h.eventId, stranger)).people).toHaveLength(0);
    const own = await mapView(h.ctx, h.eventId, h.users.attendeeHana);
    expect(own.me?.lat).toBe(48.86);
    h.setNow(h.now() + 16 * 60_000);
    expect((await mapView(h.ctx, h.eventId, h.users.attendeeHana)).me).toBeNull();
    expect(await h.store.docGet('locations', `${h.eventId}:${h.users.attendeeHana}`)).toBeNull();
  });
});

describe('games', () => {
  it('lets only one of two simultaneous moves land', async () => {
    const h = await createHarness();
    const game = await createGame(h.ctx, h.eventId, h.users.attendeeAda, 'FOUR');
    await playGame(h.ctx, h.eventId, h.users.attendeeBen, game.id, { action: 'join' });
    const results = await Promise.all([0, 1].map((col) => code(playGame(h.ctx, h.eventId, h.users.attendeeAda, game.id, { action: 'move', col }))));
    expect(results.filter((r) => r === 'OK')).toHaveLength(1);
    expect((await viewGame(h.ctx, h.eventId, h.users.attendeeAda, game.id)).board.filter(Boolean)).toHaveLength(1);
  });

  it('keeps quiz answers back until a person has answered', async () => {
    const h = await createHarness();
    const quiz = await createGame(h.ctx, h.eventId, h.users.attendeeAda, 'QUIZ');
    const before = await viewGame(h.ctx, h.eventId, h.users.attendeeBen, quiz.id);
    expect(before.questions.every((q) => q.answer === null)).toBe(true);
    expect(JSON.stringify(before)).not.toContain('"answer":0');
  });
});

describe('workflows and MCP never exceed the person behind them', () => {
  it('runs with the starter’s permissions and records the run', async () => {
    const h = await createHarness();
    expect(await code(runWorkflow(h.ctx, h.eventId, h.users.attendeeAda, 'sla-sweep', 'CANVAS'))).toBe('FORBIDDEN');
    const run = await runWorkflow(h.ctx, h.eventId, h.users.organiserNadia, 'ops-briefing', 'CANVAS');
    expect(run.status).toBe('SUCCEEDED');
    const attendee = await flowSnapshot(h.ctx, h.eventId, h.users.attendeeAda);
    expect(attendee.runs).toHaveLength(0);
    expect(attendee.nodes.some((n) => n.id === 'signals')).toBe(false);
    expect((await h.store.listAudit(h.eventId)).some((a) => a.action === 'workflow.run')).toBe(true);
  });

  it('stores token hashes only, scopes tools, and stops at revocation', async () => {
    const h = await createHarness();
    const made = await createToken(h.ctx, h.users.attendeeAda, { name: 't', scope: 'READ', eventId: h.eventId });
    expect(JSON.stringify(await h.store.docList('apiTokens'))).not.toContain(made.secret);
    const token = await resolveToken(h.ctx, made.secret);
    if (!token) throw new Error('token did not resolve');
    const call = (name: string, args: object) => handleMcp(h.ctx, token, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
    expect(await call('hello_post', { text: 'x' })).toMatchObject({ result: { isError: true } });
    expect(await call('hello_schedule', {})).toMatchObject({ result: { isError: false } });
    expect(await handleMcp(h.ctx, token, { jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull();
    expect(await code(revokeToken(h.ctx, h.users.attendeeBen, made.id))).toBe('NOT_FOUND');
    await revokeToken(h.ctx, h.users.attendeeAda, made.id);
    expect(await resolveToken(h.ctx, made.secret)).toBeNull();
  });
});

describe('erasure and durable storage', () => {
  it('erases posts, likes, tokens, location and the sign-in account', async () => {
    const h = await createHarness();
    const userId = await register(h.ctx, { handle: 'gone', displayName: 'Gone', password: 'long enough password' });
    const other = await createPost(h.ctx, h.eventId, h.users.attendeeAda, text('keep'));
    await createPost(h.ctx, h.eventId, userId, text('remove me'));
    await actOnPost(h.ctx, h.eventId, userId, other.id, { action: 'like', on: true });
    await createToken(h.ctx, userId, { name: 't', scope: 'WRITE', eventId: h.eventId });
    await shareLocation(h.ctx, h.eventId, userId, { audience: 'EVENT', lat: 1, lng: 1, approximate: false, minutes: 15 });
    await eraseMe(h.ctx, userId);
    // The demo seed has its own posts (pst-seed-*). Of the posts made here, only 'keep' survives, unliked.
    const feed = (await listFeed(h.ctx, h.eventId, h.users.attendeeAda, all)).filter((p) => !p.id.startsWith('pst-seed-'));
    expect(feed.map((p) => p.text)).toEqual(['keep']);
    expect(feed[0]?.likeCount).toBe(0);
    expect(await h.store.docList('apiTokens', { userId })).toHaveLength(0);
    expect(await h.store.docList('locations', { userId })).toHaveLength(0);
    expect(await code(signIn(h.ctx, { handle: 'gone', password: 'long enough password' }))).toBe('FORBIDDEN');
  });

  it('restores everything from a snapshot', async () => {
    const h = await createHarness();
    await register(h.ctx, { handle: 'kept', displayName: 'Kept', password: 'long enough password' });
    const post = await createPost(h.ctx, h.eventId, h.users.attendeeAda, text('still here'));
    await actOnPost(h.ctx, h.eventId, h.users.attendeeBen, post.id, { action: 'like', on: true });
    const restored = new MemoryHelloStore();
    restored.hydrate(h.store.snapshot());
    const made = (store: MemoryHelloStore) => store.docList('posts').then((posts) => posts.filter((p) => !p.id.startsWith('pst-seed-')).map((p) => p.text));
    expect(await made(restored)).toEqual(['still here']);
    expect((await restored.docList('posts')).length).toBe((await h.store.docList('posts')).length);
    expect(await restored.docGet('accounts', 'kept')).not.toBeNull();
    expect((await restored.listIncidents(h.eventId)).length).toBe((await h.store.listIncidents(h.eventId)).length);
    // Notification de-duplication survives too: the same notice cannot be written twice after a restart.
    const liked = (await restored.listNotifications(h.users.attendeeAda)).find((n) => n.kind === 'POST_LIKED');
    if (!liked) throw new Error('the like notification was not restored');
    expect(await restored.insertNotificationIfNew(liked)).toBe(false);
  });
});
