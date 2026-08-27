import { describe, expect, it } from 'vitest';
import { createRun } from '../init';
import { step } from '../step';
import { serialize, deserialize } from '../serialize';
import { avgUtilization, pctComplete, summarize } from '../scoring';
import { mulberry32 } from '../rng';
import {
  CHAR_IDS,
  LEARNING_RAMP_TICKS,
  SIM_DEADLINE_TICKS,
  TASKS,
  TASK_BY_ID,
} from '../content';
import type { Action, ScheduledEvent, SimEvent, SimState } from '../types';

/** Run N ticks, applying actions only on the first tick. Collects events. */
function run(state: SimState, ticks: number, actions: Action[] = []): SimEvent[] {
  const all: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    const { events } = step(state, i === 0 ? actions : []);
    all.push(...events);
    if (state.outcome !== 'running') break;
  }
  return all;
}

const quiet = { events: [] as ScheduledEvent[] }; // no chaos, for clean measurements

describe('determinism', () => {
  it('same seed + same action script => identical states', () => {
    const script = (s: SimState) => {
      const acts: Record<number, Action[]> = {
        1: [
          { type: 'assign', charId: 'mei', taskId: 'make-breakfast' },
          { type: 'assign', charId: 'sora', taskId: 'strip-beds' },
          { type: 'assign', charId: 'hana', taskId: 'clean-bathroom' },
          { type: 'assign', charId: 'kenji', taskId: 'fetch-car-a' },
          { type: 'assign', charId: 'taro', taskId: 'clean-living-room' },
        ],
        3000: [{ type: 'assign', charId: 'taro', taskId: 'pack-bag-3' }],
        4000: [{ type: 'nudge', charId: 'mei' }],
      };
      for (let i = 0; i < 6000; i++) {
        step(s, acts[s.tick + 1] ?? []);
        if (s.outcome !== 'running') break;
      }
      return s;
    };
    const a = script(createRun(42));
    const b = script(createRun(42));
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });

  it('different seeds give different task durations', () => {
    const a = createRun(1);
    const b = createRun(2);
    const diffs = TASKS.filter(
      (t) => a.tasks[t.id].workRequired !== b.tasks[t.id].workRequired,
    );
    expect(diffs.length).toBeGreaterThan(10);
  });
});

describe('precedence', () => {
  it('locked tasks reject assignment and never accrue before preds are done', () => {
    const s = createRun(7, quiet);
    run(s, 1, [{ type: 'assign', charId: 'sora', taskId: 'eat-breakfast' }]);
    expect(s.tasks['eat-breakfast'].assignees).toHaveLength(0);
    expect(s.tasks['eat-breakfast'].status).toBe('locked');
  });

  it('property: no task is ever done before all its predecessors', () => {
    const rng = mulberry32(99);
    const s = createRun(99);
    const taskIds = TASKS.map((t) => t.id);
    for (let i = 0; i < SIM_DEADLINE_TICKS; i++) {
      const actions: Action[] = [];
      if (i % 120 === 0) {
        const char = CHAR_IDS[rng.int(0, 4)];
        const t = taskIds[rng.int(0, taskIds.length - 1)];
        actions.push(
          rng.next() < 0.8
            ? { type: 'assign', charId: char, taskId: t }
            : { type: 'unassign', charId: char },
        );
      }
      step(s, actions);
      for (const t of TASKS) {
        const ts = s.tasks[t.id];
        if (ts.status === 'done' || ts.workDone > 0) {
          for (const p of t.preds ?? []) {
            expect(s.tasks[p].status, `${t.id} progressed before ${p}`).toBe('done');
          }
          if (t.predsAny) {
            expect(t.predsAny.some((p) => s.tasks[p].status === 'done')).toBe(true);
          }
        }
      }
      if (s.outcome !== 'running') break;
    }
  });

  it('loading is car-specific: car A needs bags 1+2 and car A fetched', () => {
    const s = createRun(5, quiet);
    for (const id of ['pack-bag-1', 'pack-bag-2']) {
      s.tasks[id].workDone = s.tasks[id].workRequired - 1;
    }
    run(s, 1, [{ type: 'assign', charId: 'sora', taskId: 'pack-bag-1' }]);
    run(s, 200);
    run(s, 1, [{ type: 'assign', charId: 'sora', taskId: 'pack-bag-2' }]);
    run(s, 200);
    expect(s.tasks['load-car-a'].status).toBe('locked'); // no car yet
    run(s, 1, [{ type: 'assign', charId: 'kenji', taskId: 'fetch-car-a' }]);
    run(s, 2000);
    expect(s.tasks['fetch-car-a'].status).toBe('done');
    expect(s.tasks['load-car-a'].status).toBe('open');
    // Car B's load stays locked: bag 3 and snacks and car B are all missing.
    expect(s.tasks['load-car-b'].status).toBe('locked');
  });
});

