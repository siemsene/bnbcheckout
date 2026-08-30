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

/**
 * How many runs this session is. 'single' is the original format and stays the
 * default; 'two-run' adds a planning stage and a second run after the first.
 * Practice mode has neither and is unaffected by any of it.
 */
export type SessionFormat = 'single' | 'two-run';

/** What run 2 faces: the identical morning, or the same job on a different day. */
export type ReplayScenario = 'sameSeed' | 'newChaos';

export interface SessionSettings {
  simDeadlineMin: number;
  compression: number;
  /** Minutes the planning stage may run before the sim starts regardless. */
  planningMinutes: number;
  /** Absent on sessions created before two-run existed — treat as 'single'. */
  format?: SessionFormat;
  /** Only meaningful when format is 'two-run'. Defaults to 'sameSeed'. */
  replayScenario?: ReplayScenario;
  /** Minutes the between-runs planning stage may run. */
  planMinutes?: number;
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
  /**
   * Two-run only. When the plan stage opened, and when run 2 starts. Both are
   * server-stamped for the same reason `runStartsAt` is: every client derives
   * its own stage from them, so a skewed instructor clock must never get in.
   */
  planOpensAt?: Timestamp | null;
  run2StartsAt?: Timestamp | null;
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
  /** Which run this row describes. Absent on single-run sessions (implicitly 1). */
  round?: 1 | 2;
  /** Set only by the markReady callable; clients are blocked by rules. */
  ready?: boolean;
}

export const DEFAULT_PLANNING_MINUTES = 5;

/** "Starting in 5… 4… 3…" window before the run, mirrored in functions. */
export const COUNTDOWN_MS = 5_000;

export type Stage =
  | 'lobby'
  | 'planning'
  | 'countdown'
  | 'running'
  /** Run 1 is over; results are up and the room waits for the instructor. */
  | 'review1'
  /** The plan board is open between the two runs. */
  | 'plan2'
  | 'countdown2'
  | 'running2'
  | 'ended';

/** Which run a stage belongs to. */
export function roundOf(stage: Stage): 1 | 2 {
  return stage === 'plan2' || stage === 'countdown2' || stage === 'running2' ? 2 : 1;
}

export function isTwoRun(session: SessionDoc | null): boolean {
  return session?.settings?.format === 'two-run';
}

/** Wall-clock milliseconds one full run lasts for this session's compression. */
export function runWindowMs(session: SessionDoc | null): number {
  const deadlineMin = session?.settings?.simDeadlineMin ?? 120;
  const compression = session?.settings?.compression ?? 8;
  return ((deadlineMin * 60) / compression) * 1000;
}

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

  // Newest timestamp first, so a later stage always wins. Everything below is
  // arithmetic on server-stamped instants: no client has to be awake at a
  // transition, and a refresher or late joiner lands on the same answer.
  const twoRun = isTwoRun(session);

  if (twoRun) {
    const r2 = session.run2StartsAt?.toMillis();
    if (r2 != null) {
      if (nowMs >= r2) return 'running2';
      return nowMs >= r2 - COUNTDOWN_MS ? 'countdown2' : 'plan2';
    }
    const planAt = session.planOpensAt?.toMillis();
    if (planAt != null && nowMs >= planAt) return 'plan2';
  }

  const startsAt = session.runStartsAt?.toMillis();
  if (startsAt == null) return 'planning';
  if (nowMs >= startsAt) {
    // In a two-run session, run 1 ending is a stage of its own: the room sits on
    // its results until the instructor opens planning. Derived from the run's
    // known length rather than a written flag, so it needs no actor either.
    if (twoRun && nowMs >= startsAt + runWindowMs(session)) return 'review1';
    return 'running';
  }
  return nowMs >= startsAt - COUNTDOWN_MS ? 'countdown' : 'planning';
}

/** True once a player's own run is over, however it ended. */
export function playerIsDone(p: PlayerDoc): boolean {
  return p.phase === 'finished' || p.phase === 'abandoned';
}

