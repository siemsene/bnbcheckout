// End-of-round results: celebration headline, score summary, the run's Gantt
// (who worked when on what), and the utilization chart. Shown as a blocking
// overlay so every round is reviewed before the next one starts.

import { summarize } from '../../engine/scoring';
import { useSimStore } from '../../state/simStore';
import { CompletionChart } from '../../components/charts/CompletionChart';
import { GanttChart } from '../../components/charts/GanttChart';
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

  // Of all the time the team was assigned to something, how much actually
  // produced work — the gap is walking and blocked time.
  let assigned = 0;
  let producing = 0;
  for (const s of r.timeline) {
    const d = s.end - s.start;
    assigned += d;
    if (s.kind === 'working') producing += d;
  }
  const productiveShare = assigned > 0 ? producing / assigned : 0;

  return (
    <div className="overlay">
      {finished && <Celebration />}
      <div className="overlay-card results-card">
        {finished && (
          <img
            src="/assets/scene/celebration.jpg"
            alt="The five friends celebrating in front of the loaded car"
            style={{
              width: '100%',
              maxWidth: 380,
              borderRadius: 14,
              marginBottom: 12,
            }}
          />
        )}
        <h1>{finished ? '🎉 Checkout complete!' : '⏰ Time’s up!'}</h1>
        <p style={{ fontSize: '1.1rem' }}>
          {finished ? (
            <>
              Everything done and away by{' '}
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
          <Stat label="Productive time" value={`${Math.round(productiveShare * 100)}%`} />
          <Stat label="Rework events" value={String(r.reworkTotal)} />
        </div>

        <h3 style={sectionH}>Project completion over time</h3>
        <p style={sectionP}>
          The whole job as one line. Dips are rework — a re-dirtied bathroom or a
          repacked bag doesn’t just stall progress, it takes some back.
        </p>
        <CompletionChart completion={r.completion} finishSimMinute={r.finishSimMinute} />

        <h3 style={sectionH}>Where the two hours went</h3>
        <p style={sectionP}>
          Every stretch of every friend’s morning. Gaps are idle time — nobody was
          assigned anything.
        </p>
        <GanttChart timeline={r.timeline} finishSimMinute={r.finishSimMinute} />

        <h3 style={sectionH}>Who was busy when</h3>
        <p style={sectionP}>
          The same story as a rate: how much of each minute each friend spent busy.
        </p>
        <UtilizationChart utilization={r.utilization} />

        <button className="btn-big" onClick={onPlayAgain} style={{ marginTop: 22 }}>
          {playAgainLabel}
        </button>
      </div>
    </div>
  );
}

const sectionH: React.CSSProperties = {
  margin: '22px 0 2px',
  textAlign: 'left',
  borderTop: '1px solid var(--line)',
  paddingTop: 16,
};
const sectionP: React.CSSProperties = {
  margin: '0 0 8px',
  textAlign: 'left',
  fontSize: '0.85rem',
  color: 'var(--ink-soft)',
};

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: '1.6rem', fontWeight: 700 }}>{value}</div>
      <div style={{ fontSize: '0.8rem', color: 'var(--ink-soft)' }}>{label}</div>
    </div>
  );
}

