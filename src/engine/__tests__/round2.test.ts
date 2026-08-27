// Round-2 mechanics: vacuum contention, shopping-list gating, cat/spill/music
// events, doorbell, and post-rework re-locking.

import { describe, expect, it } from 'vitest';
import { createRun } from '../init';
import { personalMult, step } from '../step';
import { deserialize, serialize } from '../serialize';
import {
  INTERRUPT_MAX_TICKS,
  MUSIC_BOOST,
  NO_LIST_MULT,
  TRANSIT_TICKS,
  VACUUM_PENALTY,
} from '../content';
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

describe('vacuum contention', () => {
  it('the second simultaneous vacuum task runs at the penalty rate', () => {
    const s = createRun(7, quiet);
    // Unlock bedrooms.
    run(s, 1, [{ type: 'assign', charId: 'sora', taskId: 'strip-beds' }]);
    run(s, 2000);
    expect(s.tasks['strip-beds'].status).toBe('done');
    run(s, 1, [
      { type: 'assign', charId: 'sora', taskId: 'clean-bedroom-1' },
      { type: 'assign', charId: 'mei', taskId: 'clean-bedroom-2' },
    ]);
    run(s, 40); // both arrived and working
    const mSora = personalMult(s, 'sora')!;
    const mMei = personalMult(s, 'mei')!;
    // Sora's task is earlier in TASKS order -> holds the vacuum. Both are
    // owners of their own rooms, so ownership cancels in the ratio.
    expect(mSora).toBeGreaterThan(mMei);
    expect(mMei / mSora).toBeCloseTo(VACUUM_PENALTY, 1);
  });

  it('a lone vacuum task pays no penalty', () => {
    const s = createRun(7, quiet);
    run(s, 1, [{ type: 'assign', charId: 'mei', taskId: 'clean-living-room' }]);
    run(s, 40);
    expect(personalMult(s, 'mei')).toBeCloseTo(0.5 + 0.5 * (10 / 240), 1); // just ramping
  });
});

describe('shopping list', () => {
  it('snack run is slow before the living room is cleaned, fast after', () => {
    const s = createRun(11, quiet);
    run(s, 1, [{ type: 'assign', charId: 'mei', taskId: 'buy-snacks' }]);
    run(s, 40);
    const before = personalMult(s, 'mei')!;
    expect(before).toBeCloseTo(1.4 * NO_LIST_MULT, 2); // travel: no ramp

    const t = createRun(11, quiet);
    t.tasks['clean-living-room'].workDone = t.tasks['clean-living-room'].workRequired - 1;
    run(t, 1, [{ type: 'assign', charId: 'sora', taskId: 'clean-living-room' }]);
    run(t, 200);
    expect(t.tasks['clean-living-room'].status).toBe('done');
    run(t, 1, [{ type: 'assign', charId: 'mei', taskId: 'buy-snacks' }]);
    run(t, 40);
    expect(personalMult(t, 'mei')).toBeCloseTo(1.4, 2);
  });
});

describe('new chaos events', () => {
  it('the cat un-cleans a finished living room and re-locks untouched successors', () => {
    const events: ScheduledEvent[] = [{ at: 500, type: 'cat' }];
    const s = createRun(13, { events });
    s.tasks['clean-living-room'].workDone = s.tasks['clean-living-room'].workRequired - 1;
    run(s, 1, [{ type: 'assign', charId: 'hana', taskId: 'clean-living-room' }]);
    run(s, 200);
    expect(s.tasks['clean-living-room'].status).toBe('done');
    run(s, 400);
    expect(s.tasks['clean-living-room'].status).toBe('open');
    expect(s.tasks['clean-living-room'].reworkCount).toBe(1);
  });

  it('a spill adds work to tidy-kitchen while it is not done', () => {
    const events: ScheduledEvent[] = [{ at: 100, type: 'spill' }];
    const s = createRun(17, { events });
    const before = s.tasks['tidy-kitchen'].workRequired;
    run(s, 200);
    expect(s.tasks['tidy-kitchen'].workRequired).toBe(before + 180);
  });

  it('music boosts everyone while it lasts', () => {
    const events: ScheduledEvent[] = [{ at: 300, type: 'music', duration: 360 }];
    const s = createRun(19, { events });
    s.tasks['fetch-car-a'].workRequired = 100000; // keep it running throughout
    run(s, 1, [{ type: 'assign', charId: 'kenji', taskId: 'fetch-car-a' }]);
    run(s, 250); // travel task, no ramp: mult = 1.3
    expect(personalMult(s, 'kenji')).toBeCloseTo(1.3, 2);
    run(s, 100); // music started at 300
    expect(personalMult(s, 'kenji')).toBeCloseTo(1.3 * MUSIC_BOOST, 2);
    run(s, 400); // music over
    expect(personalMult(s, 'kenji')).toBeCloseTo(1.3, 2);
  });

  it('an un-nudged interruption ends on its own after at most 5 sim-minutes', () => {
    const events: ScheduledEvent[] = [
      { at: 100, type: 'distraction', charId: 'mei', maxDuration: 8 * 60 },
    ];
    const s = createRun(31, { events });
    run(s, 1, [{ type: 'assign', charId: 'mei', taskId: 'strip-beds' }]);
    s.tasks['strip-beds'].workRequired = 100000; // keep the task alive
    run(s, 150);
    expect(s.chars.mei.activity).toBe('distracted');
    run(s, INTERRUPT_MAX_TICKS); // well past the cap, well short of 8 min
    expect(s.chars.mei.activity).toBe('working');
  });

  it('the doorbell traps a character until nudged', () => {
    const events: ScheduledEvent[] = [
      { at: 200, type: 'doorbell', charId: 'hana', duration: 1000 },
    ];
    const s = createRun(23, { events });
    run(s, 1, [{ type: 'assign', charId: 'hana', taskId: 'clean-bathroom' }]);
    run(s, 300);
    expect(s.chars.hana.activity).toBe('distracted');
    run(s, 1, [{ type: 'nudge', charId: 'hana' }]);
    run(s, 45);
    expect(s.chars.hana.activity === 'working' || s.chars.hana.activity === 'walking').toBe(
      true,
    );
  });
});

