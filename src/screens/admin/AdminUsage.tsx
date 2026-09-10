// Admin-only: who is using this thing, how much, and what it costs to run.
//
// Two different time spans share this screen, and keeping them straight is most
// of the design:
//
//   - The COUNTS are lifetime. Sessions are purged after the retention window,
//     so `cleanupSessions` folds each one into a durable per-instructor archive
//     on its way out. Lifetime = that archive + whatever is still live.
//   - The DETAIL is the retention window only. Titles, dates, per-student rows
//     and distinct-student figures die with the sessions; nothing can bring
//     them back, so the screen says so rather than showing a lifetime-looking
//     number that silently means "this month".
//
// And the counts are measured while the money is modelled (billing/costModel
// prices those counts against Google's published rates) — that distinction
// stays visible everywhere too, because a made-up number presented like a bill
// is worse than no number.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuthStore } from '../../state/authStore';
import { Shell } from '../../components/brand/Shell';
import { Logo } from '../../components/brand/Logo';
import {
  setAdminClaim,
  usageStats,
  type ArchiveRow,
  type InstructorUsage,
  type SessionUsageRow,
  type UsageStats,
} from '../../firebase/callables';
import {
  FREE_TIER,
  PRICING,
  dayKeyOf,
  estimate,
  expandArchive,
  formatUsd,
  grossUsd,
  priceLines,
  sessionLines,
  sessionOps,
  type CostLine,
  type DatedSession,
  type Pricing,
} from '../../billing/costModel';

/** A live session row turned into cost-model input. */
function toDated(s: SessionUsageRow): DatedSession {
  return {
    players: s.players,
    runsPlayed: s.runsPlayed,
    format: s.format,
    simDeadlineMin: s.simDeadlineMin,
    compression: s.compression,
    dayKey: dayKeyOf(s.createdAtMs),
  };
}

const EMPTY_ARCHIVE: ArchiveRow = {
  instructorUid: '',
  sessions: 0,
  seats: 0,
  runs: 0,
  biggestClass: 0,
  firstSessionAtMs: null,
  lastSessionAtMs: null,
  sizes: {},
};

interface Row {
  instructor: InstructorUsage;
  /** Sessions still inside the retention window, with full detail. */
  live: SessionUsageRow[];
  /** Purged sessions, re-expanded from their archived shapes. */
  archived: DatedSession[];

  // Lifetime — archive plus live.
  sessions: number;
  seats: number;
  runs: number;
  biggestClass: number;
  firstActiveMs: number | null;
  lastActiveMs: number | null;
  /** Lifetime list price. No free tier: see the assumptions panel. */
  lifetimeUsd: number;

  /** Distinct humans, window only — uids are deleted with the players. */
  windowDistinctStudents: number;
}

const minOf = (a: number | null, b: number | null) =>
  a == null ? b : b == null ? a : Math.min(a, b);
const maxOf = (a: number | null, b: number | null) =>
  a == null ? b : b == null ? a : Math.max(a, b);

/**
 * One row per instructor, plus a synthetic row for sessions and archive
 * entries whose owner no longer has a `users` document. Those are real usage on
 * the bill, so folding them silently into nothing would make the totals lie.
 */
