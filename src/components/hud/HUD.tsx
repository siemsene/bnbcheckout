// Top bar: sim clock (8:00 -> 10:00 AM), deadline bar, overall progress, and
// pause — always available in practice, but absent during a synchronized
// classroom run, where the room shares one clock that nobody may stop.

import { SIM_DEADLINE_TICKS } from '../../engine/content';
import { pctComplete } from '../../engine/scoring';
import { useSimStore } from '../../state/simStore';

function clockText(tick: number): string {
  const total = 8 * 60 + Math.floor(tick / 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h}:${m.toString().padStart(2, '0')} AM`;
}

export function HUD() {
  useSimStore((s) => s.version);
  const sim = useSimStore((s) => s.sim);
  const paused = useSimStore((s) => s.paused);
  const phase = useSimStore((s) => s.phase);
  const pauseAllowed = useSimStore((s) => s.pauseAllowed);
  const setPaused = useSimStore((s) => s.setPaused);
  if (!sim) return null;

  const pct = Math.round(pctComplete(sim) * 100);
  const timePct = Math.min(100, (sim.tick / SIM_DEADLINE_TICKS) * 100);
  const minutesLeft = Math.max(0, Math.ceil((SIM_DEADLINE_TICKS - sim.tick) / 60));

  return (
    <header className="panel hud">
      <div className="hud-clock" aria-label={`Simulated time ${clockText(sim.tick)}`}>
        {clockText(sim.tick)}
      </div>
      <div
        className="hud-deadline"
        role="progressbar"
        aria-label={`Time used — ${minutesLeft} simulated minutes left before 10 AM checkout`}
        aria-valuenow={Math.round(timePct)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div style={{ width: `${timePct}%` }} />
      </div>
      <div className="hud-progress" aria-live="off">
        {pct}% done
      </div>
      {pauseAllowed && phase === 'running' && (
        <button onClick={() => setPaused(!paused)} aria-pressed={paused}>
          {paused ? '▶ Resume' : '⏸ Pause'}
        </button>
      )}
    </header>
  );
}
