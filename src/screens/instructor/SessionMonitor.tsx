// Live session view for projection: jumbo join code, leaderboard, constraint
// summary, and session controls (start / end).

import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuthStore } from '../../state/authStore';
import {
  setSessionStatus,
  subscribeSession,
  type SessionDoc,
} from '../../firebase/data';
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
  const navigate = useNavigate();

  useEffect(() => init(), [init]);
  useEffect(() => {
    if (!loading && (!user || !isInstructor)) navigate('/instructor/auth');
  }, [loading, user, isInstructor, navigate]);
  useEffect(() => {
    if (sessionId) return subscribeSession(sessionId, setSession);
  }, [sessionId]);

  if (!session || !user) return null;

  return (
    <div style={{ maxWidth: 980, margin: '0 auto', padding: 24, display: 'grid', gap: 16 }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <Link to="/instructor">← Sessions</Link>
        <h1 style={{ flex: 1 }}>{session.title}</h1>
        {session.status !== 'ended' ? (
          <button
            style={{ background: 'var(--danger)' }}
            onClick={() => setSessionStatus(session.id, user.uid, 'ended')}
          >
            End session & reveal results
          </button>
        ) : (
          <span className="panel" style={{ padding: '6px 14px' }}>
            Ended — results revealed
          </span>
        )}
      </header>

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
        <LeaderboardPanel sessionId={session.id} revealScatter={session.status === 'ended'} />
        <ExportCsvButton sessionId={session.id} />
      </section>

      <ConstraintPanel />
    </div>
  );
}
