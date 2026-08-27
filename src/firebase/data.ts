// Firestore reads/writes shared by student, instructor, and admin screens.

import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  Timestamp,
  type Unsubscribe,
} from 'firebase/firestore';
import { signInAnonymously } from 'firebase/auth';
import { auth, db } from './client';
import type { Checkpoint } from '../engine/serialize';
import type { ResultSummary } from '../engine/scoring';

export interface SessionSettings {
  simDeadlineMin: number;
  compression: number;
  /** Minutes the planning stage may run before the sim starts regardless. */
  planningMinutes: number;
}

export interface SessionDoc {
  id: string;
  code: string;
  instructorUid: string;
  title: string;
  /** 'planning' and 'running' are advisory; the real stage boundary is
   * `runStartsAt` (see stageOf) so no client has to be awake at the moment. */
  status: 'lobby' | 'planning' | 'running' | 'ended';
  playerCount: number;
  /** The instant the whole room's clock starts. Absolute, server-stamped. */
  runStartsAt?: Timestamp | null;
  settings?: SessionSettings;
  createdAt?: Timestamp;
  startedAt?: Timestamp;
  endedAt?: Timestamp;
}

export interface PlayerDoc {
  id: string;
  name: string;
  uid: string;
  phase: 'lobby' | 'planning' | 'running' | 'finished' | 'abandoned';
  simMinute: number;
  pctComplete: number;
  utilizationAvg: number;
  finished: boolean;
  finishSimMinute: number | null;
  score: number;
  seed: number;
  /** Set only by the markReady callable; clients are blocked by rules. */
  ready?: boolean;
}

export const DEFAULT_PLANNING_MINUTES = 5;

/** "Starting in 5… 4… 3…" window before the run, mirrored in functions. */
export const COUNTDOWN_MS = 5_000;

export type Stage = 'lobby' | 'planning' | 'countdown' | 'running' | 'ended';

/**
 * The room's stage, derived rather than broadcast: every client computes the
 * same answer from the same timestamp, so refreshers and late arrivals can't
 * miss the transition.
 *
 * `status` records what a human authority explicitly did; which side of
 * `runStartsAt` we are on is pure arithmetic. Legacy docs may carry
 * `status: 'running'` — treated as an alias for 'planning'. Nothing writes it
 * any more: doing so would re-introduce the "somebody must be awake at the
 * transition instant" problem this design removes.
 */
export function stageOf(session: SessionDoc | null, nowMs: number): Stage {
  if (!session) return 'lobby';
  if (session.status === 'ended') return 'ended';
  if (session.status === 'lobby') return 'lobby';
  const startsAt = session.runStartsAt?.toMillis();
  if (startsAt == null) return 'planning';
  if (nowMs >= startsAt) return 'running';
  return nowMs >= startsAt - COUNTDOWN_MS ? 'countdown' : 'planning';
}

/** True once a player's own run is over, however it ended. */
export function playerIsDone(p: PlayerDoc): boolean {
  return p.phase === 'finished' || p.phase === 'abandoned';
}

export async function ensureAnonAuth(): Promise<string> {
  const a = auth();
  if (a.currentUser) return a.currentUser.uid;
  const cred = await signInAnonymously(a);
  return cred.user.uid;
}

export function subscribeSession(
  sessionId: string,
  cb: (s: SessionDoc | null) => void,
): Unsubscribe {
  return onSnapshot(doc(db(), 'sessions', sessionId), (snap) => {
    cb(snap.exists() ? ({ id: snap.id, ...snap.data() } as SessionDoc) : null);
  });
}

export function subscribePlayers(
  sessionId: string,
  cb: (players: PlayerDoc[]) => void,
): Unsubscribe {
  const q = query(
    collection(db(), 'sessions', sessionId, 'players'),
    orderBy('score', 'desc'),
  );
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as PlayerDoc));
  });
}

export interface ProgressUpdate {
  phase: PlayerDoc['phase'];
  simMinute: number;
  pctComplete: number;
  utilizationAvg: number;
  finished: boolean;
  finishSimMinute: number | null;
  score: number;
}

export async function writeProgress(
  sessionId: string,
  playerId: string,
  p: ProgressUpdate,
): Promise<void> {
  await updateDoc(doc(db(), 'sessions', sessionId, 'players', playerId), {
    ...p,
    lastWriteAt: serverTimestamp(),
  });
}

export async function saveCheckpoint(
  sessionId: string,
  playerId: string,
  uid: string,
  cp: Checkpoint,
): Promise<void> {
  await setDoc(doc(db(), 'sessions', sessionId, 'players', playerId, 'private', 'checkpoint'), {
    ...cp,
    uid,
    savedAt: serverTimestamp(),
  });
}

export async function loadCheckpoint(
  sessionId: string,
  playerId: string,
): Promise<Checkpoint | null> {
  const snap = await getDoc(
    doc(db(), 'sessions', sessionId, 'players', playerId, 'private', 'checkpoint'),
  );
  return snap.exists() ? (snap.data() as Checkpoint) : null;
}

export async function saveResult(
  sessionId: string,
  playerId: string,
  uid: string,
  result: ResultSummary,
): Promise<void> {
  await setDoc(doc(db(), 'sessions', sessionId, 'players', playerId, 'private', 'result'), {
    ...result,
    uid,
    savedAt: serverTimestamp(),
  });
}

// --- instructor -----------------------------------------------------------

export function subscribeMySessions(
  uid: string,
  cb: (sessions: SessionDoc[]) => void,
): Unsubscribe {
  const q = query(collection(db(), 'sessions'), where('instructorUid', '==', uid));
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as SessionDoc));
  });
}

export async function setSessionStatus(
  sessionId: string,
  instructorUid: string,
  status: SessionDoc['status'],
): Promise<void> {
  await updateDoc(doc(db(), 'sessions', sessionId), {
    status,
    instructorUid,
    ...(status === 'running' ? { startedAt: serverTimestamp() } : {}),
    ...(status === 'ended' ? { endedAt: serverTimestamp() } : {}),
  });
}

// Stage transitions are NOT written from here — they go through the
// `sessionControl` callable so the server stamps the timing. An instructor
// clock that is minutes off would otherwise be baked into the one timestamp
// every student derives their stage and sim-clock from.

// --- admin ----------------------------------------------------------------

export interface InstructorDoc {
  uid: string;
  email: string;
  displayName: string;
  status: 'pending' | 'approved' | 'rejected';
}

export function subscribeInstructors(
  cb: (users: InstructorDoc[]) => void,
): Unsubscribe {
  return onSnapshot(collection(db(), 'users'), (snap) => {
    cb(snap.docs.map((d) => ({ uid: d.id, ...d.data() }) as InstructorDoc));
  });
}
