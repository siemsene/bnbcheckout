// Admin-only: approve or reject instructor registrations. The admin claim is
// bootstrapped by the setAdminClaim callable (admin email only).

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuthStore } from '../../state/authStore';
import { Shell } from '../../components/brand/Shell';
import { Logo } from '../../components/brand/Logo';
import { approveInstructor, setAdminClaim } from '../../firebase/callables';
import {
  setInstructorAffiliation,
  subscribeInstructors,
  type InstructorDoc,
} from '../../firebase/data';

export function AdminApprovals() {
  const { user, isAdmin, init, loading, refreshClaims } = useAuthStore();
  const [users, setUsers] = useState<InstructorDoc[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  // Bumped to re-attach the listener after a denied read; see below.
  const [retry, setRetry] = useState(0);

  useEffect(() => init(), [init]);
  useEffect(() => {
    if (!isAdmin) return;
    setListError(null);
    return subscribeInstructors(setUsers, (e) => setListError(e.message));
  }, [isAdmin, retry]);

  if (loading) return null;
  if (!user) {
    return (
      <Centered>
        <p>
          Sign in with your admin account first via the{' '}
          <a href="/instructor/auth">instructor sign-in</a> page.
        </p>
      </Centered>
    );
  }
  if (!isAdmin) {
    return (
      <Centered>
        <p>This page is for the site admin.</p>
        <button
          onClick={async () => {
            try {
              await setAdminClaim();
              await refreshClaims();
              window.location.reload();
            } catch (e) {
              setClaimError(e instanceof Error ? e.message : 'Not eligible.');
            }
          }}
        >
          I am the admin — activate admin access
        </button>
        {claimError && (
          <p role="alert" style={{ color: 'var(--danger)' }}>
            {claimError}
          </p>
        )}
      </Centered>
    );
  }

  const pending = users.filter((u) => u.status === 'pending');
  const others = users.filter((u) => u.status !== 'pending');

  return (
    <Shell
      tagline="Site admin"
      nav={
        <Link
          to="/instructor"
          className="btn-ghost"
          style={{ padding: '8px 16px', borderRadius: 10, textDecoration: 'none' }}
        >
          My sessions
        </Link>
      }
    >
      <div className="page-head">
        <h1>Instructor approvals</h1>
        <p>Approved instructors can create sessions and run them with a class.</p>
      </div>

      {listError && (
        <div className="card" role="alert" style={{ marginBottom: 16 }}>
          <strong style={{ color: 'var(--danger)' }}>
            Could not load the instructor list.
          </strong>
          <p style={{ margin: '6px 0', color: 'var(--ink-soft)', fontSize: '0.9rem' }}>
            {listError} — the list below is empty because of this error, not
            because there is nothing pending.
          </p>
          <button
            onClick={async () => {
              await refreshClaims();
              setRetry((n) => n + 1);
            }}
          >
            Retry
          </button>
        </div>
      )}

      <h2 style={{ fontSize: '1.05rem', margin: '0 0 10px' }}>
        Waiting for you{' '}
        <span className={`pill ${pending.length ? 'pill-warn' : 'pill-done'}`}>
          {pending.length}
        </span>
      </h2>
      <div style={{ display: 'grid', gap: 10, marginBottom: 28 }}>
        {pending.map((u) => (
          <div key={u.uid} className="card card-row">
            <div style={{ flex: 1, minWidth: 180 }}>
              <strong>{u.displayName}</strong>
              <div style={{ color: 'var(--ink-soft)', fontSize: '0.9rem' }}>{u.email}</div>
              <Affiliation user={u} />
            </div>
            <button
              disabled={busy === u.uid}
              onClick={async () => {
                setBusy(u.uid);
                await approveInstructor(u.uid, true).finally(() => setBusy(null));
              }}
            >
              {busy === u.uid ? 'Working…' : '✓ Approve'}
            </button>
            <button
              className="btn-ghost"
              disabled={busy === u.uid}
              onClick={async () => {
                setBusy(u.uid);
                await approveInstructor(u.uid, false).finally(() => setBusy(null));
              }}
            >
              Reject
            </button>
          </div>
        ))}
        {pending.length === 0 && (
          <div className="card" style={{ textAlign: 'center', padding: '30px 20px' }}>
            <div style={{ fontSize: '1.8rem' }} aria-hidden>
              ✅
            </div>
            <p style={{ margin: '8px 0 0', color: 'var(--ink-soft)' }}>
              Nothing pending — you’re all caught up.
            </p>
          </div>
        )}
      </div>

      <h2 style={{ fontSize: '1.05rem', margin: '0 0 10px' }}>Processed</h2>
      <div style={{ display: 'grid', gap: 8 }}>
        {others.map((u) => (
          <div key={u.uid} className="card card-row" style={{ padding: '12px 16px' }}>
            <div style={{ flex: 1, minWidth: 160 }}>
              <span>
                <strong>{u.displayName}</strong>{' '}
                <span style={{ color: 'var(--ink-soft)' }}>— {u.email}</span>
              </span>
              <Affiliation user={u} />
            </div>
            <span className={`pill ${u.status === 'approved' ? 'pill-live' : 'pill-warn'}`}>
              {u.status === 'approved' ? '✓ approved' : '✗ rejected'}
            </span>
          </div>
        ))}
        {others.length === 0 && (
          <p style={{ color: 'var(--ink-soft)', fontSize: '0.9rem' }}>
            Nobody processed yet.
          </p>
        )}
      </div>
    </Shell>
  );
}

/**
 * Affiliation, with an inline admin edit.
 *
 * Registration collects it now, but the accounts that predate the field have
 * none, and the repair path in authStore cannot invent one — so the admin
 * needs a way to fill it in rather than only ever reading it.
 */
function Affiliation({ user }: { user: InstructorDoc }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(user.affiliation ?? '');
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  if (!editing) {
    return (
      <div style={{ color: 'var(--ink-soft)', fontSize: '0.9rem' }}>
        {user.affiliation ? (
          <>🎓 {user.affiliation} </>
        ) : (
          <em>No affiliation on file. </em>
        )}
        <button
          className="btn-ghost"
          style={{ padding: '2px 8px', fontSize: '0.8rem' }}
          onClick={() => {
            setValue(user.affiliation ?? '');
            setFailed(null);
            setEditing(true);
          }}
        >
          {user.affiliation ? 'Edit' : 'Add'}
        </button>
      </div>
    );
  }

  const save = async () => {
    setSaving(true);
    try {
      await setInstructorAffiliation(user.uid, value);
      setEditing(false);
    } catch (e) {
      setFailed(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ fontSize: '0.9rem', marginTop: 4 }}>
      <input
        value={value}
        autoFocus
        placeholder="University affiliation"
        aria-label={`University affiliation for ${user.displayName}`}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void save();
          if (e.key === 'Escape') setEditing(false);
        }}
        style={{ maxWidth: 260 }}
      />{' '}
      <button
        className="btn-ghost"
        style={{ padding: '2px 8px', fontSize: '0.8rem' }}
        disabled={saving}
        onClick={() => void save()}
      >
        {saving ? 'Saving…' : 'Save'}
      </button>{' '}
      <button
        className="btn-ghost"
        style={{ padding: '2px 8px', fontSize: '0.8rem' }}
        disabled={saving}
        onClick={() => setEditing(false)}
      >
        Cancel
      </button>
      {failed && (
        <div role="alert" style={{ color: 'var(--danger)' }}>
          {failed}
        </div>
      )}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth-wrap">
      <div className="auth-card" style={{ textAlign: 'center' }}>
        <Logo size={38} tagline="Site admin" />
        {children}
      </div>
    </div>
  );
}
