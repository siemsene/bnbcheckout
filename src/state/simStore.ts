// Zustand store owning the live simulation: fixed-timestep loop, action
// dispatch, speech bubbles, and the event ticker. The engine state object is
// mutated in place; `version` bumps tell React when to re-read it.

import { create } from 'zustand';
import { createRun } from '../engine/init';
import { applyOnly, step } from '../engine/step';
import { CHAR_IDS, SIM_DEADLINE_TICKS, TASK_BY_ID } from '../engine/content';
import { AMBIENT, bubbleText, BUBBLES } from '../content/bubbles';
import type { Action, CharId, SimEvent, SimState } from '../engine/types';

export type GamePhase = 'lobby' | 'planning' | 'running' | 'done';

export interface ActiveBubble {
  id: number;
  charId: CharId | undefined;
  text: string;
  /** Real-time ms timestamp when the bubble disappears. */
  until: number;
}

export interface TickerEntry {
  id: number;
  simMinute: number;
  text: string;
  kind: 'info' | 'done' | 'rework' | 'warn';
}

const BUBBLE_MS = 4200;

/** Sim speed: 8 ticks/real-second = 120 sim-min in 15 real minutes. A ?speed=
 * URL param (practice mode only) overrides it for testing/demo purposes. */
let ticksPerRealSecond = 8;
export function setSimSpeed(tps: number) {
  ticksPerRealSecond = Math.max(1, Math.min(240, tps));
}
export function getSimSpeed() {
  return ticksPerRealSecond;
}

/** Real milliseconds a full run lasts at the current speed (15 min at 8 tps). */
export function runWallClockMs() {
  return (SIM_DEADLINE_TICKS / ticksPerRealSecond) * 1000;
}

/** Max ticks stepped in one advance() call, so a long stall can't freeze the
 * tab with a single enormous burst. Successive frames keep converging. */
const CATCHUP_CAP = 1200;

/** Above this many ticks in one call we're fast-forwarding, not playing. */
const BURST_TICKS = 300;

interface SimStore {
  sim: SimState | null;
  version: number;
  phase: GamePhase;
  paused: boolean;
  bubbles: ActiveBubble[];
  ticker: TickerEntry[];
  /** Click-to-assign fallback: currently selected character (or null). */
  selected: CharId | null;
  setSelected(c: CharId | null): void;
  /**
   * Classroom mode: the wall-clock instant (in *client* clock terms) that the
   * room's run began. When set, sim time is a function of this absolute anchor
   * rather than of accumulated deltas, so a refreshed, throttled or slow client
   * converges back to the room's shared sim-time instead of drifting behind.
   * null in practice mode, which keeps the accumulate path.
   */
  clockAnchorMs: number | null;
  setClockAnchor(ms: number | null): void;
  /** False during a synchronized classroom run — nobody may pause. */
  pauseAllowed: boolean;
  setPauseAllowed(allowed: boolean): void;
  /** Stop the run where it stands (instructor ended the session). */
  haltRun(): void;
  /** Called after each real-second batch of ticks; Firebase layer hooks in here. */
  onTicked?: (sim: SimState) => void;

  /**
   * Start a fresh run. `opts` is only used by two-run sessions: round 2 keeps
   * the same task durations and may re-roll the disruptions.
   */
  newGame(seed: number, opts?: { round?: 1 | 2; chaosSeed?: number }): void;
  beginPlanning(): void;
  startClock(): void;
  setPaused(p: boolean): void;
  dispatch(action: Action): void;
  /** Advance the loop; called by useSimLoop with real elapsed ms. */
  advance(realMs: number): void;
  reset(): void;
}

let nextId = 1;
let tickRemainder = 0;

