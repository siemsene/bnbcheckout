// Planned slack: the gaps a lane already has, held against everything else.
//
// A friend's lane is an order, and the dispatcher fills the first idle moment
// it finds. So adding one more job to a lane used to drop it into whatever gap
// was going spare — even a gap that existed only because the job after it was
// waiting on somebody else — and everything behind it slid later. The student
// added one job and three moved.
//
// Slack is the fix, and it is derived rather than drawn: every gap between two
// consecutive scheduled jobs is reserved automatically, because a gap the
// schedule already has is exactly the time the plan is relying on. Two rules
// keep it honest:
//
//   1. A window is held FOR the job that follows it, not against it. If that
//      job's predecessor lands early it starts early; only other jobs are kept
//      out. Without this the reservation would delay the very job it protects,
//      and — because the dispatcher runs before finished work unlocks its
//      successors within a tick — a window ending on the exact instant its job
//      became available would hand the slot to whatever else was open.
//   2. A window lives only as long as the pair it sits between. Move the
//      following job, drop it, or deliberately put something between the two,
//      and the reservation goes with it.

import type { CharId, Plan, SlackWindow } from './types';
import { CHAR_IDS } from './content';

/** Gaps shorter than this are transit noise, not a plan's intent. */
export const MIN_SLACK_MIN = 1;

/** How long a buffer the planner drops into a lane by hand runs for. */
export const MANUAL_SLACK_MIN = 5;

/** One job's span in a friend's lane, as the projection placed it. */
export interface PlacedSpan {
  taskId: string;
  startMin: number;
  endMin: number;
  /** Nothing was actually scheduled, so there is no span to sit beside. */
  absent: boolean;
}

/**
 * The windows a placement implies: one per gap between consecutive jobs that
 * both really happen. Leading gaps are deliberately not reserved — before the
 * first job there is no pair, and holding the start of the morning empty would
 * be a plan doing nothing on purpose.
 */
export function deriveSlack(
  placedByChar: Partial<Record<CharId, PlacedSpan[]>>,
  /** Buffers the planner placed by hand. Kept as-is, and never derived over. */
  manual?: Partial<Record<CharId, SlackWindow[]>>,
): Partial<Record<CharId, SlackWindow[]>> {
  const out: Partial<Record<CharId, SlackWindow[]>> = {};
  for (const charId of CHAR_IDS) {
    const queued = placedByChar[charId];
    if (!queued || queued.length < 2) continue;
    // By CLOCK, not by queue position. The two usually agree, but a lane can
    // run out of order — a job whose predecessor lands late gets skipped and
    // picked up afterwards — and pairing by queue position would then measure a
    // "gap" straight through a job that is actually being worked in it, and
    // reserve time that was never free.
    const placed = [...queued]
      .filter((p) => !p.absent)
      .sort((a, b) => a.startMin - b.startMin);
    const byHand = (manual?.[charId] ?? []).filter((w) => w.manual);
    const windows: SlackWindow[] = [...byHand];
    for (let i = 1; i < placed.length; i++) {
      const prev = placed[i - 1];
      const cur = placed[i];
      // A hand-placed buffer already owns its stretch of the gap. Derive only
      // what is left over, so the two never draw on top of each other.
      const from = byHand
        .filter((w) => w.from < cur.startMin && w.to > prev.endMin)
        .reduce((edge, w) => Math.max(edge, w.to), prev.endMin);
      if (cur.startMin - from < MIN_SLACK_MIN) continue;
      windows.push({
        from,
        to: cur.startMin,
        forTask: cur.taskId,
        after: prev.taskId,
      });
    }
    if (windows.length > 0) out[charId] = windows;
  }
  return out;
}

/**
 * Drop the windows a queue edit has invalidated, BEFORE the projection re-runs.
 *
 * A window survives only while its job is still immediately preceded by the job
 * it was measured from. That single rule covers every way a plan can move on:
 * the following job removed, dragged elsewhere, or something deliberately
 * inserted into the gap — which is the planner saying they want that time used,
 * so the reservation must not fight them for it.
 */
export function pruneSlack(
  slack: Partial<Record<CharId, SlackWindow[]>> | undefined,
  queues: Record<CharId, string[]>,
): Partial<Record<CharId, SlackWindow[]>> | undefined {
  if (!slack) return undefined;
  const out: Partial<Record<CharId, SlackWindow[]>> = {};
  for (const charId of CHAR_IDS) {
    const windows = slack[charId];
    if (!windows || windows.length === 0) continue;
    const q = queues[charId] ?? [];
    const kept = windows.filter((w) => {
      // A hand-placed buffer belongs to the job it sits behind, and outlives
      // anything else the planner does to the lane.
      if (w.manual) return q.includes(w.after);
      const at = q.indexOf(w.forTask);
      return at > 0 && q[at - 1] === w.after;
    });
    if (kept.length > 0) out[charId] = kept;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Is this friend's time reserved right now for some OTHER job than this one?
 *
 * The asymmetry is the whole design: `taskId` is what the dispatcher is about
 * to hand them, and a window held for that same job never blocks it.
 */
export function heldForAnother(
  plan: Plan | undefined,
  charId: CharId,
  taskId: string,
  minute: number,
): boolean {
  const windows = plan?.slack?.[charId];
  if (!windows || windows.length === 0) return false;
  // Closed at BOTH ends, which is worth a word. A window runs to the instant
  // its job takes over, and the dispatcher runs before the tick's work is
  // banked — so at that last instant the predecessor is not yet marked done and
  // the job being protected is still locked. Releasing there would hand the
  // slot to whatever else happened to be open, which is the entire failure this
  // exists to prevent. Holding one tick longer costs the protected job nothing,
  // because a window never blocks the job it is held for.
  return windows.some(
    (w) => w.forTask !== taskId && minute >= w.from && minute <= w.to,
  );
}

/** True when two window sets say the same thing, so the UI can skip an update. */
export function sameSlack(
  a: Partial<Record<CharId, SlackWindow[]>> | undefined,
  b: Partial<Record<CharId, SlackWindow[]>> | undefined,
): boolean {
  const key = (s: Partial<Record<CharId, SlackWindow[]>> | undefined) =>
    CHAR_IDS.map((c) =>
      (s?.[c] ?? [])
        .map(
          (w) =>
            `${w.manual ? 'M' : 'D'}${w.after}>${w.forTask}:${w.from.toFixed(3)}-${w.to.toFixed(3)}`,
        )
        .join(','),
    ).join('|');
  return key(a) === key(b);
}
