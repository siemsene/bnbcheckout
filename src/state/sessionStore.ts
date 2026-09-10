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
  roundOf,
  saveCheckpoint,
  saveResult,
  subscribePlayers,
  subscribeSession,
  writeProgress,
  type PlayerDoc,
  type ProgressUpdate,
  type SessionDoc,
  type Stage,
} from '../firebase/data';
import {
  getServerTime,
  joinSession,
  markReady as markReadyCallable,
} from '../firebase/callables';
import { firebaseEnabled } from '../firebase/client';
import { CHECKPOINT_INTERVAL_MS, PROGRESS_INTERVAL_MS } from './cadence';
import { useSimStore, type GamePhase } from './simStore';

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

  /** Live session doc + roster, so stage logic has one source of truth. */
  session: SessionDoc | null;
  players: PlayerDoc[];
  /** serverNow - clientNow, from the last callable. Corrects a skewed clock. */
  serverOffsetMs: number;
  /** This player's own ready flag (optimistic; server owns the real one). */
  ready: boolean;
  readyPending: boolean;
  readyError: string | null;

  join(code: string, name: string): Promise<boolean>;
  /** Restore identity from localStorage (call on mount of /session route). */
  restore(): StoredIdentity | null;
  leave(): void;

  /** Subscribe to the session doc and roster. Returns cleanup. */
  watchSession(sessionId: string): () => void;
  /** Server-corrected wall clock. */
  now(): number;
  /** Re-measure the server clock offset (used on resume). */
  syncClock(): Promise<void>;
  /** Tell the server this player has finished planning. */
  markReady(): Promise<void>;

  /** Wire progress reporting onto the running sim store. Returns cleanup. */
  attachReporting(): () => void;
  /** Try to resume from a server checkpoint; returns true if resumed. */
  resumeFromCheckpoint(stage: Stage): Promise<boolean>;
  reportNow(phase: GamePhase): void;
  /** Force a checkpoint write now (used at the end of planning). */
  checkpointNow(): void;
  /**
   * Persist run 1's summary before the state is replaced for round 2. Without
   * this the improvement comparison has nothing to compare against, since the
   * sim state itself is about to be thrown away.
   */
  /**
   * Persist the current round's result now.
   *
   * The automatic save in `attachReporting` only fires when the ENGINE ends a
   * run (`sim.outcome !== 'running'`). A run the room ends — the deadline
   * passing while this client's sim lagged, or the instructor ending the
   * session — halts through `haltRun`, which sets the store's phase and leaves
   * `sim.outcome` alone. So nothing was written, and the run-1-vs-run-2
   * debrief had nothing to read back.
   */
  saveRoundResult(): Promise<void>;
}

let lastProgressAt = 0;
let lastCheckpointAt = 0;
let lastPhase: GamePhase | null = null;

