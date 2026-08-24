// step(state, actions): advances the simulation by exactly one tick (1 sim-second).
// Mutates `state` in place for performance and returns it together with any events.
// Pure in the deterministic sense: no Date, no Math.random, no I/O.

import {
  BATHROOM_REWORK_FRACTION,
  CHARACTERS,
  CHAR_IDS,
  DEFAULT_MULTIWORKER,
  FIND_ITEM_TASKS,
  FOUND_ITEM_THRESHOLD_HANA,
  FOUND_ITEM_THRESHOLD_OTHERS,
  HANGRY_MULT,
  HANGRY_TICK,
  LEARNING_RAMP_TICKS,
  LEARNING_START_FRACTION,
  NUDGE_COST_TICKS,
  PLAYER_CHAR,
  REPACK_EXTRA_SECONDS,
  SIM_DEADLINE_TICKS,
  TASK_BY_ID,
  TRANSIT_TICKS,
  WALKBACK_FRACTION,
  WALKTHROUGH_SURPRISE_EXTRA_SECONDS,
  WALKTHROUGH_SURPRISE_THRESHOLD,
  TICKS_PER_MINUTE,
} from './content';
import type {
  Action,
  CharId,
  SimEvent,
  SimState,
  StepResult,
  TaskState,
} from './types';

export function step(state: SimState, actions: Action[] = []): StepResult {
  const events: SimEvent[] = [];
  if (state.outcome !== 'running') return { state, events };

  state.tick++;

  for (const action of actions) applyAction(state, action, events);
  fireScheduledEvents(state, events);
  endExpiredInterruptions(state);
  accrueWork(state, events);
  refreshUnlocks(state);
  sampleUtilization(state);
  checkEnd(state, events);

  return { state, events };
}

/**
 * Apply actions without advancing time — used during the planning freeze
 * (tick stays 0) so players can stage assignments and still get discovery
 * bubbles. Actions are logged normally, so replays stay deterministic.
 */
export function applyOnly(state: SimState, actions: Action[]): StepResult {
  const events: SimEvent[] = [];
  if (state.outcome !== 'running') return { state, events };
  for (const action of actions) applyAction(state, action, events);
  return { state, events };
}

// ---------------------------------------------------------------------------
// Actions

function applyAction(state: SimState, action: Action, events: SimEvent[]) {
  const tick = state.tick;

  if (action.type === 'nudge') {
    const target = state.chars[action.charId];
    if (target.activity === 'distracted' || target.activity === 'oncall') {
      target.activity = target.taskId ? 'working' : 'idle';
      target.unavailableUntil = tick;
      bubble(state, events, action.charId, `nudged-${action.charId}`, true);
      // Nudging costs the player a moment of their own work.
      const sora = state.chars[PLAYER_CHAR];
      sora.unavailableUntil = Math.max(sora.unavailableUntil, tick + NUDGE_COST_TICKS);
    } else if (target.activity === 'toilet') {
      bubble(state, events, action.charId, 'nudge-toilet-futile');
    }
    state.actionLog.push({ tick, action });
    return;
  }

  if (action.type === 'unassign') {
    removeFromTask(state, action.charId, events);
    state.actionLog.push({ tick, action });
    return;
  }

  // assign
  const def = TASK_BY_ID[action.taskId];
  const task = state.tasks[action.taskId];
  if (!def || !task) return;
  if (task.status !== 'open') return; // locked or done: UI prevents; engine rejects
  if (task.assignees.length >= def.maxWorkers) return;
  const char = state.chars[action.charId];
  if (char.taskId === action.taskId) return;

  removeFromTask(state, action.charId, events);
  task.assignees.push(action.charId);
  char.taskId = action.taskId;
  // Characters in the middle of an interruption stay interrupted; they will
  // start walking to the task once it ends (handled in endExpiredInterruptions).
  if (char.activity === 'idle' || char.activity === 'working' || char.activity === 'walking' || char.activity === 'walkback') {
    char.activity = 'walking';
  }
  task.arriveAt[action.charId] = Math.max(tick, char.unavailableUntil) + TRANSIT_TICKS;
  state.actionLog.push({ tick, action });

  // Discovery bubbles for hidden constraints.
  if (def.requiresLicense && !CHARACTERS[action.charId].license) {
    bubble(state, events, action.charId, `no-license-${action.charId}`);
  }
  if (def.skill === 'cooking' && action.charId === 'kenji') {
    bubble(state, events, 'kenji', 'kenji-cooking');
  }
  if (task.assignees.includes('taro') && task.assignees.length > 1) {
    bubble(state, events, 'taro', 'taro-crowded');
  }
  if (def.owners && !def.owners.includes(action.charId) && def.nonOwnerMult) {
    bubble(state, events, action.charId, `stranger-bag-${action.charId}`);
  }
}