describe('learning curve', () => {
  it('ramps from ~50% to 100% over 4 sim-minutes on normal tasks', () => {
    const s = createRun(11, quiet);
    run(s, 1, [{ type: 'assign', charId: 'sora', taskId: 'clean-living-room' }]);
    run(s, 30); // transit
    const w0 = s.tasks['clean-living-room'].workDone;
    run(s, 10);
    const earlyRate = (s.tasks['clean-living-room'].workDone - w0) / 10;
    run(s, LEARNING_RAMP_TICKS + 20);
    const w1 = s.tasks['clean-living-room'].workDone;
    run(s, 10);
    const lateRate = (s.tasks['clean-living-room'].workDone - w1) / 10;
    expect(earlyRate).toBeGreaterThan(0.45);
    expect(earlyRate).toBeLessThan(0.62);
    expect(lateRate).toBeGreaterThan(0.95);
    expect(lateRate).toBeLessThanOrEqual(1.01);
  });

  it('travel tasks have no ramp (full rate immediately after transit)', () => {
    const s = createRun(11, quiet);
    run(s, 1, [{ type: 'assign', charId: 'kenji', taskId: 'fetch-car-a' }]);
    run(s, 31);
    const w0 = s.tasks['fetch-car-a'].workDone;
    run(s, 10);
    const rate = (s.tasks['fetch-car-a'].workDone - w0) / 10;
    expect(rate).toBeCloseTo(1.3, 1); // kenji's driving mult, no ramp
  });
});

describe('travel abandon', () => {
  it('unassigning mid-fetch resets progress and makes the walker unavailable', () => {
    const s = createRun(13, quiet);
    run(s, 1, [{ type: 'assign', charId: 'kenji', taskId: 'fetch-car-a' }]);
    run(s, 300);
    expect(s.tasks['fetch-car-a'].workDone).toBeGreaterThan(100);
    run(s, 1, [{ type: 'unassign', charId: 'kenji' }]);
    expect(s.tasks['fetch-car-a'].workDone).toBe(0);
    expect(s.chars.kenji.activity).toBe('walkback');
    expect(s.chars.kenji.unavailableUntil).toBeGreaterThan(s.tick + 60);
    // He cannot contribute anywhere while walking back.
    run(s, 1, [{ type: 'assign', charId: 'kenji', taskId: 'clean-living-room' }]);
    run(s, 30);
    expect(s.tasks['clean-living-room'].workDone).toBe(0);
  });
});

describe('hard resource constraint: driving license', () => {
  it('unlicensed characters emit a bubble and contribute nothing to fetch-car', () => {
    const s = createRun(17, quiet);
    const events = run(s, 1, [{ type: 'assign', charId: 'mei', taskId: 'fetch-car-a' }]);
    expect(events.some((e) => e.type === 'bubble' && e.textKey === 'no-license-mei')).toBe(
      true,
    );
    run(s, 400);
    expect(s.tasks['fetch-car-a'].workDone).toBe(0);
  });
});

