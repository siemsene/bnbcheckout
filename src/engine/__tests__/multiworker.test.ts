// Two friends on one job.
//
// The planning board can now put a second person on a job that has room, and
// the whole crew on one that demands it. None of that needed an engine change —
// the dispatcher already fills empty hands up to `maxWorkers` and seats a crew
// barrier when everyone is free at once — so what is pinned here is the
// BEHAVIOUR the board now promises, which was previously unreachable from the
// UI and therefore untested.
//
// Pairing tests use Sora and Kenji deliberately: neither has a `pairedMult` or
// `aloneMult`, so "two are faster than one" measures the crew factor and
// nothing else. Taro (0.7 paired) and Hana (1.25 paired, 0.8 alone) would make
// the same assertion mean something quite different.

import { describe, expect, it } from 'vitest';
import { createRun } from '../init';
import { step } from '../step';
import { checkPlan } from '../planCheck';
import { MANUAL_SLACK_MIN, deriveSlack, pruneSlack } from '../slack';
import { projectPlan } from '../project';
import { CHAR_IDS, SIM_DEADLINE_TICKS, TICKS_PER_MINUTE } from '../content';
import type { CharId, Plan, SimState, SlackWindow } from '../types';

const emptyQueues = () =>
  Object.fromEntries(CHAR_IDS.map((c) => [c, [] as string[]])) as Record<CharId, string[]>;

const plan = (queues: Partial<Record<CharId, string[]>>): Plan => ({
  queues: { ...emptyQueues(), ...queues },
  rev: 1,
});

/** First tick this friend was actually working the job, per the projection. */
const firstWorked = (
  p: ReturnType<typeof projectPlan>,
  charId: CharId,
  taskId: string,
): number | null => {
  const segs = p.timeline.filter(
    (s) => s.charId === charId && s.taskId === taskId && s.kind === 'working',
  );
  return segs.length === 0 ? null : Math.min(...segs.map((s) => s.start));
};

describe('sharing a job between two friends', () => {
  it('puts both of them on it, and it finishes sooner than alone', () => {
    // strip-beds: maxWorkers 2, no predecessors, default crew factors.
    const solo = projectPlan(42, plan({ sora: ['strip-beds'] }));
    const pair = projectPlan(42, plan({ sora: ['strip-beds'], kenji: ['strip-beds'] }));

    expect(pair.taskWindows['strip-beds']!.end).toBeLessThan(
      solo.taskWindows['strip-beds']!.end,
    );
    expect(firstWorked(pair, 'sora', 'strip-beds')).not.toBeNull();
    expect(firstWorked(pair, 'kenji', 'strip-beds')).not.toBeNull();
  });

  it('a helper joins only for the time they are available', () => {
    // Mei owes her mother a call first (hers alone, no predecessors), so she
    // arrives at the shared job late. This is the semantics the board draws:
    // the helper's bar starts when THEY come free, not when the job started.
    const p = projectPlan(
      42,
      plan({ sora: ['strip-beds'], mei: ['call-mom', 'strip-beds'] }),
    );

    const sora = firstWorked(p, 'sora', 'strip-beds')!;
    const mei = firstWorked(p, 'mei', 'strip-beds');
    expect(mei).not.toBeNull();
    expect(mei!).toBeGreaterThan(sora);
    // No barrier on an ordinary job: it started with whoever got there first.
    expect(p.taskWindows['strip-beds']!.start).toBeLessThanOrEqual(mei!);
    // And they finish together — nobody is pulled off early.
    const end = (c: CharId) =>
      Math.max(
        ...p.timeline
          .filter((s) => s.charId === c && s.taskId === 'strip-beds')
          .map((s) => s.end),
      );
    expect(end('mei')).toBe(end('sora'));
  });

  it('a helper who comes free too late never works it at all', () => {
    // Kenji does the job early; Mei has half a morning queued in front of it.
    // The job still gets done, she simply is not needed — which is why the
    // board draws "done without them" instead of a red "never starts".
    const p = projectPlan(
      42,
      plan({
        kenji: ['strip-beds'],
        mei: ['call-mom', 'clean-bedroom-2', 'pack-bag-2', 'strip-beds'],
      }),
    );

    expect(p.taskWindows['strip-beds']).not.toBeNull();
    expect(firstWorked(p, 'kenji', 'strip-beds')).not.toBeNull();
    expect(firstWorked(p, 'mei', 'strip-beds')).toBeNull();
    expect(p.unscheduled).not.toContain('strip-beds');
  });

  it('never seats more than the job has room for, and does reach the cap', () => {
    // The existing maxWorkers test uses a one-person job, where the cap can be
    // respected without ever being approached. A two-person job checks both.
    const s: SimState = createRun(42, { events: [] });
    s.plan = plan({
      sora: ['strip-beds'],
      kenji: ['strip-beds'],
      mei: ['strip-beds'],
      taro: ['strip-beds'],
      hana: ['strip-beds'],
    });

    let peak = 0;
    for (let i = 0; i < 900; i++) {
      step(s);
      peak = Math.max(peak, s.tasks['strip-beds'].assignees.length);
      expect(s.tasks['strip-beds'].assignees.length).toBeLessThanOrEqual(2);
      if (s.tasks['strip-beds'].status === 'done') break;
    }
    expect(peak).toBe(2); // the cap was reached, so the ceiling means something
  });
});

