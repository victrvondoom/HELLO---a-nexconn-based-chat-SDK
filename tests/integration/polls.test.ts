import { describe, expect, it } from 'vitest';
import { createHarness } from './harness';
import { DomainError } from '@/domain/errors';
import { cleanPollOptions, closesText, pollView } from '@/domain/moments/poll';
import { actOnPost, createPost, listFeed } from '@/services/feed';
import { eraseMe } from '@/services/rights';

const ADA = 'u-att-ada';
const BEN = 'u-att-ben';
const CHLOE = 'u-att-chloe';
const POLL = { options: ['Tea', 'Coffee'], minutes: 60 };

async function code(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(DomainError);
  return (error as DomainError).code;
}

const base = { mediaId: null, communityId: null, repostOf: null, backdrop: null } as const;

describe('poll rules', () => {
  it('accepts 2 to 4 distinct options and a sane duration, and says what is wrong otherwise', () => {
    expect(cleanPollOptions([' Tea ', 'Coffee'], 60)).toEqual({ ok: true, labels: ['Tea', 'Coffee'] });
    expect(cleanPollOptions(['Only'], 60)).toEqual({ ok: false, problem: 'OPTION_COUNT' });
    expect(cleanPollOptions(['a', 'b', 'c', 'd', 'e'], 60)).toEqual({ ok: false, problem: 'OPTION_COUNT' });
    expect(cleanPollOptions(['a', ' '], 60)).toEqual({ ok: false, problem: 'OPTION_EMPTY' });
    expect(cleanPollOptions(['a', 'x'.repeat(41)], 60)).toEqual({ ok: false, problem: 'OPTION_LONG' });
    expect(cleanPollOptions(['Tea', 'tea'], 60)).toEqual({ ok: false, problem: 'OPTION_DUPLICATE' });
    expect(cleanPollOptions(['a', 'b'], 1)).toEqual({ ok: false, problem: 'DURATION' });
    expect(cleanPollOptions(['a', 'b'], 7 * 24 * 60 + 1)).toEqual({ ok: false, problem: 'DURATION' });
  });

  it('hides results until the viewer has voted, is the author, or the poll closed', () => {
    const poll = { options: [{ id: 'opt0', label: 'A' }, { id: 'opt1', label: 'B' }], closesAt: 1000, votes: { x: 'opt0', y: 'opt0', z: 'opt1' } };
    expect(pollView(poll, 'v', 'author', 10).total).toBeNull();
    expect(pollView(poll, 'v', 'author', 10).options[0]?.votes).toBeNull();
    expect(pollView(poll, 'author', 'author', 10).total).toBe(3);
    const voted = pollView(poll, 'x', 'author', 10);
    expect(voted.myVote).toBe('opt0');
    expect(voted.options.map((o) => o.percent)).toEqual([67, 33]);
    expect(pollView(poll, 'v', 'author', 1000).closed).toBe(true);
    expect(pollView(poll, 'v', 'author', 1000).total).toBe(3);
    expect(closesText(1000 + 90 * 60_000, 1000)).toBe('closes in 2 h');
    expect(closesText(5, 10)).toBe('closed');
  });
});

describe('polls through the service', () => {
  it('creates a poll, counts one vote per person, and only shows results after voting', async () => {
    const h = await createHarness();
    await createPost(h.ctx, h.eventId, ADA, { ...base, text: 'Tea or coffee?', poll: POLL });
    const before = (await listFeed(h.ctx, h.eventId, BEN, { scope: 'latest', communityId: null, authorId: null }))[0];
    expect(before?.poll?.options.map((o) => o.label)).toEqual(['Tea', 'Coffee']);
    expect(before?.poll?.total).toBeNull();
    const postId = before?.id ?? '';

    await actOnPost(h.ctx, h.eventId, BEN, postId, { action: 'vote', optionId: 'opt1' });
    expect(await code(actOnPost(h.ctx, h.eventId, BEN, postId, { action: 'vote', optionId: 'opt0' }))).toBe('DUPLICATE');
    await actOnPost(h.ctx, h.eventId, CHLOE, postId, { action: 'vote', optionId: 'opt1' });

    const after = (await listFeed(h.ctx, h.eventId, BEN, { scope: 'latest', communityId: null, authorId: null }))[0];
    expect(after?.poll?.myVote).toBe('opt1');
    expect(after?.poll?.total).toBe(2);
    expect(after?.poll?.options.map((o) => o.percent)).toEqual([0, 100]);
    // The author sees counts without voting. Nobody sees who voted for what.
    const author = (await listFeed(h.ctx, h.eventId, ADA, { scope: 'latest', communityId: null, authorId: null }))[0];
    expect(author?.poll?.total).toBe(2);
    expect(JSON.stringify(author)).not.toContain(BEN);
  });

  it('counts a double tap once, even when both requests arrive together', async () => {
    const h = await createHarness();
    const post = await createPost(h.ctx, h.eventId, ADA, { ...base, text: 'Pick one', poll: POLL });
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => actOnPost(h.ctx, h.eventId, BEN, post.id, { action: 'vote', optionId: 'opt0' })));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(Object.keys((await h.store.docGet('posts', post.id))?.poll?.votes ?? {})).toEqual([BEN]);
  });

  it('refuses votes after the poll closes, bad options, and polls without a question or with media', async () => {
    const h = await createHarness();
    const post = await createPost(h.ctx, h.eventId, ADA, { ...base, text: 'Short poll', poll: { options: ['a', 'b'], minutes: 5 } });
    expect(await code(actOnPost(h.ctx, h.eventId, BEN, post.id, { action: 'vote', optionId: 'opt7' }))).toBe('VALIDATION_FAILED');
    h.setNow(h.now() + 6 * 60_000);
    expect(await code(actOnPost(h.ctx, h.eventId, BEN, post.id, { action: 'vote', optionId: 'opt0' }))).toBe('VALIDATION_FAILED');
    const closed = (await listFeed(h.ctx, h.eventId, CHLOE, { scope: 'latest', communityId: null, authorId: null }))[0];
    expect(closed?.poll?.closed).toBe(true);
    expect(closed?.poll?.total).toBe(0);

    expect(await code(createPost(h.ctx, h.eventId, ADA, { ...base, text: '', poll: POLL }))).toBe('VALIDATION_FAILED');
    expect(await code(createPost(h.ctx, h.eventId, ADA, { ...base, text: 'One option', poll: { options: ['only'], minutes: 60 } }))).toBe('VALIDATION_FAILED');
    const plain = await createPost(h.ctx, h.eventId, ADA, { ...base, text: 'No poll here' });
    expect(await code(actOnPost(h.ctx, h.eventId, BEN, plain.id, { action: 'vote', optionId: 'opt0' }))).toBe('VALIDATION_FAILED');
  });

  it('erasing a person removes their vote from other people’s polls and keeps the rest', async () => {
    const h = await createHarness();
    const post = await createPost(h.ctx, h.eventId, ADA, { ...base, text: 'Erase test', poll: POLL });
    await actOnPost(h.ctx, h.eventId, BEN, post.id, { action: 'vote', optionId: 'opt0' });
    await actOnPost(h.ctx, h.eventId, CHLOE, post.id, { action: 'vote', optionId: 'opt1' });
    await eraseMe(h.ctx, BEN);
    expect((await h.store.docGet('posts', post.id))?.poll?.votes).toEqual({ [CHLOE]: 'opt1' });
  });
});