describe('multi-worker efficiency', () => {
  it('two neutral workers produce ~1.7x the rate of one', () => {
    // sora + mei on strip-beds (neither has cleaning/pairing modifiers)
    const one = createRun(23, quiet);
    run(one, 1, [{ type: 'assign', charId: 'sora', taskId: 'strip-beds' }]);
    run(one, 30 + LEARNING_RAMP_TICKS); // past ramp
    const w0 = one.tasks['strip-beds'].workDone;
    run(one, 50);
    const rate1 = (one.tasks['strip-beds'].workDone - w0) / 50;

    const two = createRun(23, quiet);
    run(two, 1, [
      { type: 'assign', charId: 'sora', taskId: 'strip-beds' },
      { type: 'assign', charId: 'mei', taskId: 'strip-beds' },
    ]);
    run(two, 30 + LEARNING_RAMP_TICKS);
    const v0 = two.tasks['strip-beds'].workDone;
    run(two, 50);
    const rate2 = (two.tasks['strip-beds'].workDone - v0) / 50;

    expect(rate2 / rate1).toBeGreaterThan(1.6);
    expect(rate2 / rate1).toBeLessThan(1.8);
  });

  it('maxWorkers is enforced', () => {
    const s = createRun(29, quiet);
    run(s, 1, [
      { type: 'assign', charId: 'sora', taskId: 'clean-bathroom' },
      { type: 'assign', charId: 'mei', taskId: 'clean-bathroom' },
    ]);
    expect(s.tasks['clean-bathroom'].assignees).toEqual(['sora']);
  });
});

describe('soft constraints', () => {
  it('Mei cooks much faster than Kenji', () => {
    const mei = createRun(31, quiet);
    run(mei, 1, [{ type: 'assign', charId: 'mei', taskId: 'make-breakfast' }]);
    run(mei, 500);
    const kenji = createRun(31, quiet);
    run(kenji, 1, [{ type: 'assign', charId: 'kenji', taskId: 'make-breakfast' }]);
    run(kenji, 500);
    expect(mei.tasks['make-breakfast'].workDone).toBeGreaterThan(
      kenji.tasks['make-breakfast'].workDone * 3,
    );
  });

  it('Taro slows down when someone joins him; Hana speeds up', () => {
    const taroAlone = createRun(37, quiet);
    run(taroAlone, 1, [{ type: 'assign', charId: 'taro', taskId: 'clean-living-room' }]);
    run(taroAlone, 30 + LEARNING_RAMP_TICKS);
    const t0 = taroAlone.tasks['clean-living-room'].workDone;
    run(taroAlone, 100);
    const rateAlone = (taroAlone.tasks['clean-living-room'].workDone - t0) / 100;

    const pair = createRun(37, quiet);
    run(pair, 1, [
      { type: 'assign', charId: 'taro', taskId: 'clean-living-room' },
      { type: 'assign', charId: 'hana', taskId: 'clean-living-room' },
    ]);
    run(pair, 30 + LEARNING_RAMP_TICKS);
    const p0 = pair.tasks['clean-living-room'].workDone;
    run(pair, 100);
    const ratePair = (pair.tasks['clean-living-room'].workDone - p0) / 100;

    // pair rate = (taro 0.7 + hana 1.5*1.25) * 1.7/2 = 2.19 vs taro alone 1.0
    expect(ratePair / rateAlone).toBeGreaterThan(1.9);
    expect(ratePair / rateAlone).toBeLessThan(2.5);
  });
});

