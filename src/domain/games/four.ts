/** Four in a row on a 7 by 6 grid. Pure rules: where a disc lands, and whether a move wins. */
export const COLS = 7;
export const ROWS = 6;

/** The cell a disc dropped in `col` lands on, or -1 when the column is full. */
export function landing(board: readonly number[], col: number): number {
  for (let row = ROWS - 1; row >= 0; row -= 1) {
    if (board[row * COLS + col] === 0) return row * COLS + col;
  }
  return -1;
}

/** The four (or more) cells that win through `cell`, or an empty list. */
export function winningLine(board: readonly number[], cell: number): number[] {
  const seat = board[cell];
  if (!seat) return [];
  const row = Math.floor(cell / COLS);
  const col = cell % COLS;
  for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]] as const) {
    const line = [cell];
    for (const dir of [1, -1]) {
      let r = row + dr * dir;
      let c = col + dc * dir;
      while (r >= 0 && r < ROWS && c >= 0 && c < COLS && board[r * COLS + c] === seat) {
        line.push(r * COLS + c);
        r += dr * dir;
        c += dc * dir;
      }
    }
    if (line.length >= 4) return line.sort((a, b) => a - b);
  }
  return [];
}
