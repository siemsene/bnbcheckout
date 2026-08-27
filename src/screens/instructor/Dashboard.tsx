// Instructor home: list sessions, create new ones.

import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../state/authStore';
import { createSession } from '../../firebase/callables';
import {
  DEFAULT_PLANNING_MINUTES,
  stageOf,
  subscribeMySessions,
  type SessionDoc,
} from '../../firebase/data';

/** Stage is derived from the clock, so this reads "running" without anything
 * having written that word to the doc. */
function StageBadge({ session }: { session: SessionDoc }) {
  const stage = stageOf(session, Date.now());
  return (
    <span
      style={{
        padding: '2px 10px',
        borderRadius: 999,
        background:
          stage === 'running' || stage === 'countdown'
            ? '#e3f2e6'
            : stage === 'ended'
              ? '#eee'
              : '#fdf3dd',
      }}
    >
      {stage}
    </span>
  );
}

export function Dashboard() {
  const { user, isInstructor, init, loading, logout } = useAuthStore();
  const [sessions, setSessions] = useState<SessionDoc[]>([]);
  const [title, setTitle] = useState('');
  const [planningMinutes, setPlanningMinutes] = useState(DEFAULT_PLANNING_MINUTES);
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();

  useEffect(() => init(), [init]);
  useEffect(() => {
    if (!loading && (!user || !isInstructor)) navigate('/instructor/auth');
  }, [loading, user, isInstructor, navigate]);
  useEffect(() => {
    if (user && isInstructor) return subscribeMySessions(user.uid, setSessions);
  }, [user, isInstructor]);

  if (!user || !isInstructor) return null;

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: 24 }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <h1 style={{ flex: 1 }}>Your sessions</h1>
        <button className="btn-ghost" onClick={() => logout().then(() => navigate('/'))}>
          Sign out
        </button>
      </header>

      <form
        className="panel"
        style={{ display: 'flex', gap: 10, padding: 14, margin: '18px 0' }}
        onSubmit={async (e) => {
          e.preventDefault();
          setCreating(true);
          try {
            const res = await createSession(title || 'Class session', planningMinutes);
            navigate(`/instructor/session/${res.sessionId}`);
          } finally {
            setCreating(false);
          }
        }}
      >
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Session title (e.g. MGT 340 — Tuesday)"
          style={{ flex: 1, fontSize: '1rem', padding: '8px 12px', borderRadius: 10, border: '2px solid var(--line)' }}
        />
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: '0.85rem',
            color: 'var(--ink-soft)',
            whiteSpace: 'nowrap',
          }}
        >
          Planning
          <input
            type="number"
            min={1}
            max={30}
            value={planningMinutes}
            onChange={(e) => setPlanningMinutes(Number(e.target.value))}
            style={{
              width: 58,
              fontSize: '1rem',
              padding: '8px 6px',
              borderRadius: 10,
              border: '2px solid var(--line)',
            }}
          />
          min
        </label>
        <button disabled={creating}>{creating ? 'Creating…' : '+ New session'}</button>
      </form>

      <div style={{ display: 'grid', gap: 10 }}>
        {sessions.map((s) => (
          <Link
            key={s.id}
            to={`/instructor/session/${s.id}`}
            className="panel"
            style={{
              display: 'flex',
              gap: 14,
              padding: 14,
              textDecoration: 'none',
              color: 'inherit',
              alignItems: 'center',
            }}
          >
            <strong style={{ fontSize: '1.2rem', fontFamily: 'var(--font-display)' }}>
              {s.code}
            </strong>
            <span style={{ flex: 1 }}>{s.title}</span>
            <StageBadge session={s} />
            <span style={{ color: 'var(--ink-soft)' }}>{s.playerCount} players</span>
          </Link>
        ))}
        {sessions.length === 0 && (
          <p style={{ color: 'var(--ink-soft)' }}>No sessions yet — create your first one above.</p>
        )}
      </div>
    </div>
  );
}
