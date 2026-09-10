// How often a session writes, and how long a run lasts.
//
// These live in their own dependency-free module because two very different
// callers need to agree on them: `sessionStore`, which does the writing, and
// `billing/costModel`, which prices it. A cost model that quietly disagreed
// with the real cadence would be worse than no cost model at all — and this
// module imports nothing, so the pricing tests can pull it in without dragging
// Firebase into a Node test run.

/** Gap between leaderboard progress writes during a run. */
export const PROGRESS_INTERVAL_MS = 10_000;

/** Gap between full checkpoint saves during a run. */
export const CHECKPOINT_INTERVAL_MS = 60_000;

/**
 * Wall-clock milliseconds one full run lasts: `simDeadlineMin` sim-minutes
 * played at `compression`× speed. 120 sim-minutes at 8× is 15 real minutes.
 */
export function runWindowMsFor(simDeadlineMin: number, compression: number): number {
  return ((simDeadlineMin * 60) / compression) * 1000;
}
