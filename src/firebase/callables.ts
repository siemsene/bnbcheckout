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
