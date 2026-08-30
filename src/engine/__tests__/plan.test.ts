// The auto-dispatcher and the schedule projection. These are the two pieces a
// two-run session rests on, so they are pinned as engine invariants rather than
// tested through the UI.

import { describe, expect, it } from 'vitest';
import { createRun } from '../init';
import { step } from '../step';
import { planActions } from '../dispatch';
import { createQuietRun, projectPlan } from '../project';
import { CHAR_IDS, SIM_DEADLINE_TICKS, TASK_BY_ID, TASKS } from '../content';
import type { Action, CharId, Plan, SimState } from '../types';

const emptyQueues = () =>
  Object.fromEntries(CHAR_IDS.map((c) => [c, [] as string[]])) as Record<CharId, string[]>;

/** A plan a competent student might write: skills matched, work kept parallel. */
function goodPlan(): Plan {
  const queues = emptyQueues();
  queues.mei = [
    'make-breakfast', 'call-mom', 'eat-breakfast', 'pack-bag-2', 'clean-bedroom-2',
  ];
  queues.kenji = [
    'fetch-car-a', 'eat-breakfast', 'pack-bag-1', 'clean-bedroom-1',
    'load-car-a', 'garbage',
  ];
  // Both cars need a licence, so they can only go to Kenji or Hana.
  queues.hana = [
    'guest-book', 'fetch-car-b', 'eat-breakfast', 'clean-bathroom',
    'clean-bedroom-3', 'pack-bag-3', 'final-walkthrough',
  ];
  queues.taro = [
    'buy-imodium', 'clean-living-room', 'eat-breakfast', 'buy-snacks',
    'load-car-b', 'garbage',
  ];
  queues.sora = [
    'strip-beds', 'eat-breakfast', 'tidy-kitchen', 'pack-bag-1', 'pack-bag-3',
    'clean-bedroom-1', 'load-car-a',
  ];
  return { queues, rev: 1 };
}

/**
 * Run a plan the way run 2 is actually played: the dispatcher handles routine
 * assignment, and an attentive student handles the exceptions.
 *
 * The dispatcher deliberately does NOT nudge. Interruptions are the one thing a
 * plan cannot absorb, so clearing them stays the player's job — management by
 * exception, and the reason run 2 is still a game rather than a cutscene. The
 * difference is not marginal: this same plan finishes 0 of 5 seeds unattended
 * and 5 of 5 when somebody is nudging.
 */
function runPlan(
  seed: number,
  plan: Plan,
  opts: { nudge?: boolean; overrides?: Parameters<typeof createRun>[1] } = {},
): SimState {
  const { nudge = true, overrides } = opts;
  const s = createRun(seed, overrides);
  s.plan = plan;
  for (let i = 0; i < SIM_DEADLINE_TICKS; i++) {
    const acts: Action[] = [];
    if (nudge) {
      for (const c of CHAR_IDS) {
        const a = s.chars[c].activity;
        if (a === 'distracted' || a === 'oncall') acts.push({ type: 'nudge', charId: c });
      }
    }
    step(s, acts);
    if (s.outcome !== 'running') break;
  }
  return s;
}

describe('the plan dispatcher', () => {
  it('is inert without a plan, so an ordinary run is untouched', () => {
    const s = createRun(42);
    expect(planActions(s)).toEqual([]);
    for (let i = 0; i < 200; i++) step(s);
    for (const c of CHAR_IDS) expect(s.chars[c].taskId).toBeUndefined();
    expect(s.actionLog).toHaveLength(0);
  });

  it('never emits an action the engine would reject', () => {
    for (const seed of [3, 42, 999]) {
      const s = runPlan(seed, goodPlan());
      for (const entry of s.actionLog) {
        if (entry.src !== 'plan' || entry.action.type !== 'assign') continue;
        const { charId, taskId } = entry.action;
        const def = TASK_BY_ID[taskId];
        if (def.onlyChars) expect(def.onlyChars).toContain(charId);
        if (def.requiresLicense) expect(['kenji', 'hana']).toContain(charId);
      }
    }
  });

  it('never emits unassign, so it cannot strand a travel task', () => {
    const s = runPlan(42, goodPlan());
    const planned = s.actionLog.filter((a) => a.src === 'plan');
    expect(planned.length).toBeGreaterThan(5);
    expect(planned.every((a) => a.action.type === 'assign')).toBe(true);
  });

  it('does not thrash: nobody is re-sent to a task they are already on', () => {
    const s = runPlan(42, goodPlan());
    const last: Record<string, string> = {};
    for (const e of s.actionLog) {
      if (e.action.type !== 'assign') continue;
      const { charId, taskId } = e.action;
      if (last[charId]) expect(last[charId]).not.toBe(taskId);
      last[charId] = taskId;
    }
  });

  it('respects maxWorkers even when everyone queues the same task', () => {
    const queues = emptyQueues();
    for (const c of CHAR_IDS) queues[c] = ['clean-bedroom-1']; // maxWorkers: 1
    const s = createRun(7);
    s.plan = { queues, rev: 1 };
    for (let i = 0; i < 600; i++) {
      step(s);
      expect(s.tasks['clean-bedroom-1'].assignees.length).toBeLessThanOrEqual(1);
      if (s.outcome !== 'running') break;
    }
  });
});

