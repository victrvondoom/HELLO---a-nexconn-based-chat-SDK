import { describe, expect, it } from 'vitest';
import { createHarness, type Harness } from './harness';
import {
  actOnStory,
  createHighlight,
  createStory,
  deleteHighlight,
  explore,
  listHighlights,
  listSaved,
  momentsCharter,
  setSaved,
  storyTray,
  storyViewers,
  type StoryInput,
} from '@/services/moments';
import { actOnPost, createPost, listFeed, readMedia, uploadMedia } from '@/services/feed';
import { eraseMe, exportMyData } from '@/services/rights';
import { STORY_ORDER, STORY_TTL_MS } from '@/domain/moments/stories';
import { DomainError } from '@/domain/errors';

const MIN = 60_000;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const MP4 = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32]);

const text = (t: string): StoryInput => ({ kind: 'TEXT', text: t, backdrop: 'sky', mediaId: null, spaceId: null, audience: 'EVENT' });
const post = (t: string, extra: Partial<{ mediaId: string | null; backdrop: 'sun' | null }> = {}) => ({ text: t, mediaId: null, communityId: null, repostOf: null, ...extra });
const feed = (scope: 'all' | 'latest' | 'visual') => ({ scope, communityId: null, authorId: null });

/** The error a promise rejects with: its code and message, or OK. */
async function outcome(run: Promise<unknown>): Promise<{ code: string; message: string; retryAfter: number | null }> {
  try {
    await run;
    return { code: 'OK', message: '', retryAfter: null };
  } catch (e) {
    if (!(e instanceof DomainError)) throw e;
    return { code: e.code, message: e.message, retryAfter: e.retryAfterSeconds };
  }
}
const code = async (run: Promise<unknown>) => (await outcome(run)).code;

async function ring(h: Harness, viewer: string, author: string) {
  return (await storyTray(h.ctx, h.eventId, viewer)).rings.find((r) => r.author.id === author);
}

