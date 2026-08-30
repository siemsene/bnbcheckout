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
  type ReplayScenario,
  type SessionDoc,
  type SessionFormat,
  type Stage,
} from '../../firebase/data';

/** Stage is derived from the clock, so this reads "running" without anything
 * having written that word to the doc. */
function StageBadge({ session }: { session: SessionDoc }) {
  const stage = stageOf(session, Date.now());
  const live =
    stage === 'running' ||
    stage === 'countdown' ||
    stage === 'running2' ||
    stage === 'countdown2';
  const cls = live ? 'pill-live' : stage === 'ended' ? 'pill-done' : 'pill-lobby';
  // Colour is never the only signal — each stage carries its own glyph and label.
  const meta: Record<Stage, { glyph: string; label: string }> = {
    lobby: { glyph: '○', label: 'lobby' },
    planning: { glyph: '✎', label: 'planning' },
    countdown: { glyph: '⏳', label: 'starting' },
    running: { glyph: '▶', label: 'run 1' },
    review1: { glyph: '⏸', label: 'run 1 done' },
    plan2: { glyph: '✎', label: 'planning run 2' },
    countdown2: { glyph: '⏳', label: 'starting run 2' },
    running2: { glyph: '▶', label: 'run 2' },
    ended: { glyph: '✓', label: 'ended' },
  };
  const { glyph, label } = meta[stage];
  return (
    <span className={`pill ${cls}`}>
      <span aria-hidden>{glyph}</span> {label}
    </span>
  );
}

/** Session lengths are a cap in minutes; keep them sane whatever gets typed. */
function clampMinutes(n: number): number {
  return Number.isFinite(n) ? Math.min(30, Math.max(1, Math.round(n))) : 5;
}

/** A radio rendered as a card, so the option carries its own explanation. */
function Choice({
  name,
  value,
  checked,
  onChange,
  title,
  desc,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: () => void;
  title: string;
  desc: string;
}) {
  // Named and described explicitly: with the input visually hidden, the
  // wrapping label was not supplying the name and the radios announced as
  // their raw values ("single", "two-run") instead of their visible titles.
  const titleId = `${name}-${value}-title`;
  const descId = `${name}-${value}-desc`;
  return (
    <label className="choice">
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        aria-labelledby={titleId}
        aria-describedby={descId}
      />
      <span className="choice-body">
        <span className="choice-title" id={titleId}>
          {title}
        </span>
        <span className="choice-desc" id={descId}>
          {desc}
        </span>
      </span>
    </label>
  );
}

/** Narrow number box with its unit beside it. */
function Minutes({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <div>
      <label className="setup-label" htmlFor={id}>
        {label}
      </label>
      <div className="time-input">
        <input
          id={id}
          type="number"
          min={1}
          max={30}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <span className="time-unit">minutes</span>
      </div>
    </div>
  );
}

