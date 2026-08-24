// Zustand store owning the live simulation: fixed-timestep loop, action
// dispatch, speech bubbles, and the event ticker. The engine state object is
// mutated in place; `version` bumps tell React when to re-read it.

import { create } from 'zustand';
import { createRun } from '../engine/init';
import { applyOnly, step } from '../engine/step';
import { TASK_BY_ID } from '../engine/content';
import { bubbleText, BUBBLES } from '../content/bubbles';
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
  /** Called after each real-second batch of ticks; Firebase layer hooks in here. */
  onTicked?: (sim: SimState) => void;

  newGame(seed: number): void;
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

  setSelected(c) {
    set({ selected: c });
  },

  newGame(seed) {
    tickRemainder = 0;
    set({
      sim: createRun(seed),
      version: 0,
      phase: 'lobby',
      paused: false,
      bubbles: [],
      ticker: [],
      selected: null,
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
    set({ paused: p });
  },

  dispatch(action) {
    const { sim, phase } = get();
    if (!sim) return;
    if (phase === 'planning') {
      const { events } = applyOnly(sim, [action]);
      ingestEvents(sim, events, set, get);
      set((s) => ({ version: s.version + 1 }));
    } else if (phase === 'running') {
      // Applied on the next tick via the pending queue.
      pendingActions.push(action);
    }
  },

  advance(realMs) {
    const { sim, phase, paused } = get();
    if (!sim || phase !== 'running' || paused || sim.outcome !== 'running') return;

    tickRemainder += (realMs / 1000) * ticksPerRealSecond;
    let ticks = Math.floor(tickRemainder);
    tickRemainder -= ticks;
    // Catch-up cap: recover fully from background-tab throttling (browsers
    // throttle rAF/timers when hidden) but bound the worst-case burst.
    if (ticks > 1200) ticks = 1200;

    if (ticks === 0) return;
    const allEvents: SimEvent[] = [];
    for (let i = 0; i < ticks; i++) {
      const actions = pendingActions.splice(0);
      const { events } = step(sim, actions);
      allEvents.push(...events);
      if (sim.outcome !== 'running') break;
    }
    ingestEvents(sim, allEvents, set, get);
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
    set({ sim: null, version: 0, phase: 'lobby', paused: false, bubbles: [], ticker: [] });
  },
}));

const pendingActions: Action[] = [];

type Set = (fn: (s: SimStore) => Partial<SimStore>) => void;

function ingestEvents(sim: SimState, events: SimEvent[], set: Set, _get: () => SimStore) {
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
      bubbles: [
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