function buildRows(
  data: UsageStats,
  pricing: Pricing,
): { rows: Row[]; orphans: Row | null } {
  const liveByUid = new Map<string, SessionUsageRow[]>();
  for (const s of data.sessions) {
    const list = liveByUid.get(s.instructorUid);
    if (list) list.push(s);
    else liveByUid.set(s.instructorUid, [s]);
  }
  const archiveByUid = new Map(data.archive.map((a) => [a.instructorUid, a]));
  const known = new Set(data.instructors.map((i) => i.uid));

  const makeRow = (
    instructor: InstructorUsage,
    live: SessionUsageRow[],
    archive: ArchiveRow,
  ): Row => {
    const archived = expandArchive(archive.sizes);
    const liveDated = live.map(toDated);
    const windowCost = estimate(liveDated, pricing);
    const archivedOps = archived.reduce(
      (usd, s) => usd + grossUsd(sessionOps(s), pricing),
      0,
    );

    const liveFirst = live.reduce<number | null>(
      (t, s) => minOf(t, s.createdAtMs),
      null,
    );
    const liveLast = live.reduce<number | null>(
      (t, s) => maxOf(t, s.createdAtMs),
      null,
    );

    return {
      instructor,
      live,
      archived,
      sessions: archive.sessions + live.length,
      seats: archive.seats + live.reduce((n, s) => n + s.players, 0),
      runs: archive.runs + live.reduce((n, s) => n + s.runsPlayed, 0),
      biggestClass: live.reduce((n, s) => Math.max(n, s.players), archive.biggestClass),
      firstActiveMs: minOf(archive.firstSessionAtMs, liveFirst),
      lastActiveMs: maxOf(archive.lastSessionAtMs, liveLast),
      lifetimeUsd: windowCost.grossUsd + archivedOps,
      windowDistinctStudents: instructor.distinctStudents,
    };
  };

  const rows = data.instructors
    .map((i) =>
      makeRow(i, liveByUid.get(i.uid) ?? [], archiveByUid.get(i.uid) ?? EMPTY_ARCHIVE),
    )
    .sort((a, b) => b.lifetimeUsd - a.lifetimeUsd || b.seats - a.seats);

  // Anything attributed to a uid with no account: sessions whose instructor was
  // deleted, and the `unattributed` bucket the archive uses for sessions that
  // reached the purge with no readable owner.
  const orphanLive = data.sessions.filter((s) => !known.has(s.instructorUid));
  const orphanArchives = data.archive.filter((a) => !known.has(a.instructorUid));
  const orphans =
    orphanLive.length || orphanArchives.length
      ? makeRow(
          {
            uid: '',
            email: '',
            displayName: 'Deleted instructor accounts',
            affiliation: null,
            status: 'approved',
            createdAtMs: null,
            distinctStudents: orphanLive.reduce((n, s) => n + s.distinctStudents, 0),
          },
          orphanLive,
          orphanArchives.reduce<ArchiveRow>(
            (acc, a) => ({
              ...acc,
              sessions: acc.sessions + a.sessions,
              seats: acc.seats + a.seats,
              runs: acc.runs + a.runs,
              biggestClass: Math.max(acc.biggestClass, a.biggestClass),
              firstSessionAtMs: minOf(acc.firstSessionAtMs, a.firstSessionAtMs),
              lastSessionAtMs: maxOf(acc.lastSessionAtMs, a.lastSessionAtMs),
              sizes: mergeSizes(acc.sizes, a.sizes),
            }),
            EMPTY_ARCHIVE,
          ),
        )
      : null;

  return { rows, orphans };
}

function mergeSizes(
  a: Record<string, number>,
  b: Record<string, number>,
): Record<string, number> {
  const out = { ...a };
  for (const [k, n] of Object.entries(b)) out[k] = (out[k] ?? 0) + n;
  return out;
}

const dateFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
const fmtDate = (ms: number | null) => (ms == null ? '—' : dateFmt.format(ms));
const num = (n: number) => Math.round(n).toLocaleString();
const plural = (n: number, word: string) => `${num(n)} ${word}${n === 1 ? '' : 's'}`;

