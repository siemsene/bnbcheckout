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

import {
  BATHROOM_TASK,
  CHARACTERS,
  CHAR_IDS,
  TASKS,
  TASK_BY_ID,
  TICKS_PER_MINUTE,
} from './content';
import { heldForAnother } from './slack';
import type { Action, CharId, SimState } from './types';

/** Could this character ever do this task, however long they waited? */
export function eligible(charId: CharId, taskId: string): boolean {
  const def = TASK_BY_ID[taskId];
  if (!def) return false;
  if (def.requiresLicense && !CHARACTERS[charId].license) return false;
  if (def.onlyChars && !def.onlyChars.includes(charId)) return false;
  return true;
}

/**
 * Is the bathroom in use right now? Nobody cleans a room Taro is sitting in, so
 * the task is momentarily untakeable. Distinct from `eligible`, which asks who
 * could EVER do a task; this asks whether it can be taken *this tick*.
 */
export function bathroomOccupied(state: SimState): boolean {
  return state.chars.taro.activity === 'toilet';
}

/**
 * Is this friend's time reserved right now for some job other than this one?
 * Slack is held FOR the job that follows it, so it never blocks that job — see
 * `engine/slack.ts` for why that asymmetry is load-bearing.
 */
function reserved(state: SimState, charId: CharId, taskId: string): boolean {
  return heldForAnother(state.plan, charId, taskId, state.tick / TICKS_PER_MINUTE);
}

/** Free to be given something new: idle, present, and not mid-interruption. */
function available(state: SimState, charId: CharId): boolean {
  const c = state.chars[charId];
  return !c.taskId && c.activity === 'idle' && c.unavailableUntil <= state.tick;
}

/**
 * Is a locked crew job worth standing still for, rather than getting on with
 * something further down the lane?
 *
 * Yes when the thing it waits on is somebody else's job — they are cooking,
 * and wandering off now means the whole table eats late. No in the two cases
 * where waiting cannot end:
 *
 *   1. The job it waits on is this same friend's OWN later work. Waiting would
 *      be waiting for themselves; they have to go and do it.
 *   2. Nobody at all is down to do it. That is a plan still being written, and
 *      idling all morning over a job nobody will ever start helps no one —
 *      `checkPlan` says so in words instead.
 */
function worthWaitingFor(
  state: SimState,
  charId: CharId,
  taskId: string,
  indexInQueue: number,
): boolean {
  const def = TASK_BY_ID[taskId];
  const plan = state.plan;
  if (!def || !plan) return false;
  // An unmet `predsAny` has no single job to wait on, so never hold for it.
  if (def.predsAny && !def.predsAny.some((p) => state.tasks[p]?.status === 'done')) {
    return false;
  }
  const queue = plan.queues[charId] ?? [];
  const unmet = (def.preds ?? []).filter((p) => state.tasks[p]?.status !== 'done');
  if (unmet.length === 0) return false;
  return unmet.every((p) => {
    if (queue.indexOf(p) > indexInQueue) return false; // waiting on themselves
    return CHAR_IDS.some((c) => (plan.queues[c] ?? []).includes(p));
  });
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
      (c) =>
        (plan.queues[c] ?? []).includes(def.id) &&
        !task.assignees.includes(c) &&
        !reserved(state, c, def.id),
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

    for (const [index, taskId] of (plan.queues[charId] ?? []).entries()) {
      const task = state.tasks[taskId];
      const def = TASK_BY_ID[taskId];
      if (!task || !def) continue;
      if (task.status === 'done') continue; // nothing to come back for
      if (!eligible(charId, taskId)) continue;

      if ((def.minWorkers ?? 1) > 1) {
        // A crew job keeps its place in the ORDER, locked or not.
        //
        // This check has to come BEFORE the locked test below. It used to sit
        // after it, so while the cooks were still cooking the job was merely
        // `locked`, everyone skipped straight past it to whatever they had
        // queued next, and breakfast — which needs all five at once — was held
        // up by the very people waiting for it. Ordering a job after the crew
        // job did nothing, because the order was never consulted.
        if (
          barrierIsSatisfiable(state, taskId) &&
          (task.status === 'open' || worthWaitingFor(state, charId, taskId, index))
        ) {
          break; // stand by rather than wander off
        }
        continue;
      }

      if (task.status !== 'open') continue; // still locked: look further
      // Taro is in there: skip down the queue rather than queue at the door.
      if (taskId === BATHROOM_TASK && bathroomOccupied(state)) continue;
      // This stretch is being kept for a job earlier in their lane.
      if (reserved(state, charId, taskId)) continue;
      if (!roomOn(taskId)) continue;
      take(charId, taskId);
      break;
    }
  }

  return actions;
}
