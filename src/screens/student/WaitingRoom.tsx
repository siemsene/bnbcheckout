// Shown between "my run is over" and "the whole class is done".
//
// Results stay locked deliberately: an early finisher who could see the Gantt
// and the discovered-constraint recap would happily narrate it to the person
// next to them, who is still playing.

import { summarize } from '../../engine/scoring';
import { useSimStore } from '../../state/simStore';
import { LeaderboardPanel } from './LeaderboardPanel';
import { formatCountdown } from '../../state/useRoomStage';

export function WaitingRoom({
  sessionId,
  playerId,
  remaining,
  msUntilRunOver,
}: {
  sessionId: string;
  playerId: string;
  /** How many classmates are still playing. */
  remaining: number;
  /** Wall-clock left before the run is over for everyone regardless. */
  msUntilRunOver: number;
}) {
  const sim = useSimStore((s) => s.sim);
  if (!sim) return null;
  const r = summarize(sim);
  const finished = r.outcome === 'finished';

  return (
    <div className="overlay">
      <div className="overlay-card" style={{ maxWidth: 760 }}>
        <h1>{finished ? '✅ You’re done!' : '⏰ Time’s up for you'}</h1>
        <p style={{ fontSize: '1.05rem' }}>
          {finished ? (
            <>
              Everything done and away by{' '}
              <strong>
                {Math.floor(8 + r.finishSimMinute! / 60)}:
                {String(Math.floor(r.finishSimMinute!) % 60).padStart(2, '0')} AM
              </strong>
              .
            </>
          ) : (
            <>
              You got <strong>{Math.round(r.pctComplete * 100)}%</strong> of the work
              done before 10 AM.
            </>
          )}
        </p>

        <p className="panel" style={{ padding: '12px 16px' }} role="status">
          {remaining > 0 ? (
            <>
              Waiting for <strong>{remaining}</strong>{' '}
              {remaining === 1 ? 'classmate' : 'classmates'} to finish
              {msUntilRunOver > 0 && <> — at most {formatCountdown(msUntilRunOver)} more</>}.
              Your full results unlock when the class is done.
            </>
          ) : (
            <>Wrapping up the class results…</>
          )}
        </p>

        <h3 style={{ margin: '18px 0 8px', textAlign: 'left' }}>Live leaderboard</h3>
        <LeaderboardPanel
          sessionId={sessionId}
          highlightPlayerId={playerId}
          revealScatter={false}
        />
      </div>
    </div>
  );
}
