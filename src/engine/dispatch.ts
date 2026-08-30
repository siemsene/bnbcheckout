// The auto-dispatcher: turns a committed plan into assignments, tick by tick.
//
// It runs INSIDE step(), not in the store's animation loop. The loop advances in
// batches whose size depends on frame rate and on the catch-up path, so a
// dispatcher there would assign people at different sim-ticks on a smooth client
// than on one recovering from a throttled tab — and two students in the same room
// would silently diverge. Running here keeps a plan-driven run a pure function of
// (seed, plan), which is also what lets `projectPlan` predict a schedule by
// calling exactly the same code.
//
// Two invariants carry most of the safety:
//
//   1. It only ever fills EMPTY hands — a character is a candidate solely when
//      idle and free. That is the whole anti-thrash guarantee.
//   2. It never emits `unassign`. With (1), a busy character is never touched,
//      which is what stops it yanking someone off a travel task, where
//      abandoning wipes all progress and charges a walk back.
//
// There is deliberately NO cursor. An earlier version advanced a per-character
// index and never looked back, which meant a task that was finished and then
// REWORKED — the cat re-messing the living room — could never be picked up
// again by anyone: every queue had already moved past it. Re-reading the whole
// queue each tick costs nothing at this size and makes rework recoverable, which
// is rather the point of having rework in a teaching sim.

import { CHARACTERS, CHAR_IDS, TASKS, TASK_BY_ID } from './content';
import type { Action, CharId, SimState } from './types';

/** Could this character ever do this task, however long they waited? */
export function eligible(charId: CharId, taskId: string): boolean {
  const def = TASK_BY_ID[taskId];
  if (!def) return false;
  if (def.requiresLicense && !CHARACTERS[charId].license) return false;
  if (def.onlyChars && !def.onlyChars.includes(charId)) return false;
  return true;
}

/** Free to be given something new: idle, present, and not mid-interruption. */
function available(state: SimState, charId: CharId): boolean {
  const c = state.chars[charId];
  return !c.taskId && c.activity === 'idle' && c.unavailableUntil <= state.tick;
}

/**
 * Can this plan ever satisfy a crew barrier? A task needing all five is
 * unsatisfiable if fewer than five friends ever queue it, and nobody should hold
 * for something that can never happen. The plan validator says so in words
 * before the run; this is the engine refusing to deadlock on it.
 */
export function barrierIsSatisfiable(state: SimState, taskId: string): boolean {
  const def = TASK_BY_ID[taskId];
  const need = def?.minWorkers ?? 1;
  if (need <= 1) return true;
  const plan = state.plan;
  if (!plan) return false;
  const queued = CHAR_IDS.filter((c) => (plan.queues[c] ?? []).includes(taskId)).length;
  return queued >= need;
}

/** The assignments the plan implies this tick. */
export function planActions(state: SimState): Action[] {
  const plan = state.plan;
  if (!plan) return [];

  const actions: Action[] = [];
  // Assignments already emitted this tick, so crew limits hold across the batch.
  const claimed = new Map<string, number>();
  const placed = new Set<CharId>();

  const roomOn = (taskId: string) =>
    state.tasks[taskId].assignees.length + (claimed.get(taskId) ?? 0) <
    TASK_BY_ID[taskId].maxWorkers;

  const take = (charId: CharId, taskId: string) => {
    actions.push({ type: 'assign', charId, taskId });
    claimed.set(taskId, (claimed.get(taskId) ?? 0) + 1);
    placed.add(charId);
  };

  // 1. Fire any crew barrier whose whole crew is standing by. A barrier task
  //    produces literally nothing below its minimum, so sending people in one at
  //    a time just parks them at the table. Everyone goes at once, or nobody —
  //    which also overlaps their transits.
  for (const def of TASKS) {
    const need = def.minWorkers ?? 1;
    if (need <= 1) continue;
    const task = state.tasks[def.id];
    if (task.status !== 'open') continue;

    const pending = CHAR_IDS.filter(
      (c) => (plan.queues[c] ?? []).includes(def.id) && !task.assignees.includes(c),
    );
    if (task.assignees.length + pending.length < need) continue; // plan can't do it
    if (!pending.every((c) => available(state, c))) continue; // still assembling

    for (const c of pending) {
      if (!roomOn(def.id)) break;
      take(c, def.id);
    }
  }

  // 2. Everyone else takes the first thing their plan still wants doing.
  for (const charId of CHAR_IDS) {
    if (placed.has(charId) || !available(state, charId)) continue;

    for (const taskId of plan.queues[charId] ?? []) {
      const task = state.tasks[taskId];
      const def = TASK_BY_ID[taskId];
      if (!task || !def) continue;
      if (task.status !== 'open') continue; // done or still locked: look further
      if (!eligible(charId, taskId)) continue;

      if ((def.minWorkers ?? 1) > 1) {
        // Their next job needs the whole crew and the crew isn't ready. Wait for
        // them rather than wandering off, so the barrier can actually close —
        // unless no plan could ever satisfy it, in which case skip it entirely.
        if (barrierIsSatisfiable(state, taskId)) break;
        continue;
      }

      if (!roomOn(taskId)) continue;
      take(charId, taskId);
      break;
    }
  }

  return actions;
}
