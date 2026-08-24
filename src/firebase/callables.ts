// Typed wrappers for the Cloud Functions callables.

import { httpsCallable } from 'firebase/functions';
import { fns } from './client';

export interface JoinSessionResult {
  sessionId: string;
  playerId: string;
  seed: number;
  rejoined: boolean;
}

export async function joinSession(code: string, name: string): Promise<JoinSessionResult> {
  const fn = httpsCallable<{ code: string; name: string }, JoinSessionResult>(
    fns(),
    'joinSession',
  );
  return (await fn({ code, name })).data;
}

export async function createSession(title: string): Promise<{ sessionId: string; code: string }> {
  const fn = httpsCallable<{ title: string }, { sessionId: string; code: string }>(
    fns(),
    'createSession',
  );
  return (await fn({ title })).data;
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
