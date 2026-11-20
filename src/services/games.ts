import { z } from 'zod';
import { DomainError } from '../domain/errors';
import { COLS, landing, ROWS, winningLine } from '../domain/games/four';
import { effectiveStatus, isOpenGame } from '../domain/games/lifecycle';
import type { Game, QuizQuestion } from '../domain/product';
import { notify, requireCapability, type ServiceContext } from './context';
import { ID } from './feed';

/**
 * Games between people at the event.
 *
 * The server owns the rules: it checks whose turn it is, where a disc lands and who won, and it
 * keeps quiz answers to itself until a person has answered. A browser can only ask to make a move.
 */

export const GameCreateSchema = z.object({ kind: z.enum(['FOUR', 'QUIZ']) });
export const GameActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('join') }),
  z.object({ action: z.literal('move'), col: z.number().int().min(0).max(COLS - 1) }),
  z.object({ action: z.literal('answer'), question: z.number().int().min(0).max(20), choice: z.number().int().min(0).max(3) }),
]);

async function eventGame(ctx: ServiceContext, eventId: string, gameId: string): Promise<Game> {
  const game = ID.test(gameId) ? await ctx.store.docGet('games', gameId) : null;
  if (!game || game.eventId !== eventId) throw new DomainError('NOT_FOUND', 'That game does not exist.');
  return game;
}

/** Deterministic shuffle, so a quiz is the same for everyone who opens it. */
function shuffled<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  let s = seed >>> 0 || 1;
  for (let i = out.length - 1; i > 0; i -= 1) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    const a = out[i] as T;
    out[i] = out[j] as T;
    out[j] = a;
  }
  return out;
}

/** Questions are written from the event's own schedule, so every quiz is about this event as it is now. */
export async function buildQuiz(ctx: ServiceContext, eventId: string, seed: number): Promise<QuizQuestion[]> {
  const [sessions, rooms] = await Promise.all([ctx.store.listSessions(eventId), ctx.store.listRooms(eventId)]);
  const roomName = new Map(rooms.map((r) => [r.id, r.name]));
  const questions: QuizQuestion[] = [];
  const ask = (prompt: string, right: string, wrong: string[], salt: number) => {
    const others = shuffled([...new Set(wrong)].filter((w) => w !== right), seed + salt).slice(0, 3);
    if (others.length < 2) return;
    const options = shuffled([right, ...others], seed + salt * 7);
    questions.push({ prompt, options, answer: options.indexOf(right) });
  };
  shuffled(sessions, seed).forEach((s, i) => {
    const room = roomName.get(s.roomId);
    if (room && i % 2 === 0) ask(`Where is “${s.title}” held?`, room, rooms.map((r) => r.name), i + 1);
    else if (s.topics[0]) ask(`Which session covers ${s.topics[0]}?`, s.title, sessions.map((x) => x.title), i + 1);
  });
  const largest = [...rooms].sort((a, b) => b.capacity - a.capacity)[0];
  if (largest) ask('Which room holds the most people?', largest.name, rooms.map((r) => r.name), 99);
  return questions.slice(0, 6);
}

export async function createGame(ctx: ServiceContext, eventId: string, userId: string, kind: Game['kind']): Promise<Game> {
  await requireCapability(ctx, eventId, userId, 'message.send');
  const now = ctx.now();
  // Closed games (see src/domain/games/lifecycle.ts) no longer count, so the limit cannot lock a person out.
  const open = (await ctx.store.docList('games', { eventId, createdBy: userId })).filter((g) => isOpenGame(g, now));
  if (open.length >= 5) throw new DomainError('VALIDATION_FAILED', 'Finish one of your open games before starting another.');
  const id = ctx.newId('game');
  const questions = kind === 'QUIZ' ? await buildQuiz(ctx, eventId, now) : [];
  if (kind === 'QUIZ' && questions.length < 3) throw new DomainError('INELIGIBLE', 'The schedule is too short to write a quiz from.');
  const game: Game = {
    id,
    eventId,
    kind,
    createdBy: userId,
    status: kind === 'QUIZ' ? 'ACTIVE' : 'WAITING',
    createdAt: now,
    updatedAt: now,
    players: kind === 'FOUR' ? [userId] : [],
    board: kind === 'FOUR' ? new Array<number>(COLS * ROWS).fill(0) : [],
    turn: 0,
    winnerId: null,
    line: [],
    questions,
    answers: {},
  };
  await ctx.store.docPut('games', game);
  return game;
}