describe('a job that needs the whole crew', () => {
  /** What the board's "add all five" builds: the crew job at the front of every lane. */
  const breakfastForEveryone = () =>
    plan({
      mei: ['eat-breakfast', 'make-breakfast'],
      sora: ['eat-breakfast', 'strip-beds'],
      kenji: ['eat-breakfast', 'fetch-car-a'],
      taro: ['eat-breakfast', 'clean-living-room'],
      hana: ['eat-breakfast', 'guest-book'],
    });

  it('fires when all five are down for it, and everyone works it', () => {
    const p = projectPlan(42, breakfastForEveryone());
    const window = p.taskWindows['eat-breakfast'];
    expect(window).not.toBeNull();

    for (const c of CHAR_IDS) {
      const started = firstWorked(p, c, 'eat-breakfast');
      expect(started).not.toBeNull();
      expect(started!).toBeLessThan(window!.end);
    }
    // It unblocks what waits on it, which is the point of getting it done.
    expect(p.unscheduled).not.toContain('eat-breakfast');
  });

  it('putting it at the front of every lane does not stall the cook', () => {
    // The barrier sits ahead of `make-breakfast` in Mei's own lane. A locked
    // job is skipped rather than waited on, so she cooks and the crew eats.
    const s: SimState = createRun(42, { events: [] });
    s.plan = breakfastForEveryone();
    for (let i = 0; i < SIM_DEADLINE_TICKS; i++) {
      step(s);
      if (s.tasks['eat-breakfast'].status === 'done') break;
    }
    expect(s.tasks['make-breakfast'].status).toBe('done');
    expect(s.tasks['eat-breakfast'].status).toBe('done');
  });

  it('is reported as unsatisfiable when only four are down for it', () => {
    const four = plan({
      mei: ['make-breakfast', 'eat-breakfast'],
      sora: ['eat-breakfast'],
      kenji: ['eat-breakfast'],
      taro: ['eat-breakfast'],
    });
    expect(checkPlan(four).some((i) => i.key === 'barrier:eat-breakfast')).toBe(true);
    expect(projectPlan(42, four).unscheduled).toContain('eat-breakfast');
  });
});

describe('checkPlan and crew size', () => {
  it('says nothing about two people on a two-person job', () => {
    const issues = checkPlan(plan({ sora: ['strip-beds'], kenji: ['strip-beds'] }));
    expect(issues.some((i) => i.key === 'crowded:strip-beds')).toBe(false);
  });

  it('warns, but does not error, when more sign up than fit', () => {
    const issues = checkPlan(
      plan({ sora: ['strip-beds'], kenji: ['strip-beds'], mei: ['strip-beds'] }),
    );
    const crowded = issues.filter((i) => i.key === 'crowded:strip-beds');
    expect(crowded).toHaveLength(1);
    expect(crowded[0].level).toBe('warn');
    expect(crowded[0].text).toContain('One of them');
  });

  it('clears the crew-barrier error once all five are down for breakfast', () => {
    const five = plan({
      mei: ['eat-breakfast', 'make-breakfast'],
      sora: ['eat-breakfast'],
      kenji: ['eat-breakfast'],
      taro: ['eat-breakfast'],
      hana: ['eat-breakfast'],
    });
    const issues = checkPlan(five);
    expect(issues.some((i) => i.key === 'barrier:eat-breakfast')).toBe(false);
    expect(issues.some((i) => i.key === 'crowded:eat-breakfast')).toBe(false);
  });

  it('gives every issue a unique key, since the board renders them by key', () => {
    const issues = checkPlan(
      plan({ sora: ['strip-beds'], kenji: ['strip-beds'], mei: ['strip-beds'] }),
    );
    expect(new Set(issues.map((i) => i.key)).size).toBe(issues.length);
  });
});