function removeFromTask(state: SimState, charId: CharId, events: SimEvent[]) {
  const char = state.chars[charId];
  const prevTaskId = char.taskId;
  if (!prevTaskId) return;
  const prevDef = TASK_BY_ID[prevTaskId];
  const prev = state.tasks[prevTaskId];
  prev.assignees = prev.assignees.filter((c) => c !== charId);
  delete prev.arriveAt[charId];
  char.taskId = undefined;

  // Abandoning a travel task: all progress lost, and the walker must come back.
  if (prevDef.travel && prev.status === 'open' && prev.workDone > 0) {
    const ticksOut = Math.round(prev.workDone); // 1 effective person-sec ~ 1 tick out
    prev.workDone = 0;
    char.activity = 'walkback';
    char.unavailableUntil = Math.max(
      char.unavailableUntil,
      state.tick + Math.max(TRANSIT_TICKS, Math.round(ticksOut * WALKBACK_FRACTION)),
    );
    bubble(state, events, charId, `walkback-${prevTaskId}`, true);
  } else if (char.activity === 'working' || char.activity === 'walking') {
    char.activity = 'idle';
  }
}

// ---------------------------------------------------------------------------
// Scheduled chaos

function fireScheduledEvents(state: SimState, events: SimEvent[]) {
  const tick = state.tick;
  while (
    state.nextEventIdx < state.schedule.length &&
    state.schedule[state.nextEventIdx].at <= tick
  ) {
    const ev = state.schedule[state.nextEventIdx++];
    switch (ev.type) {
      case 'phone': {
        const c = state.chars[ev.charId];
        if (c.activity === 'toilet') break; // priorities
        c.activity = 'oncall';
        c.unavailableUntil = tick + ev.duration;
        bubble(state, events, ev.charId, 'phone-start', true);
        break;
      }
      case 'distraction': {
        const c = state.chars[ev.charId];
        if (c.activity !== 'working' && c.activity !== 'idle') break;
        c.activity = 'distracted';
        c.unavailableUntil = tick + ev.maxDuration;
        bubble(state, events, ev.charId, 'distracted-start', true);
        break;
      }
      case 'toilet': {
        const c = state.chars[ev.charId];
        c.activity = 'toilet';
        c.unavailableUntil = tick + ev.duration;
        bubble(state, events, ev.charId, 'toilet-start', true);
        // The bathroom suffers, whether cleaned already or mid-clean.
        const bath = state.tasks['clean-bathroom'];
        if (bath.workDone > 0) {
          bath.workDone = Math.max(0, bath.workDone * (1 - BATHROOM_REWORK_FRACTION));
          if (bath.status === 'done') bath.status = 'open';
          bath.reworkCount++;
          events.push({
            type: 'rework',
            tick,
            taskId: 'clean-bathroom',
            textKey: 'rework-bathroom',
          });
        }
        break;
      }
      case 'flavor':
        bubble(state, events, undefined, ev.textKey, true);
        break;
    }
  }
}

