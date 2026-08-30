// The classroom two-stage flow: stage derivation from one timestamp, and the
// anchored sim clock that keeps a whole room on the same sim-minute.

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  stageOf,
  playerIsDone,
  roundOf,
  COUNTDOWN_MS,
  type PlayerDoc,
  type SessionDoc,
} from '../../firebase/data';
import { setSimSpeed, useSimStore } from '../../state/simStore';
import { TRANSIT_TICKS } from '../content';

/** Minimal stand-in for a Firestore Timestamp. */
const ts = (ms: number) => ({ toMillis: () => ms }) as SessionDoc['runStartsAt'];

function session(over: Partial<SessionDoc> = {}): SessionDoc {
  return {
    id: 's1',
    code: 'ABCDEF',
    instructorUid: 'i1',
    title: 'Class',
    status: 'planning',
    playerCount: 2,
    ...over,
  };
}

function player(over: Partial<PlayerDoc> = {}): PlayerDoc {
  return {
    id: 'p1',
    name: 'Ana',
    uid: 'u1',
    phase: 'running',
    simMinute: 0,
    pctComplete: 0,
    utilizationAvg: 0,
    finished: false,
    finishSimMinute: null,
    score: 0,
    seed: 1,
    ...over,
  };
}

describe('stage derivation', () => {
  const NOW = 1_000_000;

  it('is lobby until the instructor opens planning', () => {
    expect(stageOf(session({ status: 'lobby' }), NOW)).toBe('lobby');
    expect(stageOf(null, NOW)).toBe('lobby');
  });

  it('walks planning -> countdown -> running off one timestamp', () => {
    const s = session({ runStartsAt: ts(NOW + 60_000) });
    expect(stageOf(s, NOW)).toBe('planning');
    expect(stageOf(s, NOW + 60_000 - COUNTDOWN_MS - 1)).toBe('planning');
    expect(stageOf(s, NOW + 60_000 - COUNTDOWN_MS)).toBe('countdown');
    expect(stageOf(s, NOW + 59_999)).toBe('countdown');
    expect(stageOf(s, NOW + 60_000)).toBe('running');
    expect(stageOf(s, NOW + 10_000_000)).toBe('running');
  });

  it('ended beats everything', () => {
    expect(stageOf(session({ status: 'ended', runStartsAt: ts(NOW - 1) }), NOW)).toBe('ended');
  });

  it('treats a legacy running status as planning until the timestamp says otherwise', () => {
    const s = session({ status: 'running', runStartsAt: ts(NOW + 60_000) });
    expect(stageOf(s, NOW)).toBe('planning');
  });

  it('a single-run session never leaves running, however long it waits', () => {
    // The default format is unchanged: no review1, no plan2, no second run.
    const s = session({ runStartsAt: ts(NOW) });
    expect(stageOf(s, NOW + 10_000_000)).toBe('running');
  });

  it('counts a player who ran out of time as done', () => {
    // `finished` means "completed every task"; the phase is what ends a run.
    expect(playerIsDone(player({ phase: 'finished', finished: false }))).toBe(true);
    expect(playerIsDone(player({ phase: 'finished', finished: true }))).toBe(true);
    expect(playerIsDone(player({ phase: 'abandoned' }))).toBe(true);
    expect(playerIsDone(player({ phase: 'running' }))).toBe(false);
    expect(playerIsDone(player({ phase: 'planning' }))).toBe(false);
  });
});

