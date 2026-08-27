// Personal errands: the per-character gate, their availability from tick 0,
// their parallelism with the final walkthrough, and the Imodium payoff.

import { describe, expect, it } from 'vitest';
import { createRun } from '../init';
import { step } from '../step';
import { TASKS, TASK_BY_ID } from '../content';
import type { Action, ScheduledEvent, SimEvent, SimState } from '../types';

function run(state: SimState, ticks: number, actions: Action[] = []): SimEvent[] {
  const all: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    const { events } = step(state, i === 0 ? actions : []);
    all.push(...events);
    if (state.outcome !== 'running') break;
  }
  return all;
}

const quiet = { events: [] as ScheduledEvent[] };
const ERRANDS = ['call-mom', 'buy-imodium', 'guest-book'] as const;

describe('personal errands', () => {
  it('are available from the very first tick, with no predecessors', () => {
    const s = createRun(11, quiet);
    for (const id of ERRANDS) {
      expect(TASK_BY_ID[id].preds).toBeUndefined();
      expect(s.tasks[id].status).toBe('open');
      // Short enough to fit inside the final walkthrough, which is the point.
      expect(TASK_BY_ID[id].baseMinutes).toBeLessThan(
        TASK_BY_ID['final-walkthrough'].baseMinutes,
      );
    }
  });

  it('refuse the wrong friend outright rather than stranding them', () => {
    const s = createRun(13, quiet);
    // Kenji is mid-trip fetching a car, then gets dropped on Mei's errand.
    run(s, 1, [{ type: 'assign', charId: 'kenji', taskId: 'fetch-car-a' }]);
    run(s, 120);
    const progress = s.tasks['fetch-car-a'].workDone;
    expect(progress).toBeGreaterThan(0);

    const events = run(s, 1, [{ type: 'assign', charId: 'kenji', taskId: 'call-mom' }]);

    // Rejected: he keeps his own task and its progress...
    expect(s.chars.kenji.taskId).toBe('fetch-car-a');
    expect(s.tasks['fetch-car-a'].workDone).toBeGreaterThanOrEqual(progress);
    // ...the errand's single slot stays free for the one person who can use it...
    expect(s.tasks['call-mom'].assignees).toEqual([]);
    // ...and he says why.
    expect(events.some((e) => e.type === 'bubble' && e.textKey === 'not-mine-kenji')).toBe(true);
  });

  it('the owner can actually finish theirs', () => {
    const s = createRun(17, quiet);
    run(s, 1, [{ type: 'assign', charId: 'mei', taskId: 'call-mom' }]);
    run(s, 1200);
    expect(s.tasks['call-mom'].status).toBe('done');
  });

  it('run in parallel with the walkthrough but still gate completion', () => {
    const s = createRun(19, quiet);
    // Everything except Hana's note is finished.
    for (const t of TASKS) {
      if (t.id === 'guest-book' || t.id === 'final-walkthrough') continue;
      s.tasks[t.id].status = 'done';
      s.tasks[t.id].workDone = s.tasks[t.id].workRequired;
    }
    run(s, 1);
    expect(s.tasks['final-walkthrough'].status).toBe('open'); // errand is not a pred

    run(s, 1, [{ type: 'assign', charId: 'sora', taskId: 'final-walkthrough' }]);
    run(s, 1500);
    expect(s.tasks['final-walkthrough'].status).toBe('done');
    // The walkthrough is done, but the run is not: the errand still gates it.
    expect(s.outcome).toBe('running');

    run(s, 1, [{ type: 'assign', charId: 'hana', taskId: 'guest-book' }]);
    run(s, 1200);
    expect(s.outcome).toBe('finished');
  });
});

describe('imodium', () => {
  const emergency = (at: number, skippable: boolean): ScheduledEvent => ({
    at,
    type: 'toilet',
    charId: 'taro',
    duration: 240,
    skippableByImodium: skippable,
  });

  it('a skippable emergency still fires when Taro has not been to the pharmacy', () => {
    const s = createRun(23, { events: [emergency(200, true)] });
    run(s, 260);
    expect(s.chars.taro.activity).toBe('toilet');
  });

  it('is headed off once the pharmacy run is done, leaving the bathroom alone', () => {
    const s = createRun(29, { events: [emergency(200, true)] });
    s.tasks['buy-imodium'].status = 'done';
    s.tasks['buy-imodium'].workDone = s.tasks['buy-imodium'].workRequired;
    // Give the bathroom some progress so a re-dirtying would be visible.
    s.tasks['clean-bathroom'].workDone = 500;

    const events = run(s, 260);
    expect(s.chars.taro.activity).not.toBe('toilet');
    expect(s.tasks['clean-bathroom'].workDone).toBe(500);
    expect(s.tasks['clean-bathroom'].reworkCount).toBe(0);
    expect(events.some((e) => e.type === 'bubble' && e.textKey === 'imodium-holding')).toBe(true);
  });

  it('does not protect against a stubborn emergency — it cuts most, not all', () => {
    const s = createRun(31, { events: [emergency(200, false)] });
    s.tasks['buy-imodium'].status = 'done';
    s.tasks['buy-imodium'].workDone = s.tasks['buy-imodium'].workRequired;
    run(s, 260);
    expect(s.chars.taro.activity).toBe('toilet');
  });
});