export async function playGame(ctx: ServiceContext, eventId: string, userId: string, gameId: string, input: z.infer<typeof GameActionSchema>): Promise<void> {
  await requireCapability(ctx, eventId, userId, 'message.send');
  const game = await eventGame(ctx, eventId, gameId);
  const now = ctx.now();
  const problems: DomainError[] = [];
  const refuse = (code: DomainError['code'], message: string) => {
    problems.push(new DomainError(code, message));
    return null;
  };
  // The whole decision runs inside one atomic change, so two moves sent together cannot both land.
  const updated = await ctx.store.docMutate('games', game.id, (stored) => {
    // A game that has closed by time is treated as closed: no join, move or answer is accepted.
    const g = { ...stored, status: effectiveStatus(stored, now) };
    if (g.status === 'FINISHED') return refuse('INVALID_TRANSITION', 'This game has closed.');
    if (input.action === 'join') {
      if (g.kind !== 'FOUR' || g.status !== 'WAITING') return refuse('INVALID_TRANSITION', 'This game is not open to join.');
      if (g.players.includes(userId)) return refuse('VALIDATION_FAILED', 'You are already in this game.');
      return { ...g, players: [...g.players, userId], status: 'ACTIVE', updatedAt: now };
    }
    if (input.action === 'move') {
      if (g.kind !== 'FOUR' || g.status !== 'ACTIVE') return refuse('INVALID_TRANSITION', 'This game is not in play.');
      const seat = g.players.indexOf(userId);
      if (seat === -1) return refuse('FORBIDDEN', 'You are watching this game, not playing it.');
      if (seat !== g.turn) return refuse('INVALID_TRANSITION', 'It is not your turn.');
      const cell = landing(g.board, input.col);
      if (cell === -1) return refuse('VALIDATION_FAILED', 'That column is full.');
      const board = [...g.board];
      board[cell] = seat + 1;
      const line = winningLine(board, cell);
      const status = line.length > 0 ? 'WON' : board.every((c) => c !== 0) ? 'DRAW' : 'ACTIVE';
      return { ...g, board, line, status, winnerId: status === 'WON' ? userId : null, turn: 1 - g.turn, updatedAt: now };
    }
    if (g.kind !== 'QUIZ') return refuse('INVALID_TRANSITION', 'This game has no questions.');
    const given = g.answers[userId] ?? [];
    if (input.question !== given.length || input.question >= g.questions.length) return refuse('INVALID_TRANSITION', 'Answer the questions in order, once each.');
    return { ...g, answers: { ...g.answers, [userId]: [...given, input.choice] }, players: g.players.includes(userId) ? g.players : [...g.players, userId], updatedAt: now };
  });
  if (problems[0]) throw problems[0];
  if (updated?.kind === 'FOUR' && updated.status !== 'WAITING') {
    const other = updated.players.find((p) => p !== userId);
    const me = await ctx.store.getUser(userId);
    if (other) {
      const body =
        input.action === 'join'
          ? `${me?.displayName ?? 'Someone'} joined your game. You move first.`
          : updated.status === 'WON'
            ? `${me?.displayName ?? 'Someone'} won your game of Four in a row.`
            : null;
      if (body) await notify(ctx, { eventId, recipientUserId: other, kind: 'GAME_UPDATE', body, href: `/events/${eventId}/games/${updated.id}`, dedupeParts: [updated.id, updated.status] });
    }
  }
}

const score = (g: Game, userId: string) => (g.answers[userId] ?? []).filter((choice, i) => g.questions[i]?.answer === choice).length;

export async function viewGame(ctx: ServiceContext, eventId: string, userId: string, gameId: string) {
  await requireCapability(ctx, eventId, userId, 'event.read');
  return present(ctx, await eventGame(ctx, eventId, gameId), userId);
}

async function present(ctx: ServiceContext, stored: Game, userId: string) {
  const g = { ...stored, status: effectiveStatus(stored, ctx.now()) };
  const name = async (id: string) => (await ctx.store.getUser(id))?.displayName ?? 'Someone';
  const mine = g.answers[userId] ?? [];
  return {
    id: g.id,
    kind: g.kind,
    status: g.status,
    createdAt: g.createdAt,
    host: await name(g.createdBy),
    players: await Promise.all(g.players.map(async (id) => ({ id, name: await name(id), isSelf: id === userId, score: g.kind === 'QUIZ' ? score(g, id) : 0, answered: (g.answers[id] ?? []).length }))),
    seat: g.players.indexOf(userId),
    board: g.board,
    turn: g.turn,
    line: g.line,
    winner: g.winnerId ? await name(g.winnerId) : null,
    youWon: g.winnerId === userId,
    canJoin: g.kind === 'FOUR' && g.status === 'WAITING' && !g.players.includes(userId),
    // A question's answer is included only after this person has answered it.
    questions: g.questions.map((q, i) => ({ prompt: q.prompt, options: q.options, yours: mine[i] ?? null, answer: i < mine.length ? q.answer : null })),
    total: g.questions.length,
  };
}

export type GameView = Awaited<ReturnType<typeof present>>;

export async function listGames(ctx: ServiceContext, eventId: string, userId: string): Promise<GameView[]> {
  await requireCapability(ctx, eventId, userId, 'event.read');
  const games = (await ctx.store.docList('games', { eventId })).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 40);
  return Promise.all(games.map((g) => present(ctx, g, userId)));
}
