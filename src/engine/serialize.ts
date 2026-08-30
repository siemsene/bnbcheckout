// Checkpoint encode/decode. SimState is entirely JSON-safe by construction.

import { ENGINE_VERSION } from './init';
import type { SimState } from './types';

export interface Checkpoint {
  engineVersion: number;
  seed: number;
  /**
   * Which run this snapshot is from. Both rounds of a two-run session share a
   * seed, so `seed` alone cannot tell a stale run-1 checkpoint from a live
   * run-2 one — restoring the wrong one would silently replay the first run.
   */
  round: 1 | 2;
  tick: number;
  stateJSON: string;
}

export function serialize(state: SimState): Checkpoint {
  return {
    engineVersion: state.engineVersion,
    seed: state.seed,
    round: state.round,
    tick: state.tick,
    stateJSON: JSON.stringify(state),
  };
}

/** Returns null when the checkpoint was written by an incompatible engine. */
export function deserialize(cp: Checkpoint): SimState | null {
  if (cp.engineVersion !== ENGINE_VERSION) return null;
  return JSON.parse(cp.stateJSON) as SimState;
}
