import { describe, expect, it } from 'vitest';
import { createHarness } from './harness';
import { createGame, GameCreateSchema, playGame, viewGame } from '@/services/games';

const custom = {
  title: 'Lunch quiz',
  questions: [
    { prompt: 'Which planet is red?', options: ['Mars', 'Venus'], answer: 0 },
    { prompt: 'How many legs has a spider?', options: ['Six', 'Eight', 'Ten'], answer: 1 },
    { prompt: 'What does AV stand for?', options: ['Audio-visual', 'Auto vote', 'Any venue'], answer: 0 },
  ],
};

describe('Create a game (custom quiz)', () => {
  it('validates the questions and keeps the answers on the server', async () => {
    expect(GameCreateSchema.safeParse({ kind: 'QUIZ', custom: { ...custom, questions: custom.questions.slice(0, 2) } }).success).toBe(false);
    expect(GameCreateSchema.safeParse({ kind: 'QUIZ', custom: { ...custom, questions: [{ prompt: 'Same twice?', options: ['A', 'a'], answer: 0 }, ...custom.questions] } }).success).toBe(false);
    expect(GameCreateSchema.safeParse({ kind: 'QUIZ', custom: { ...custom, questions: [{ prompt: 'Out of range', options: ['A', 'B'], answer: 3 }, ...custom.questions] } }).success).toBe(false);
    expect(GameCreateSchema.safeParse({ kind: 'QUIZ', custom }).success).toBe(true);

    const h = await createHarness();
    const game = await createGame(h.ctx, h.eventId, h.users.attendeeAda, 'QUIZ', custom);
    const before = await viewGame(h.ctx, h.eventId, h.users.attendeeBen, game.id);
    expect(before.title).toBe('Lunch quiz');
    expect(before.questions.every((q) => q.answer === null)).toBe(true);
    await playGame(h.ctx, h.eventId, h.users.attendeeBen, game.id, { action: 'answer', question: 0, choice: 0 });
    const after = await viewGame(h.ctx, h.eventId, h.users.attendeeBen, game.id);
    expect(after.players.find((p) => p.isSelf)?.score).toBe(1);
  });
});
