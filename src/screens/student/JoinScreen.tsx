// Students join with a session code + a name they invent. No account needed.

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSessionStore } from '../../state/sessionStore';

export function JoinScreen() {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const join = useSessionStore((s) => s.join);
  const joining = useSessionStore((s) => s.joining);
  const error = useSessionStore((s) => s.error);
  const navigate = useNavigate();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (await join(code, name)) navigate('/session');
  }

  return (
    <div className="overlay" style={{ background: 'var(--bg)' }}>
      <form className="overlay-card" onSubmit={onSubmit}>
        <h1>Join your class session</h1>
        <p style={{ color: 'var(--ink-soft)' }}>
          Enter the code on the classroom screen and pick a display name. Coming
          back? Use the same code and name to resume.
        </p>
        <div style={{ display: 'grid', gap: 12, margin: '18px auto', maxWidth: 320 }}>
          <label style={{ textAlign: 'left' }}>
            Session code
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="e.g. TULIP7"
              maxLength={6}
              required
              style={inputStyle}
              autoComplete="off"
            />
          </label>
          <label style={{ textAlign: 'left' }}>
            Your name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. ScheduleSensei"
              minLength={2}
              maxLength={20}
              required
              style={inputStyle}
              autoComplete="off"
            />
          </label>
        </div>
        {error && (
          <p role="alert" style={{ color: 'var(--danger)', fontWeight: 600 }}>
            {error}
          </p>
        )}
        <button className="btn-big" disabled={joining}>
          {joining ? 'Joining…' : 'Join session'}
        </button>
      </form>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  fontSize: '1.1rem',
  padding: '10px 12px',
  marginTop: 4,
  borderRadius: 10,
  border: '2px solid var(--line)',
};
