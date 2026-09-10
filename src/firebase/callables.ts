// Typed wrappers for the Cloud Functions callables.

import { httpsCallable } from 'firebase/functions';
import type { ReplayScenario, SessionFormat } from './data';
import { fns } from './client';

export interface JoinSessionResult {
  sessionId: string;
  playerId: string;
  seed: number;
  rejoined: boolean;
  /** Server wall-clock at join, so the client can correct its own clock. */
  serverNowMs: number;
}

export async function joinSession(code: string, name: string): Promise<JoinSessionResult> {
  const fn = httpsCallable<{ code: string; name: string }, JoinSessionResult>(
    fns(),
    'joinSession',
  );
  return (await fn({ code, name })).data;
}

export interface CreateSessionOptions {
  planningMinutes?: number;
  /** 'single' (default) is the original one-run format. */
  format?: SessionFormat;
  /** Two-run only: what run 2 faces. */
  replayScenario?: ReplayScenario;
  /** Two-run only: minutes the plan board stays open between the runs. */
  planMinutes?: number;
}

export async function createSession(
  title: string,
  opts: CreateSessionOptions = {},
): Promise<{ sessionId: string; code: string }> {
  const fn = httpsCallable<
    { title: string } & CreateSessionOptions,
    { sessionId: string; code: string }
  >(fns(), 'createSession');
  return (await fn({ title, ...opts })).data;
}

export interface MarkReadyResult {
  readyCount: number;
  playerCount: number;
  allReady: boolean;
  /** Millis since epoch when the room's run starts (null while unset). */
  runStartsAtMs: number | null;
  serverNowMs: number;
}

export async function markReady(
  sessionId: string,
  playerId: string,
): Promise<MarkReadyResult> {
  const fn = httpsCallable<{ sessionId: string; playerId: string }, MarkReadyResult>(
    fns(),
    'markReady',
  );
  return (await fn({ sessionId, playerId })).data;
}

export interface SessionControlResult {
  status: string;
  runStartsAtMs: number | null;
  serverNowMs: number;
}

export async function sessionControl(
  sessionId: string,
  action:
    | 'openPlanning'
    | 'startNow'
    | 'end'
    | 'openPlan2'
    | 'startNow2'
    | 'skipToPlan2',
  /** openPlan2 only: move on even though some students are still playing. */
  opts: { force?: boolean } = {},
): Promise<SessionControlResult> {
  const fn = httpsCallable<
    { sessionId: string; action: string; force?: boolean },
    SessionControlResult
  >(fns(), 'sessionControl');
  return (await fn({ sessionId, action, ...opts })).data;
}

/**
 * Remove a finished session and everything under it. Server-side because the
 * rules forbid client deletes outright, and because players, name tickets and
 * private checkpoints all hang off the session doc.
 */
export async function deleteSession(
  sessionId: string,
): Promise<{ deleted: boolean; alreadyGone: boolean }> {
  const fn = httpsCallable<
    { sessionId: string },
    { deleted: boolean; alreadyGone: boolean }
  >(fns(), 'deleteSession');
  return (await fn({ sessionId })).data;
}

export async function getServerTime(): Promise<number> {
  const fn = httpsCallable<Record<string, never>, { serverNowMs: number }>(
    fns(),
    'getServerTime',
  );
  return (await fn({})).data.serverNowMs;
}

export async function approveInstructor(uid: string, approve: boolean): Promise<void> {
  const fn = httpsCallable<{ uid: string; approve: boolean }, void>(
    fns(),
    'approveInstructor',
  );
  await fn({ uid, approve });
}

export async function setAdminClaim(): Promise<void> {
  const fn = httpsCallable<Record<string, never>, void>(fns(), 'setAdminClaim');
  await fn({});
}

// --- admin usage ----------------------------------------------------------

/** One instructor account, with the reach of their sessions attached. */
export interface InstructorUsage {
  uid: string;
  email: string;
  displayName: string;
  affiliation: string | null;
  status: 'pending' | 'approved' | 'rejected';
  createdAtMs: number | null;
  /**
   * Distinct students across all of this instructor's sessions. Lower than the
   * seat count whenever the same class comes back for a second session, which
   * is exactly the difference worth seeing.
   */
  distinctStudents: number;
}

/** One session, reduced to the counts the usage screen and cost model need. */
export interface SessionUsageRow {
  id: string;
  title: string;
  instructorUid: string;
  createdAtMs: number | null;
  endedAtMs: number | null;
  format: 'single' | 'two-run';
  simDeadlineMin: number;
  compression: number;
  /** Player documents — one per student per session. */
  players: number;
  distinctStudents: number;
  runsPlayed: 0 | 1 | 2;
  finished: number;
}

/**
 * One instructor's purged sessions, reduced to counts that outlive them.
 *
 * Written by the nightly purge and by deleteSession, just before the session
 * itself goes. Added to the live sessions, this is what makes the headline
 * numbers lifetime totals instead of a rolling 30-day window.
 */
export interface ArchiveRow {
  instructorUid: string;
  sessions: number;
  /** Student-sessions. Distinct humans cannot survive the purge; see below. */
  seats: number;
  runs: number;
  biggestClass: number;
  firstSessionAtMs: number | null;
  lastSessionAtMs: number | null;
  /**
   * Session shapes — `players|runs|format|deadlineMin|compression` → count — so
   * purged sessions can be re-priced by today's cost model rather than one
   * frozen on the night they were deleted.
   */
  sizes: Record<string, number>;
}

export interface UsageStats {
  generatedAtMs: number;
  /**
   * How long a session stays queryable in full. Past this it survives only as
   * the counts in `archive`: no title, no per-student detail, and in particular
   * no distinct-student figure, because the anonymous uids that identified them
   * are deleted along with the players.
   */
  retentionDays: number;
  /** What producing this answer cost, in billable document reads. */
  docsRead: number;
  instructors: InstructorUsage[];
  /** Sessions still inside the retention window, in full detail. */
  sessions: SessionUsageRow[];
  /** Everything already purged, as durable per-instructor counts. */
  archive: ArchiveRow[];
}

/**
 * Admin-only usage roll-up. Returns measured counts only — the money figure is
 * derived on this side, in `billing/costModel`, so the pricing assumptions stay
 * readable and testable instead of being buried in a deployed function.
 */
export async function usageStats(): Promise<UsageStats> {
  const fn = httpsCallable<Record<string, never>, UsageStats>(fns(), 'usageStats');
  return (await fn({})).data;
}