describe('Moments: stories', () => {
  it('creates, views, reacts and deletes a story, and only the author sees counts and viewers', async () => {
    const h = await createHarness();
    const { attendeeBen: ben, attendeeAda: ada, organiserNadia: nadia } = h.users;
    const story = await createStory(h.ctx, h.eventId, ben, { ...text('Zero trust demo at 14:00'), spaceId: 'sp-r2' });
    expect(story.expiresAt).toBe(h.now() + STORY_TTL_MS);

    const seenByAda = (await ring(h, ada, ben))?.stories.find((s) => s.id === story.id);
    expect(seenByAda).toMatchObject({ seen: false, viewCount: null, reactionCount: null, canDelete: false, space: { id: 'sp-r2', name: 'Room 2' } });
    expect(seenByAda?.nexconn).toEqual({ messageType: 'HL:Story', channel: `community evt:${h.eventId} / stories` });

    // Views are idempotent: the first time is kept. The author's own view is not recorded.
    await actOnStory(h.ctx, h.eventId, ada, story.id, { action: 'view' });
    const firstAt = h.now();
    h.setNow(h.now() + 5 * MIN);
    const again = await actOnStory(h.ctx, h.eventId, ada, story.id, { action: 'view' });
    await actOnStory(h.ctx, h.eventId, ben, story.id, { action: 'view' });
    expect(again?.seen).toBe(true);
    expect((await h.store.docGet('stories', story.id))?.views).toEqual([{ userId: ada, at: firstAt }]);

    // One reaction per person, replaced, and the author is told once.
    await actOnStory(h.ctx, h.eventId, ada, story.id, { action: 'react', reactionId: 'fire' });
    const reacted = await actOnStory(h.ctx, h.eventId, ada, story.id, { action: 'react', reactionId: 'heart' });
    expect(reacted?.myReaction).toBe('heart');
    expect((await h.store.listNotifications(ben)).filter((n) => n.kind === 'STORY_REACTION')).toHaveLength(1);
    expect(await code(actOnStory(h.ctx, h.eventId, ben, story.id, { action: 'react', reactionId: 'clap' }))).toBe('VALIDATION_FAILED');

    const own = (await ring(h, ben, ben))?.stories.find((s) => s.id === story.id);
    expect(own).toMatchObject({ viewCount: 1, reactionCount: 1, seen: true, canDelete: true });
    expect(await storyViewers(h.ctx, h.eventId, ben, story.id)).toEqual([{ user: { id: ada, name: 'Ada (demo attendee)' }, at: firstAt, reactionId: 'heart' }]);
    expect(await code(storyViewers(h.ctx, h.eventId, ada, story.id))).toBe('NOT_FOUND');

    expect((await actOnStory(h.ctx, h.eventId, ada, story.id, { action: 'unreact' }))?.myReaction).toBeNull();
    expect(await code(actOnStory(h.ctx, h.eventId, ada, story.id, { action: 'delete' }))).toBe('FORBIDDEN');
    expect(await actOnStory(h.ctx, h.eventId, ben, story.id, { action: 'delete' })).toBeNull();
    expect(await code(actOnStory(h.ctx, h.eventId, ada, story.id, { action: 'view' }))).toBe('NOT_FOUND');

    // An organiser can take down someone else's story.
    const other = await createStory(h.ctx, h.eventId, ben, text('Second story'));
    expect(await code(actOnStory(h.ctx, h.eventId, nadia, other.id, { action: 'delete' }))).toBe('OK');
  });

  it('orders the tray as announced, with your own ring first even when it is empty', async () => {
    const h = await createHarness();
    const tray = await storyTray(h.ctx, h.eventId, h.users.attendeeAda);
    expect(tray.order).toEqual(STORY_ORDER);
    expect(tray.rings[0]).toMatchObject({ isYou: true, stories: [], latestAt: null, hasUnseen: false });
    // Unseen and followed (Ines, Dev), then unseen by latest story (Kiri, Ben, Lena), then seen by latest (Nadia, Chloe).
    expect(tray.rings.map((r) => r.author.id)).toEqual(['u-att-ada', 'u-spk-ines', 'u-att-dev', 'u-ops-kiri', 'u-att-ben', 'u-ops-lena', 'u-org-nadia', 'u-att-chloe']);
    expect(tray.rings[1]?.stories.map((s) => s.id)).toEqual(['sty-seed-ines-2', 'sty-seed-ines-1']);
  });

  it('hides a followers-only story, and its file, from people who do not follow the author', async () => {
    const h = await createHarness();
    const { attendeeAda: ada, attendeeBen: ben, attendeeDev: dev } = h.users; // Ada follows Dev and Ines; Ben follows neither.
    expect((await ring(h, ada, 'u-spk-ines'))?.stories.some((s) => s.id === 'sty-seed-ines-2')).toBe(true);
    expect((await ring(h, ben, 'u-spk-ines'))?.stories.some((s) => s.id === 'sty-seed-ines-2')).toBe(false);
    expect(await code(actOnStory(h.ctx, h.eventId, ben, 'sty-seed-ines-2', { action: 'view' }))).toBe('NOT_FOUND');

    const media = await uploadMedia(h.ctx, h.eventId, dev, 'image/png', PNG);
    const story = await createStory(h.ctx, h.eventId, dev, { ...text(''), kind: 'IMAGE', mediaId: media.id, audience: 'FOLLOWERS' });
    expect((await ring(h, ada, dev))?.stories.find((s) => s.id === story.id)?.nexconn.channel).toMatch(/ · directed$/);
    expect((await readMedia(h.ctx, h.eventId, ada, media.id)).meta.id).toBe(media.id);
    expect(await code(readMedia(h.ctx, h.eventId, ben, media.id))).toBe('NOT_FOUND');
    expect(await code(actOnStory(h.ctx, h.eventId, ben, story.id, { action: 'react', reactionId: 'wow' }))).toBe('NOT_FOUND');
  });

  it('deletes expired stories and their files, but keeps highlighted ones with their audience', async () => {
    const h = await createHarness();
    const { attendeeBen: ben, attendeeAda: ada } = h.users;
    const media = await uploadMedia(h.ctx, h.eventId, ben, 'image/png', PNG);
    const pictured = await createStory(h.ctx, h.eventId, ben, { ...text('Badge printer close-up'), kind: 'IMAGE', mediaId: media.id });
    const kept = await createStory(h.ctx, h.eventId, ben, text('Worth keeping'));
    await createHighlight(h.ctx, h.eventId, ben, { title: 'Summit', storyIds: [kept.id] });

    h.setNow(h.now() + STORY_TTL_MS + MIN);
    const tray = await storyTray(h.ctx, h.eventId, ada);
    expect(tray.rings.flatMap((r) => r.stories)).toHaveLength(0);
    expect(await h.store.docGet('stories', pictured.id)).toBeNull();
    expect(await h.store.docGet('media', media.id)).toBeNull();
    expect(await h.store.blobGet(media.id)).toBeNull();
    expect(await h.store.docGet('stories', 'sty-seed-dev-1')).toBeNull();
    // Highlighted stories outlive the 24 hours: Ben's own, and Ines's seeded pair.
    expect(await h.store.docGet('stories', kept.id)).not.toBeNull();
    expect((await listHighlights(h.ctx, h.eventId, ada, ben))[0]?.stories.map((s) => s.id)).toEqual([kept.id]);
    // Ben does not follow Ines: her followers-only story stays hidden inside the highlight too.
    const inesForBen = await listHighlights(h.ctx, h.eventId, ben, 'u-spk-ines');
    expect(inesForBen[0]?.stories.map((s) => s.id)).toEqual(['sty-seed-ines-1']);
    expect((await listHighlights(h.ctx, h.eventId, ada, 'u-spk-ines'))[0]?.stories).toHaveLength(2);
    expect(await code(actOnStory(h.ctx, h.eventId, ben, 'sty-seed-ines-1', { action: 'view' }))).toBe('OK');
    expect(await code(actOnStory(h.ctx, h.eventId, ben, 'sty-seed-ines-2', { action: 'view' }))).toBe('NOT_FOUND');
    expect(await code(actOnStory(h.ctx, h.eventId, ada, pictured.id, { action: 'view' }))).toBe('NOT_FOUND');
  });

  it('lets only the owner build highlights from their own stories, and hides one with nothing to show', async () => {
    const h = await createHarness();
    const { attendeeBen: ben, attendeeAda: ada } = h.users;
    expect(await code(createHighlight(h.ctx, h.eventId, ada, { title: 'Not mine', storyIds: ['sty-seed-ines-1'] }))).toBe('NOT_FOUND');
    const only = await createHighlight(h.ctx, h.eventId, 'u-spk-ines', { title: 'Followers', storyIds: ['sty-seed-ines-2'] });
    expect((await listHighlights(h.ctx, h.eventId, ben, 'u-spk-ines')).map((x) => x.id)).not.toContain(only.id);
    expect((await listHighlights(h.ctx, h.eventId, ada, 'u-spk-ines')).map((x) => x.id)).toContain(only.id);
    expect(await code(deleteHighlight(h.ctx, h.eventId, ada, only.id))).toBe('FORBIDDEN');
    expect(await code(deleteHighlight(h.ctx, h.eventId, 'u-spk-ines', only.id))).toBe('OK');
    expect(await code(listHighlights(h.ctx, h.eventId, ada, 'u-nobody'))).toBe('NOT_FOUND');
  });
});

