// Instructor home: list sessions, create new ones.

import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../state/authStore';
import { createSession } from '../../firebase/callables';
import { Shell } from '../../components/brand/Shell';
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
  const cls =
    stage === 'running' || stage === 'countdown'
      ? 'pill-live'
      : stage === 'ended'
        ? 'pill-done'
        : 'pill-lobby';
  // Colour is never the only signal — each stage carries its own glyph.
  const glyph = { lobby: '○', planning: '✎', countdown: '⏳', running: '▶', ended: '✓' }[stage];
  return (
    <span className={`pill ${cls}`}>
      <span aria-hidden>{glyph}</span> {stage}
    </span>
  );
}

export function Dashboard() {
  const { user, isInstructor, isAdmin, init, loading, logout } = useAuthStore();
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
    <Shell
      tagline={user.email ?? undefined}
      nav={
        <>
          {isAdmin && (
            <Link
              to="/admin"
              className="btn-ghost"
              style={{ padding: '8px 16px', borderRadius: 10, textDecoration: 'none' }}
            >
              Admin
            </Link>
          )}
          <button className="btn-ghost" onClick={() => logout().then(() => navigate('/'))}>
            Sign out
          </button>
        </>
      }
    >
      <div className="page-head">
        <h1>Your sessions</h1>
        <p>Create a session, project the join code, and run the class from the monitor.</p>
      </div>

      <form
        className="card"
        style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 20 }}
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
        <label className="field" style={{ flex: '1 1 260px', marginBottom: 0 }}>
          <span>Session title</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. MGT 340 — Tuesday"
          />
        </label>
        <label className="field" style={{ marginBottom: 0, width: 118 }}>
          <span>Planning (min)</span>
          <input
            type="number"
            min={1}
            max={30}
            value={planningMinutes}
            onChange={(e) => setPlanningMinutes(Number(e.target.value))}
          />
        </label>
        <button className="btn-big" disabled={creating} style={{ fontSize: '1rem' }}>
          {creating ? 'Creating…' : '+ New session'}
        </button>
      </form>

      <div style={{ display: 'grid', gap: 10 }}>
        {sessions.map((s) => (
          <Link key={s.id} to={`/instructor/session/${s.id}`} className="card card-link">
            <strong
              style={{
                fontSize: '1.35rem',
                fontFamily: 'var(--font-display)',
                letterSpacing: '0.08em',
                background: 'var(--bg-deep)',
                color: '#fff',
                padding: '6px 12px',
                borderRadius: 10,
              }}
            >
              {s.code}
            </strong>
            <span style={{ flex: 1, fontWeight: 600 }}>{s.title}</span>
            <StageBadge session={s} />
            <span style={{ color: 'var(--ink-soft)', fontSize: '0.88rem' }}>
              {s.playerCount} {s.playerCount === 1 ? 'player' : 'players'}
            </span>
          </Link>
        ))}
        {sessions.length === 0 && (
          <div className="card" style={{ textAlign: 'center', padding: '34px 20px' }}>
            <div style={{ fontSize: '2rem' }} aria-hidden>
              🗝️
            </div>
            <p style={{ margin: '8px 0 0', fontWeight: 600 }}>No sessions yet</p>
            <p style={{ margin: '4px 0 0', color: 'var(--ink-soft)', fontSize: '0.9rem' }}>
              Create one above, then project its join code for the class.
            </p>
          </div>
        )}
      </div>
    </Shell>
  );
}
