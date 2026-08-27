// Typed wrappers for the Cloud Functions callables.

import { httpsCallable } from 'firebase/functions';
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

export async function createSession(
  title: string,
  planningMinutes?: number,
): Promise<{ sessionId: string; code: string }> {
  const fn = httpsCallable<
    { title: string; planningMinutes?: number },
    { sessionId: string; code: string }
  >(fns(), 'createSession');
  return (await fn({ title, planningMinutes })).data;
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
  action: 'openPlanning' | 'startNow' | 'end',
): Promise<SessionControlResult> {
  const fn = httpsCallable<
    { sessionId: string; action: string },
    SessionControlResult
  >(fns(), 'sessionControl');
  return (await fn({ sessionId, action })).data;
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