function endExpiredInterruptions(state: SimState) {
  const tick = state.tick;
  for (const id of CHAR_IDS) {
    const c = state.chars[id];
    if (
      (c.activity === 'oncall' || c.activity === 'distracted' || c.activity === 'toilet' || c.activity === 'walkback') &&
      c.unavailableUntil <= tick
    ) {
      if (c.taskId) {
        // Walk (back) to the task if not yet arrived, else resume.
        const task = state.tasks[c.taskId];
        const arrive = task.arriveAt[id] ?? tick;
        if (arrive > tick) {
          c.activity = 'walking';
        } else {
          c.activity = 'working';
        }
      } else {
        c.activity = 'idle';
      }
    }
    // Walkers arrive.
    if (c.activity === 'walking' && c.taskId) {
      const arrive = state.tasks[c.taskId].arriveAt[id] ?? tick;
      if (arrive <= tick) c.activity = 'working';
    }
  }
}

// ---------------------------------------------------------------------------
// Work accrual

/** True when this character adds effective work to their task this tick. */
function contributes(state: SimState, charId: CharId): boolean {
  const c = state.chars[charId];
  if (!c.taskId) return false;
  if (c.activity !== 'working') return false;
  if (c.unavailableUntil > state.tick) return false;
  const def = TASK_BY_ID[c.taskId];
  if (def.requiresLicense && !CHARACTERS[charId].license) return false;
  return true;
}

function accrueWork(state: SimState, events: SimEvent[]) {
  const tick = state.tick;
  const eatDone = state.tasks['eat-breakfast'].status === 'done';
  const hangryActive = tick >= HANGRY_TICK && !eatDone;
  if (hangryActive) bubble(state, events, undefined, 'hangry', true);

  for (const [taskId, task] of Object.entries(state.tasks)) {
    if (task.status !== 'open' || task.assignees.length === 0) continue;
    const def = TASK_BY_ID[taskId];

    const workers = task.assignees.filter((c) => contributes(state, c));
    const n = workers.length;
    if (n === 0) continue;
    if (def.minWorkers && n < def.minWorkers) continue;

    const factors = def.multiWorkerFactors ?? DEFAULT_MULTIWORKER;
    const factor = factors[Math.min(n, factors.length - 1)];
    const share = factor / n;

    let rate = 0;
    for (const charId of workers) {
      const charDef = CHARACTERS[charId];
      let m = charDef.skillMult[def.skill] ?? 1.0;
      if (def.owners) {
        if (def.owners.includes(charId)) m *= def.ownerMult ?? 1;
        else m *= def.nonOwnerMult ?? 1;
      }
      // Learning curve (skipped for travel tasks).
      if (!def.travel) {
        const arrived = task.arriveAt[charId] ?? tick;
        const onTask = Math.max(0, tick - arrived);
        m *=
          LEARNING_START_FRACTION +
          (1 - LEARNING_START_FRACTION) * Math.min(1, onTask / LEARNING_RAMP_TICKS);
      }
      // Social preferences.
      if (n > 1 && charDef.pairedMult) m *= charDef.pairedMult;
      if (n === 1 && charDef.aloneMult) m *= charDef.aloneMult;
      // Hunger.
      if (hangryActive && !state.chars[charId].fed) m *= HANGRY_MULT;
      rate += m * share;
    }

    task.workDone += rate;
    if (task.workDone >= task.workRequired) {
      completeTask(state, taskId, task, events);
    }
  }
}