describe('Moments: posting rules are cited when broken', () => {
  it('R1, R2 and R3', async () => {
    const h = await createHarness();
    const ada = h.users.attendeeAda;
    const tags = Array.from({ length: 11 }, (_, i) => `#tag${String.fromCharCode(97 + i)}`).join(' ');
    expect(await outcome(createStory(h.ctx, h.eventId, ada, text('x'.repeat(201))))).toMatchObject({ code: 'VALIDATION_FAILED', message: expect.stringContaining('(rule R1-length)') as unknown });
    expect((await outcome(createStory(h.ctx, h.eventId, ada, text(tags)))).message).toMatch(/\(rule R2-tags\)$/);
    expect((await outcome(createPost(h.ctx, h.eventId, ada, post(tags)))).message).toMatch(/\(rule R2-tags\)$/);

    await createPost(h.ctx, h.eventId, ada, post('See you in Room 3 #satellites'));
    expect(await outcome(createPost(h.ctx, h.eventId, ada, post('  see you in ROOM 3   #Satellites')))).toMatchObject({ code: 'VALIDATION_FAILED', message: expect.stringMatching(/\(rule R3-duplicate\)$/) as unknown });
    // Someone else may say the same thing, and so may Ada once 10 minutes have passed. Shares with no text are never repeats.
    expect(await code(createPost(h.ctx, h.eventId, h.users.attendeeBen, post('See you in Room 3 #satellites')))).toBe('OK');
    h.setNow(h.now() + 10 * MIN);
    expect(await code(createPost(h.ctx, h.eventId, ada, post('See you in Room 3 #satellites')))).toBe('OK');
    expect(await code(createPost(h.ctx, h.eventId, ada, { ...post(''), repostOf: 'pst-seed-01' }))).toBe('OK');
    expect(await code(createPost(h.ctx, h.eventId, ada, { ...post(''), repostOf: 'pst-seed-02' }))).toBe('OK');
  });

  it('R4: ten stories an hour, counted from storage', async () => {
    const h = await createHarness();
    const ada = h.users.attendeeAda;
    for (let i = 0; i < 10; i += 1) await createStory(h.ctx, h.eventId, ada, text(`Story ${i}`));
    const refused = await outcome(createStory(h.ctx, h.eventId, ada, text('One too many')));
    expect(refused).toMatchObject({ code: 'RATE_LIMITED', retryAfter: 3600 });
    expect(refused.message).toMatch(/\(rule R4-pace\)$/);
    h.setNow(h.now() + 60 * MIN);
    expect(await code(createStory(h.ctx, h.eventId, ada, text('Next hour')))).toBe('OK');
  });

  it('R5: your own file from this event, of the right kind; and a real place', async () => {
    const h = await createHarness();
    const { attendeeAda: ada, attendeeBen: ben } = h.users;
    const image = await uploadMedia(h.ctx, h.eventId, ada, 'image/png', PNG);
    const video = await uploadMedia(h.ctx, h.eventId, ada, 'video/mp4', MP4);
    const bens = await uploadMedia(h.ctx, h.eventId, ben, 'image/png', PNG);
    const r5 = /\(rule R5-media\)$/;
    expect(await outcome(createStory(h.ctx, h.eventId, ada, { ...text(''), kind: 'IMAGE', mediaId: bens.id }))).toMatchObject({ code: 'NOT_FOUND', message: expect.stringMatching(r5) as unknown });
    expect(await outcome(createPost(h.ctx, h.eventId, ada, post('', { mediaId: bens.id })))).toMatchObject({ code: 'NOT_FOUND', message: expect.stringMatching(r5) as unknown });
    expect(await outcome(createStory(h.ctx, h.eventId, ada, { ...text(''), kind: 'IMAGE', mediaId: video.id }))).toMatchObject({ code: 'VALIDATION_FAILED', message: expect.stringMatching(r5) as unknown });
    expect((await outcome(createStory(h.ctx, h.eventId, ada, { ...text('Words'), mediaId: image.id }))).message).toMatch(r5);
    expect((await outcome(createStory(h.ctx, h.eventId, ada, { ...text(''), kind: 'VIDEO' }))).message).toMatch(r5);
    // One upload may go into a post and a story (deleting either keeps it for the other: see releaseMedia).
    await createPost(h.ctx, h.eventId, ada, post('Robot arm', { mediaId: image.id }));
    expect(await code(createStory(h.ctx, h.eventId, ada, { ...text(''), kind: 'IMAGE', mediaId: image.id }))).toBe('OK');
    expect(await code(createStory(h.ctx, h.eventId, ada, { ...text(''), kind: 'VIDEO', mediaId: video.id }))).toBe('OK');
    expect(await code(createStory(h.ctx, h.eventId, ada, { ...text('Somewhere'), spaceId: 'sp-nowhere' }))).toBe('NOT_FOUND');
  });
});