describe('eat breakfast synchronization', () => {
  function finishBreakfastPrep(s: SimState) {
    run(s, 1, [
      { type: 'assign', charId: 'mei', taskId: 'make-breakfast' },
      { type: 'assign', charId: 'sora', taskId: 'make-breakfast' },
    ]);
    run(s, 2500);
    expect(s.tasks['make-breakfast'].status).toBe('done');
  }

  it('requires all five present to progress', () => {
    const s = createRun(41, quiet);
    finishBreakfastPrep(s);
    const four: Action[] = (['sora', 'kenji', 'mei', 'taro'] as const).map((c) => ({
      type: 'assign',
      charId: c,
      taskId: 'eat-breakfast',
    }));
    run(s, 1, four);
    run(s, 300);
    expect(s.tasks['eat-breakfast'].workDone).toBe(0);
    run(s, 1, [{ type: 'assign', charId: 'hana', taskId: 'eat-breakfast' }]);
    run(s, 100);
    expect(s.tasks['eat-breakfast'].workDone).toBeGreaterThan(0);
  });

  it('skipping breakfast makes everyone slower after sim-minute 60', () => {
    const s = createRun(43, quiet);
    s.tasks['clean-living-room'].workRequired = 100000; // keep it running past t=60
    run(s, 1, [{ type: 'assign', charId: 'sora', taskId: 'clean-living-room' }]);
    // Warp to just before the hangry threshold, past ramp.
    run(s, 3500);
    const w0 = s.tasks['clean-living-room'].workDone;
    run(s, 50);
    const before = (s.tasks['clean-living-room'].workDone - w0) / 50;
    run(s, 100); // crosses tick 3600
    const w1 = s.tasks['clean-living-room'].workDone;
    run(s, 50);
    const after = (s.tasks['clean-living-room'].workDone - w1) / 50;
    expect(after / before).toBeCloseTo(0.8, 1);
  });
});

describe('rework', () => {
  it("Taro's toilet emergency re-dirties a cleaned bathroom", () => {
    const events: ScheduledEvent[] = [
      { at: 1500, type: 'toilet', charId: 'taro', duration: 240 },
    ];
    const s = createRun(47, { events });
    run(s, 1, [{ type: 'assign', charId: 'hana', taskId: 'clean-bathroom' }]);
    run(s, 1200);
    expect(s.tasks['clean-bathroom'].status).toBe('done');
    const evs = run(s, 400);
    expect(s.tasks['clean-bathroom'].status).toBe('open');
    expect(s.tasks['clean-bathroom'].reworkCount).toBe(1);
    expect(s.tasks['clean-bathroom'].workDone).toBeLessThan(
      s.tasks['clean-bathroom'].workRequired,
    );
    expect(evs.some((e) => e.type === 'rework' && e.taskId === 'clean-bathroom')).toBe(true);
    expect(s.chars.taro.activity === 'toilet' || s.chars.taro.unavailableUntil > 1500).toBe(
      true,
    );
  });

  it('Hana finding a forgotten item reopens a packed bag with extra work', () => {
    const s = createRun(53, {
      events: [],
      rolls: { foundItemRolls: { 'clean-bedroom-2': 0.5 } as Record<string, number> },
    });
    // Merge partial roll override cleanly (createRun spread replaces whole map).
    s.rolls.foundItemRolls['clean-bedroom-2'] = 0.5; // < 0.65 (Hana) but > 0.25 (others)
    // Pack Mei's bag first.
    run(s, 1, [
      { type: 'assign', charId: 'mei', taskId: 'pack-bag-2' },
      { type: 'assign', charId: 'sora', taskId: 'strip-beds' },
    ]);
    run(s, 1500);
    expect(s.tasks['pack-bag-2'].status).toBe('done');
    expect(s.tasks['strip-beds'].status).toBe('done');
    const reqBefore = s.tasks['pack-bag-2'].workRequired;
    // Hana cleans Mei's room -> finds the item.
    run(s, 1, [{ type: 'assign', charId: 'hana', taskId: 'clean-bedroom-2' }]);
    const evs = run(s, 1500);
    expect(s.tasks['clean-bedroom-2'].status).toBe('done');
    expect(s.tasks['pack-bag-2'].status).toBe('open');
    expect(s.tasks['pack-bag-2'].workRequired).toBeGreaterThan(reqBefore);
    expect(evs.some((e) => e.type === 'rework' && e.taskId === 'pack-bag-2')).toBe(true);
  });

  it('a non-Hana cleaner with the same roll does NOT find the item', () => {
    const s = createRun(53, { events: [] });
    s.rolls.foundItemRolls['clean-bedroom-2'] = 0.5;
    run(s, 1, [
      { type: 'assign', charId: 'mei', taskId: 'pack-bag-2' },
      { type: 'assign', charId: 'sora', taskId: 'strip-beds' },
    ]);
    run(s, 1500);
    run(s, 1, [{ type: 'assign', charId: 'kenji', taskId: 'clean-bedroom-2' }]);
    run(s, 2500);
    expect(s.tasks['clean-bedroom-2'].status).toBe('done');
    expect(s.tasks['pack-bag-2'].status).toBe('done');
  });
});

