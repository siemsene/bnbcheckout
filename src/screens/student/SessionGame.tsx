// The session-wired game, and the client half of the two-stage classroom flow.
//
// Everything room-wide is derived from the session doc's `runStartsAt` rather
// than pushed by an event, so this component's job is just: watch the doc, work
// out which stage the room is in, and keep the sim store in step with it.

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { setSimSpeed, useSimStore } from '../../state/simStore';
import { useSessionStore } from '../../state/sessionStore';
import { useRoomStage } from '../../state/useRoomStage';
import { ensureAnonAuth, loadResult, playerIsDone, stageOf } from '../../firebase/data';
import { hashSeed } from '../../engine/rng';
import type { ResultSummary } from '../../engine/scoring';
import { projectPlan } from '../../engine/project';
import { Lobby } from './Lobby';
import { SimScreen } from './SimScreen';
import { Results } from './Results';
import { WaitingRoom } from './WaitingRoom';
import { LeaderboardPanel } from './LeaderboardPanel';
import { CountdownOverlay, SessionPlanningBar } from '../../components/hud/PlanningBar';
import { PlanBoard } from '../../components/plan/PlanBoard';
import { runWallClockMs } from '../../state/simStore';

/**
 * Resolve once the session doc has actually arrived, or after a short grace
 * period so an offline client still boots rather than hanging on a spinner.
 */
function firstSnapshot(timeoutMs = 4000): Promise<void> {
  if (useSessionStore.getState().session) return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      unsub();
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    const unsub = useSessionStore.subscribe((s) => {
      if (s.session) finish();
    });
  });
}