export function AdminUsage() {
  const { user, isAdmin, init, loading, refreshClaims } = useAuthStore();
  const [data, setData] = useState<UsageStats | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [pricingId, setPricingId] = useState<Pricing['id']>('multi-region');
  const [openUid, setOpenUid] = useState<string | null>(null);

  useEffect(() => init(), [init]);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setData(await usageStats());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load usage.');
    } finally {
      setBusy(false);
    }
  }, []);

  // Loaded on demand rather than live: this query reads every player document
  // in the project, so a listener that re-ran on every progress write would
  // cost more than everything it is measuring.
  useEffect(() => {
    if (isAdmin) void load();
  }, [isAdmin, load]);

  const pricing = PRICING[pricingId];
  const built = useMemo(() => (data ? buildRows(data, pricing) : null), [data, pricing]);

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

  const allRows = built ? [...built.rows, ...(built.orphans ? [built.orphans] : [])] : [];
  const activeRows = allRows.filter((r) => r.sessions > 0);
  const idleRows = allRows.filter((r) => r.sessions === 0);

  return (
    <Shell
      tagline="Site admin"
      nav={
        <>
          <Link to="/admin" className="btn-ghost nav-link">
            Approvals
          </Link>
          <Link to="/instructor" className="btn-ghost nav-link">
            My sessions
          </Link>
        </>
      }
    >
      <div className="page-head">
        <h1>Usage by instructor</h1>
        <p>
          Everything ever run, grouped by who ran it — with what it plausibly
          cost on the Blaze plan.
        </p>
      </div>

      {error && (
        <div className="card" role="alert" style={{ marginBottom: 16 }}>
          <strong style={{ color: 'var(--danger)' }}>Could not load usage.</strong>
          <p style={{ margin: '6px 0', color: 'var(--ink-soft)', fontSize: '0.9rem' }}>
            {error}
          </p>
          <button onClick={() => void load()}>Retry</button>
        </div>
      )}

      {busy && !data && <p role="status">Counting…</p>}

      {data && built && (
        <>
          <Totals data={data} rows={activeRows} pricing={pricing} />

          <div className="usage-controls">
            <label className="usage-region">
              <span>Database location</span>
              <select
                value={pricingId}
                onChange={(e) => setPricingId(e.target.value as Pricing['id'])}
              >
                {Object.values(PRICING).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <span className="usage-controls-note">
              Firestore charges roughly twice as much in a multi-region. If you
              are not sure which yours is, leave it — it is the dearer guess.
            </span>
            <button className="btn-ghost" disabled={busy} onClick={() => void load()}>
              {busy ? 'Counting…' : 'Refresh'}
            </button>
          </div>

          <h2 className="usage-h2">
            Instructors who have run something{' '}
            <span className="pill pill-done">{activeRows.length}</span>
          </h2>
          <div className="usage-scroll">
            <table className="usage-table">
              <caption className="sr-only">
                Lifetime sessions, students and estimated cost for each
                instructor who has run at least one session.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Instructor</th>
                  <th scope="col" className="n">
                    Sessions
                  </th>
                  <th scope="col" className="n">
                    Students
                  </th>
                  <th scope="col" className="n">
                    Runs
                  </th>
                  <th scope="col" className="n">
                    Biggest
                  </th>
                  <th scope="col">First</th>
                  <th scope="col">Latest</th>
                  <th scope="col" className="n">
                    Est. cost
                  </th>
                  <th scope="col">
                    <span className="sr-only">Details</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {activeRows.map((r) => (
                  <InstructorRow
                    key={r.instructor.uid || 'orphans'}
                    row={r}
                    data={data}
                    pricing={pricing}
                    open={openUid === (r.instructor.uid || 'orphans')}
                    onToggle={() =>
                      setOpenUid((cur) =>
                        cur === (r.instructor.uid || 'orphans')
                          ? null
                          : r.instructor.uid || 'orphans',
                      )
                    }
                  />
                ))}
                {activeRows.length === 0 && (
                  <tr>
                    <td colSpan={9} style={{ padding: 20, color: 'var(--ink-soft)' }}>
                      Nobody has run a session yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {idleRows.length > 0 && (
            <>
              <h2 className="usage-h2">
                Accounts that have never run a session{' '}
                <span className="pill pill-lobby">{idleRows.length}</span>
              </h2>
              <div className="usage-idle">
                {idleRows.map((r) => (
                  <div key={r.instructor.uid} className="card card-row">
                    <div style={{ flex: 1, minWidth: 180 }}>
                      <strong>{r.instructor.displayName}</strong>
                      <div style={{ color: 'var(--ink-soft)', fontSize: '0.88rem' }}>
                        {r.instructor.email}
                        {r.instructor.affiliation ? ` — ${r.instructor.affiliation}` : ''}
                      </div>
                    </div>
                    <StatusPill status={r.instructor.status} />
                  </div>
                ))}
              </div>
            </>
          )}

          <Assumptions pricing={pricing} />
        </>
      )}
    </Shell>
  );
}

function StatusPill({ status }: { status: InstructorUsage['status'] }) {
  const cls =
    status === 'approved' ? 'pill-live' : status === 'pending' ? 'pill-warn' : 'pill-done';
  const glyph = status === 'approved' ? '✓' : status === 'pending' ? '⏳' : '✗';
  return (
    <span className={`pill ${cls}`}>
      <span aria-hidden>{glyph}</span> {status}
    </span>
  );
}

/** The four numbers worth reading before any of the detail. */
function Totals({
  data,
  rows,
  pricing,
}: {
  data: UsageStats;
  rows: Row[];
  pricing: Pricing;
}) {
  const sessions = rows.reduce((n, r) => n + r.sessions, 0);
  const seats = rows.reduce((n, r) => n + r.seats, 0);
  const runs = rows.reduce((n, r) => n + r.runs, 0);
  const lifetimeUsd = rows.reduce((n, r) => n + r.lifetimeUsd, 0);
  const archivedSessions = data.archive.reduce((n, a) => n + a.sessions, 0);

  // The invoice-facing number: the whole project's live sessions, bucketed by
  // day so the free tier is applied the way Google actually applies it.
  const windowCost = estimate(data.sessions.map(toDated), pricing);

  return (
    <>
      <div className="usage-tiles">
        <Tile label="Instructors" value={num(rows.length)} sub="have run a session" />
        <Tile
          label="Sessions"
          value={num(sessions)}
          sub={`all time — ${plural(runs, 'run')} played`}
        />
        <Tile
          label="Students"
          value={num(seats)}
          sub="all time, counted once per session they joined"
        />
        <Tile
          label="Cost, last 30 days"
          value={formatUsd(windowCost.netUsd)}
          sub={
            windowCost.netUsd === 0
              ? `inside the free tier — ${formatUsd(lifetimeUsd)} all time at list price`
              : `after the free tier — ${formatUsd(lifetimeUsd)} all time at list price`
          }
          accent
        />
      </div>
      <p className="usage-window" role="note">
        Counts are lifetime: {plural(archivedSessions, 'session')} already past
        the {data.retentionDays}-day window survive as durable counters, folded
        in above. Session titles, dates and per-student detail do not — only the
        last {data.retentionDays} days can be broken down. Reading all this cost{' '}
        {num(data.docsRead)} document reads.
      </p>
    </>
  );
}

function Tile({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub: string;
  accent?: boolean;
}) {
  return (
    <div className={`usage-tile${accent ? ' is-accent' : ''}`}>
      <span className="usage-tile-label">{label}</span>
      <strong className="usage-tile-value">{value}</strong>
      <span className="usage-tile-sub">{sub}</span>
    </div>
  );
}

function InstructorRow({
  row,
  data,
  pricing,
  open,
  onToggle,
}: {
  row: Row;
  data: UsageStats;
  pricing: Pricing;
  open: boolean;
  onToggle: () => void;
}) {
  const i = row.instructor;
  const detailId = `usage-detail-${i.uid || 'orphans'}`;

  return (
    <>
      <tr className={open ? 'is-open' : undefined}>
        <th scope="row">
          <span className="usage-name">{i.displayName}</span>
          <span className="usage-sub">
            {i.email || 'account no longer exists'}
            {i.affiliation ? ` — ${i.affiliation}` : ''}
          </span>
        </th>
        <td className="n">{row.sessions}</td>
        <td className="n">{row.seats}</td>
        <td className="n">{row.runs}</td>
        <td className="n">{row.biggestClass}</td>
        <td>{fmtDate(row.firstActiveMs)}</td>
        <td>{fmtDate(row.lastActiveMs)}</td>
        <td className="n">{formatUsd(row.lifetimeUsd)}</td>
        <td className="n">
          <button
            className="btn-ghost usage-toggle"
            aria-expanded={open}
            aria-controls={detailId}
            onClick={onToggle}
          >
            {open ? 'Hide' : 'Detail'}
          </button>
        </td>
      </tr>
      {open && (
        <tr id={detailId} className="usage-detail-row">
          <td colSpan={9}>
            <SessionDetail row={row} data={data} pricing={pricing} />
          </td>
        </tr>
      )}
    </>
  );
}

function SessionDetail({
  row,
  data,
  pricing,
}: {
  row: Row;
  data: UsageStats;
  pricing: Pricing;
}) {
  const sessions = [...row.live].sort(
    (a, b) => (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0),
  );

  return (
    <div className="usage-detail">
      <p className="usage-detail-head">
        <strong>Last {data.retentionDays} days.</strong>{' '}
        {sessions.length === 0
          ? 'Nothing recent — everything this instructor has run is already past the window and survives only as the counts above.'
          : `${plural(row.windowDistinctStudents, 'distinct student')} across ${plural(
              sessions.length,
              'session',
            )}. Repeat attendees are counted once here and once per session in the lifetime figure.`}
        {row.archived.length > 0 &&
          ` ${plural(row.archived.length, 'earlier session')} already purged.`}
      </p>

      {sessions.length > 0 && (
        <table className="usage-table usage-table-inner">
          <caption className="sr-only">
            Individual sessions run by {row.instructor.displayName} in the last{' '}
            {data.retentionDays} days.
          </caption>
          <thead>
            <tr>
              <th scope="col">Session</th>
              <th scope="col">Date</th>
              <th scope="col">Format</th>
              <th scope="col" className="n">
                Students
              </th>
              <th scope="col" className="n">
                Finished
              </th>
              <th scope="col" className="n">
                Reads
              </th>
              <th scope="col" className="n">
                Writes
              </th>
              <th scope="col" className="n">
                Est. cost
              </th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => {
              const ops = sessionOps(toDated(s));
              const cost = estimate([toDated(s)], pricing);
              return (
                <tr key={s.id}>
                  <th scope="row">{s.title}</th>
                  <td>{fmtDate(s.createdAtMs)}</td>
                  <td>
                    {s.format === 'two-run' ? 'two runs' : 'single run'}
                    {s.runsPlayed === 0 && (
                      <span className="usage-sub">— never started</span>
                    )}
                  </td>
                  <td className="n">{s.players}</td>
                  <td className="n">{s.finished}</td>
                  <td className="n">{num(ops.reads)}</td>
                  <td className="n">{num(ops.writes)}</td>
                  <td className="n">{formatUsd(cost.grossUsd)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <BiggestSessionBreakdown row={row} pricing={pricing} />
    </div>
  );
}

/**
 * Where the money actually goes, worked through one of this instructor's
 * sessions. One example beats a per-session breakdown nobody reads: the shape
 * is the same every time, and the largest class is where it bites hardest.
 *
 * A session that never started is a poor example even when it is the largest —
 * its fan-out line would read as a claim about traffic that never happened —
 * so one that actually ran always wins. Purged sessions are eligible too: their
 * shape is all this needs, and for an instructor whose recent term has aged out
 * they are the only example left.
 */
function BiggestSessionBreakdown({ row, pricing }: { row: Row; pricing: Pricing }) {
  const candidates: { session: DatedSession; label: string }[] = [
    ...row.live.map((s) => ({ session: toDated(s), label: `“${s.title}”` })),
    ...row.archived.map((s) => ({ session: s, label: 'a since-purged session' })),
  ];
  const played = candidates.filter((c) => c.session.runsPlayed > 0);
  const pool = played.length ? played : candidates;
  const best = pool.reduce<(typeof pool)[number] | null>(
    (top, c) => (top == null || c.session.players > top.session.players ? c : top),
    null,
  );
  if (!best || best.session.players === 0) return null;

  const lines = priceLines(sessionLines(best.session), pricing).filter((l) => l.units > 0);

  return (
    <details className="usage-breakdown">
      <summary>
        Where it goes — {best.label}, {plural(best.session.players, 'student')}
      </summary>
      <ul>
        {lines.map((l: CostLine) => (
          <li key={l.key}>
            <span className="usage-line-label">{l.label}</span>
            <span className="usage-line-units">
              {l.unit === 'GiB-month'
                ? `${(l.units * 1024).toFixed(1)} MiB-month`
                : plural(l.units, l.unit)}
            </span>
            <span className="usage-line-usd">{formatUsd(l.usd)}</span>
            <span className="usage-line-why">{l.why}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** The honest small print, in the open rather than in a footnote. */
function Assumptions({ pricing }: { pricing: Pricing }) {
  return (
    <details className="card usage-assumptions">
      <summary>How these numbers are worked out</summary>
      <p>
        The counts are measured. The money is <strong>modelled</strong> —
        Firebase has no billing API this app can read, so each session’s
        documents and listener traffic are priced against Google’s published
        rates for {pricing.label.toLowerCase()}. Treat it as an order of
        magnitude, and check the Firebase console for the real invoice.
      </p>
      <ul>
        <li>
          <strong>Counts are lifetime; detail is not.</strong> A session is
          folded into a durable per-instructor counter just before the nightly
          cleanup deletes it, so sessions and students keep adding up forever.
          What cannot survive is anything about the individual students —
          they’re anonymous, and their records go with the session. That is why
          “students” counts a repeat attendee once per session rather than once.
        </li>
        <li>
          <strong>Purged sessions are re-priced, not frozen.</strong> The archive
          stores each session’s shape — class size, runs, length — rather than a
          dollar figure, so old sessions and new ones are always costed by the
          same model.
        </li>
        <li>
          <strong>Reads scale with the square of the class.</strong> Every
          student’s progress write is delivered to every other student’s
          leaderboard listener. Thirty students cost about 88,000 reads a
          session; a hundred cost over a million.
        </li>
        <li>
          <strong>The free tier is applied per day</strong> ({num(FREE_TIER.readsPerDay)}{' '}
          reads, {num(FREE_TIER.writesPerDay)} writes), because that is how
          Google resets it. Two classes on one afternoon can cost money where the
          same two on different days cost nothing. It is applied only to the
          headline “last 30 days” figure: a purged session’s date is gone, so
          which day’s allowance it used is genuinely unknown, and every
          all-time figure is therefore quoted at list price.
        </li>
        <li>
          <strong>Per-instructor costs are list price too.</strong> The allowance
          is project-wide, so there is no honest way to give one instructor a
          share of it.
        </li>
        <li>
          <strong>Not included:</strong> hosting bandwidth, function CPU time,
          egress, and authentication. All are free at classroom scale.
        </li>
      </ul>
    </details>
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
