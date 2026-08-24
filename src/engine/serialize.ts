// Checkpoint encode/decode. SimState is entirely JSON-safe by construction.

import { ENGINE_VERSION } from './init';
import type { SimState } from './types';

export interface Checkpoint {
  engineVersion: number;
  seed: number;
  tick: number;
  stateJSON: string;
}

export function serialize(state: SimState): Checkpoint {
  return {
    engineVersion: state.engineVersion,
    seed: state.seed,
    tick: state.tick,
    stateJSON: JSON.stringify(state),
  };
}

/** Returns null when the checkpoint was written by an incompatible engine. */
export function deserialize(cp: Checkpoint): SimState | null {
  if (cp.engineVersion !== ENGINE_VERSION) return null;
  return JSON.parse(cp.stateJSON) as SimState;
}
