// Plan versus actual: where the morning drifted from what was planned.
//
// Kept out of the React layer so the arithmetic can be tested directly. The
// planned side comes from the projection frozen at commit time — deliberately
// not recomputed, so the debrief compares against the plan the student actually
// signed up to rather than a fresh calculation that has quietly moved on.

import { TASKS, TICKS_PER_MINUTE } from './content';
import type { LoggedAction, PlannedProjection, TimelineSegment } from './types';

export interface TaskVariance {
  taskId: string;
  /** Planned and actual start/finish in sim-minutes; null when never happened. */
  plannedStart: number | null;
  plannedEnd: number | null;
  actualStart: number | null;
  actualEnd: number | null;
  /** Actual finish minus planned finish, in sim-minutes. Positive is late. */
  deltaEnd: number | null;
  /** The player intervened on this task rather than letting the plan run. */
  overridden: boolean;
}

/** When each task actually ran, derived from the run's own timeline. */
export function actualWindows(
  timeline: TimelineSegment[],
): Record<string, { start: number; end: number }> {
  const out: Record<string, { start: number; end: number }> = {};
  for (const s of timeline) {
    // Travel and blocked time is charged to the person, not the task: a task's
    // window is when work was actually going into it.
    if (s.kind !== 'working' || !s.taskId) continue;
    const cur = out[s.taskId];
    out[s.taskId] = cur
      ? { start: Math.min(cur.start, s.start), end: Math.max(cur.end, s.end) }
      : { start: s.start, end: s.end };
  }
  return out;
}

/**
 * Actions the player took by hand once the clock was running. Tick 0 is excluded
 * because that is where staged pre-run assignments land, and plan-sourced actions
 * carry a `src` tag.
 */
export function overrides(actionLog: LoggedAction[]): LoggedAction[] {
  return actionLog.filter((a) => a.src === undefined && a.tick > 0);
}

export function computeVariance(
  planned: PlannedProjection | undefined,
  timeline: TimelineSegment[],
  actionLog: LoggedAction[],
): TaskVariance[] {
  const actual = actualWindows(timeline);
  const touched = new Set(
    overrides(actionLog)
      .map((a) => (a.action.type === 'assign' ? a.action.taskId : undefined))
      .filter((t): t is string => !!t),
  );
  const toMin = (t: number | undefined | null) =>
    t == null ? null : t / TICKS_PER_MINUTE;

  return TASKS.map((def) => {
    const p = planned?.taskWindows?.[def.id] ?? null;
    const a = actual[def.id] ?? null;
    const plannedEnd = toMin(p?.end);
    const actualEnd = toMin(a?.end);
    return {
      taskId: def.id,
      plannedStart: toMin(p?.start),
      plannedEnd,
      actualStart: toMin(a?.start),
      actualEnd,
      deltaEnd: plannedEnd != null && actualEnd != null ? actualEnd - plannedEnd : null,
      overridden: touched.has(def.id),
    };
  });
}

/** One-line summary of how the plan held up, for the debrief headline. */
export function varianceSummary(rows: TaskVariance[], actionLog: LoggedAction[]) {
  const withDelta = rows.filter((r) => r.deltaEnd != null);
  const late = withDelta.filter((r) => r.deltaEnd! > 0.5);
  const worst = [...withDelta].sort((a, b) => (b.deltaEnd ?? 0) - (a.deltaEnd ?? 0))[0];
  const meanDrift = withDelta.length
    ? withDelta.reduce((sum, r) => sum + r.deltaEnd!, 0) / withDelta.length
    : 0;
  return {
    overrideCount: overrides(actionLog).length,
    lateCount: late.length,
    comparedCount: withDelta.length,
    meanDrift,
    worst: worst && (worst.deltaEnd ?? 0) > 0 ? worst : null,
    /** Planned but never actually done. */
    neverHappened: rows.filter((r) => r.plannedEnd != null && r.actualEnd == null).length,
  };
}
