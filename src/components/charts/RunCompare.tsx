// Run 1 against run 2 — did planning actually help?
//
// Paired bars rather than two numbers: the point is the size of the gap, and a
// reader should get it without doing subtraction. Direction of "better" differs
// per metric (earlier finish good, more rework bad), so each row says which way
// is up rather than relying on colour alone.

import type { ResultSummary } from '../../engine/scoring';

const INK = '#33322e';
const MUTED = '#898781';
const GRID = '#e1e0d9';
const RUN1 = '#b9b7ae';
const RUN2 = '#2a78d6';
const BETTER = '#22633a';
const WORSE = '#a2481f';

interface Row {
  label: string;
  a: number | null;
  b: number | null;
  /** Max for the bar scale. */
  max: number;
  fmt: (v: number) => string;
  /** True when a smaller number is the better outcome. */
  lowerIsBetter: boolean;
}

function productiveShare(r: ResultSummary): number {
  let assigned = 0;
  let producing = 0;
  for (const s of r.timeline) {
    const d = s.end - s.start;
    assigned += d;
    if (s.kind === 'working') producing += d;
  }
  return assigned > 0 ? producing / assigned : 0;
}

export function RunCompare({ run1, run2 }: { run1: ResultSummary; run2: ResultSummary }) {
  const rows: Row[] = [
    {
      label: 'Finished at',
      a: run1.finishSimMinute,
      b: run2.finishSimMinute,
      max: 120,
      fmt: (v) => `${Math.floor(8 + v / 60)}:${String(Math.floor(v) % 60).padStart(2, '0')}`,
      lowerIsBetter: true,
    },
    {
      label: 'Work completed',
      a: run1.pctComplete * 100,
      b: run2.pctComplete * 100,
      max: 100,
      fmt: (v) => `${Math.round(v)}%`,
      lowerIsBetter: false,
    },
    {
      label: 'Average utilisation',
      a: run1.avgUtilization * 100,
      b: run2.avgUtilization * 100,
      max: 100,
      fmt: (v) => `${Math.round(v)}%`,
      lowerIsBetter: false,
    },
    {
      label: 'Productive time',
      a: productiveShare(run1) * 100,
      b: productiveShare(run2) * 100,
      max: 100,
      fmt: (v) => `${Math.round(v)}%`,
      lowerIsBetter: false,
    },
    {
      label: 'Rework events',
      a: run1.reworkTotal,
      b: run2.reworkTotal,
      max: Math.max(4, run1.reworkTotal, run2.reworkTotal),
      fmt: (v) => String(Math.round(v)),
      lowerIsBetter: true,
    },
  ];

  return (
    <div style={{ textAlign: 'left' }}>
      <div
        style={{
          display: 'flex',
          gap: 16,
          fontSize: '0.78rem',
          color: MUTED,
          marginBottom: 8,
        }}
      >
        <span>
          <Swatch fill={RUN1} /> First run
        </span>
        <span>
          <Swatch fill={RUN2} /> Second run, with a plan
        </span>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem' }}>
        <tbody>
          {rows.map((r) => {
            const delta = r.a != null && r.b != null ? r.b - r.a : null;
            // Judge the change on what the reader can actually see. A drift of
            // 0.4% renders as "81% -> 81%", and calling that a decline reads as
            // a bug in the debrief rather than a fact about the run.
            const visible = delta != null && r.fmt(r.a!) !== r.fmt(r.b!);
            const better = !visible || delta == null
              ? null
              : r.lowerIsBetter
                ? delta < 0
                : delta > 0;
            return (
              <tr key={r.label} style={{ borderTop: `1px solid ${GRID}` }}>
                <th
                  scope="row"
                  style={{ textAlign: 'left', padding: '7px 10px 7px 0', fontWeight: 600 }}
                >
                  {r.label}
                </th>
                <td style={{ width: '55%', padding: '7px 10px 7px 0' }}>
                  <Bars a={r.a} b={r.b} max={r.max} />
                </td>
                <td style={{ padding: '7px 0', whiteSpace: 'nowrap', color: MUTED }}>
                  {r.a == null ? '—' : r.fmt(r.a)} →{' '}
                  <strong style={{ color: INK }}>{r.b == null ? '—' : r.fmt(r.b)}</strong>
                </td>
                <td
                  style={{
                    padding: '7px 0 7px 10px',
                    whiteSpace: 'nowrap',
                    fontWeight: 700,
                    color: better == null ? MUTED : better ? BETTER : WORSE,
                  }}
                >
                  {delta == null
                    ? r.a == null && r.b != null
                      ? 'finished this time'
                      : r.a != null && r.b == null
                        ? 'did not finish'
                        : 'neither run finished'
                    : !visible
                      ? 'no change'
                      : `${better ? '▲' : '▼'} ${
                          r.lowerIsBetter && r.max === 120
                            ? `${Math.abs(Math.round(delta))}′`
                            : r.fmt(Math.abs(delta))
                        }`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Bars({ a, b, max }: { a: number | null; b: number | null; max: number }) {
  const pct = (v: number | null) => (v == null ? 0 : Math.max(1, (v / max) * 100));
  return (
    <span style={{ display: 'grid', gap: 3 }}>
      <span style={{ display: 'block', height: 8, background: GRID, borderRadius: 4 }}>
        <span
          style={{ display: 'block', height: 8, width: `${pct(a)}%`, background: RUN1, borderRadius: 4 }}
        />
      </span>
      <span style={{ display: 'block', height: 8, background: GRID, borderRadius: 4 }}>
        <span
          style={{ display: 'block', height: 8, width: `${pct(b)}%`, background: RUN2, borderRadius: 4 }}
        />
      </span>
    </span>
  );
}

function Swatch({ fill }: { fill: string }) {
  return (
    <span
      aria-hidden
      style={{
        display: 'inline-block',
        width: 12,
        height: 8,
        borderRadius: 3,
        background: fill,
        marginRight: 4,
      }}
    />
  );
}