export const useSimStore = create<SimStore>((set, get) => ({
  sim: null,
  version: 0,
  phase: 'lobby',
  paused: false,
  bubbles: [],
  ticker: [],
  selected: null,
  clockAnchorMs: null,
  pauseAllowed: true,

  setSelected(c) {
    set({ selected: c });
  },

  setClockAnchor(ms) {
    set({ clockAnchorMs: ms });
  },

  setPauseAllowed(allowed) {
    set({ pauseAllowed: allowed, ...(allowed ? {} : { paused: false }) });
  },

  haltRun() {
    set({ phase: 'done', paused: false, clockAnchorMs: null });
  },

  newGame(seed, opts) {
    tickRemainder = 0;
    pendingActions.length = 0;
    set({
      sim: createRun(seed, opts),
      version: 0,
      phase: 'lobby',
      paused: false,
      bubbles: [],
      ticker: [],
      selected: null,
      clockAnchorMs: null,
    });
  },

  beginPlanning() {
    set({ phase: 'planning' });
  },

  startClock() {
    const { phase } = get();
    if (phase === 'planning') set({ phase: 'running', paused: false });
  },

  setPaused(p) {
    if (!get().pauseAllowed) return; // synchronized run: the clock is the clock
    set({ paused: p });
  },

  dispatch(action) {
    const { sim, phase, paused } = get();
    if (!sim) return;
    // Whenever the clock is frozen — the planning freeze, or a paused practice
    // run — apply immediately. Queuing would strand the action: `advance` bails
    // while paused, so the queue is never drained, and since nothing calls `set`
    // nothing re-renders either (every worker view repaints off `version`). The
    // player drags an idle friend onto a task and sees nothing happen until they
    // hit resume, at which point the chip snaps across.
    //
    // Applying early grants no head start: `arriveAt` is stamped as an ABSOLUTE
    // tick, so a frozen clock still owes the full transit once time resumes.
    if (phase === 'planning' || (phase === 'running' && paused)) {
      const { events } = applyOnly(sim, [action]);
      ingestEvents(sim, events, set, get);
      set((s) => ({ version: s.version + 1 }));
    } else if (phase === 'running') {
      // Applied on the next tick via the pending queue.
      pendingActions.push(action);
    }
  },

  advance(realMs) {
    const { sim, phase, paused, clockAnchorMs } = get();
    if (!sim || phase !== 'running' || paused || sim.outcome !== 'running') return;

    let ticks: number;
    if (clockAnchorMs != null) {
      // Anchored (classroom): sim time is a pure function of wall-clock since
      // the room started, so every client targets the same tick regardless of
      // how much time it personally missed.
      const target = Math.floor(
        ((Date.now() - clockAnchorMs) / 1000) * ticksPerRealSecond,
      );
      ticks = target - sim.tick;
      if (ticks <= 0) return; // ahead of the room (or not started): idle
    } else {
      // Unanchored (practice): accumulate elapsed unpaused wall-clock.
      tickRemainder += (realMs / 1000) * ticksPerRealSecond;
      ticks = Math.floor(tickRemainder);
      tickRemainder -= ticks;
    }
    // Catch-up cap: recover fully from background-tab throttling (browsers
    // throttle rAF/timers when hidden) but bound the worst-case burst.
    if (ticks > CATCHUP_CAP) ticks = CATCHUP_CAP;

    if (ticks === 0) return;
    // A big burst means we're fast-forwarding (a resumed or throttled client
    // catching up to the room). Replaying minutes of chatter as live bubbles
    // would bury the player, so the ticker carries that history instead.
    const burst = ticks > BURST_TICKS;

    const allEvents: SimEvent[] = [];
    for (let i = 0; i < ticks; i++) {
      const actions = pendingActions.splice(0);
      const { events } = step(sim, actions);
      allEvents.push(...events);
      if (sim.outcome !== 'running') break;
    }
    ingestEvents(sim, allEvents, set, get, burst);

    // Ambient chatter: someone pipes up every couple of sim-minutes (UI-only
    // flavor — never engine state, so replays are unaffected).
    if (!burst && sim.outcome === 'running' && sim.tick > 0 && sim.tick % 150 < ticks) {
      const slot = Math.floor(sim.tick / 150);
      const charId = CHAR_IDS[slot % CHAR_IDS.length];
      const lines = AMBIENT[charId];
      const busyState = sim.chars[charId].activity;
      if (lines && (busyState === 'working' || busyState === 'idle')) {
        const text = lines[slot % lines.length];
        const now0 = Date.now();
        set((s) => ({
          bubbles: [
            ...s.bubbles.filter((b) => b.charId !== charId),
            { id: nextId++, charId, text, until: now0 + BUBBLE_MS },
          ].slice(-8),
        }));
      }
    }

    const now = Date.now();
    set((s) => ({
      version: s.version + 1,
      bubbles: s.bubbles.filter((b) => b.until > now),
      phase: sim.outcome !== 'running' ? 'done' : s.phase,
    }));
    get().onTicked?.(sim);
  },

  reset() {
    tickRemainder = 0;
    pendingActions.length = 0;
    set({
      sim: null,
      version: 0,
      phase: 'lobby',
      paused: false,
      bubbles: [],
      ticker: [],
      clockAnchorMs: null,
      pauseAllowed: true,
    });
  },
}));

