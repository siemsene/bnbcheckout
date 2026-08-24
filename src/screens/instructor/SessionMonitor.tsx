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
      </section>

      <ConstraintPanel />
    </div>
  );
}