export function Dashboard() {
  const { user, isInstructor, isAdmin, init, loading, logout } = useAuthStore();
  const [sessions, setSessions] = useState<SessionDoc[]>([]);
  const [title, setTitle] = useState('');
  const [planningMinutes, setPlanningMinutes] = useState(DEFAULT_PLANNING_MINUTES);
  // Two-run is opt-in. A plain single run stays the default, so nothing about
  // the existing class format changes unless an instructor asks for it.
  const [format, setFormat] = useState<SessionFormat>('single');
  const [planMinutes, setPlanMinutes] = useState(8);
  const [replayScenario, setReplayScenario] = useState<ReplayScenario>('sameSeed');
  const [creating, setCreating] = useState(false);
  // The form is tall enough to bury the session list, so it collapses once
  // there is a list to bury. Derived rather than stored, because `sessions`
  // arrives asynchronously and initial state cannot wait for it.
  const [formOpen, setFormOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => init(), [init]);
  useEffect(() => {
    if (!loading && (!user || !isInstructor)) navigate('/instructor/auth');
  }, [loading, user, isInstructor, navigate]);
  useEffect(() => {
    if (user && isInstructor) return subscribeMySessions(user.uid, setSessions);
  }, [user, isInstructor]);

  if (!user || !isInstructor) return null;

  const showForm = formOpen || sessions.length === 0;

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

      {showForm ? (
        <section className="card setup-card">
          <div className="setup-head">
            <h2>New session</h2>
            <p>Students join with the code; you drive the stages from the monitor.</p>
          </div>

          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setCreating(true);
              try {
                const res = await createSession(title || 'Class session', {
                  planningMinutes: clampMinutes(planningMinutes),
                  format,
                  ...(format === 'two-run'
                    ? { replayScenario, planMinutes: clampMinutes(planMinutes) }
                    : {}),
                });
                navigate(`/instructor/session/${res.sessionId}`);
              } finally {
                setCreating(false);
              }
            }}
          >
            <label className="field">
              <span>Session title</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. MGT 340 — Tuesday"
              />
            </label>
            <p className="setup-hint" style={{ marginBottom: 20 }}>
              Only you see this — it labels the session in the list below.
            </p>

            <fieldset className="setup-fieldset" aria-labelledby="format-legend">
              <legend className="setup-label" id="format-legend">
                Format
              </legend>
              <div className="choice-grid">
                <Choice
                  name="format"
                  value="single"
                  checked={format === 'single'}
                  onChange={() => setFormat('single')}
                  title="One run"
                  desc="Plan together, then race the clock once. The original format."
                />
                <Choice
                  name="format"
                  value="two-run"
                  checked={format === 'two-run'}
                  onChange={() => setFormat('two-run')}
                  title="Two runs, with planning"
                  desc="Play once to discover the constraints, build a plan, then run it again."
                />
              </div>
              {format === 'two-run' && (
                <p className="setup-hint">
                  The debrief shows the plan against what actually happened, and
                  run 1 against run 2.
                </p>
              )}
            </fieldset>

            {format === 'two-run' && (
              <fieldset className="setup-fieldset" aria-labelledby="replay-legend">
                <legend className="setup-label" id="replay-legend">
                  Run 2 faces
                </legend>
                <div className="choice-grid">
                  <Choice
                    name="replay"
                    value="sameSeed"
                    checked={replayScenario === 'sameSeed'}
                    onChange={() => setReplayScenario('sameSeed')}
                    title="The same morning"
                    desc="Identical replay, so any improvement is down to the plan."
                  />
                  <Choice
                    name="replay"
                    value="newChaos"
                    checked={replayScenario === 'newChaos'}
                    onChange={() => setReplayScenario('newChaos')}
                    title="Same job, different day"
                    desc="Task lengths hold but interruptions are re-rolled, so the plan has to absorb surprises."
                  />
                </div>
              </fieldset>
            )}

            <div className="setup-fieldset setup-times">
              {/* Two similarly-named durations, so each says which stage it caps
                  rather than leaving "Planning" and "Plan" to be told apart. */}
              <Minutes
                id="planning-minutes"
                label="Planning before run 1"
                value={planningMinutes}
                onChange={setPlanningMinutes}
              />
              {format === 'two-run' && (
                <Minutes
                  id="plan-minutes"
                  label="Plan board between the runs"
                  value={planMinutes}
                  onChange={setPlanMinutes}
                />
              )}
            </div>
            <p className="setup-hint">
              A cap, not a countdown you have to wait out — you can start the run
              early from the monitor whenever the class is ready.
            </p>

            <div className="setup-foot">
              {sessions.length > 0 && (
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => setFormOpen(false)}
                >
                  Cancel
                </button>
              )}
              <button className="btn-big" disabled={creating} style={{ fontSize: '1rem' }}>
                {creating ? 'Creating…' : 'Create session'}
              </button>
            </div>
          </form>
        </section>
      ) : (
        <button
          className="btn-big"
          style={{ fontSize: '1rem', marginBottom: 22 }}
          onClick={() => setFormOpen(true)}
        >
          + New session
        </button>
      )}

      <div style={{ display: 'grid', gap: 10 }}>
        {sessions.map((s) => (
          <Link key={s.id} to={`/instructor/session/${s.id}`} className="card card-link">
            <strong className="session-code">{s.code}</strong>
            <span className="session-main">
              <span className="session-title">{s.title}</span>
              {/* Format was invisible in the list, which is the one thing you
                  need when picking between two sessions of the same class. */}
              <span className="session-meta">
                {s.settings?.format === 'two-run' ? 'Two runs' : 'One run'}
                {' · '}
                {s.playerCount} {s.playerCount === 1 ? 'player' : 'players'}
              </span>
            </span>
            <StageBadge session={s} />
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
