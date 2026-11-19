import type { GameStatus } from '../product';

/**
 * When a game closes. Pure: the caller supplies the clock.
 *
 * Nothing used to end a quiz, or a Four-in-a-row game nobody joined, so they stayed WAITING or ACTIVE
 * forever. `createGame` refuses anyone with five open games, so after five quiz rounds (the "Start a
 * schedule quiz" workflow makes one each time) a person could never start another game of any kind.
 *
 * - A game waiting for an opponent closes two hours after it was last touched.
 * - A quiz closes two hours after it opened. Answers are refused after that, and the scores stand.
 * - A Four-in-a-row game in play closes after 24 hours without a move.
 */
export const GAME_OPEN_MS = 2 * 60 * 60 * 1000;
export const GAME_IDLE_MS = 24 * 60 * 60 * 1000;

export interface GameClock {
  kind: 'FOUR' | 'QUIZ';
  status: GameStatus;
  createdAt: number;
  updatedAt: number;
}

export function effectiveStatus(game: GameClock, now: number): GameStatus {
  if (game.status === 'WAITING' && now - game.updatedAt >= GAME_OPEN_MS) return 'FINISHED';
  if (game.kind === 'QUIZ' && game.status === 'ACTIVE' && now - game.createdAt >= GAME_OPEN_MS) return 'FINISHED';
  if (game.kind === 'FOUR' && game.status === 'ACTIVE' && now - game.updatedAt >= GAME_IDLE_MS) return 'FINISHED';
  return game.status;
}

/** Open games count toward a person's limit of open games. Closed, won and drawn ones do not. */
export function isOpenGame(game: GameClock, now: number): boolean {
  const status = effectiveStatus(game, now);
  return status === 'WAITING' || status === 'ACTIVE';
}
