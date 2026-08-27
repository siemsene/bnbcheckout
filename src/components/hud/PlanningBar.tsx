// The planning-stage banner. Practice mode starts its own clock; a classroom
// session instead waits for the whole room (or the countdown) before starting.

import { formatCountdown } from '../../state/useRoomStage';

export function PracticePlanningBar({ onStart }: { onStart: () => void }) {
  return (
    <div className="panel planning-bar">
      <strong>Planning time</strong>
      <span style={{ color: 'var(--ink-soft)', flex: 1 }}>
        The clock is frozen. Stage your first assignments, then start the morning.
      </span>
      <button className="btn-big" onClick={onStart}>
        ▶ Start the clock
      </button>
    </div>
  );
}

export function SessionPlanningBar({
  msUntilStart,
  readyCount,
  playerCount,
  ready,
  pending,
  error,
  onReady,
}: {
  msUntilStart: number;
  readyCount: number;
  playerCount: number;
  ready: boolean;
  pending: boolean;
  error: string | null;
  onReady: () => void;
}) {
  return (
    <div className="panel planning-bar">
      <strong>Planning — {formatCountdown(msUntilStart)} left</strong>
      <span style={{ color: 'var(--ink-soft)', flex: 1 }}>
        {error ? (
          <span style={{ color: 'var(--danger)', fontWeight: 700 }} role="alert">
            {error}
          </span>
        ) : (
          <>
            {ready
              ? 'You’re ready. The morning starts as soon as everyone else is — or when the timer runs out.'
              : 'The clock is frozen. Stage your first assignments, then tell the class you’re ready.'}{' '}
            <strong>
              {readyCount} of {playerCount} ready
            </strong>
          </>
        )}
      </span>
      {ready ? (
        <span className="ready-badge" role="status">
          ✓ Ready
        </span>
      ) : (
        <button className="btn-big" onClick={onReady} disabled={pending}>
          {pending ? 'Sending…' : 'I’m ready →'}
        </button>
      )}
    </div>
  );
}

export function CountdownOverlay({ msUntilStart }: { msUntilStart: number }) {
  const seconds = Math.max(1, Math.ceil(msUntilStart / 1000));
  return (
    <div className="overlay countdown-overlay">
      <div style={{ textAlign: 'center', color: '#fff' }}>
        <div style={{ fontSize: '1.2rem', opacity: 0.85 }}>Everyone’s ready…</div>
        <div className="countdown-number" aria-live="assertive">
          {seconds}
        </div>
        <div style={{ fontSize: '1.05rem', opacity: 0.85 }}>
          Checkout starts for the whole class
        </div>
      </div>
    </div>
  );
}
