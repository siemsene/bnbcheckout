// The bathroom is a room, not just a task: while Taro is in it, it cannot be
// cleaned. Whoever was on it is turned out, and nobody can be put back on it
// until he is done — by hand, or by the plan dispatcher.

import { describe, expect, it } from 'vitest';
import { createRun } from '../init';
import { step } from '../step';
import { bathroomOccupied } from '../dispatch';
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

const emergency = (at: number, duration = 240): ScheduledEvent => ({
  at,
  type: 'toilet',
  charId: 'taro',
  duration,
});

describe('an occupied bathroom', () => {
  it('unassigns whoever is cleaning it the moment Taro goes in', () => {
    const s = createRun(61, { events: [emergency(200)] });
    run(s, 1, [{ type: 'assign', charId: 'hana', taskId: 'clean-bathroom' }]);
    run(s, 150);
    expect(s.tasks['clean-bathroom'].assignees).toEqual(['hana']);
    const done = s.tasks['clean-bathroom'].workDone;
    expect(done).toBeGreaterThan(0);

    const events = run(s, 60); // crosses tick 200
    expect(s.chars.taro.activity).toBe('toilet');
    expect(s.tasks['clean-bathroom'].assignees).toEqual([]);
    expect(s.chars.hana.taskId).toBeUndefined();
    expect(s.chars.hana.activity).toBe('idle');
    expect(
      events.some((e) => e.type === 'bubble' && e.textKey === 'bathroom-evicted'),
    ).toBe(true);
  });

  it('accrues no work while he is in there, whoever was on it', () => {
    const s = createRun(67, { events: [emergency(200)] });
    run(s, 1, [{ type: 'assign', charId: 'hana', taskId: 'clean-bathroom' }]);
    run(s, 220);
    const frozen = s.tasks['clean-bathroom'].workDone;
    run(s, 100); // still occupied
    expect(bathroomOccupied(s)).toBe(true);
    expect(s.tasks['clean-bathroom'].workDone).toBe(frozen);
  });

  it('rejects a new assignment until he is out, then allows it', () => {
    const s = createRun(71, { events: [emergency(200)] });
    run(s, 220);
    expect(bathroomOccupied(s)).toBe(true);

    const events = run(s, 1, [{ type: 'assign', charId: 'mei', taskId: 'clean-bathroom' }]);
    expect(s.tasks['clean-bathroom'].assignees).toEqual([]);
    expect(s.chars.mei.taskId).toBeUndefined();
    expect(
      events.some((e) => e.type === 'bubble' && e.textKey === 'bathroom-occupied'),
    ).toBe(true);

    run(s, 250); // emergency ends at 440
    expect(bathroomOccupied(s)).toBe(false);
    run(s, 1, [{ type: 'assign', charId: 'mei', taskId: 'clean-bathroom' }]);
    expect(s.tasks['clean-bathroom'].assignees).toEqual(['mei']);
  });

  it('turns Taro himself out if he was the one cleaning it', () => {
    const s = createRun(73, { events: [emergency(200)] });
    run(s, 1, [{ type: 'assign', charId: 'taro', taskId: 'clean-bathroom' }]);
    run(s, 250);
    expect(s.chars.taro.activity).toBe('toilet');
    expect(s.chars.taro.taskId).toBeUndefined();
    expect(s.tasks['clean-bathroom'].assignees).toEqual([]);
    // And he goes back to idle when the emergency ends, not to cleaning.
    run(s, 250);
    expect(s.chars.taro.activity).toBe('idle');
    expect(s.tasks['clean-bathroom'].assignees).toEqual([]);
  });

  it('makes the dispatcher move down the queue instead of waiting at the door', () => {
    const s = createRun(79, { events: [emergency(1, 600)] });
    s.plan = {
      rev: 1,
      queues: {
        sora: ['clean-bathroom', 'strip-beds'],
        kenji: [],
        mei: [],
        taro: [],
        hana: [],
      },
    };
    run(s, 60);
    expect(bathroomOccupied(s)).toBe(true);
    expect(s.chars.sora.taskId).toBe('strip-beds');
    expect(s.tasks['clean-bathroom'].assignees).toEqual([]);
  });
});