function completeTask(
  state: SimState,
  taskId: string,
  task: TaskState,
  events: SimEvent[],
) {
  const tick = state.tick;

  // Final-walkthrough surprise: one last forgotten item behind the sofa.
  if (
    taskId === 'final-walkthrough' &&
    !state.walkthroughSurpriseDone &&
    state.rolls.walkthroughRoll < WALKTHROUGH_SURPRISE_THRESHOLD
  ) {
    state.walkthroughSurpriseDone = true;
    task.workRequired += WALKTHROUGH_SURPRISE_EXTRA_SECONDS;
    task.reworkCount++;
    events.push({ type: 'rework', tick, taskId, textKey: 'rework-walkthrough' });
    return; // not done after all
  }

  task.workDone = task.workRequired;
  task.status = 'done';
  events.push({ type: 'taskDone', tick, taskId });

  if (taskId === 'eat-breakfast') {
    for (const c of CHAR_IDS) state.chars[c].fed = true;
  }

  // Cleaning may uncover a forgotten item -> repack somebody's bag.
  const bagId = FIND_ITEM_TASKS[taskId] ? state.rolls.foundItemBag[taskId] : undefined;
  if (bagId) {
    const roll = state.rolls.foundItemRolls[taskId];
    const cleanedByHana = task.assignees.includes('hana');
    const threshold = cleanedByHana
      ? FOUND_ITEM_THRESHOLD_HANA
      : FOUND_ITEM_THRESHOLD_OTHERS;
    if (roll < threshold) {
      const bag = state.tasks[bagId];
      bag.workRequired += REPACK_EXTRA_SECONDS;
      if (bag.status === 'done') {
        bag.status = 'open';
      }
      bag.reworkCount++;
      events.push({ type: 'rework', tick, taskId: bagId, textKey: `found-item-${taskId}` });
    }
  }

  // Free the workers.
  for (const charId of task.assignees) {
    const c = state.chars[charId];
    c.taskId = undefined;
    if (c.activity === 'working' || c.activity === 'walking') c.activity = 'idle';
  }
  task.assignees = [];
  task.arriveAt = {};
}

// ---------------------------------------------------------------------------
// DAG, sampling, end conditions

function refreshUnlocks(state: SimState) {
  for (const [taskId, task] of Object.entries(state.tasks)) {
    if (task.status !== 'locked') continue;
    const def = TASK_BY_ID[taskId];
    const predsOk = (def.preds ?? []).every((p) => state.tasks[p].status === 'done');
    const anyOk =
      !def.predsAny || def.predsAny.some((p) => state.tasks[p].status === 'done');
    if (predsOk && anyOk) task.status = 'open';
  }
}

function sampleUtilization(state: SimState) {
  for (let i = 0; i < CHAR_IDS.length; i++) {
    const c = state.chars[CHAR_IDS[i]];
    if (c.activity === 'working' || c.activity === 'walking') c.busyTicks++;
  }
  if (state.tick % TICKS_PER_MINUTE === 0) {
    const minute = state.tick / TICKS_PER_MINUTE - 1;
    for (let i = 0; i < CHAR_IDS.length; i++) {
      const c = state.chars[CHAR_IDS[i]];
      const prevTotal = state.utilization[i].reduce((a, b) => a + b, 0) * TICKS_PER_MINUTE;
      state.utilization[i][minute] = (c.busyTicks - prevTotal) / TICKS_PER_MINUTE;
    }
  }
}

function checkEnd(state: SimState, events: SimEvent[]) {
  const allDone = Object.values(state.tasks).every((t) => t.status === 'done');
  if (allDone) {
    state.outcome = 'finished';
    events.push({ type: 'finished', tick: state.tick });
  } else if (state.tick >= SIM_DEADLINE_TICKS) {
    state.outcome = 'deadline';
    events.push({ type: 'deadline', tick: state.tick });
  }
}

// ---------------------------------------------------------------------------

function bubble(
  state: SimState,
  events: SimEvent[],
  charId: CharId | undefined,
  textKey: string,
  allowRepeat = false,
) {
  const key = allowRepeat ? `${textKey}@${state.tick}` : textKey;
  if (state.emitted[key]) return;
  state.emitted[key] = true;
  events.push({ type: 'bubble', tick: state.tick, charId, textKey });
}
