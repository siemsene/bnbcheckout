// Admin-only: approve or reject instructor registrations. The admin claim is
// bootstrapped by the setAdminClaim callable (admin email only).

import { useEffect, useState } from 'react';
import { useAuthStore } from '../../state/authStore';
import { approveInstructor, setAdminClaim } from '../../firebase/callables';
import { subscribeInstructors, type InstructorDoc } from '../../firebase/data';

export function AdminApprovals() {
  const { user, isAdmin, init, loading, refreshClaims } = useAuthStore();
  const [users, setUsers] = useState<InstructorDoc[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);

  useEffect(() => init(), [init]);
  useEffect(() => {
    if (isAdmin) return subscribeInstructors(setUsers);
  }, [isAdmin]);

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
    <div style={{ maxWidth: 760, margin: '0 auto', padding: 24 }}>
      <h1>Instructor approvals</h1>
      <h2 style={{ margin: '18px 0 8px' }}>Pending ({pending.length})</h2>
      <div style={{ display: 'grid', gap: 8 }}>
        {pending.map((u) => (
          <div key={u.uid} className="panel" style={{ display: 'flex', gap: 12, padding: 12, alignItems: 'center' }}>
            <div style={{ flex: 1 }}>
              <strong>{u.displayName}</strong>
              <div style={{ color: 'var(--ink-soft)', fontSize: '0.9rem' }}>{u.email}</div>
            </div>
            <button
              disabled={busy === u.uid}
              onClick={async () => {
                setBusy(u.uid);
                await approveInstructor(u.uid, true).finally(() => setBusy(null));
              }}
            >
              Approve
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
        {pending.length === 0 && <p style={{ color: 'var(--ink-soft)' }}>Nothing pending.</p>}
      </div>
      <h2 style={{ margin: '18px 0 8px' }}>Processed</h2>
      <div style={{ display: 'grid', gap: 6 }}>
        {others.map((u) => (
          <div key={u.uid} className="panel" style={{ display: 'flex', gap: 12, padding: 10 }}>
            <span style={{ flex: 1 }}>
              {u.displayName} — {u.email}
            </span>
            <span>{u.status === 'approved' ? '✓ approved' : '✗ rejected'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="overlay" style={{ background: 'var(--bg)' }}>
      <div className="overlay-card">{children}</div>
    </div>
  );
}
