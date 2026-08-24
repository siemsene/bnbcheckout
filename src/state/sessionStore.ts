// Student session context: who am I in which session, plus the glue that
// reports sim progress to Firestore (throttled) and checkpoints for rejoin.

import { create } from 'zustand';
import { deserialize, serialize } from '../engine/serialize';
import { summarize } from '../engine/scoring';
import { simMinute } from '../engine/scoring';
import type { SimState } from '../engine/types';
import {
  ensureAnonAuth,
  loadCheckpoint,
  saveCheckpoint,
  saveResult,
  writeProgress,
  type ProgressUpdate,
} from '../firebase/data';
import { joinSession } from '../firebase/callables';
import { firebaseEnabled } from '../firebase/client';
import { useSimStore, type GamePhase } from './simStore';

const PROGRESS_INTERVAL_MS = 10_000;
const CHECKPOINT_INTERVAL_MS = 60_000;
const STORAGE_KEY = 'checkout-rush-session';

interface StoredIdentity {
  sessionId: string;
  playerId: string;
  name: string;
  code: string;
  seed: number;
}

interface SessionStore {
  identity: StoredIdentity | null;
  uid: string | null;
  joining: boolean;
  error: string | null;

  join(code: string, name: string): Promise<boolean>;
  /** Restore identity from localStorage (call on mount of /session route). */
  restore(): StoredIdentity | null;
  leave(): void;

  /** Wire progress reporting onto the running sim store. Returns cleanup. */
  attachReporting(): () => void;
  /** Try to resume from a server checkpoint; returns true if resumed. */
  resumeFromCheckpoint(): Promise<boolean>;
  reportNow(phase: GamePhase): void;
}

let lastProgressAt = 0;
let lastCheckpointAt = 0;
let lastPhase: GamePhase | null = null;

export const useSessionStore = create<SessionStore>((set, get) => ({
  identity: null,
  uid: null,
  joining: false,
  error: null,

  async join(code, name) {
    if (!firebaseEnabled) {
      set({ error: 'Class sessions are not configured on this deployment.' });
      return false;
    }
    set({ joining: true, error: null });
    try {
      const uid = await ensureAnonAuth();
      const res = await joinSession(code.trim().toUpperCase(), name);
      const identity: StoredIdentity = {
        sessionId: res.sessionId,
        playerId: res.playerId,
        name: name.trim(),
        code: code.trim().toUpperCase(),
        seed: res.seed,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
      set({ identity, uid, joining: false });
      return true;
    } catch (e) {
      const msg =
        e instanceof Error && /already|taken/i.test(e.message)
          ? 'That name is taken in this session — pick another.'
          : e instanceof Error
            ? e.message
            : 'Could not join the session.';
      set({ error: msg, joining: false });
      return false;
    }
  },

  restore() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    try {
      const identity = JSON.parse(raw) as StoredIdentity;
      set({ identity });
      return identity;
    } catch {
      return null;
    }
  },

  leave() {
    localStorage.removeItem(STORAGE_KEY);
    set({ identity: null });
  },

  attachReporting() {
    const report = (sim: SimState) => {
      const { identity, uid } = get();
      if (!identity || !uid) return;
      const phase = useSimStore.getState().phase;
      const now = Date.now();
      const phaseChanged = phase !== lastPhase;
      lastPhase = phase;

      if (phaseChanged || now - lastProgressAt > PROGRESS_INTERVAL_MS) {
        lastProgressAt = now;
        const r = summarize(sim);
        const p: ProgressUpdate = {
          phase:
            phase === 'done'
              ? 'finished'
              : phase === 'running'
                ? 'running'
                : phase === 'planning'
                  ? 'planning'
                  : 'lobby',
          simMinute: Math.floor(simMinute(sim)),
          pctComplete: r.pctComplete,
          utilizationAvg: r.avgUtilization,
          finished: r.outcome === 'finished',
          finishSimMinute: r.finishSimMinute,
          score: r.score,
        };
        void writeProgress(identity.sessionId, identity.playerId, p).catch(() => {});
      }

      if (now - lastCheckpointAt > CHECKPOINT_INTERVAL_MS || phaseChanged) {
        lastCheckpointAt = now;
        void saveCheckpoint(identity.sessionId, identity.playerId, uid, serialize(sim)).catch(
          () => {},
        );
      }

      if (sim.outcome !== 'running') {
        void saveResult(identity.sessionId, identity.playerId, uid, summarize(sim)).catch(
          () => {},
        );
      }
    };

    useSimStore.setState({ onTicked: report });

    const onHide = () => {
      const sim = useSimStore.getState().sim;
      const { identity, uid } = get();
      if (sim && identity && uid) {
        void saveCheckpoint(identity.sessionId, identity.playerId, uid, serialize(sim)).catch(
          () => {},
        );
      }
    };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      useSimStore.setState({ onTicked: undefined });
      document.removeEventListener('visibilitychange', onHide);
    };
  },

  async resumeFromCheckpoint() {
    const { identity } = get();
    if (!identity) return false;
    try {
      const cp = await loadCheckpoint(identity.sessionId, identity.playerId);
      if (!cp || cp.tick === 0) return false;
      const state = deserialize(cp);
      if (!state) return false;
      useSimStore.setState({
        sim: state,
        version: 1,
        phase: state.outcome === 'running' ? 'running' : 'done',
        paused: false,
        bubbles: [],
        ticker: [],
        selected: null,
      });
      return true;
    } catch {
      return false;
    }
  },

  reportNow(phase) {
    const sim = useSimStore.getState().sim;
    if (sim) {
      lastProgressAt = 0;
      lastPhase = phase;
      const { identity } = get();
      if (identity) {
        const r = summarize(sim);
        void writeProgress(identity.sessionId, identity.playerId, {
          phase: phase === 'done' ? 'finished' : (phase as ProgressUpdate['phase']),
          simMinute: Math.floor(simMinute(sim)),
          pctComplete: r.pctComplete,
          utilizationAvg: r.avgUtilization,
          finished: r.outcome === 'finished',
          finishSimMinute: r.finishSimMinute,
          score: r.score,
        }).catch(() => {});
      }
    }
  },
}));
