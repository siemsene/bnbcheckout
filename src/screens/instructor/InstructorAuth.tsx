// Instructor register / login / pending-approval flow.

import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../state/authStore';
import { Logo } from '../../components/brand/Logo';

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
      <div className="auth-wrap">
        <div className="auth-card">
          <Logo size={38} tagline="Instructor access" />
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
            <>
              <p>
                Your email is verified. The site admin has been notified and will
                approve your instructor account — you’ll get an email when it’s
                ready.
              </p>
              {/* The very first admin has nobody to approve them, and the
                  bootstrap lives on a route nothing links to. */}
              <p style={{ fontSize: '0.85rem', color: 'var(--ink-soft)' }}>
                Are you the site admin? <Link to="/admin">Activate admin access →</Link>{' '}
                then approve yourself there.
              </p>
            </>
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
    <div className="auth-wrap">
      <form
        className="auth-card"
        onSubmit={async (e) => {
          e.preventDefault();
          if (mode === 'register') {
            if (await register(email, password, displayName)) setRegistered(true);
          } else {
            await login(email, password);
          }
        }}
      >
        <Link to="/" className="brand" aria-label="Checkout Rush home">
          <Logo size={38} tagline="Instructor access" />
        </Link>
        <h1>{mode === 'login' ? 'Sign in' : 'Create your account'}</h1>
        <p style={{ color: 'var(--ink-soft)', marginTop: 0, fontSize: '0.9rem' }}>
          {mode === 'login'
            ? 'Run sessions and watch the class leaderboard live.'
            : 'You’ll verify your email, then the site admin approves your account.'}
        </p>
        {registered ? (
          <p>Check your inbox for the verification link, then sign in.</p>
        ) : (
          <div style={{ margin: '18px 0' }}>
            {mode === 'register' && (
              <label className="field">
                <span>Your name</span>
                <input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  autoComplete="name"
                  required
                />
              </label>
            )}
            <label className="field">
              <span>Email</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </label>
            <label className="field">
              <span>Password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                minLength={8}
                required
              />
            </label>
          </div>
        )}
        {error && (
          <p role="alert" style={{ color: 'var(--danger)' }}>
            {error}
          </p>
        )}
        {!registered && (
          <button className="btn-big" style={{ width: '100%' }}>
            {mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
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