describe('planned slack', () => {
  // A window is always the gap between a pair of jobs, held for the second of
  // them. `deriveSlack` builds these from the projection; here they are written
  // out so the engine rule can be tested on its own.
  const hold = (
    p: Plan,
    charId: CharId,
    w: { from: number; to: number; after: string; forTask: string },
  ): Plan => ({ ...p, slack: { ...p.slack, [charId]: [w] } });

  it('stops a newly added job from eating the gap and pushing the rest out', () => {
    // The complaint, exactly. Kenji fetches a car, then waits on Sora's
    // stripped beds before he can clean a bedroom: a real gap, mid-morning.
    const sora = ['clean-living-room', 'strip-beds'];
    const alone = projectPlan(42, plan({ sora, kenji: ['fetch-car-a', 'clean-bedroom-1'] }));
    const bedroomAlone = alone.taskWindows['clean-bedroom-1']!.start;

    // One more job, and the dispatcher starts it in the gap — it takes the
    // first thing it CAN do — so the bedroom slips.
    const squeezed = plan({
      sora,
      kenji: ['fetch-car-a', 'clean-bedroom-1', 'clean-bathroom'],
    });
    const eaten = projectPlan(42, squeezed);
    expect(eaten.taskWindows['clean-bathroom']!.start).toBeLessThan(bedroomAlone);
    expect(eaten.taskWindows['clean-bedroom-1']!.start).toBeGreaterThan(bedroomAlone);

    // Hold the gap for the bedroom and it keeps the slot it had before anyone
    // added anything — to the tick — while the new job waits its turn.
    const held = hold(squeezed, 'kenji', {
      from: alone.taskWindows['fetch-car-a']!.end / TICKS_PER_MINUTE,
      to: bedroomAlone / TICKS_PER_MINUTE,
      after: 'fetch-car-a',
      forTask: 'clean-bedroom-1',
    });
    const reserved = projectPlan(42, held);
    expect(reserved.taskWindows['clean-bedroom-1']!.start).toBe(bedroomAlone);
    expect(reserved.taskWindows['clean-bathroom']!.start).toBeGreaterThan(
      reserved.taskWindows['clean-bedroom-1']!.start,
    );
  });

  it('never blocks the job it is held for, however early that job comes free', () => {
    // The asymmetry that makes the whole thing safe. A window covering the
    // first hour, held for strip-beds, must not delay strip-beds itself.
    const p = hold(plan({ sora: ['strip-beds'] }), 'sora', {
      from: 0,
      to: 60,
      after: 'nothing',
      forTask: 'strip-beds',
    });
    const held = projectPlan(42, p);
    const free = projectPlan(42, plan({ sora: ['strip-beds'] }));
    expect(held.taskWindows['strip-beds']!.start).toBe(
      free.taskWindows['strip-beds']!.start,
    );
  });

  it('does keep every other job out of the window', () => {
    const p = hold(plan({ sora: ['clean-living-room', 'strip-beds'] }), 'sora', {
      from: 0,
      to: 45,
      after: 'nothing',
      forTask: 'strip-beds',
    });
    const held = projectPlan(42, p);
    // strip-beds may run (it is what the time is for); the living room may not.
    expect(held.taskWindows['strip-beds']!.start).toBeLessThan(45 * TICKS_PER_MINUTE);
    expect(held.taskWindows['clean-living-room']!.start).toBeGreaterThanOrEqual(
      45 * TICKS_PER_MINUTE,
    );
  });

  it('holds a crew barrier too, so a reserved friend is not seated early', () => {
    const five = plan({
      mei: ['eat-breakfast', 'make-breakfast'],
      sora: ['eat-breakfast'],
      kenji: ['eat-breakfast'],
      taro: ['eat-breakfast'],
      hana: ['eat-breakfast'],
    });
    const plain = projectPlan(42, five);
    const heldBack = projectPlan(
      42,
      hold(five, 'hana', { from: 0, to: 90, after: 'nothing', forTask: 'guest-book' }),
    );
    expect(plain.taskWindows['eat-breakfast']).not.toBeNull();
    // The whole table waits for the one friend whose time is spoken for.
    expect(heldBack.taskWindows['eat-breakfast']!.start).toBeGreaterThan(
      plain.taskWindows['eat-breakfast']!.start,
    );
  });
});

