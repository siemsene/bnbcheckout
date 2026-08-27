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
  INTERRUPT_MAX_TICKS,
  LEARNING_RAMP_TICKS,
  LEARNING_START_FRACTION,
  MUSIC_BOOST,
  NO_LIST_MULT,
  NUDGE_CHAT_TICKS,
  NUDGE_WALK_TICKS,
  PLAYER_CHAR,
  REPACK_EXTRA_SECONDS,
  SIM_DEADLINE_TICKS,
  TASK_BY_ID,
  TASKS,
  TRANSIT_TICKS,
  VACUUM_PENALTY,
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
  TimelineKind,
} from './types';

export function step(state: SimState, actions: Action[] = []): StepResult {
  const events: SimEvent[] = [];
  if (state.outcome !== 'running') return { state, events };

  state.tick++;

  for (const action of actions) applyAction(state, action, events);
  fireScheduledEvents(state, events);
  resolveNudge(state, events);
  endExpiredInterruptions(state);
  // Recorded before accrueWork: each character's state for this tick is settled,
  // and anyone finishing a task this tick still gets credited for it.
  recordTimeline(state);
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
    if (action.charId === PLAYER_CHAR) return;
    if (target.activity === 'toilet') {
      bubble(state, events, action.charId, 'nudge-toilet-futile');
      state.actionLog.push({ tick, action });
      return;
    }
    if (state.nudge) return; // Sora is already on her way to someone
    if (target.activity !== 'distracted' && target.activity !== 'oncall') return;

    // Sora walks over, has a word, then walks back to whatever she was doing.
    state.nudge = { target: action.charId, arriveAt: tick + NUDGE_WALK_TICKS };
    const sora = state.chars[PLAYER_CHAR];
    if (sora.activity === 'working' || sora.activity === 'idle') sora.activity = 'walking';
    sora.unavailableUntil = Math.max(
      sora.unavailableUntil,
      tick + NUDGE_WALK_TICKS + NUDGE_CHAT_TICKS,
    );
    bubble(state, events, PLAYER_CHAR, 'nudge-onmyway', true);
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

  // Personal errands are rejected outright rather than accepted-and-useless.
  // This MUST sit above removeFromTask: an errand is mandatory and single-slot,
  // so letting the wrong friend take it would strand them (losing any travel
  // progress) AND permanently block the one person who can finish it.
  if (def.onlyChars && !def.onlyChars.includes(action.charId)) {
    bubble(state, events, action.charId, `not-mine-${action.charId}`, true);
    return;
  }

  removeFromTask(state, action.charId, events);
  task.assignees.push(action.charId);
  char.taskId = action.taskId;
  // Characters in the middle of an interruption stay interrupted; they will
  // start walking to the task once it ends (handled in endExpiredInterruptions).
  if (
    char.activity === 'idle' ||
    char.activity === 'working' ||
    char.activity === 'walking' ||
    char.activity === 'walkback'
  ) {
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
  if (
    action.taskId === 'buy-snacks' &&
    state.tasks['clean-living-room'].status !== 'done'
  ) {
    bubble(state, events, action.charId, 'no-shopping-list');
  }
  if (def.equipment === 'vacuum') {
    const others = TASKS.filter(
      (t) =>
        t.equipment === 'vacuum' &&
        t.id !== action.taskId &&
        state.tasks[t.id].status === 'open' &&
        state.tasks[t.id].assignees.length > 0,
    );
    if (others.length > 0) bubble(state, events, action.charId, 'no-vacuum');
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
        c.unavailableUntil = tick + Math.min(ev.duration, INTERRUPT_MAX_TICKS);
        bubble(state, events, ev.charId, 'phone-start', true);
        break;
      }
      case 'distraction': {
        const c = state.chars[ev.charId];
        if (c.activity !== 'working' && c.activity !== 'idle') break;
        c.activity = 'distracted';
        c.unavailableUntil = tick + Math.min(ev.maxDuration, INTERRUPT_MAX_TICKS);
        bubble(state, events, ev.charId, 'distracted-start', true);
        break;
      }
      case 'toilet': {
        // The pharmacy run pays off: most (not all) remaining emergencies are
        // suppressed. nextEventIdx was already advanced, so breaking here
        // consumes the event and leaves the rest of the schedule untouched.
        if (
          ev.skippableByImodium &&
          state.tasks['buy-imodium']?.status === 'done'
        ) {
          bubble(state, events, ev.charId, 'imodium-holding', true);
          break;
        }
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
          refreshLocksAfterRework(state, 'clean-bathroom');
        }
        break;
      }
      case 'doorbell': {
        const c = state.chars[ev.charId];
        if (c.activity === 'toilet' || c.activity === 'oncall') break;
        c.activity = 'distracted'; // stuck at the door until nudged (or it ends)
        c.unavailableUntil = tick + Math.min(ev.duration, INTERRUPT_MAX_TICKS);
        bubble(state, events, ev.charId, 'doorbell', true);
        break;
      }
      case 'cat': {
        const living = state.tasks['clean-living-room'];
        if (living.status === 'done') {
          living.status = 'open';
          living.workDone = living.workRequired * 0.85;
          living.reworkCount++;
          events.push({
            type: 'rework',
            tick,
            taskId: 'clean-living-room',
            textKey: 'cat-mess',
          });
          refreshLocksAfterRework(state, 'clean-living-room');
        } else {
          bubble(state, events, undefined, 'cat-visit', true);
        }
        break;
      }
      case 'spill': {
        const kitchen = state.tasks['tidy-kitchen'];
        if (kitchen.status !== 'done') {
          kitchen.workRequired += 3 * 60;
          bubble(state, events, undefined, 'spill', true);
        }
        break;
      }
      case 'music': {
        state.boostUntil = tick + ev.duration;
        bubble(state, events, undefined, 'music', true);
        break;
      }
      case 'flavor':
        bubble(state, events, undefined, ev.textKey, true);
        break;
    }
  }
}