describe('timeline (Gantt source)', () => {
  it('records travel then work on the assigned task', () => {
    const s = createRun(41, quiet);
    run(s, 1, [{ type: 'assign', charId: 'hana', taskId: 'clean-bathroom' }]);
    s.tasks['clean-bathroom'].workRequired = 100000; // keep her on it
    run(s, 200);

    const hers = s.timeline.filter((t) => t.charId === 'hana');
    expect(hers.map((t) => t.kind)).toEqual(['travel', 'working']);
    expect(hers.every((t) => t.taskId === 'clean-bathroom')).toBe(true);
    // Travel is the fixed transit time; work runs to the current tick.
    expect(hers[0].end - hers[0].start).toBe(TRANSIT_TICKS);
    expect(hers[1].end).toBe(s.tick);
  });

  it('an interruption becomes a blocked span between two working spans', () => {
    const events: ScheduledEvent[] = [
      { at: 300, type: 'phone', charId: 'kenji', duration: 180 },
    ];
    const s = createRun(43, { events });
    run(s, 1, [{ type: 'assign', charId: 'kenji', taskId: 'clean-living-room' }]);
    s.tasks['clean-living-room'].workRequired = 100000;
    run(s, 700);

    const kinds = s.timeline.filter((t) => t.charId === 'kenji').map((t) => t.kind);
    expect(kinds).toEqual(['travel', 'working', 'blocked', 'working']);
    const blocked = s.timeline.find((t) => t.charId === 'kenji' && t.kind === 'blocked')!;
    expect(blocked.end - blocked.start).toBe(180);
  });

  it('spans never overlap and stay inside the elapsed run', () => {
    const s = createRun(47);
    run(s, 1, [
      { type: 'assign', charId: 'sora', taskId: 'strip-beds' },
      { type: 'assign', charId: 'mei', taskId: 'make-breakfast' },
      { type: 'assign', charId: 'taro', taskId: 'pack-bag-3' },
    ]);
    run(s, 3000);

    for (const c of ['sora', 'mei', 'taro'] as const) {
      const spans = s.timeline.filter((t) => t.charId === c);
      expect(spans.length).toBeGreaterThan(0);
      for (let i = 0; i < spans.length; i++) {
        expect(spans[i].end).toBeGreaterThan(spans[i].start);
        expect(spans[i].end).toBeLessThanOrEqual(s.tick);
        if (i > 0) expect(spans[i].start).toBeGreaterThanOrEqual(spans[i - 1].end);
      }
    }
  });

  it('survives a checkpoint round-trip and keeps extending the same span', () => {
    const s = createRun(53, quiet);
    run(s, 1, [{ type: 'assign', charId: 'mei', taskId: 'make-breakfast' }]);
    s.tasks['make-breakfast'].workRequired = 100000;
    run(s, 300);
    const before = s.timeline.length;

    const resumed = deserialize(serialize(s))!;
    expect(resumed).not.toBeNull();
    run(resumed, 100);

    // The open span was extended, not restarted — index-based, so JSON-safe.
    expect(resumed.timeline.length).toBe(before);
    const last = resumed.timeline[resumed.timeline.length - 1];
    expect(last.kind).toBe('working');
    expect(last.end).toBe(resumed.tick);
  });
});

describe('rework re-locking', () => {
  it('reopening the bathroom re-locks an untouched garbage task', () => {
    const events: ScheduledEvent[] = [
      { at: 3000, type: 'toilet', charId: 'taro', duration: 240 },
    ];
    const s = createRun(29, { events });
    // Force garbage's preds done.
    for (const id of ['tidy-kitchen', 'clean-bathroom', 'make-breakfast', 'eat-breakfast']) {
      s.tasks[id].status = 'done';
      s.tasks[id].workDone = s.tasks[id].workRequired;
    }
    run(s, 1);
    expect(s.tasks['garbage'].status).toBe('open');
    run(s, 3100);
    expect(s.tasks['clean-bathroom'].status).toBe('open'); // re-dirtied
    expect(s.tasks['garbage'].status).toBe('locked'); // re-locked
  });
});