describe('interruptions & nudge', () => {
  it('a phone call stops work; a nudge means Sora walks over, chats, and walks back', () => {
    const events: ScheduledEvent[] = [
      { at: 600, type: 'phone', charId: 'kenji', duration: 1200 },
    ];
    const s = createRun(59, { events });
    s.tasks['strip-beds'].workRequired = 100000; // Sora's task must outlast the test
    run(s, 1, [
      { type: 'assign', charId: 'kenji', taskId: 'clean-living-room' },
      { type: 'assign', charId: 'sora', taskId: 'strip-beds' },
    ]);
    run(s, 650);
    expect(s.chars.kenji.activity).toBe('oncall');
    const w0 = s.tasks['clean-living-room'].workDone;
    run(s, 50);
    expect(s.tasks['clean-living-room'].workDone).toBe(w0);

    const stripBefore = s.tasks['strip-beds'].workDone;
    run(s, 1, [{ type: 'nudge', charId: 'kenji' }]);
    // Not instant: Sora is walking over; Kenji still on the phone.
    expect(s.nudge).not.toBeNull();
    expect(s.chars.kenji.activity).toBe('oncall');
    run(s, 45); // > NUDGE_WALK_TICKS
    expect(s.nudge).toBeNull();
    expect(s.chars.kenji.activity).toBe('working');
    run(s, 20);
    expect(s.tasks['clean-living-room'].workDone).toBeGreaterThan(w0);
    // Sora produced nothing during the walk+chat, and needs to walk back.
    expect(s.tasks['strip-beds'].workDone).toBe(stripBefore);
    const stripMid = s.tasks['strip-beds'].workDone;
    run(s, 80); // walk back + resume
    expect(s.tasks['strip-beds'].workDone).toBeGreaterThan(stripMid);
  });

  it('a second nudge while Sora is en route is ignored', () => {
    const events: ScheduledEvent[] = [
      { at: 300, type: 'distraction', charId: 'mei', maxDuration: 2000 },
      { at: 300, type: 'phone', charId: 'kenji', duration: 2000 },
    ];
    const s = createRun(62, { events });
    run(s, 350);
    run(s, 1, [{ type: 'nudge', charId: 'mei' }]);
    const firstTarget = s.nudge?.target;
    run(s, 1, [{ type: 'nudge', charId: 'kenji' }]);
    expect(s.nudge?.target).toBe(firstTarget);
    expect(s.chars.kenji.activity).toBe('oncall'); // untouched
  });

  it('distraction auto-expires after its max duration if never nudged', () => {
    const events: ScheduledEvent[] = [
      { at: 300, type: 'distraction', charId: 'mei', maxDuration: 480 },
    ];
    const s = createRun(61, { events });
    run(s, 1, [{ type: 'assign', charId: 'mei', taskId: 'make-breakfast' }]);
    run(s, 350);
    expect(s.chars.mei.activity).toBe('distracted');
    run(s, 500);
    expect(s.chars.mei.activity).toBe('working');
  });
});

describe('serialization', () => {
  it('serialize -> deserialize -> continue === continue', () => {
    const a = createRun(67);
    run(a, 1, [
      { type: 'assign', charId: 'mei', taskId: 'make-breakfast' },
      { type: 'assign', charId: 'hana', taskId: 'clean-bathroom' },
    ]);
    run(a, 1000);
    const b = deserialize(serialize(a))!;
    expect(b).not.toBeNull();
    const later: Action[] = [{ type: 'assign', charId: 'kenji', taskId: 'fetch-car-a' }];
    run(a, 1, later);
    run(a, 1000);
    run(b, 1, later);
    run(b, 1000);
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });
});

