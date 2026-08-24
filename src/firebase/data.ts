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
  type Unsubscribe,
} from 'firebase/firestore';
import { signInAnonymously } from 'firebase/auth';
import { auth, db } from './client';
import type { Checkpoint } from '../engine/serialize';
import type { ResultSummary } from '../engine/scoring';

export interface SessionDoc {
  id: string;
  code: string;
  instructorUid: string;
  title: string;
  status: 'lobby' | 'running' | 'ended';
  playerCount: number;
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
