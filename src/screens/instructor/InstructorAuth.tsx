// Instructor register / login / pending-approval flow.

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../state/authStore';

export function InstructorAuth() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [registered, setRegistered] = useState(false);
  const [resent, setResent] = useState(false);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const {
    user,
    isInstructor,
    instructorStatus,
    error,
    loading,
    init,
    register,
    login,
    logout,
    refreshClaims,
    resendVerification,
    reloadUser,
  } = useAuthStore();

  // Firebase's verification mail comes from the project's default sender.
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID ?? 'your-project';

  useEffect(() => init(), [init]);

  useEffect(() => {
    if (user && isInstructor) navigate('/instructor');
  }, [user, isInstructor, navigate]);

  if (loading) return null;

  // Signed in but not (yet) an approved instructor.
  if (user) {
    return (
      <div className="overlay" style={{ background: 'var(--bg)' }}>
        <div className="overlay-card">
          <h1>Almost there</h1>
          {!user.emailVerified ? (
            <>
              <p>
                We sent a verification link to <strong>{user.email}</strong>. Click
                it, then come back here.
              </p>
              <p style={{ fontSize: '0.85rem', color: 'var(--ink-soft)' }}>
                Not there? It comes from <code>noreply@{projectId}.firebaseapp.com</code>,
                which often lands in <strong>Spam</strong> or <strong>Promotions</strong> —
                search your mail for that address before resending.
              </p>
              {resent && (
                <p style={{ color: 'var(--ok, #0ca30c)', fontWeight: 700 }} role="status">
                  Sent again — give it a minute.
                </p>
              )}
            </>
          ) : instructorStatus === 'rejected' ? (
            <p role="alert">Your instructor request was declined. Contact the site admin.</p>
          ) : (
            <p>
              Your email is verified. The site admin has been notified and will
              approve your instructor account — you’ll get an email when it’s
              ready.
            </p>
          )}
          <div
            style={{
              display: 'flex',
              gap: 10,
              justifyContent: 'center',
              marginTop: 16,
              flexWrap: 'wrap',
            }}
          >
            {!user.emailVerified ? (
              <>
                <button
                  onClick={async () => {
                    await reloadUser();
                    if (!useAuthStore.getState().user?.emailVerified) return;
                    await refreshClaims();
                    window.location.reload();
                  }}
                >
                  I’ve clicked the link — check again
                </button>
                <button
                  className="btn-ghost"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setResent(await resendVerification());
                    setBusy(false);
                  }}
                >
                  {busy ? 'Sending…' : 'Resend verification email'}
                </button>
              </>
            ) : (
              <button onClick={() => refreshClaims().then(() => window.location.reload())}>
                I’ve been approved — refresh
              </button>
            )}
            <button className="btn-ghost" onClick={() => logout()}>
              Sign out
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="overlay" style={{ background: 'var(--bg)' }}>
      <form
        className="overlay-card"
        onSubmit={async (e) => {
          e.preventDefault();
          if (mode === 'register') {
            if (await register(email, password, displayName)) setRegistered(true);
          } else {
            await login(email, password);
          }
        }}
      >
        <h1>Instructor {mode === 'login' ? 'sign in' : 'registration'}</h1>
        {registered ? (
          <p>Check your inbox for the verification link, then sign in.</p>
        ) : (
          <div style={{ display: 'grid', gap: 12, margin: '18px auto', maxWidth: 340 }}>
            {mode === 'register' && (
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Your name"
                required
                style={inputStyle}
              />
            )}
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              required
              style={inputStyle}
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password (8+ characters)"
              minLength={8}
              required
              style={inputStyle}
            />
          </div>
        )}
        {error && (
          <p role="alert" style={{ color: 'var(--danger)' }}>
            {error}
          </p>
        )}
        {!registered && (
          <button className="btn-big">{mode === 'login' ? 'Sign in' : 'Create account'}</button>
        )}
        <p style={{ marginTop: 14, fontSize: '0.9rem' }}>
          {mode === 'login' ? (
            <>
              New here?{' '}
              <a href="#" onClick={(e) => (e.preventDefault(), setMode('register'))}>
                Register as an instructor
              </a>
            </>
          ) : (
            <>
              Already registered?{' '}
              <a href="#" onClick={(e) => (e.preventDefault(), setMode('login'))}>
                Sign in
              </a>
            </>
          )}
        </p>
      </form>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  fontSize: '1.05rem',
  padding: '10px 12px',
  borderRadius: 10,
  border: '2px solid var(--line)',
};
