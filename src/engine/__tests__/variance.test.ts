// Plan-versus-actual arithmetic. The debrief makes claims out loud ("your plan
// was six minutes optimistic", "you overrode it four times"), so the numbers
// behind them are pinned here rather than trusted to the component.

import { describe, expect, it } from 'vitest';
import { actualWindows, computeVariance, overrides, varianceSummary } from '../variance';
import { createRun } from '../init';
import { step } from '../step';
import { projectPlan } from '../project';
import { CHAR_IDS, SIM_DEADLINE_TICKS } from '../content';
import type { CharId, LoggedAction, Plan, TimelineSegment } from '../types';

const seg = (
  charId: CharId,
  taskId: string,
  start: number,
  end: number,
  kind: TimelineSegment['kind'] = 'working',
): TimelineSegment => ({ charId, taskId, kind, start, end });

const emptyQueues = () =>
  Object.fromEntries(CHAR_IDS.map((c) => [c, [] as string[]])) as Record<CharId, string[]>;

function goodPlan(): Plan {
  const q = emptyQueues();
  q.mei = ['make-breakfast', 'call-mom', 'eat-breakfast', 'pack-bag-2', 'clean-bedroom-2'];
  q.kenji = ['fetch-car-a', 'eat-breakfast', 'pack-bag-1', 'clean-bedroom-1', 'load-car-a', 'garbage'];
  q.hana = ['guest-book', 'fetch-car-b', 'eat-breakfast', 'clean-bathroom', 'clean-bedroom-3', 'pack-bag-3', 'final-walkthrough'];
  q.taro = ['buy-imodium', 'clean-living-room', 'eat-breakfast', 'buy-snacks', 'load-car-b', 'garbage'];
  q.sora = ['strip-beds', 'eat-breakfast', 'tidy-kitchen', 'pack-bag-1', 'pack-bag-3', 'clean-bedroom-1', 'load-car-a'];
  return { queues: q, rev: 1 };
}

describe('actualWindows', () => {
  it('spans the first start to the last finish across everyone on a task', () => {
    const w = actualWindows([
      seg('sora', 'strip-beds', 100, 400),
      seg('kenji', 'strip-beds', 250, 700),
    ]);
    expect(w['strip-beds']).toEqual({ start: 100, end: 700 });
  });

  it('ignores travel and blocked time, which belongs to the person', () => {
    const w = actualWindows([
      seg('sora', 'buy-snacks', 60, 90, 'travel'),
      seg('sora', 'buy-snacks', 90, 300),
      seg('sora', 'buy-snacks', 300, 400, 'blocked'),
    ]);
    expect(w['buy-snacks']).toEqual({ start: 90, end: 300 });
  });
});

describe('overrides', () => {
  const log: LoggedAction[] = [
    { tick: 0, action: { type: 'assign', charId: 'sora', taskId: 'strip-beds' } },
    { tick: 40, action: { type: 'assign', charId: 'mei', taskId: 'make-breakfast' }, src: 'plan' },
    { tick: 90, action: { type: 'assign', charId: 'hana', taskId: 'clean-bathroom' } },
    { tick: 120, action: { type: 'nudge', charId: 'kenji' } },
  ];

  it('counts only what the player did once the clock was running', () => {
    // Tick 0 is pre-run staging; `src: plan` is the dispatcher.
    expect(overrides(log).map((a) => a.tick)).toEqual([90, 120]);
  });
});

describe('computeVariance', () => {
  it('reports drift per task and flags the ones the player took over', () => {
    const planned = {
      timeline: [],
      completion: [],
      finishSimMinute: 60,
      outcome: 'finished' as const,
      taskWindows: {
        'strip-beds': { start: 0, end: 600 }, // 0' -> 10'
        'clean-bathroom': { start: 600, end: 1200 },
      },
      unscheduled: [],
    };
    const timeline = [
      seg('sora', 'strip-beds', 0, 900), // finished at 15' instead of 10'
      seg('hana', 'clean-bathroom', 600, 1200),
    ];
    const log: LoggedAction[] = [
      { tick: 300, action: { type: 'assign', charId: 'sora', taskId: 'strip-beds' } },
    ];

    const rows = computeVariance(planned, timeline, log);
    const strip = rows.find((r) => r.taskId === 'strip-beds')!;
    expect(strip.plannedEnd).toBe(10);
    expect(strip.actualEnd).toBe(15);
    expect(strip.deltaEnd).toBe(5);
    expect(strip.overridden).toBe(true);

    const bath = rows.find((r) => r.taskId === 'clean-bathroom')!;
    expect(bath.deltaEnd).toBe(0);
    expect(bath.overridden).toBe(false);
  });

  it('leaves delta null when a task never ran, rather than inventing a number', () => {
    const planned = {
      timeline: [], completion: [], finishSimMinute: null, outcome: 'running' as const,
      taskWindows: { 'strip-beds': { start: 0, end: 600 } },
      unscheduled: [],
    };
    const rows = computeVariance(planned, [], []);
    const strip = rows.find((r) => r.taskId === 'strip-beds')!;
    expect(strip.actualEnd).toBeNull();
    expect(strip.deltaEnd).toBeNull();
    expect(varianceSummary(rows, []).neverHappened).toBe(1);
  });

  it('survives a run with no plan at all', () => {
    const rows = computeVariance(undefined, [seg('sora', 'strip-beds', 0, 600)], []);
    expect(rows.every((r) => r.plannedEnd === null)).toBe(true);
    expect(rows.every((r) => r.deltaEnd === null)).toBe(true);
  });
});

describe('against a real run', () => {
  it('the plan is optimistic once chaos is let back in', () => {
    // The whole point of the debrief: a plan built on a quiet morning meets a
    // noisy one, and the drift is what there is to talk about.
    const plan = goodPlan();
    const projection = projectPlan(42, plan);

    const s = createRun(42);
    s.plan = plan;
    for (let i = 0; i < SIM_DEADLINE_TICKS; i++) {
      const acts: LoggedAction['action'][] = [];
      for (const c of CHAR_IDS) {
        const a = s.chars[c].activity;
        if (a === 'distracted' || a === 'oncall') acts.push({ type: 'nudge', charId: c });
      }
      step(s, acts);
      if (s.outcome !== 'running') break;
    }

    const rows = computeVariance(projection, s.timeline, s.actionLog);
    const summary = varianceSummary(rows, s.actionLog);

    expect(summary.comparedCount).toBeGreaterThan(10);
    // Nudges are player actions, so an attentive run has overrides by definition.
    expect(summary.overrideCount).toBeGreaterThan(0);
    // And reality ran later than the quiet projection, on average.
    expect(summary.meanDrift).toBeGreaterThan(0);
  });
});