const pendingActions: Action[] = [];

// Dev-only hook so tests and debugging can reach the store from the console.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__simStore = useSimStore;
}

type Set = (fn: (s: SimStore) => Partial<SimStore>) => void;

function ingestEvents(
  sim: SimState,
  events: SimEvent[],
  set: Set,
  _get: () => SimStore,
  /** Fast-forwarding: record to the ticker, but don't pop stale bubbles. */
  suppressBubbles = false,
) {
  if (events.length === 0) return;
  const now = Date.now();
  const newBubbles: ActiveBubble[] = [];
  const newTicker: TickerEntry[] = [];
  const minute = Math.floor(sim.tick / 60);

  for (const ev of events) {
    switch (ev.type) {
      case 'bubble': {
        const text = bubbleText(ev.textKey, ev.tick);
        if (text) {
          const charId = ev.charId ?? BUBBLES[ev.textKey]?.charId;
          newBubbles.push({ id: nextId++, charId, text, until: now + BUBBLE_MS });
          newTicker.push({
            id: nextId++,
            simMinute: minute,
            text: charId ? `${cap(charId)}: “${text}”` : text,
            kind: 'info',
          });
        }
        break;
      }
      case 'taskDone':
        newTicker.push({
          id: nextId++,
          simMinute: minute,
          text: `✓ ${TASK_BY_ID[ev.taskId].name} done`,
          kind: 'done',
        });
        break;
      case 'rework': {
        const text = bubbleText(ev.textKey, ev.tick);
        newTicker.push({
          id: nextId++,
          simMinute: minute,
          text: `↩ Rework: ${TASK_BY_ID[ev.taskId].name}${text ? ` — ${text}` : ''}`,
          kind: 'rework',
        });
        if (text) {
          const charId = BUBBLES[ev.textKey]?.charId;
          newBubbles.push({ id: nextId++, charId, text, until: now + BUBBLE_MS });
        }
        break;
      }
      case 'finished':
        newTicker.push({
          id: nextId++,
          simMinute: minute,
          text: '🎉 Checkout complete!',
          kind: 'done',
        });
        break;
      case 'deadline':
        newTicker.push({
          id: nextId++,
          simMinute: minute,
          text: '⏰ Time’s up — checkout incomplete.',
          kind: 'warn',
        });
        break;
    }
  }

  if (newBubbles.length || newTicker.length) {
    set((s) => ({
      // Keep at most one live bubble per character (newest wins).
      bubbles: suppressBubbles
        ? s.bubbles
        : [
            ...s.bubbles.filter(
              (b) => !newBubbles.some((n) => n.charId && n.charId === b.charId),
            ),
            ...newBubbles,
          ].slice(-8),
      ticker: [...s.ticker, ...newTicker].slice(-60),
    }));
  }
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
