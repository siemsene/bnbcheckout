// Post-game: celebration headline, score summary, utilization chart slot
// (real dataviz-conformant chart lands in the polish phase), and what-you-
// discovered recap.

import { summarize } from '../../engine/scoring';
import { useSimStore } from '../../state/simStore';
import { UtilizationChart } from '../../components/charts/UtilizationChart';
import { Celebration } from './Celebration';

export function Results({
  onPlayAgain,
  playAgainLabel = 'Play again',
}: {
  onPlayAgain: () => void;
  playAgainLabel?: string;
}) {
  const sim = useSimStore((s) => s.sim);
  if (!sim) return null;
  const r = summarize(sim);
  const finished = r.outcome === 'finished';

  return (
    <div className="overlay">
      {finished && <Celebration />}
      <div className="overlay-card">
        {finished && (
          <img
            src="/assets/scene/celebration.jpg"
            alt="The five friends celebrating in front of the loaded car"
            style={{ width: '100%', borderRadius: 14, marginBottom: 12 }}
          />
        )}
        <h1>{finished ? '🎉 Checkout complete!' : '⏰ Time’s up!'}</h1>
        <p style={{ fontSize: '1.1rem' }}>
          {finished ? (
            <>
              Keys in the lockbox at{' '}
              <strong>
                {Math.floor(8 + r.finishSimMinute! / 60)}:
                {String(Math.floor(r.finishSimMinute!) % 60).padStart(2, '0')} AM
              </strong>{' '}
              — {Math.round(120 - r.finishSimMinute!)} sim-minutes to spare.
            </>
          ) : (
            <>
              The team got <strong>{Math.round(r.pctComplete * 100)}%</strong> of the
              work done before 10 AM.
            </>
          )}
        </p>
        <div
          style={{
            display: 'flex',
            gap: 24,
            justifyContent: 'center',
            margin: '18px 0',
            flexWrap: 'wrap',
          }}
        >
          <Stat label="Score" value={String(r.score)} />
          <Stat label="Avg utilization" value={`${Math.round(r.avgUtilization * 100)}%`} />
          <Stat label="Rework events" value={String(r.reworkTotal)} />
        </div>

        <h3 style={{ margin: '10px 0' }}>Who was busy when</h3>
        <UtilizationChart utilization={r.utilization} />

        <button className="btn-big" onClick={onPlayAgain} style={{ marginTop: 18 }}>
          {playAgainLabel}
        </button>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: '1.6rem', fontWeight: 700 }}>{value}</div>
      <div style={{ fontSize: '0.8rem', color: 'var(--ink-soft)' }}>{label}</div>
    </div>
  );
}