export async function ensureAnonAuth(): Promise<string> {
  const a = auth();
  const current = a.currentUser;
  if (current?.isAnonymous) return current.uid;

  // A real (instructor/admin) account is signed in on this page's Auth
  // instance. That only happens when an instructor navigates to a student
  // page inside the same tab, where Auth was already built browser-wide.
  // Both ways out are wrong: reusing the account stamps the instructor's uid
  // onto a player doc, and signing in anonymously replaces the shared record
  // and signs the instructor out of every tab. Say so instead.
  if (current) {
    throw new Error(
      'You are signed in as an instructor in this tab. Open the student page ' +
        'in a new tab to join as a student.',
    );
  }

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
  /**
   * Which run this progress belongs to. Load-bearing, not decorative: the
   * security rules only allow simMinute to go backwards when the round goes up,
   * so omitting this would deny every round-2 write.
   */
  round: 1 | 2;
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

/**
 * Per-round document names. Round 1 keeps the original names so existing
 * sessions and the single-run format are untouched; round 2 gets its own, which
 * is what stops the replay overwriting run 1 and destroying the very comparison
 * the two-run format exists to show.
 *
 * The rules match `private/{doc}` generically, so no rules change is needed.
 */
const privateDoc = (base: 'checkpoint' | 'result', round: 1 | 2 = 1) =>
  round === 1 ? base : `${base}-2`;

export async function saveCheckpoint(
  sessionId: string,
  playerId: string,
  uid: string,
  cp: Checkpoint,
  round: 1 | 2 = 1,
): Promise<void> {
  await setDoc(
    doc(
      db(), 'sessions', sessionId, 'players', playerId,
      'private', privateDoc('checkpoint', round),
    ),
    { ...cp, uid, savedAt: serverTimestamp() },
  );
}

export async function loadCheckpoint(
  sessionId: string,
  playerId: string,
  round: 1 | 2 = 1,
): Promise<Checkpoint | null> {
  const snap = await getDoc(
    doc(
      db(), 'sessions', sessionId, 'players', playerId,
      'private', privateDoc('checkpoint', round),
    ),
  );
  return snap.exists() ? (snap.data() as Checkpoint) : null;
}

export async function saveResult(
  sessionId: string,
  playerId: string,
  uid: string,
  result: ResultSummary,
  round: 1 | 2 = 1,
): Promise<void> {
  await setDoc(
    doc(
      db(), 'sessions', sessionId, 'players', playerId,
      'private', privateDoc('result', round),
    ),
    { ...result, uid, savedAt: serverTimestamp() },
  );
}

export async function loadResult(
  sessionId: string,
  playerId: string,
  round: 1 | 2 = 1,
): Promise<ResultSummary | null> {
  const snap = await getDoc(
    doc(
      db(), 'sessions', sessionId, 'players', playerId,
      'private', privateDoc('result', round),
    ),
  );
  return snap.exists() ? (snap.data() as ResultSummary) : null;
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
  /**
   * University / institution, collected at registration. Optional because
   * accounts created before the field existed do not carry it — the admin
   * screen shows those as "not given" rather than hiding them.
   */
  affiliation?: string;
  status: 'pending' | 'approved' | 'rejected';
}

/**
 * Admin-only: fill in or correct an instructor's university affiliation.
 *
 * Needed because affiliation was added after the first accounts existed, and
 * because the missing-profile repair path in authStore has no affiliation to
 * write. `allow update: if isAdmin()` already covers this — no rules change.
 */
export async function setInstructorAffiliation(
  uid: string,
  affiliation: string,
): Promise<void> {
  await updateDoc(doc(db(), 'users', uid), { affiliation: affiliation.trim() });
}

export function subscribeInstructors(
  cb: (users: InstructorDoc[]) => void,
  onError?: (e: Error) => void,
): Unsubscribe {
  // The error callback is load-bearing. This listener is attached the moment
  // `isAdmin` flips true, which can be before Firestore has picked up the
  // refreshed ID token carrying the admin claim — the read is then denied, and
  // a denied listener never retries. Without this the screen sat on "Nothing
  // pending — you're all caught up", which reads as success rather than a
  // permission failure that a reload would clear.
  return onSnapshot(
    collection(db(), 'users'),
    (snap) => {
      cb(snap.docs.map((d) => ({ uid: d.id, ...d.data() }) as InstructorDoc));
    },
    (e) => onError?.(e),
  );
}