/** A completed successor may need to re-lock… we keep it simple: completed
 * tasks stay done; only *locked* tasks re-check. Reopening a pred therefore
 * never cascades — but tasks that were open purely because this pred was done
 * must re-lock if they haven't started. */
function refreshLocksAfterRework(state: SimState, predId: string) {
  for (const t of TASKS) {
    if (!t.preds?.includes(predId)) continue;
    const ts = state.tasks[t.id];
    if (ts.status === 'open' && ts.workDone === 0 && ts.assignees.length === 0) {
      ts.status = 'locked';
    }
  }
}

function resolveNudge(state: SimState, events: SimEvent[]) {
  const n = state.nudge;
  if (!n || state.tick < n.arriveAt) return;
  const target = state.chars[n.target];
  if (target.activity === 'distracted' || target.activity === 'oncall') {
    target.activity = target.taskId ? 'working' : 'idle';
    target.unavailableUntil = state.tick;
    bubble(state, events, n.target, `nudged-${n.target}`, true);
  } else {
    bubble(state, events, n.target, 'nudge-already-fine', true);
  }
  // Sora heads back to her own task (or the hall).
  const sora = state.chars[PLAYER_CHAR];
  if (sora.taskId) {
    state.tasks[sora.taskId].arriveAt[PLAYER_CHAR] =
      state.tick + NUDGE_CHAT_TICKS + NUDGE_WALK_TICKS;
    sora.activity = 'walking';
  } else {
    sora.activity = 'idle';
  }
  state.nudge = null;
}

function endExpiredInterruptions(state: SimState) {
  const tick = state.tick;
  for (const id of CHAR_IDS) {
    const c = state.chars[id];
    if (
      (c.activity === 'oncall' ||
        c.activity === 'distracted' ||
        c.activity === 'toilet' ||
        c.activity === 'walkback') &&
      c.unavailableUntil <= tick
    ) {
      if (c.taskId) {
        const task = state.tasks[c.taskId];
        const arrive = task.arriveAt[id] ?? tick;
        c.activity = arrive > tick ? 'walking' : 'working';
      } else {
        c.activity = 'idle';
      }
    }
    // Walkers arrive.
    if (c.activity === 'walking' && c.taskId) {
      const arrive = state.tasks[c.taskId].arriveAt[id] ?? tick;
      if (arrive <= tick && c.unavailableUntil <= tick) c.activity = 'working';
    }
  }
}

// ---------------------------------------------------------------------------
// Timeline (Gantt source)

