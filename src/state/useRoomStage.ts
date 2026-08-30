// The classroom room-stage, derived on every client from one timestamp.
//
// Nothing broadcasts "start now": the session doc carries `runStartsAt`, and
// each client independently decides which side of it the clock is on. A student
// who refreshes, joins late, or was offline reaches the same answer, so nobody
// can miss the transition.

import { useEffect, useState } from 'react';
import {
  playerIsDone,
  roundOf,
  stageOf,
  type PlayerDoc,
  type SessionDoc,
  type Stage,
} from '../firebase/data';
import { runWallClockMs } from './simStore';
import { useSessionStore } from './sessionStore';

/** How often stage/countdown derivations re-evaluate. */
const TICK_MS = 250;
/** Slack after the last possible finish before we call the run over. */
const RUN_OVER_GRACE_MS = 10_000;

export interface RoomStage {
  session: SessionDoc | null;
  players: PlayerDoc[];
  stage: Stage;
  /** Which run the room is on. 1 for every single-run session. */
  round: 1 | 2;
  /** Run start in *client* clock terms (skew-corrected), or null. */
  anchorMs: number | null;
  /** Milliseconds until the run starts; 0 once it has. */
  msUntilStart: number;
  readyCount: number;
  playerCount: number;
  /** Every player's run is over, so results may be revealed to everyone. */
  allDone: boolean;
}

export function useRoomStage(): RoomStage {
  const session = useSessionStore((s) => s.session);
  const players = useSessionStore((s) => s.players);
  const serverOffsetMs = useSessionStore((s) => s.serverOffsetMs);
  const [, forceTick] = useState(0);

  useEffect(() => {
    const t = setInterval(() => forceTick((n) => n + 1), TICK_MS);
    return () => clearInterval(t);
  }, []);

  const now = Date.now() + serverOffsetMs;
  const stage = stageOf(session, now);

  const round = roundOf(stage);
  // Each round anchors to its own start instant, so run 2's sim-clock is not
  // measured from run 1's.
  const startsAtServerMs =
    (round === 2
      ? session?.run2StartsAt?.toMillis()
      : session?.runStartsAt?.toMillis()) ?? null;
  // Convert the server instant into this client's own clock once, so the hot
  // sim loop can stay on a plain Date.now().
  const anchorMs =
    startsAtServerMs == null ? null : startsAtServerMs - serverOffsetMs;

  const msUntilStart =
    startsAtServerMs == null ? 0 : Math.max(0, startsAtServerMs - now);

  const readyCount = players.filter((p) => p.ready === true).length;

  // Note `p.finished` means "completed every task" — a player who ran out of
  // time has finished: false but phase: 'finished'. The phase is the predicate.
  const everyoneFinished = players.length > 0 && players.every(playerIsDone);
  // Backstop: the run has a hard 2-sim-hour deadline, so past its wall-clock
  // length every run has ended whether or not an abandoned tab said so.
  const pastRunWindow =
    anchorMs != null && Date.now() > anchorMs + runWallClockMs() + RUN_OVER_GRACE_MS;
  const inRun = stage === 'running' || stage === 'running2';
  const allDone =
    stage === 'ended' ||
    // review1 exists precisely because run 1 is over; results are meant to be up.
    stage === 'review1' ||
    (inRun && (everyoneFinished || pastRunWindow));

  return {
    session,
    players,
    stage,
    round,
    anchorMs,
    msUntilStart,
    readyCount,
    playerCount: players.length,
    allDone,
  };
}

/** mm:ss for the planning countdown. */
export function formatCountdown(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