describe('the breakfast barrier', () => {
  it('fires when all five queue it', () => {
    const queues = emptyQueues();
    queues.mei = ['make-breakfast', 'eat-breakfast'];
    for (const c of CHAR_IDS) if (c !== 'mei') queues[c] = ['eat-breakfast'];
    const s = createRun(42);
    s.plan = { queues, rev: 1 };
    for (let i = 0; i < SIM_DEADLINE_TICKS; i++) {
      step(s);
      if (s.tasks['eat-breakfast'].status === 'done') break;
    }
    expect(s.tasks['eat-breakfast'].status).toBe('done');
  });

  it('never seats a partial crew, who would produce nothing at all', () => {
    const queues = emptyQueues();
    queues.mei = ['make-breakfast', 'eat-breakfast'];
    // Only three others queue it, so the barrier can never be met.
    for (const c of ['kenji', 'hana', 'taro'] as CharId[]) queues[c] = ['eat-breakfast'];
    const s = createRun(42);
    s.plan = { queues, rev: 1 };
    for (let i = 0; i < 2000; i++) {
      step(s);
      expect(s.tasks['eat-breakfast'].assignees.length).toBe(0);
      if (s.outcome !== 'running') break;
    }
  });

  it('does not deadlock when the barrier is queued before its predecessor', () => {
    const queues = emptyQueues();
    for (const c of CHAR_IDS) queues[c] = ['eat-breakfast', 'clean-bathroom'];
    queues.mei = ['eat-breakfast', 'make-breakfast'];
    const s = createRun(42);
    s.plan = { queues, rev: 1 };
    for (let i = 0; i < 900; i++) step(s);
    // Somebody got on with something, rather than all five staring at a lock.
    expect(s.actionLog.some((a) => a.src === 'plan')).toBe(true);
  });
});

describe('projectPlan', () => {
  it('is deterministic for a given (seed, plan)', () => {
    const a = projectPlan(42, goodPlan());
    const b = projectPlan(42, goodPlan());
    expect(b.finishSimMinute).toBe(a.finishSimMinute);
    expect(b.timeline).toEqual(a.timeline);
    expect(b.taskWindows).toEqual(a.taskWindows);
  });

  it('suppresses chaos but keeps the deterministic penalties', () => {
    const s = createQuietRun(42);
    expect(s.schedule).toHaveLength(0);
    expect(s.rolls.walkthroughRoll).toBe(1);
  });

  it('schedules every task under a complete plan', () => {
    const p = projectPlan(42, goodPlan());
    expect(p.unscheduled).toEqual([]);
    expect(p.finishSimMinute).not.toBeNull();
  });

  it('reports the tasks a partial plan never reaches', () => {
    const queues = emptyQueues();
    queues.sora = ['strip-beds'];
    const p = projectPlan(42, { queues, rev: 1 });
    expect(p.unscheduled.length).toBeGreaterThan(15);
    expect(p.finishSimMinute).toBeNull();
  });

  it('uses the published estimates, not the seed’s true durations', () => {
    // Students plan from the "~25 min" on each card, so the projection has to
    // as well; variance is only meaningful against the estimate they were given.
    const s = createQuietRun(42);
    for (const t of TASKS) {
      expect(s.tasks[t.id].workRequired).toBe(t.baseMinutes * 60);
    }
  });

  it('chaos only ever costs time: a quiet run never finishes later', () => {
    // The invariant that makes the projection honest. Measured with the SAME
    // durations on both sides — the projection's nominal durations are a
    // separate, deliberate choice (above) and would confound this.
    const quietRolls = {
      foundItemRolls: Object.fromEntries(TASKS.map((t) => [t.id, 1])),
      walkthroughRoll: 1,
    };
    let compared = 0;
    for (const seed of [3, 17, 42, 101, 999]) {
      const quiet = runPlan(seed, goodPlan(), {
        overrides: { events: [], rolls: quietRolls },
      });
      const actual = runPlan(seed, goodPlan());
      if (quiet.outcome !== 'finished' || actual.outcome !== 'finished') continue;
      compared++;
      expect(quiet.tick).toBeLessThanOrEqual(actual.tick);
    }
    expect(compared).toBeGreaterThan(2);
  });

  it('an unattended plan fares much worse — exceptions are the human’s job', () => {
    const seeds = [3, 17, 42, 101, 999];
    const attended = seeds.filter((s) => runPlan(s, goodPlan()).outcome === 'finished');
    const alone = seeds.filter(
      (s) => runPlan(s, goodPlan(), { nudge: false }).outcome === 'finished',
    );
    expect(attended.length).toBeGreaterThan(alone.length);
  });
});

describe('batch invariance (why the dispatcher lives inside step)', () => {
  it('one tick at a time equals five hundred at a time', () => {
    const one = createRun(42);
    one.plan = goodPlan();
    for (let i = 0; i < 3000; i++) {
      step(one);
      if (one.outcome !== 'running') break;
    }

    const many = createRun(42);
    many.plan = goodPlan();
    outer: for (let b = 0; b < 6; b++) {
      for (let i = 0; i < 500; i++) {
        step(many);
        if (many.outcome !== 'running') break outer;
      }
    }

    expect(many.tick).toBe(one.tick);
    for (const t of TASKS) {
      expect(many.tasks[t.id].workDone).toBe(one.tasks[t.id].workDone);
    }
  });
});
