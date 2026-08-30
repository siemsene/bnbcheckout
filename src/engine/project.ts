// projectPlan: what a plan is predicted to do, by running the real engine.
//
// The prediction is produced by the same step() the game uses, with the same
// rate model, crew factors, learning ramps and transit costs. That is the whole
// point: a planned Gantt drawn from a second, simpler model would flatter the
// plan and make plan-vs-actual variance meaningless — the student would be
// comparing the engine against a strawman rather than their plan against
// reality.
//
// What is suppressed is chaos, and only chaos: interruptions, the cat, found
// items, the walkthrough surprise. Everything deterministic stays in, including
// the hangry penalty, the vacuum contention and the shopping-list gate, because
// a plan that ignores those is a plan that was wrong.

import { createRun } from './init';
import { step } from './step';
import { SIM_DEADLINE_TICKS, TASKS, TICKS_PER_MINUTE } from './content';
import type { Plan, PlannedProjection, SimState } from './types';

/**
 * Project against the published estimates (every task's `~N minutes`) rather
 * than the seed's true durations. Students plan from the estimates they can see,
 * and variance is only interesting when the plan was built on them.
 *
 * Flip after a classroom trial if the debrief plays better the other way.
 */
export const PROJECT_WITH_TRUE_DURATIONS = false;

/** A run with every random disruption switched off. */
export function createQuietRun(seed: number, plan?: Plan): SimState {
  const foundItemRolls: Record<string, number> = {};
  for (const t of TASKS) foundItemRolls[t.id] = 1; // above every found-item threshold

  const durationMults: Record<string, number> | undefined =
    PROJECT_WITH_TRUE_DURATIONS
      ? undefined
      : Object.fromEntries(TASKS.map((t) => [t.id, 1]));

  const s = createRun(seed, {
    events: [],
    rolls: {
      foundItemRolls,
      walkthroughRoll: 1, // above the surprise threshold
      ...(durationMults ? { durationMults } : {}),
    },
  });
  if (plan) {
    s.plan = plan;
  }
  return s;
}

/**
 * Run the plan forward and report what it achieves. Deterministic for a given
 * (seed, plan): no clock, no randomness beyond the seed.
 *
 * Cost is one full-length headless run — measured at roughly 50ms, so this is
 * fine to call synchronously on a plan edit behind a short debounce.
 */
export function projectPlan(seed: number, plan: Plan): PlannedProjection {
  const s = createQuietRun(seed, plan);

  const startedAt: Record<string, number> = {};
  const doneAt: Record<string, number> = {};

  for (let i = 0; i < SIM_DEADLINE_TICKS; i++) {
    step(s);
    for (const t of TASKS) {
      const task = s.tasks[t.id];
      if (startedAt[t.id] === undefined && task.workDone > 0) startedAt[t.id] = s.tick;
      if (doneAt[t.id] === undefined && task.status === 'done') doneAt[t.id] = s.tick;
    }
    if (s.outcome !== 'running') break;
  }

  const taskWindows: PlannedProjection['taskWindows'] = {};
  const unscheduled: string[] = [];
  for (const t of TASKS) {
    const start = startedAt[t.id];
    if (start === undefined) {
      taskWindows[t.id] = null;
      unscheduled.push(t.id);
      continue;
    }
    taskWindows[t.id] = { start, end: doneAt[t.id] ?? s.tick };
  }

  return {
    timeline: s.timeline,
    completion: s.completion,
    finishSimMinute: s.outcome === 'finished' ? s.tick / TICKS_PER_MINUTE : null,
    outcome: s.outcome,
    taskWindows,
    unscheduled,
  };
}