describe('Moments: shared uploads', () => {
  it('keeps a file a post and a story share until both are deleted', async () => {
    const h = await createHarness();
    const ada = h.users.attendeeAda;
    const image = await uploadMedia(h.ctx, h.eventId, ada, 'image/png', PNG);
    const p = await createPost(h.ctx, h.eventId, ada, post('Robot arm', { mediaId: image.id }));
    const s = await createStory(h.ctx, h.eventId, ada, { ...text(''), kind: 'IMAGE', mediaId: image.id });
    await actOnStory(h.ctx, h.eventId, ada, s.id, { action: 'delete' });
    expect((await readMedia(h.ctx, h.eventId, ada, image.id)).bytes.byteLength).toBe(PNG.byteLength);
    await actOnPost(h.ctx, h.eventId, ada, p.id, { action: 'delete' });
    expect(await code(readMedia(h.ctx, h.eventId, ada, image.id))).toBe('NOT_FOUND');
  });
});

describe('Moments: feed, saves and explore', () => {
  it('ranks the Everyone feed by the charter and says why; latest is newest first', async () => {
    const h = await createHarness();
    const ada = h.users.attendeeAda;
    const ranked = await listFeed(h.ctx, h.eventId, ada, feed('all'));
    expect(ranked[0]).toMatchObject({ id: 'pst-seed-01', because: ['following', 'fresh', 'conversation', 'liked-by-follows'], tags: ['satellites'], backdrop: 'sun' });
    expect(ranked[0]?.nexconn).toEqual({ messageType: 'HL:Post', channel: `community evt:${h.eventId} / feed` });
    const mine = await createPost(h.ctx, h.eventId, ada, post('Just arrived #hallwaytrack', { backdrop: 'sun' }));
    const after = await listFeed(h.ctx, h.eventId, ada, feed('all'));
    expect(after[0]).toMatchObject({ id: mine.id, backdrop: 'sun', because: ['yours', 'fresh'] });
    const latest = await listFeed(h.ctx, h.eventId, ada, feed('latest'));
    expect(latest.every((p) => p.because.length === 0)).toBe(true);
    expect(latest.map((p) => p.createdAt)).toEqual([...latest.map((p) => p.createdAt)].sort((a, b) => b - a));
    const visual = await listFeed(h.ctx, h.eventId, ada, feed('visual'));
    expect(visual.some((p) => p.id === 'pst-seed-08')).toBe(false);
    expect(visual.every((p) => p.backdrop !== null || p.media !== null)).toBe(true);
    // A backdrop is for text only: a picture post keeps no backdrop.
    const image = await uploadMedia(h.ctx, h.eventId, ada, 'image/png', PNG);
    expect((await createPost(h.ctx, h.eventId, ada, post('Robot arm', { mediaId: image.id, backdrop: 'sun' }))).backdrop).toBeNull();
  });

  it('saves a post once, privately, newest save first, and forgets saves of a deleted post', async () => {
    const h = await createHarness();
    const { attendeeAda: ada, attendeeBen: ben } = h.users;
    await setSaved(h.ctx, h.eventId, ada, 'pst-seed-01', true);
    await setSaved(h.ctx, h.eventId, ada, 'pst-seed-01', true);
    expect(await h.store.docList('savedPosts', { userId: ada })).toHaveLength(1);
    h.setNow(h.now() + MIN);
    await setSaved(h.ctx, h.eventId, ada, 'pst-seed-04', true);
    expect((await listSaved(h.ctx, h.eventId, ada)).map((p) => [p.id, p.saved])).toEqual([
      ['pst-seed-04', true],
      ['pst-seed-01', true],
    ]);
    expect(await listSaved(h.ctx, h.eventId, ben)).toEqual([]);
    expect((await listFeed(h.ctx, h.eventId, ada, feed('latest'))).find((p) => p.id === 'pst-seed-01')?.saved).toBe(true);
    await setSaved(h.ctx, h.eventId, ada, 'pst-seed-01', false);
    await setSaved(h.ctx, h.eventId, ada, 'pst-seed-01', false);
    expect((await listSaved(h.ctx, h.eventId, ada)).map((p) => p.id)).toEqual(['pst-seed-04']);
    expect(await code(setSaved(h.ctx, h.eventId, ada, 'pst-nope', true))).toBe('NOT_FOUND');
    await actOnPost(h.ctx, h.eventId, h.users.organiserNadia, 'pst-seed-04', { action: 'delete' });
    expect(await h.store.docList('savedPosts', { userId: ada })).toHaveLength(0);
  });

  it('trends tags used by three people, and filters explore by a tag', async () => {
    const h = await createHarness();
    const ada = h.users.attendeeAda;
    const grid = await explore(h.ctx, h.eventId, ada, { tag: null });
    expect(grid.tags).toEqual([
      { tag: 'hallwaytrack', people: 4 },
      { tag: 'robotics', people: 3 },
      { tag: 'satellites', people: 3 },
    ]);
    expect(grid.posts.length).toBe(11);
    expect(grid.posts.every((p) => (p.backdrop !== null || p.media !== null) && p.repost === null && p.because.length > 0)).toBe(true);
    const tagged = await explore(h.ctx, h.eventId, ada, { tag: '#Satellites' });
    expect(tagged.tag).toBe('satellites');
    // Newest first, and the text-only post with the tag is included.
    expect(tagged.posts.map((p) => p.id)).toEqual(['pst-seed-01', 'pst-seed-02', 'pst-seed-08']);
    expect(await code(explore(h.ctx, h.eventId, ada, { tag: '42' }))).toBe('VALIDATION_FAILED');
    // Two people are not a trend.
    await createPost(h.ctx, h.eventId, ada, post('#quietroom is lovely'));
    await createPost(h.ctx, h.eventId, h.users.attendeeBen, post('Agreed #quietroom'));
    expect((await explore(h.ctx, h.eventId, ada, { tag: null })).tags.some((t) => t.tag === 'quietroom')).toBe(false);
    await createPost(h.ctx, h.eventId, h.users.attendeeChloe, post('Found the #QuietRoom'));
    expect((await explore(h.ctx, h.eventId, ada, { tag: null })).tags).toContainEqual({ tag: 'quietroom', people: 3 });
  });
});

