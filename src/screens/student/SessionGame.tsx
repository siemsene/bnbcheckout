// The session-wired game: seed comes from the server, progress is reported,
// checkpoints allow resume, and the leaderboard is shown alongside results.

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSimStore } from '../../state/simStore';
import { useSessionStore } from '../../state/sessionStore';
import { subscribeSession, type SessionDoc } from '../../firebase/data';
import { ensureAnonAuth } from '../../firebase/data';
import { Lobby } from './Lobby';
import { SimScreen } from './SimScreen';
import { Results } from './Results';
import { LeaderboardPanel } from './LeaderboardPanel';

export function SessionGame() {
  const navigate = useNavigate();
  const identity = useSessionStore((s) => s.identity);
  const restore = useSessionStore((s) => s.restore);
  const resumeFromCheckpoint = useSessionStore((s) => s.resumeFromCheckpoint);
  const attachReporting = useSessionStore((s) => s.attachReporting);
  const phase = useSimStore((s) => s.phase);
  const sim = useSimStore((s) => s.sim);
  const newGame = useSimStore((s) => s.newGame);
  const [session, setSession] = useState<SessionDoc | null>(null);
  const [ready, setReady] = useState(false);
  const [showBoard, setShowBoard] = useState(false);

  // Restore identity / bounce to join.
  useEffect(() => {
    const id = identity ?? restore();
    if (!id) {
      navigate('/join');
      return;
    }
    let cancelled = false;
    (async () => {
      await ensureAnonAuth();
      useSessionStore.setState({ uid: (await ensureAnonAuth()) });
      const resumed = await resumeFromCheckpoint();
      if (cancelled) return;
      if (!resumed) newGame(id.seed);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Report progress while playing.
  useEffect(() => {
    if (!ready) return;
    return attachReporting();
  }, [ready, attachReporting]);

  // Watch session status (instructor can end it).
  useEffect(() => {
    const id = useSessionStore.getState().identity;
    if (!id || !ready) return;
    return subscribeSession(id.sessionId, setSession);
  }, [ready]);

  if (!ready || !sim) return null;

  const ended = session?.status === 'ended';

  return (
    <>
      <SimScreen />
      {phase === 'lobby' && <Lobby />}
      {(phase === 'done' || ended) && !showBoard && (
        <Results onPlayAgain={() => setShowBoard(true)} playAgainLabel="See the class leaderboard →" />
      )}
      {(phase === 'done' || ended) && showBoard && (
        <div className="overlay">
          <div className="overlay-card" style={{ maxWidth: 760 }}>
            <h1>Class leaderboard</h1>
            <LeaderboardPanel
              sessionId={useSessionStore.getState().identity!.sessionId}
              highlightPlayerId={useSessionStore.getState().identity!.playerId}
              revealScatter={ended}
            />
            <button className="btn-ghost" onClick={() => setShowBoard(false)} style={{ marginTop: 14 }}>
              ← Back to my results
            </button>
          </div>
        </div>
      )}
    </>
  );
}
