// Live session view for projection: jumbo join code, leaderboard, constraint
// summary, and session controls (start / end).

import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuthStore } from '../../state/authStore';
import {
  DEFAULT_PLANNING_MINUTES,
  isTwoRun,
  playerIsDone,
  stageOf,
  subscribeSession,
  type SessionDoc,
} from '../../firebase/data';
import { sessionControl } from '../../firebase/callables';
import { formatCountdown } from '../../state/useRoomStage';
import { LeaderboardPanel } from '../student/LeaderboardPanel';
import { ConstraintPanel } from './ConstraintPanel';
import { subscribePlayers, type PlayerDoc } from '../../firebase/data';

function ExportCsvButton({ sessionId }: { sessionId: string }) {
  const [players, setPlayers] = useState<PlayerDoc[]>([]);
  useEffect(() => subscribePlayers(sessionId, setPlayers), [sessionId]);

  function exportCsv() {
    const rows = [
      ['name', 'phase', 'finished', 'finish_sim_minute', 'pct_complete', 'avg_utilization', 'score'],
      ...players.map((p) => [
        p.name,
        p.phase,
        String(p.finished),
        p.finishSimMinute != null ? String(Math.round(p.finishSimMinute * 10) / 10) : '',
        (p.pctComplete * 100).toFixed(1),
        (p.utilizationAvg * 100).toFixed(1),
        String(p.score),
      ]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${c.replaceAll('"', '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'checkout-rush-results.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <button className="btn-ghost" style={{ marginTop: 10 }} onClick={exportCsv}>
      ⬇ Export results as CSV
    </button>
  );
}

export function SessionMonitor() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const { user, isInstructor, init, loading } = useAuthStore();
  const [session, setSession] = useState<SessionDoc | null>(null);
  const [players, setPlayers] = useState<PlayerDoc[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, tick] = useState(0);
  const navigate = useNavigate();

  useEffect(() => init(), [init]);
  useEffect(() => {
    if (!loading && (!user || !isInstructor)) navigate('/instructor/auth');
  }, [loading, user, isInstructor, navigate]);
  useEffect(() => {
    if (sessionId) return subscribeSession(sessionId, setSession);
  }, [sessionId]);
  useEffect(() => {
    if (sessionId) return subscribePlayers(sessionId, setPlayers);
  }, [sessionId]);
  // Countdowns and the derived stage are time-based, so re-render steadily.
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(t);
  }, []);

  if (!session || !user) return null;

  const stage = stageOf(session, Date.now());
  const startsAt = session.runStartsAt?.toMillis() ?? null;
  const msUntilStart = startsAt == null ? 0 : Math.max(0, startsAt - Date.now());
  const readyCount = players.filter((p) => p.ready === true).length;
  const doneCount = players.filter(playerIsDone).length;
  const planningMinutes =
    session.settings?.planningMinutes ?? DEFAULT_PLANNING_MINUTES;
  const twoRun = isTwoRun(session);
  const planMinutes = session.settings?.planMinutes ?? 8;

  async function control(
    action: 'openPlanning' | 'startNow' | 'end' | 'openPlan2' | 'startNow2',
  ) {
    if (action === 'end' && !confirm('End the session for everyone and reveal results?')) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await sessionControl(session!.id, action);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work — try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 980, margin: '0 auto', padding: 24, display: 'grid', gap: 16 }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <Link to="/instructor">← Sessions</Link>
        <h1 style={{ flex: 1 }}>{session.title}</h1>
        {stage !== 'ended' && (
          <button
            style={{ background: 'var(--danger)' }}
            disabled={busy}
            onClick={() => control('end')}
          >
            End session & reveal results
          </button>
        )}
      </header>

      <section className="panel" style={{ padding: 16, display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0, flex: 1 }}>
            {stage === 'lobby' && 'Lobby — students joining'}
            {stage === 'planning' && `Planning — ${formatCountdown(msUntilStart)} left`}
            {stage === 'countdown' && `Starting in ${Math.ceil(msUntilStart / 1000)}…`}
            {stage === 'running' &&
              `${twoRun ? 'Run 1' : 'Running'} — ${doneCount} of ${players.length} finished`}
            {stage === 'review1' && 'Run 1 done — students are reading their results'}
            {stage === 'plan2' && `Planning run 2 — ${formatCountdown(msUntilStart)} left`}
            {stage === 'countdown2' && `Run 2 starting in ${Math.ceil(msUntilStart / 1000)}…`}
            {stage === 'running2' && `Run 2 — ${doneCount} of ${players.length} finished`}
            {stage === 'ended' && 'Ended — results revealed'}
          </h2>
          {stage === 'lobby' && (
            <button className="btn-big" disabled={busy} onClick={() => control('openPlanning')}>
              Open planning ({planningMinutes} min) →
            </button>
          )}
          {stage === 'planning' && (
            <button className="btn-big" disabled={busy} onClick={() => control('startNow')}>
              ▶ Start now
              {readyCount < players.length && ` (${players.length - readyCount} not ready)`}
            </button>
          )}
          {stage === 'review1' && (
            <button className="btn-big" disabled={busy} onClick={() => control('openPlan2')}>
              Open the plan board ({planMinutes} min) →
            </button>
          )}
          {stage === 'plan2' && (
            <button className="btn-big" disabled={busy} onClick={() => control('startNow2')}>
              ▶ Start run 2
              {readyCount < players.length && ` (${players.length - readyCount} not ready)`}
            </button>
          )}
        </div>

        {error && (
          <p style={{ color: 'var(--danger)', margin: 0 }} role="alert">
            {error}
          </p>
        )}

        {stage === 'review1' && (
          <p style={{ margin: 0, color: 'var(--ink-soft)' }}>
            Everyone is looking at their own run‑one results. Opening the plan
            board reveals the constraints they just discovered and lets them
            build a plan for the replay — and it clears everybody's ready flag.
          </p>
        )}

        {(stage === 'planning' || stage === 'countdown' || stage === 'plan2') && (
          <>
            <strong>
              {readyCount} of {players.length} ready
            </strong>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {players.map((p) => (
                <span
                  key={p.id}
                  className={`roster-chip${p.ready ? ' is-ready' : ''}`}
                >
                  {p.ready ? '✓' : '○'} {p.name}
                </span>
              ))}
              {players.length === 0 && (
                <span style={{ color: 'var(--ink-soft)' }}>Nobody has joined yet.</span>
              )}
            </div>
          </>
        )}

        {stage === 'lobby' && (
          <p style={{ color: 'var(--ink-soft)', margin: 0, fontSize: '0.88rem' }}>
            Opening planning starts a {planningMinutes}-minute countdown. The run begins
            for the whole class at once — the moment everyone marks themselves ready, or
            when the countdown runs out, whichever comes first. It cannot be paused.
          </p>
        )}
      </section>

      <div
        className="panel"
        style={{ textAlign: 'center', padding: '26px 16px', background: 'var(--bg-deep)', color: '#fff' }}
      >
        <div style={{ fontSize: '0.95rem', opacity: 0.8 }}>Join at this site with code</div>
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: '4.5rem',
            letterSpacing: '0.15em',
            fontWeight: 700,
          }}
        >
          {session.code}
        </div>
        <div style={{ opacity: 0.8 }}>{session.playerCount} players joined</div>
      </div>

      <section className="panel" style={{ padding: 16 }}>
        <h2 style={{ marginBottom: 10 }}>Leaderboard</h2>
        <LeaderboardPanel sessionId={session.id} revealScatter={stage === 'ended'} />
        <ExportCsvButton sessionId={session.id} />
      </section>

      <ConstraintPanel />
    </div>
  );
}
