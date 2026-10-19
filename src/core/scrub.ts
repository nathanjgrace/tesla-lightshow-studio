// Stepping the playhead with the keyboard: by beat or bar when the song has
// a beat grid, by a fixed step when it doesn't, or by one show frame.

const EPSILON_MS = 1;

/**
 * The first grid time strictly after `t` (dir 1) or before it (dir -1).
 * Past either end of the grid, or with no grid, it moves by `stepMs`.
 * The result stays within 0..durationMs.
 */
export function stepTime(t: number, dir: 1 | -1, grid: readonly number[] | undefined, stepMs: number, durationMs: number): number {
  let next: number | undefined;
  if (grid?.length) {
    if (dir > 0) next = grid.find((g) => g > t + EPSILON_MS);
    else for (let i = grid.length - 1; i >= 0 && next === undefined; i--) if (grid[i]! < t - EPSILON_MS) next = grid[i];
  }
  return clamp(next ?? t + dir * stepMs, durationMs);
}

/** One show frame forward or back, landing on a frame boundary. */
export function stepFrame(t: number, dir: 1 | -1, stepTimeMs: number, durationMs: number): number {
  const frame = dir > 0 ? Math.floor(t / stepTimeMs + 1e-6) + 1 : Math.ceil(t / stepTimeMs - 1e-6) - 1;
  return clamp(frame * stepTimeMs, durationMs);
}

const clamp = (t: number, durationMs: number) => Math.min(Math.max(0, durationMs), Math.max(0, t));