describe('Moments: privacy and permissions', () => {
  it('exports the person’s stories, highlights, saves and reactions', async () => {
    const h = await createHarness();
    const ada = h.users.attendeeAda;
    const story = await createStory(h.ctx, h.eventId, ada, { ...text('Front row'), spaceId: 'sp-r3', audience: 'FOLLOWERS' });
    await createHighlight(h.ctx, h.eventId, ada, { title: 'Day one', storyIds: [story.id] });
    await setSaved(h.ctx, h.eventId, ada, 'pst-seed-02', true);
    const data = await exportMyData(h.ctx, ada);
    expect(data.moments.stories).toEqual([expect.objectContaining({ id: story.id, kind: 'TEXT', text: 'Front row', spaceId: 'sp-r3', audience: 'FOLLOWERS' })]);
    expect(data.moments.highlights).toEqual([{ id: expect.any(String) as unknown, title: 'Day one', storyIds: [story.id] }]);
    expect(data.moments.saves.map((s) => s.postId)).toEqual(['pst-seed-02']);
    expect(data.moments.storyReactions).toContainEqual(expect.objectContaining({ storyId: 'sty-seed-ines-1', reactionId: 'fire' }));
    expect(data.moments.storyViews.map((v) => v.storyId)).toContain('sty-seed-dev-1');
  });

  it('erases the person’s stories, highlights and saves, and their views and reactions on other stories', async () => {
    const h = await createHarness();
    const ada = h.users.attendeeAda;
    const media = await uploadMedia(h.ctx, h.eventId, ada, 'image/png', PNG);
    const story = await createStory(h.ctx, h.eventId, ada, { ...text(''), kind: 'IMAGE', mediaId: media.id });
    await createHighlight(h.ctx, h.eventId, ada, { title: 'Mine', storyIds: [story.id] });
    await setSaved(h.ctx, h.eventId, ada, 'pst-seed-01', true);
    await actOnStory(h.ctx, h.eventId, ada, 'sty-seed-ben-1', { action: 'react', reactionId: 'wow' });
    const touches = (await h.store.docList('stories', { eventId: h.eventId }))
      .filter((s) => s.authorId !== ada)
      .reduce((n, s) => n + s.views.filter((v) => v.userId === ada).length + s.reactions.filter((r) => r.userId === ada).length, 0);
    expect(touches).toBe(8);

    const report = await eraseMe(h.ctx, ada);
    expect(report.momentsRecords).toBe(3);
    expect(report.storyInteractions).toBe(touches);
    expect(await h.store.docList('stories', { authorId: ada })).toHaveLength(0);
    expect(await h.store.blobGet(media.id)).toBeNull();
    expect(await h.store.docList('storyHighlights', { ownerId: ada })).toHaveLength(0);
    expect(await h.store.docList('savedPosts', { userId: ada })).toHaveLength(0);
    const left = JSON.stringify(await h.store.docList('stories', { eventId: h.eventId }));
    expect(left).not.toContain(ada);
    const entry = (await h.store.listAudit(h.eventId)).find((e) => e.action === 'privacy.erase');
    expect(entry?.detail).toContain(`3 Moments records (stories, highlights, saves), ${touches} story views and reactions`);
  });

  it('refuses people outside the event', async () => {
    const h = await createHarness();
    const stranger = 'u-stranger';
    expect(await code(storyTray(h.ctx, h.eventId, stranger))).toBe('FORBIDDEN');
    expect(await code(createStory(h.ctx, h.eventId, stranger, text('Hello')))).toBe('FORBIDDEN');
    expect(await code(actOnStory(h.ctx, h.eventId, stranger, 'sty-seed-ines-1', { action: 'view' }))).toBe('FORBIDDEN');
    expect(await code(explore(h.ctx, h.eventId, stranger, { tag: null }))).toBe('FORBIDDEN');
    expect(await code(listSaved(h.ctx, h.eventId, stranger))).toBe('FORBIDDEN');
    expect(await code(setSaved(h.ctx, h.eventId, stranger, 'pst-seed-01', true))).toBe('FORBIDDEN');
    expect(await code(listHighlights(h.ctx, h.eventId, stranger, 'u-spk-ines'))).toBe('FORBIDDEN');
    expect(await code(momentsCharter(h.ctx, h.eventId, stranger))).toBe('FORBIDDEN');
    expect(await code(storyTray(h.ctx, 'evt-other', h.users.attendeeAda))).toBe('FORBIDDEN');
    const charter = await momentsCharter(h.ctx, h.eventId, h.users.attendeeAda);
    expect(charter.postingRules.map((r) => r.id)).toEqual(['R1-length', 'R2-tags', 'R3-duplicate', 'R4-pace', 'R5-media']);
    expect(charter.nexconnTypes.map((t) => t.messageType)).toEqual(['HL:Story', 'HL:Post']);
  });
});