describe('anchored sim clock', () => {
  afterEach(() => {
    vi.useRealTimers();
    setSimSpeed(8);
    useSimStore.getState().reset();
  });

  /** Start a run whose shared clock began `agoMs` ago. */
  function startAnchored(seed: number, agoMs: number) {
    const store = useSimStore.getState();
    store.newGame(seed);
    store.beginPlanning();
    store.setPauseAllowed(false);
    store.setClockAnchor(Date.now() - agoMs);
    store.startClock();
    return useSimStore.getState();
  }

  it('targets the tick implied by wall-clock, not by accumulated deltas', () => {
    vi.useFakeTimers();
    startAnchored(11, 10_000); // room started 10s ago -> 80 ticks at 8 tps
    // A tiny frame delta must not limit how far we advance.
    useSimStore.getState().advance(16);
    expect(useSimStore.getState().sim!.tick).toBe(80);
  });

  it('two clients fed different frame rates reach the same tick', () => {
    vi.useFakeTimers();
    const anchor = Date.now() - 30_000;

    const runWith = (deltas: number[]) => {
      const store = useSimStore.getState();
      store.newGame(99);
      store.beginPlanning();
      store.setClockAnchor(anchor);
      store.startClock();
      for (const d of deltas) useSimStore.getState().advance(d);
      const sim = useSimStore.getState().sim!;
      return { tick: sim.tick, done: sim.tasks['strip-beds'].workDone };
    };

    const smooth = runWith(Array(60).fill(16)); // 60fps
    const janky = runWith([500, 2, 900, 1]); // stutter
    expect(smooth.tick).toBe(240); // 30s * 8 tps
    expect(janky.tick).toBe(smooth.tick);
    expect(janky.done).toBe(smooth.done);
  });

  it('a refreshed client catches up to the room instead of restarting', () => {
    vi.useFakeTimers();
    startAnchored(7, 0);
    useSimStore.getState().advance(16);
    const early = useSimStore.getState().sim!.tick;
    expect(early).toBe(0);

    // Tab was gone for two minutes.
    vi.advanceTimersByTime(120_000);
    // Converges within a few frames despite the per-call burst cap.
    for (let i = 0; i < 5; i++) useSimStore.getState().advance(16);
    expect(useSimStore.getState().sim!.tick).toBe(960); // 120s * 8 tps
  });

  it('never rewinds when the client is ahead of the room', () => {
    vi.useFakeTimers();
    startAnchored(3, 5_000);
    useSimStore.getState().advance(16);
    const tick = useSimStore.getState().sim!.tick;
    // Anchor moved later (a start pushed back); we must idle, not go backwards.
    useSimStore.getState().setClockAnchor(Date.now() + 60_000);
    useSimStore.getState().advance(16);
    expect(useSimStore.getState().sim!.tick).toBe(tick);
  });

  it('caps a single burst so one call cannot freeze the tab', () => {
    vi.useFakeTimers();
    startAnchored(5, 10 * 60_000); // 10 real minutes = 4800 ticks behind
    useSimStore.getState().advance(16);
    expect(useSimStore.getState().sim!.tick).toBe(1200);
  });
});

describe('two-run stage derivation', () => {
  const NOW = 1_000_000;
  // 120 sim-minutes at 8x compression = 15 real minutes.
  const RUN_MS = 15 * 60_000;

  const twoRun = (over: Partial<SessionDoc> = {}) =>
    session({
      settings: {
        simDeadlineMin: 120,
        compression: 8,
        planningMinutes: 5,
        format: 'two-run',
      },
      ...over,
    });

  it('drops into review1 when run 1’s window elapses, with nobody writing it', () => {
    const s = twoRun({ runStartsAt: ts(NOW) });
    expect(stageOf(s, NOW)).toBe('running');
    expect(stageOf(s, NOW + RUN_MS - 1)).toBe('running');
    expect(stageOf(s, NOW + RUN_MS)).toBe('review1');
    // And it stays there until the instructor acts.
    expect(stageOf(s, NOW + RUN_MS + 10_000_000)).toBe('review1');
  });

  it('opens the plan board on planOpensAt', () => {
    const s = twoRun({ runStartsAt: ts(NOW), planOpensAt: ts(NOW + RUN_MS + 5_000) });
    expect(stageOf(s, NOW + RUN_MS)).toBe('review1');
    expect(stageOf(s, NOW + RUN_MS + 4_999)).toBe('review1');
    expect(stageOf(s, NOW + RUN_MS + 5_000)).toBe('plan2');
  });

  it('walks plan2 -> countdown2 -> running2 off one timestamp', () => {
    const start2 = NOW + RUN_MS + 300_000;
    const s = twoRun({
      runStartsAt: ts(NOW),
      planOpensAt: ts(NOW + RUN_MS),
      run2StartsAt: ts(start2),
    });
    expect(stageOf(s, start2 - COUNTDOWN_MS - 1)).toBe('plan2');
    expect(stageOf(s, start2 - COUNTDOWN_MS)).toBe('countdown2');
    expect(stageOf(s, start2 - 1)).toBe('countdown2');
    expect(stageOf(s, start2)).toBe('running2');
  });

  it('a late joiner mid-run-2 derives run 2, not run 1', () => {
    const start2 = NOW + RUN_MS + 300_000;
    const s = twoRun({
      runStartsAt: ts(NOW),
      planOpensAt: ts(NOW + RUN_MS),
      run2StartsAt: ts(start2),
    });
    // No history, no replay: one read of the doc and the clock is enough.
    expect(stageOf(s, start2 + 60_000)).toBe('running2');
    expect(roundOf(stageOf(s, start2 + 60_000))).toBe(2);
  });

  it('ended still beats every two-run stage', () => {
    const s = twoRun({ status: 'ended', runStartsAt: ts(NOW), run2StartsAt: ts(NOW) });
    expect(stageOf(s, NOW + 10_000_000)).toBe('ended');
  });

  it('reports the round each stage belongs to', () => {
    expect(roundOf('running')).toBe(1);
    expect(roundOf('review1')).toBe(1);
    expect(roundOf('plan2')).toBe(2);
    expect(roundOf('countdown2')).toBe(2);
    expect(roundOf('running2')).toBe(2);
  });
});