describe('end conditions & scoring', () => {
  it('hits the deadline outcome when nothing is done', () => {
    const s = createRun(71, quiet);
    run(s, SIM_DEADLINE_TICKS + 10);
    expect(s.outcome).toBe('deadline');
    expect(pctComplete(s)).toBeLessThan(0.05);
    expect(summarize(s).finishSimMinute).toBeNull();
  });

  it('utilization series is consistent with busyTicks', () => {
    const s = createRun(73, quiet);
    run(s, 1, [{ type: 'assign', charId: 'sora', taskId: 'clean-living-room' }]);
    run(s, 600);
    const soraIdx = CHAR_IDS.indexOf('sora');
    const seriesSum = s.utilization[soraIdx].reduce((x, y) => x + y, 0) * 60;
    expect(Math.abs(seriesSum - s.chars.sora.busyTicks)).toBeLessThanOrEqual(60);
    expect(avgUtilization(s)).toBeGreaterThan(0);
  });

  it('a well-parallelized plan finishes before the deadline', () => {
    const s = createRun(79); // WITH chaos events — realistic
    const plan: Record<number, Action[]> = {
      1: [
        { type: 'assign', charId: 'mei', taskId: 'make-breakfast' },
        { type: 'assign', charId: 'kenji', taskId: 'fetch-car-a' },
        { type: 'assign', charId: 'sora', taskId: 'strip-beds' },
        { type: 'assign', charId: 'taro', taskId: 'clean-living-room' },
        { type: 'assign', charId: 'hana', taskId: 'clean-bathroom' },
      ],
    };
    const pending: Action[] = [];
    for (let i = 0; i < SIM_DEADLINE_TICKS; i++) {
      const actions = [...(plan[s.tick + 1] ?? []), ...pending.splice(0)];
      step(s, actions);
      if (s.outcome !== 'running') break;

      // Simple reactive player: nudge anyone stuck, keep idle people busy.
      if (s.tick % 60 === 0) {
        for (const c of CHAR_IDS) {
          if (s.chars[c].activity === 'distracted' || s.chars[c].activity === 'oncall') {
            pending.push({ type: 'nudge', charId: c });
          }
        }
        const makeDone = s.tasks['make-breakfast'].status === 'done';
        const eatDone = s.tasks['eat-breakfast'].status === 'done';
        if (makeDone && !eatDone) {
          for (const c of CHAR_IDS) {
            // Don't abandon a travel task to eat — that wipes its progress.
            const onTrip = s.chars[c].taskId && TASK_BY_ID[s.chars[c].taskId!].travel;
            if (
              s.chars[c].taskId !== 'eat-breakfast' &&
              s.chars[c].activity !== 'walkback' &&
              !onTrip
            ) {
              pending.push({ type: 'assign', charId: c, taskId: 'eat-breakfast' });
            }
          }
        } else {
          for (const c of CHAR_IDS) {
            if (s.chars[c].activity === 'idle' && s.chars[c].unavailableUntil <= s.tick) {
              const open = TASKS.filter(
                (t) =>
                  s.tasks[t.id].status === 'open' &&
                  s.tasks[t.id].assignees.length <
                    Math.min(1, TASK_BY_ID[t.id].maxWorkers) &&
                  (!t.requiresLicense || (c === 'kenji' || c === 'hana')) &&
                  // Without this the filler jams on an errand it cannot do.
                  (!t.onlyChars || t.onlyChars.includes(c)),
              );
              if (open.length) {
                pending.push({ type: 'assign', charId: c, taskId: open[0].id });
              }
            }
          }
        }
      }
    }
    expect(s.outcome).toBe('finished');
    expect(s.tick).toBeLessThan(SIM_DEADLINE_TICKS);
  }, 30000);
});