export const useSessionStore = create<SessionStore>((set, get) => ({
  identity: null,
  uid: null,
  joining: false,
  error: null,
  session: null,
  players: [],
  serverOffsetMs: 0,
  ready: false,
  readyPending: false,
  readyError: null,

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
      set({
        identity,
        uid,
        joining: false,
        serverOffsetMs: res.serverNowMs - Date.now(),
      });
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
    set({ identity: null, session: null, players: [], ready: false });
  },

  watchSession(sessionId) {
    const stopSession = subscribeSession(sessionId, (session) => set({ session }));
    const stopPlayers = subscribePlayers(sessionId, (players) => {
      const playerId = get().identity?.playerId;
      const me = players.find((p) => p.id === playerId);
      // The server's flag wins once it lands; until then keep the optimistic one.
      set({ players, ready: me?.ready === true || get().ready });
    });
    return () => {
      stopSession();
      stopPlayers();
    };
  },

  now() {
    return Date.now() + get().serverOffsetMs;
  },

  /** A student who refreshes never calls join(), so sample the clock directly.
   * Non-blocking: planning lasts minutes, so the correction always lands in
   * time, and an uncorrected clock is only wrong by that client's own skew. */
  async syncClock() {
    try {
      const serverNowMs = await getServerTime();
      set({ serverOffsetMs: serverNowMs - Date.now() });
    } catch {
      /* keep the existing offset */
    }
  },

  async markReady() {
    const { identity, readyPending } = get();
    if (!identity || readyPending) return;
    set({ readyPending: true, ready: true, readyError: null }); // optimistic
    try {
      const res = await markReadyCallable(identity.sessionId, identity.playerId);
      set({ serverOffsetMs: res.serverNowMs - Date.now() });
    } catch (e) {
      // Never fail silently here: the student pressed a button and the whole
      // room may be waiting on them.
      set({
        ready: false,
        readyError:
          e instanceof Error && /permission-denied/.test(e.message)
            ? 'This browser lost your place in the session. Rejoin with the same code and name.'
            : 'Could not tell the class you’re ready — try again.',
      });
    } finally {
      set({ readyPending: false });
    }
    get().reportNow('planning');
    // Commit the staged plan so a refresh before the run keeps it.
    get().checkpointNow();
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
          round: sim.round,
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
        void saveCheckpoint(
          identity.sessionId, identity.playerId, uid, serialize(sim), sim.round,
        ).catch(() => {});
      }

      if (sim.outcome !== 'running') {
        void saveResult(
          identity.sessionId, identity.playerId, uid, summarize(sim), sim.round,
        ).catch(
        );
      }
    };

    useSimStore.setState({ onTicked: report });

    const onHide = () => {
      const sim = useSimStore.getState().sim;
      const { identity, uid } = get();
      if (sim && identity && uid) {
        void saveCheckpoint(
          identity.sessionId, identity.playerId, uid, serialize(sim), sim.round,
        ).catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      useSimStore.setState({ onTicked: undefined });
      document.removeEventListener('visibilitychange', onHide);
    };
  },

  /**
   * A tick-0 checkpoint is a real one: planning assignments are applied by
   * `applyOnly`, which never advances the tick, so rejecting tick 0 (as this
   * used to) is exactly what threw away a student's staged plan on refresh.
   *
   * A live run is restored as 'planning', never 'running' — SessionGame
   * promotes it once the clock anchor is in place, so there is never a frame of
   * un-anchored ticking that would desync this client from the room.
   */
  async resumeFromCheckpoint(stage) {
    const { identity } = get();
    if (!identity) return false;
    try {
      const round = roundOf(stage);
      const cp = await loadCheckpoint(identity.sessionId, identity.playerId, round);
      if (!cp) return false;
      // Guard against a checkpoint left over from a different session that
      // shares this browser's stored identity.
      if (cp.seed !== identity.seed) return false;
      // ...and against run 1's snapshot being restored into run 2. Both rounds
      // share a seed, so the seed check above cannot catch this on its own; a
      // checkpoint written before `round` existed is a round-1 one.
      if ((cp.round ?? 1) !== round) return false;
      const state = deserialize(cp);
      if (!state) return false;
      const phase: GamePhase =
        state.outcome !== 'running' ? 'done' : stage === 'lobby' ? 'lobby' : 'planning';
      useSimStore.setState({
        sim: state,
        version: 1,
        phase,
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

  async saveRoundResult() {
    const sim = useSimStore.getState().sim;
    const { identity } = get();
    if (!sim || !identity) return;
    // Do not give up when the uid has not reached the store yet. This runs once,
    // at the moment a run ends, and the halt that triggers it can land during
    // boot — silently skipping the only write is how the debrief ended up with
    // nothing to read. Everything else that writes is periodic and retries.
    let uid = get().uid;
    if (!uid) {
      try {
        uid = await ensureAnonAuth();
        set({ uid });
      } catch {
        return;
      }
    }
    try {
      await saveResult(
        identity.sessionId,
        identity.playerId,
        uid,
        summarize(sim),
        sim.round,
      );
    } catch (e) {
      // Never block a stage transition on this — but do say so. A silently
      // swallowed failure here is invisible until the debrief turns up empty.
      console.error('[checkout-rush] could not save the round result', e);
    }
  },

  checkpointNow() {
    const sim = useSimStore.getState().sim;
    const { identity, uid } = get();
    if (!sim || !identity || !uid) return;
    lastCheckpointAt = Date.now();
    void saveCheckpoint(
      identity.sessionId,
      identity.playerId,
      uid,
      serialize(sim),
      sim.round,
    ).catch(() => {});
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
          round: sim.round,
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

// Dev-only hook, mirroring __simStore: identity and uid are only observable
// from here, and a room bug is usually a question about one of them.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__sessionStore = useSessionStore;
}