export function SessionGame() {
  const navigate = useNavigate();
  const identity = useSessionStore((s) => s.identity);
  const restore = useSessionStore((s) => s.restore);
  const attachReporting = useSessionStore((s) => s.attachReporting);
  const watchSession = useSessionStore((s) => s.watchSession);
  const markReady = useSessionStore((s) => s.markReady);
  const ready = useSessionStore((s) => s.ready);
  const readyPending = useSessionStore((s) => s.readyPending);
  const readyError = useSessionStore((s) => s.readyError);

  const phase = useSimStore((s) => s.phase);
  const sim = useSimStore((s) => s.sim);

  const [booted, setBooted] = useState(false);
  const [showBoard, setShowBoard] = useState(false);
  // Run 1's summary, fetched once the replay is over so the debrief can put the
  // two runs side by side. The sim state for run 1 is long gone by then.
  const [run1, setRun1] = useState<ResultSummary | null>(null);
  const room = useRoomStage();

  // 1. Identity + clock + session subscription must all be up before we can
  //    decide which stage to restore into.
  useEffect(() => {
    const id = identity ?? restore();
    if (!id) {
      navigate('/join');
      return;
    }
    let cancelled = false;
    let stopWatch: (() => void) | undefined;
    (async () => {
      const uid = await ensureAnonAuth();
      if (cancelled) return;
      useSessionStore.setState({ uid });
      stopWatch = watchSession(id.sessionId);
      // Don't block the boot on this: an uncorrected clock is only wrong by
      // this machine's own skew, and planning lasts minutes.
      void useSessionStore.getState().syncClock();
      // But DO wait for the session doc. `watchSession` only opens the
      // subscription; reading the store straight after it gives null, and
      // `stageOf(null)` is 'lobby' — which in a two-run session means a refresh
      // during run 2 restores run 1's checkpoint and silently rewinds the
      // student a whole round.
      await firstSnapshot();
      if (cancelled) return;
      const stage = stageOf(useSessionStore.getState().session, Date.now());
      const resumed = await useSessionStore.getState().resumeFromCheckpoint(stage);
      if (cancelled) return;
      if (!resumed) useSimStore.getState().newGame(id.seed);
      useSimStore.getState().setPauseAllowed(false); // the room shares one clock
      setBooted(true);
    })();
    return () => {
      cancelled = true;
      stopWatch?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!booted) return;
    return attachReporting();
  }, [booted, attachReporting]);

  // Sim speed is the session's, not whatever /play?speed= last left behind.
  useEffect(() => {
    setSimSpeed(room.session?.settings?.compression ?? 8);
  }, [room.session?.settings?.compression]);

  // 2. Keep the local sim phase in step with the room's stage.
  const promoted = useRef(false);
  const seededRound2 = useRef(false);
  useEffect(() => {
    if (!booted) return;
    const s = useSimStore.getState();
    if (room.stage === 'ended') {
      if (s.phase === 'running' || s.phase === 'planning') {
        s.haltRun();
        useSessionStore.getState().reportNow('done');
      }
      return;
    }
    if (room.stage === 'review1') return; // results are already showing
    if (room.stage === 'planning' || room.stage === 'countdown') {
      if (s.phase === 'lobby') {
        s.beginPlanning();
        useSessionStore.getState().reportNow('planning');
      }
      return;
    }
    // Run 1 is over and the plan board has opened. Keep run 1's result, then
    // build the round-2 state the plan will drive. Guarded by a ref because the
    // effect re-runs on every anchor tick, and re-seeding mid-planning would
    // throw away whatever the student had already dragged into their lanes.
    if (room.stage === 'plan2' || room.stage === 'countdown2') {
      if (!seededRound2.current) {
        seededRound2.current = true;
        void useSessionStore.getState().finishRoundOne();
        const chaosSeed =
          room.session?.settings?.replayScenario === 'newChaos'
            ? hashSeed(`${id!.seed}:r2`)
            : undefined;
        s.newGame(id!.seed, { round: 2, chaosSeed });
        useSimStore.getState().beginPlanning();
        useSimStore.getState().setPauseAllowed(false);
        useSessionStore.getState().reportNow('planning');
      }
      return;
    }

    if (room.stage === 'running2' && room.anchorMs != null) {
      if (useSimStore.getState().phase === 'planning') {
        s.setClockAnchor(room.anchorMs);
        s.startClock();
      } else if (s.phase === 'running' && s.clockAnchorMs == null) {
        s.setClockAnchor(room.anchorMs);
      }
      return;
    }

    if (room.stage === 'running' && room.anchorMs != null) {
      // Anchor first, then start: the clock must never tick unanchored, or this
      // client would drift away from the room by exactly that gap.
      if (s.phase === 'lobby') s.beginPlanning();
      if (useSimStore.getState().phase === 'planning') {
        s.setClockAnchor(room.anchorMs);
        s.startClock();
        promoted.current = true;
      } else if (s.phase === 'running' && s.clockAnchorMs == null) {
        s.setClockAnchor(room.anchorMs);
      }
    }
  }, [booted, room.stage, room.anchorMs]);

  // 3. Checkpoint the staged plan periodically during planning, so a refresh
  //    before the run keeps it (markReady also forces one).
  const version = useSimStore((s) => s.version);
  const lastPlanSave = useRef(0);
  useEffect(() => {
    if (!booted || (room.stage !== 'planning' && room.stage !== 'plan2')) return;
    const t = setTimeout(() => {
      if (Date.now() - lastPlanSave.current < 15_000) return;
      lastPlanSave.current = Date.now();
      useSessionStore.getState().checkpointNow();
    }, 3000);
    return () => clearTimeout(t);
  }, [booted, room.stage, version]);

  useEffect(() => {
    const id = identity;
    if (!id || room.round !== 2 || phase !== 'done' || run1) return;
    void loadResult(id.sessionId, id.playerId, 1).then((r) => r && setRun1(r));
  }, [identity, room.round, phase, run1]);

  if (!booted || !sim) return null;

  const id = identity ?? restore();
  if (!id) return null;

  const myDone = phase === 'done';
  const stillPlaying = room.players.filter((p) => !playerIsDone(p)).length;
  const msUntilRunOver =
    room.anchorMs == null
      ? 0
      : Math.max(0, room.anchorMs + runWallClockMs() - Date.now());

  const showResults = myDone && room.allDone;
  const showWaiting = myDone && !room.allDone;

  return (
    <>
      <SimScreen
        planningBar={
          <SessionPlanningBar
            msUntilStart={room.msUntilStart}
            readyCount={room.readyCount}
            playerCount={room.playerCount}
            ready={ready}
            pending={readyPending}
            error={readyError}
            onReady={markReady}
          />
        }
      />

      {phase === 'lobby' && (
        <Lobby
          canBegin={false}
          waitingMessage={
            room.stage === 'lobby'
              ? 'Waiting for your instructor to open planning…'
              : 'Getting you into the room…'
          }
        />
      )}

      {(room.stage === 'countdown' || room.stage === 'countdown2') && (
        <CountdownOverlay msUntilStart={room.msUntilStart} />
      )}

      {room.stage === 'plan2' && (
        <PlanBoard
          seed={id.seed}
          committed={ready}
          msUntilStart={room.msUntilStart}
          readyCount={room.readyCount}
          playerCount={room.playerCount}
          error={readyError}
          onCommit={(committedPlan) => {
            // Commit before telling the room: markReady forces a checkpoint, and
            // the plan has to already be on the sim when that write happens, or a
            // refresh would come back with an empty board.
            const s = useSimStore.getState().sim;
            if (s) {
              s.plan = committedPlan;
              s.plannedProjection = projectPlan(id.seed, committedPlan);
            }
            void markReady();
          }}
        />
      )}

      {showWaiting && (
        <WaitingRoom
          sessionId={id.sessionId}
          playerId={id.playerId}
          remaining={stillPlaying}
          msUntilRunOver={msUntilRunOver}
        />
      )}

      {showResults && !showBoard && (
        <Results
          onPlayAgain={() => setShowBoard(true)}
          playAgainLabel="See the class leaderboard →"
          previousRun={run1}
        />
      )}
      {showResults && showBoard && (
        <div className="overlay">
          <div className="overlay-card" style={{ maxWidth: 760 }}>
            <h1>Class leaderboard</h1>
            <LeaderboardPanel
              sessionId={id.sessionId}
              highlightPlayerId={id.playerId}
              revealScatter
            />
            <button
              className="btn-ghost"
              onClick={() => setShowBoard(false)}
              style={{ marginTop: 14 }}
            >
              ← Back to my results
            </button>
          </div>
        </div>
      )}
    </>
  );
}