function segmentKind(state: SimState, charId: CharId): TimelineKind | null {
  const c = state.chars[charId];
  switch (c.activity) {
    case 'oncall':
    case 'distracted':
    case 'toilet':
      return 'blocked';
    case 'walking':
    case 'walkback':
      return 'travel';
    case 'working':
      // Assigned but producing nothing: no license for the task, or still
      // paying the nudge cost. Worth showing — that time looks busy but isn't.
      return contributes(state, charId) ? 'working' : 'blocked';
    default:
      return null; // idle — a gap in the chart
  }
}

/** Extend or close each character's open span. Spans are half-open [start, end). */
function recordTimeline(state: SimState) {
  const tick = state.tick;
  for (const id of CHAR_IDS) {
    const kind = segmentKind(state, id);
    const taskId = kind === null ? undefined : state.chars[id].taskId;
    const idx = state.openSegIdx[id];
    const open = idx === undefined ? undefined : state.timeline[idx];

    if (open && open.kind === kind && open.taskId === taskId) {
      open.end = tick;
      continue;
    }
    // A differing (or absent) kind leaves the old span closed at its last
    // extension, which is already the correct boundary.
    if (kind === null) {
      delete state.openSegIdx[id];
      continue;
    }
    state.timeline.push({ charId: id, taskId, kind, start: tick - 1, end: tick });
    state.openSegIdx[id] = state.timeline.length - 1;
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
  if (def.onlyChars && !def.onlyChars.includes(charId)) return false;
  return true;
}

/** Which vacuum-equipment task currently holds the vacuum (first active one). */
function vacuumHolder(state: SimState): string | null {
  for (const t of TASKS) {
    if (t.equipment !== 'vacuum') continue;
    const ts = state.tasks[t.id];
    if (ts.status === 'open' && ts.assignees.some((c) => contributes(state, c))) {
      return t.id;
    }
  }
  return null;
}

/**
 * Personal effectiveness multiplier for a character on their current task —
 * skill × ownership × learning ramp × social × hangry × music × equipment/list
 * penalties. Excludes the team-size factor (that's team-level). Also used by
 * the UI to show live productivity. Returns null when unassigned.
 */
export function personalMult(state: SimState, charId: CharId): number | null {
  const c = state.chars[charId];
  if (!c.taskId) return null;
  const def = TASK_BY_ID[c.taskId];
  const task = state.tasks[c.taskId];
  if (def.requiresLicense && !CHARACTERS[charId].license) return 0;
  if (def.onlyChars && !def.onlyChars.includes(charId)) return 0;
  if (!contributes(state, charId)) return 0;

  const charDef = CHARACTERS[charId];
  let m = charDef.skillMult[def.skill] ?? 1.0;
  if (def.owners) {
    if (def.owners.includes(charId)) m *= def.ownerMult ?? 1;
    else m *= def.nonOwnerMult ?? 1;
  }
  if (!def.travel && !def.noRamp) {
    const arrived = task.arriveAt[charId] ?? state.tick;
    const onTask = Math.max(0, state.tick - arrived);
    m *=
      LEARNING_START_FRACTION +
      (1 - LEARNING_START_FRACTION) * Math.min(1, onTask / LEARNING_RAMP_TICKS);
  }
  const n = task.assignees.filter((x) => contributes(state, x)).length;
  if (n > 1 && charDef.pairedMult) m *= charDef.pairedMult;
  if (n === 1 && charDef.aloneMult) m *= charDef.aloneMult;

  const eatDone = state.tasks['eat-breakfast'].status === 'done';
  if (state.tick >= HANGRY_TICK && !eatDone && !c.fed) m *= HANGRY_MULT;
  if (state.tick < state.boostUntil) m *= MUSIC_BOOST;

  if (def.equipment === 'vacuum' && vacuumHolder(state) !== c.taskId) m *= VACUUM_PENALTY;
  if (c.taskId === 'buy-snacks' && state.tasks['clean-living-room'].status !== 'done') {
    m *= NO_LIST_MULT;
  }
  return m;
}

function accrueWork(state: SimState, events: SimEvent[]) {
  const tick = state.tick;
  const eatDone = state.tasks['eat-breakfast'].status === 'done';
  if (tick >= HANGRY_TICK && !eatDone) {
    bubble(state, events, undefined, 'hangry'); // announced once
  }

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
      rate += (personalMult(state, charId) ?? 0) * share;
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
  if (taskId === 'clean-living-room') {
    bubble(state, events, undefined, 'found-shopping-list');
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
        refreshLocksAfterRework(state, bagId);
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