describe('deriving slack from a schedule', () => {
  const span = (taskId: string, startMin: number, endMin: number, absent = false) => ({
    taskId,
    startMin,
    endMin,
    absent,
  });

  it('reserves the gap between two consecutive jobs, exactly', () => {
    const slack = deriveSlack({ kenji: [span('a', 0, 11.3), span('b', 25.02, 38)] });
    expect(slack.kenji).toEqual([
      { from: 11.3, to: 25.02, forTask: 'b', after: 'a' },
    ]);
  });

  it('leaves the run-up to a friend’s first job alone', () => {
    // There is no pair yet, and holding the start of the morning empty would be
    // a plan doing nothing on purpose.
    const slack = deriveSlack({ kenji: [span('a', 30, 45)] });
    expect(slack.kenji).toBeUndefined();
  });

  it('ignores gaps too small to be intent, and jobs that never happen', () => {
    expect(deriveSlack({ kenji: [span('a', 0, 10), span('b', 10.5, 20)] }).kenji)
      .toBeUndefined();
    expect(
      deriveSlack({ kenji: [span('a', 0, 10), span('b', 30, 30, true)] }).kenji,
    ).toBeUndefined();
  });

  it('measures gaps by the clock, not by queue position', () => {
    // A lane can run out of order: `late` sits second in the queue but is
    // worked last. Pairing by queue position would reserve 10 - 40 and hold
    // time that `mid` is actually working in.
    const slack = deriveSlack({
      kenji: [span('first', 0, 10), span('late', 40, 50), span('mid', 12, 38)],
    });
    expect(slack.kenji).toEqual([
      { from: 10, to: 12, forTask: 'mid', after: 'first' },
      { from: 38, to: 40, forTask: 'late', after: 'mid' },
    ]);
  });

  it('holds the window through the instant its job takes over', () => {
    // The dispatcher runs before a tick's finished work unlocks successors, so
    // at a window's closing instant the job it protects is still locked. Let go
    // there and whatever else is open takes the slot — the exact bug this whole
    // mechanism exists to prevent.
    const p: Plan = {
      ...plan({ sora: ['strip-beds'], kenji: ['clean-bedroom-1', 'clean-bathroom'] }),
      slack: {
        kenji: [{ from: 0, to: 25.033333, forTask: 'clean-bedroom-1', after: 'x' }],
      },
    };
    const pr = projectPlan(42, p);
    // The bedroom, not the bathroom, gets the moment the window ends.
    expect(pr.taskWindows['clean-bedroom-1']!.start).toBeLessThan(
      pr.taskWindows['clean-bathroom']!.start,
    );
  });

  it('drops a window once its pair stops being a pair', () => {
    const slack = { kenji: [{ from: 11, to: 25, after: 'a', forTask: 'b' }] };

    // Still adjacent: a job appended after them changes nothing.
    expect(pruneSlack(slack, { ...emptyQueues(), kenji: ['a', 'b', 'c'] })?.kenji)
      .toHaveLength(1);
    // Something deliberately dropped between them claims the time instead.
    expect(pruneSlack(slack, { ...emptyQueues(), kenji: ['a', 'c', 'b'] })?.kenji)
      .toBeUndefined();
    // The job it was held for is gone, or has moved to another lane.
    expect(pruneSlack(slack, { ...emptyQueues(), kenji: ['a'] })?.kenji).toBeUndefined();
    // It no longer follows what it was measured from.
    expect(pruneSlack(slack, { ...emptyQueues(), kenji: ['b', 'a'] })?.kenji)
      .toBeUndefined();
  });
});

