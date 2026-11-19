import { afterEach, describe, expect, it } from 'vitest';
import { createHarness } from './harness';
import { adjustXp } from '@/services/field-atlas';
import { leaderboard, setLeaderboardOptIn } from '@/services/leaderboard';
import { setCountry } from '@/services/location';
import { handleMessageOnce } from '@/services/chat-gateway';
import { resetAllRateLimiters } from '@/lib/rate-limit';

afterEach(() => {
  resetAllRateLimiters();
});

describe('leaderboard', () => {
  it('lists only people who joined, ranks ties together, and forgets people who leave', async () => {
    const h = await createHarness();
    const { attendeeAda: ada, attendeeBen: ben, attendeeChloe: chloe, organiserNadia: nadia } = h.users;
    for (const [u, xp] of [[ada, 120], [ben, 120], [chloe, 300]] as const) await adjustXp(h.ctx, h.eventId, nadia, u, xp, 'Leaderboard test award.');
    expect((await leaderboard(h.ctx, h.eventId, ada)).entries).toEqual([]);
    await setLeaderboardOptIn(h.ctx, h.eventId, ada, true);
    await setLeaderboardOptIn(h.ctx, h.eventId, ben, true);
    const board = await leaderboard(h.ctx, h.eventId, ada);
    // Chloe has the most XP but never joined, so she is not listed and does not push anyone down.
    expect(board.entries.map((e) => [e.rank, e.xp])).toEqual([[1, 120], [1, 120]]);
    expect(board.entries.find((e) => e.isSelf)?.userId).toBe(ada);
    await setLeaderboardOptIn(h.ctx, h.eventId, ben, false);
    expect((await leaderboard(h.ctx, h.eventId, chloe)).entries.map((e) => e.userId)).toEqual([ada]);
  });

  it('keeps the opt-in when the person sets their country, and the other way round', async () => {
    const h = await createHarness();
    await setLeaderboardOptIn(h.ctx, h.eventId, h.users.attendeeAda, true);
    await setCountry(h.ctx, h.users.attendeeAda, '356');
    expect(await h.store.docGet('prefs', h.users.attendeeAda)).toMatchObject({ country: '356', leaderboard: true });
  });
});

describe('offline outbox', () => {
  it('handles a message resent with the same client id once', async () => {
    const h = await createHarness();
    const before = (await h.store.listMessages(h.eventId)).length;
    const send = () => handleMessageOnce(h.ctx, { eventId: h.eventId, userId: h.users.attendeeAda, text: 'What is on in Room 4 today?', clientId: 'outbox-test-0001' });
    const results = await Promise.all([send(), send(), send()]);
    expect(results.filter((r) => r !== null)).toHaveLength(1);
    expect(await send()).toBeNull();
    expect((await h.store.listMessages(h.eventId)).length).toBe(before + 1);
  });
});
