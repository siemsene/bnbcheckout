// Balance guards: the scenario must punish naive play and reward parallel
// planning, across the per-seed duration variation.

import { describe, expect, it } from 'vitest';
import { createRun } from '../init';
import { step } from '../step';
import {
  CHAR_IDS,
  SIM_DEADLINE_TICKS,
  TASKS,
  TASK_BY_ID,
} from '../content';
import type { Action, SimState } from '../types';

/** Everyone mobs the first open task; nobody thinks about skills or parallelism. */
function herdStrategy(s: SimState): Action[] {
  const actions: Action[] = [];
  const open = TASKS.filter((t) => s.tasks[t.id].status === 'open');
  if (open.length === 0) return actions;
  const target = open[0];
  for (const c of CHAR_IDS) {
    const ch = s.chars[c];
    if (ch.taskId !== target.id && ch.activity !== 'walkback') {
      if (s.tasks[target.id].assignees.length < target.maxWorkers) {
        actions.push({ type: 'assign', charId: c, taskId: target.id });
      }
    }
  }
  return actions;
}

/** Sensible parallel play: skills matched, nudges used, breakfast synchronized. */
function smartStrategy(s: SimState): Action[] {
  const actions: Action[] = [];
  for (const c of CHAR_IDS) {
    if (s.chars[c].activity === 'distracted' || s.chars[c].activity === 'oncall') {
      actions.push({ type: 'nudge', charId: c });
    }
  }
  const makeDone = s.tasks['make-breakfast'].status === 'done';
  const eatDone = s.tasks['eat-breakfast'].status === 'done';
  if (makeDone && !eatDone) {
    for (const c of CHAR_IDS) {
      // Never yank someone off a travel task to eat: abandoning wipes all of
      // their progress and charges a walk-back. No competent player does this.
      const onTrip = s.chars[c].taskId && TASK_BY_ID[s.chars[c].taskId!].travel;
      if (
        s.chars[c].taskId !== 'eat-breakfast' &&
        s.chars[c].activity !== 'walkback' &&
        !onTrip
      ) {
        actions.push({ type: 'assign', charId: c, taskId: 'eat-breakfast' });
      }
    }
    return actions;
  }
  // Each friend's own errand comes first when they're free — that is what a
  // competent player does with a task nobody else can take.
  const prefs: Record<string, string[]> = {
    mei: ['make-breakfast', 'call-mom', 'buy-snacks', 'clean-bedroom-2', 'pack-bag-2', 'tidy-kitchen'],
    kenji: ['fetch-car-a', 'fetch-car-b', 'pack-bag-1', 'clean-bedroom-1', 'load-car-a', 'garbage'],
    hana: ['guest-book', 'clean-bathroom', 'clean-bedroom-3', 'clean-bedroom-1', 'tidy-kitchen', 'fetch-car-b'],
    taro: ['buy-imodium', 'clean-living-room', 'pack-bag-3', 'load-car-a', 'load-car-b', 'garbage', 'clean-bedroom-3'],
    sora: ['strip-beds', 'pack-bag-1', 'clean-bedroom-1', 'clean-bedroom-2', 'buy-snacks', 'load-car-b', 'final-walkthrough'],
  };
  for (const c of CHAR_IDS) {
    const ch = s.chars[c];
    if (ch.taskId || ch.activity === 'walkback') continue;
    const wish = prefs[c].find(
      (t) =>
        s.tasks[t].status === 'open' &&
        s.tasks[t].assignees.length < TASK_BY_ID[t].maxWorkers,
    );
    const fallback = TASKS.find(
      (t) =>
        s.tasks[t.id].status === 'open' &&
        s.tasks[t.id].assignees.length < t.maxWorkers &&
        (!t.requiresLicense || c === 'kenji' || c === 'hana') &&
        (!t.onlyChars || t.onlyChars.includes(c)) &&
        t.id !== 'eat-breakfast',
    )?.id;
    const target = wish ?? fallback;
    if (target) actions.push({ type: 'assign', charId: c, taskId: target });
  }
  return actions;
}

function runWith(seed: number, strategy: (s: SimState) => Action[]): SimState {
  const s = createRun(seed);
  let pending: Action[] = [];
  for (let i = 0; i < SIM_DEADLINE_TICKS; i++) {
    const actions = i % 30 === 0 ? [...pending.splice(0), ...strategy(s)] : [];
    step(s, actions);
    if (s.outcome !== 'running') break;
  }
  return s;
}

const SEEDS = [3, 17, 42, 101, 256, 999, 1234, 5150, 8888, 31415];

// Measured after the personal errands landed (engine v3): smart play finishes
// 10/10, average 94.6', slowest finisher 103.4' of 120', all three errands done
// every run. Recorded because the two assertions below move in OPPOSITE
// directions as difficulty rises — a harder scenario drops slow seeds out of
// `times`, which pulls `avg` DOWN — so neither number alone tells you whether a
// balance change was harmless. If these start failing, fix the content (the
// errands are the cheapest lever), not the thresholds.

describe('scenario balance', () => {
  it('the herd strategy (no parallelism) misses the 10 AM deadline on most seeds', () => {
    let missed = 0;
    for (const seed of SEEDS) {
      const s = runWith(seed, herdStrategy);
      if (s.outcome !== 'finished') missed++;
    }
    expect(missed).toBeGreaterThanOrEqual(7);
  });

  it('skill-matched parallel play finishes before the deadline on most seeds', () => {
    let finished = 0;
    const times: number[] = [];
    for (const seed of SEEDS) {
      const s = runWith(seed, smartStrategy);
      if (s.outcome === 'finished') {
        finished++;
        times.push(s.tick / 60);
      }
    }
    expect(finished).toBeGreaterThanOrEqual(7);
    // and it should not be trivially easy — average finish inside the last hour
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    expect(avg).toBeGreaterThan(70);
  });
});
