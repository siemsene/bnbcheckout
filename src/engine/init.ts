// createRun: builds the initial SimState for a seed, pre-rolling ALL randomness
// so that step() is fully deterministic given (seed, actionLog).

import { mulberry32 } from './rng';
import {
  CHAR_IDS,
  EVENT_TUNING,
  FIND_ITEM_TASKS,
  TASKS,
} from './content';
import type {
  CharState,
  PreRolls,
  ScheduledEvent,
  SimState,
  TaskState,
} from './types';

// 2: SimState gained the Gantt timeline (older checkpoints lack it).
export const ENGINE_VERSION = 2;

export interface RunOverrides {
  /** Replace the chaos-event schedule entirely (tests). */
  events?: ScheduledEvent[];
  /** Override individual pre-rolls (tests). */
  rolls?: Partial<PreRolls>;
}

export function createRun(seed: number, overrides?: RunOverrides): SimState {
  const rng = mulberry32(seed);

  const durationMults: Record<string, number> = {};
  for (const t of TASKS) durationMults[t.id] = rng.uniform(0.85, 1.2);

  const foundItemRolls: Record<string, number> = {};
  const foundItemBag: Record<string, string> = {};
  const bagIds = ['pack-bag-1', 'pack-bag-2', 'pack-bag-3'];
  for (const [taskId, bag] of Object.entries(FIND_ITEM_TASKS)) {
    foundItemRolls[taskId] = rng.next();
    foundItemBag[taskId] = bag === 'any' ? rng.pick(bagIds) : bag;
  }
  const walkthroughRoll = rng.next();

  const schedule = overrides?.events ?? rollSchedule(rng);
  schedule.sort((a, b) => a.at - b.at);

  const rolls: PreRolls = {
    durationMults,
    foundItemRolls,
    foundItemBag,
    walkthroughRoll,
    ...overrides?.rolls,
  };

  const tasks: Record<string, TaskState> = {};
  for (const t of TASKS) {
    tasks[t.id] = {
      status: t.preds?.length || t.predsAny?.length ? 'locked' : 'open',
      workDone: 0,
      workRequired: Math.round(t.baseMinutes * 60 * rolls.durationMults[t.id]),
      assignees: [],
      arriveAt: {},
      reworkCount: 0,
    };
  }

  const chars = {} as Record<(typeof CHAR_IDS)[number], CharState>;
  for (const c of CHAR_IDS) {
    chars[c] = { activity: 'idle', unavailableUntil: 0, busyTicks: 0, fed: false };
  }

  return {
    engineVersion: ENGINE_VERSION,
    seed,
    tick: 0,
    outcome: 'running',
    tasks,
    chars,
    schedule,
    nextEventIdx: 0,
    rolls,
    walkthroughSurpriseDone: false,
    nudge: null,
    boostUntil: 0,
    emitted: {},
    utilization: CHAR_IDS.map(() => []),
    timeline: [],
    openSegIdx: {},
    actionLog: [],
  };
}

function rollSchedule(rng: ReturnType<typeof mulberry32>): ScheduledEvent[] {
  const events: ScheduledEvent[] = [];
  const T = EVENT_TUNING;

  // Kenji's boss calls
  let t = rng.uniform(T.kenjiPhone.firstMin[0], T.kenjiPhone.firstMin[1]) * 60;
  for (let i = 0; i < T.kenjiPhone.count; i++) {
    events.push({
      at: Math.round(t),
      type: 'phone',
      charId: 'kenji',
      duration: Math.round(
        rng.uniform(T.kenjiPhone.durationMin[0], T.kenjiPhone.durationMin[1]) * 60,
      ),
    });
    t += rng.uniform(T.kenjiPhone.gapMin[0], T.kenjiPhone.gapMin[1]) * 60;
  }

  // Mei's distractions
  t = rng.uniform(T.meiDistraction.firstMin[0], T.meiDistraction.firstMin[1]) * 60;
  for (let i = 0; i < T.meiDistraction.count; i++) {
    events.push({
      at: Math.round(t),
      type: 'distraction',
      charId: 'mei',
      maxDuration: T.meiDistraction.maxDurationMin * 60,
    });
    t += rng.uniform(T.meiDistraction.gapMin[0], T.meiDistraction.gapMin[1]) * 60;
  }

  // Taro's emergencies
  const toiletCount = rng.int(T.taroToilet.count[0], T.taroToilet.count[1]);
  for (let i = 0; i < toiletCount; i++) {
    events.push({
      at: Math.round(rng.uniform(T.taroToilet.windowMin[0], T.taroToilet.windowMin[1]) * 60),
      type: 'toilet',
      charId: 'taro',
      duration: T.taroToilet.durationMin * 60,
    });
  }

  // Doorbell — the neighbor catches a pre-rolled victim
  const doorbellCount = rng.int(T.doorbell.count[0], T.doorbell.count[1]);
  for (let i = 0; i < doorbellCount; i++) {
    events.push({
      at: Math.round(rng.uniform(T.doorbell.windowMin[0], T.doorbell.windowMin[1]) * 60),
      type: 'doorbell',
      charId: rng.pick(['kenji', 'mei', 'taro', 'hana'] as const),
      duration: Math.round(
        rng.uniform(T.doorbell.durationMin[0], T.doorbell.durationMin[1]) * 60,
      ),
    });
  }

  // Cat, spill, music
  events.push({
    at: Math.round(rng.uniform(T.cat.windowMin[0], T.cat.windowMin[1]) * 60),
    type: 'cat',
  });
  events.push({
    at: Math.round(rng.uniform(T.spill.windowMin[0], T.spill.windowMin[1]) * 60),
    type: 'spill',
  });
  events.push({
    at: Math.round(rng.uniform(T.music.windowMin[0], T.music.windowMin[1]) * 60),
    type: 'music',
    duration: T.music.durationMin * 60,
  });

  // Flavor
  const flavorCount = rng.int(T.flavor.count[0], T.flavor.count[1]);
  for (let i = 0; i < flavorCount; i++) {
    events.push({
      at: Math.round(rng.uniform(T.flavor.windowMin[0], T.flavor.windowMin[1]) * 60),
      type: 'flavor',
      textKey: rng.pick(T.flavor.textKeys),
    });
  }

  return events;
}