describe('pause gating', () => {
  afterEach(() => {
    useSimStore.getState().reset();
  });

  it('a classroom run cannot be paused', () => {
    const store = useSimStore.getState();
    store.newGame(21);
    store.beginPlanning();
    store.setPauseAllowed(false);
    store.startClock();
    useSimStore.getState().setPaused(true);
    expect(useSimStore.getState().paused).toBe(false);
  });

  it('practice keeps its pause and its delta-accumulating clock', () => {
    const store = useSimStore.getState();
    store.newGame(21);
    store.beginPlanning();
    store.startClock();
    expect(useSimStore.getState().clockAnchorMs).toBeNull();

    useSimStore.getState().advance(1000); // 1 real second at 8 tps
    expect(useSimStore.getState().sim!.tick).toBe(8);

    useSimStore.getState().setPaused(true);
    expect(useSimStore.getState().paused).toBe(true);
    useSimStore.getState().advance(1000);
    expect(useSimStore.getState().sim!.tick).toBe(8); // frozen
  });

  // Regression: dragging an idle friend onto a task while paused used to queue
  // the action and repaint nothing, so the player saw the assignment only after
  // pressing resume. `advance` bails while paused, so the queue never drained.
  it('an assignment made while paused lands immediately, and repaints', () => {
    const store = useSimStore.getState();
    store.newGame(21);
    store.beginPlanning();
    store.startClock();
    useSimStore.getState().advance(1000);
    useSimStore.getState().setPaused(true);

    const before = useSimStore.getState().version;
    useSimStore.getState().dispatch({
      type: 'assign',
      charId: 'sora',
      taskId: 'strip-beds',
    });

    // The engine saw it...
    expect(useSimStore.getState().sim!.chars.sora.taskId).toBe('strip-beds');
    // ...and so did React: every worker view repaints off `version` alone.
    expect(useSimStore.getState().version).toBeGreaterThan(before);
  });

  // ...and it is not a free head start: `arriveAt` is an absolute tick, so a
  // frozen clock still owes the whole walk once time resumes.
  it('a pause-time assignment still owes the full walk on resume', () => {
    const store = useSimStore.getState();
    store.newGame(21);
    store.beginPlanning();
    store.startClock();
    useSimStore.getState().advance(1000);
    useSimStore.getState().setPaused(true);

    const at = useSimStore.getState().sim!.tick;
    useSimStore.getState().dispatch({
      type: 'assign',
      charId: 'sora',
      taskId: 'strip-beds',
    });
    expect(useSimStore.getState().sim!.tasks['strip-beds'].arriveAt.sora).toBe(
      at + TRANSIT_TICKS,
    );

    useSimStore.getState().setPaused(false);
    useSimStore.getState().advance(1000); // 8 ticks — nowhere near the 30 owed
    expect(useSimStore.getState().sim!.chars.sora.activity).toBe('walking');
    expect(useSimStore.getState().sim!.tasks['strip-beds'].workDone).toBe(0);
  });
});