describe('a crew job holds its place in the order', () => {
  // Taro runs to the pharmacy, Mei and Hana cook, everyone eats. Taro is free
  // before the cooks are done, so his lane has a few minutes of slack in it.
  const morning = (taroExtra: string[] = []) =>
    plan({
      taro: ['buy-imodium', 'eat-breakfast', ...taroExtra],
      mei: ['make-breakfast', 'eat-breakfast'],
      hana: ['make-breakfast', 'eat-breakfast'],
      sora: ['eat-breakfast'],
      kenji: ['eat-breakfast'],
    });

  it('keeps a friend standing by rather than delaying the whole table', () => {
    const plain = projectPlan(42, morning());
    const withExtra = projectPlan(42, morning(['clean-living-room']));

    // Breakfast is untouched by Taro picking up another job AFTER it...
    expect(withExtra.taskWindows['eat-breakfast']!.start).toBe(
      plain.taskWindows['eat-breakfast']!.start,
    );
    // ...and the extra job runs after breakfast, where the lane says it should.
    expect(withExtra.taskWindows['clean-living-room']!.start).toBeGreaterThanOrEqual(
      withExtra.taskWindows['eat-breakfast']!.end,
    );
  });

  it('gives the time to a job ordered BEFORE it, which is the other intent', () => {
    // The same job, dragged in front of breakfast instead. Now the planner has
    // asked for it in the gap, and gets it — along with the later breakfast
    // that comes of it.
    const ahead = projectPlan(
      42,
      plan({
        taro: ['buy-imodium', 'clean-living-room', 'eat-breakfast'],
        mei: ['make-breakfast', 'eat-breakfast'],
        hana: ['make-breakfast', 'eat-breakfast'],
        sora: ['eat-breakfast'],
        kenji: ['eat-breakfast'],
      }),
    );
    const plain = projectPlan(42, morning());
    expect(ahead.taskWindows['clean-living-room']!.start).toBeLessThan(
      ahead.taskWindows['eat-breakfast']!.start,
    );
    expect(ahead.taskWindows['eat-breakfast']!.start).toBeGreaterThan(
      plain.taskWindows['eat-breakfast']!.start,
    );
  });

  it('does not wait for a crew job whose predecessor is its own later work', () => {
    // Mei lists breakfast before the cooking it depends on. Standing by would
    // be waiting for herself, so she goes and cooks.
    const s: SimState = createRun(42, { events: [] });
    s.plan = plan({
      mei: ['eat-breakfast', 'make-breakfast'],
      sora: ['eat-breakfast'],
      kenji: ['eat-breakfast'],
      taro: ['eat-breakfast'],
      hana: ['eat-breakfast'],
    });
    for (let i = 0; i < SIM_DEADLINE_TICKS; i++) {
      step(s);
      if (s.tasks['eat-breakfast'].status === 'done') break;
    }
    expect(s.tasks['make-breakfast'].status).toBe('done');
    expect(s.tasks['eat-breakfast'].status).toBe('done');
  });

  it('does not wait for a crew job nobody is down to start', () => {
    // Half a plan: nobody cooks, so holding for breakfast would idle the whole
    // morning away. They get on with what they can do instead.
    const p = projectPlan(
      42,
      plan({
        taro: ['eat-breakfast', 'clean-living-room'],
        sora: ['eat-breakfast'],
        kenji: ['eat-breakfast'],
        mei: ['eat-breakfast'],
        hana: ['eat-breakfast'],
      }),
    );
    expect(p.taskWindows['eat-breakfast']).toBeNull();
    expect(p.taskWindows['clean-living-room']).not.toBeNull();
  });
});

describe('a buffer placed by hand', () => {
  const buffer = (after: string, from: number): SlackWindow => ({
    from,
    to: from + MANUAL_SLACK_MIN,
    forTask: '', // held against everything, which is what a buffer is
    after,
    manual: true,
  });

  it('keeps the time free from every job, including the next one', () => {
    // Derived slack exempts the job it is held for. A buffer exempts nobody —
    // that is the difference between protecting a slot and reserving time.
    const plain = projectPlan(42, plan({ sora: ['clean-living-room', 'strip-beds'] }));
    const livingRoomEnd = plain.taskWindows['clean-living-room']!.end / TICKS_PER_MINUTE;

    const buffered = projectPlan(42, {
      ...plan({ sora: ['clean-living-room', 'strip-beds'] }),
      slack: { sora: [buffer('clean-living-room', livingRoomEnd)] },
    });

    expect(buffered.taskWindows['strip-beds']!.start).toBeGreaterThanOrEqual(
      (livingRoomEnd + MANUAL_SLACK_MIN) * TICKS_PER_MINUTE,
    );
    expect(buffered.taskWindows['strip-beds']!.start).toBeGreaterThan(
      plain.taskWindows['strip-beds']!.start,
    );
  });

  it('survives a lane edit that a derived window would not', () => {
    // Anchored to the job it sits behind, so appending work leaves it alone.
    const windows = { sora: [buffer('clean-living-room', 14)] };
    const kept = pruneSlack(windows, {
      ...emptyQueues(),
      sora: ['clean-living-room', 'strip-beds', 'clean-bathroom'],
    });
    expect(kept?.sora).toHaveLength(1);

    // ...and goes when that job leaves the lane.
    expect(pruneSlack(windows, { ...emptyQueues(), sora: ['strip-beds'] })?.sora)
      .toBeUndefined();
  });

  it('is never derived over, and clips the gap window that follows it', () => {
    const span = (taskId: string, startMin: number, endMin: number) => ({
      taskId,
      startMin,
      endMin,
      absent: false,
    });
    const out = deriveSlack(
      { sora: [span('a', 0, 10), span('b', 30, 40)] },
      { sora: [buffer('a', 10)] },
    );
    expect(out.sora).toEqual([
      { from: 10, to: 15, forTask: '', after: 'a', manual: true },
      // The derived window starts where the buffer ends, so the two do not
      // draw on top of each other.
      { from: 15, to: 30, forTask: 'b', after: 'a' },
    ]);
  });
});
