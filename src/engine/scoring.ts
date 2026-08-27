// Score & progress derivations, shared by the HUD, leaderboard writes,
// and post-game charts.

import { CHAR_IDS, TICKS_PER_MINUTE } from './content';
import type { SimState, TimelineSegment } from './types';

/** Weighted completion in [0, 1]: total effective work done over total required. */
export function pctComplete(state: SimState): number {
  let done = 0;
  let req = 0;
  for (const t of Object.values(state.tasks)) {
    done += Math.min(t.workDone, t.workRequired);
    req += t.workRequired;
  }
  return req === 0 ? 0 : done / req;
}

/** Mean utilization across all characters over elapsed sim-minutes, in [0, 1]. */
export function avgUtilization(state: SimState): number {
  const elapsed = Math.max(1, state.tick);
  let busy = 0;
  for (const c of CHAR_IDS) busy += state.chars[c].busyTicks;
  return busy / (elapsed * CHAR_IDS.length);
}

export function simMinute(state: SimState): number {
  return state.tick / TICKS_PER_MINUTE;
}

/**
 * Single sortable score. Finishing always outranks not finishing; earlier
 * finishes rank higher; utilization is a small tie-breaker that rewards
 * keeping the team busy rather than just lucky seeds.
 */
export function score(state: SimState): number {
  if (state.outcome === 'finished') {
    const minutesLeft = 120 - simMinute(state);
    return Math.round(10000 + minutesLeft * 100 + avgUtilization(state) * 100);
  }
  return Math.round(pctComplete(state) * 9000);
}

export interface ResultSummary {
  outcome: SimState['outcome'];
  finishSimMinute: number | null;
  pctComplete: number;
  avgUtilization: number;
  score: number;
  /** utilization[charIndex][simMinute] */
  utilization: number[][];
  /** completion[simMinute] in [0,1] — the progress curve. */
  completion: number[];
  /** Who worked on what, when — the Gantt source. */
  timeline: TimelineSegment[];
  /** Sim-minutes elapsed when the run ended (finish time, or the full 120). */
  elapsedSimMinutes: number;
  reworkTotal: number;
}

export function summarize(state: SimState): ResultSummary {
  return {
    outcome: state.outcome,
    finishSimMinute: state.outcome === 'finished' ? simMinute(state) : null,
    pctComplete: pctComplete(state),
    avgUtilization: avgUtilization(state),
    score: score(state),
    utilization: state.utilization,
    completion: state.completion,
    timeline: state.timeline,
    elapsedSimMinutes: simMinute(state),
    reworkTotal: Object.values(state.tasks).reduce((a, t) => a + t.reworkCount, 0),
  };
}
