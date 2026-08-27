// "How the work actually landed" — cumulative project completion against the
// clock, the classic S-curve.
//
// One data series, so no legend box: the heading names it. The even-pace line
// is chrome rather than a series (muted, dashed, direct-labelled), which is why
// it does not need a categorical slot. Milestones are a table, not 120 rows.

import { useState } from 'react';
import { SIM_DEADLINE_TICKS, TICKS_PER_MINUTE } from '../../engine/content';

const INK = '#33322e';
const MUTED = '#898781';
const GRID = '#e1e0d9';
const SERIES = '#2a78d6'; // validated categorical slot 1 on this surface
const SURFACE = '#fffaf0';

const TOTAL_MIN = SIM_DEADLINE_TICKS / TICKS_PER_MINUTE;
const W = 760;
const H = 250;
const PAD_L = 42;
const PAD_R = 14;
const PAD_T = 14;
const PAD_B = 30;
const PLOT_W = W - PAD_L - PAD_R;
const PLOT_H = H - PAD_T - PAD_B;

function clockAt(min: number) {
  const h = Math.floor(8 + min / 60);
  const m = Math.floor(min) % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

export function CompletionChart({
  completion,
  finishSimMinute,
}: {
  /** completion[simMinute] in [0,1]. */
  completion: number[];
  finishSimMinute?: number | null;
}) {
  const [hover, setHover] = useState<number | null>(null);
  if (completion.length === 0) return null;

  const x = (min: number) => PAD_L + (Math.min(min, TOTAL_MIN) / TOTAL_MIN) * PLOT_W;
  const y = (frac: number) => PAD_T + (1 - Math.max(0, Math.min(1, frac))) * PLOT_H;

  const pts = completion.map((v, m) => `${x(m + 1).toFixed(1)},${y(v).toFixed(1)}`);
  const line = `M ${x(0)},${y(0)} L ${pts.join(' L ')}`;
  const area = `${line} L ${x(completion.length)},${y(0)} L ${x(0)},${y(0)} Z`;

  // First minute each quarter was reached — the table view, and far more
  // readable than a per-minute dump.
  const milestones = [0.25, 0.5, 0.75, 1].map((target) => {
    const idx = completion.findIndex((v) => v >= target);
    return { target, minute: idx < 0 ? null : idx + 1 };
  });

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const m = Math.round(((px - PAD_L) / PLOT_W) * TOTAL_MIN);
    setHover(m >= 1 && m <= completion.length ? m : null);
  }

  const hoverVal = hover != null ? completion[hover - 1] : null;

  return (
    <div style={{ textAlign: 'left' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: '100%', height: 'auto', touchAction: 'none' }}
        role="img"
        aria-label={
          `Project completion over time. ` +
          milestones
            .filter((m) => m.minute != null)
            .map((m) => `${m.target * 100}% reached at ${clockAt(m.minute!)}`)
            .join('; ') +
          `. Ended at ${Math.round((completion.at(-1) ?? 0) * 100)}%.`
        }
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {/* horizontal gridlines at each quarter */}
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <g key={f}>
            <line x1={PAD_L} x2={W - PAD_R} y1={y(f)} y2={y(f)} stroke={GRID} strokeWidth={1} />
            <text x={PAD_L - 7} y={y(f) + 4} fontSize={11} textAnchor="end" fill={MUTED}>
              {f * 100}%
            </text>
          </g>
        ))}

        {/* Even-pace benchmark: what a perfectly steady 2 hours would look like.
            Real projects are S-curves, and seeing the gap is the point. */}
        <line
          x1={x(0)}
          y1={y(0)}
          x2={x(TOTAL_MIN)}
          y2={y(1)}
          stroke={MUTED}
          strokeWidth={1.5}
          strokeDasharray="5 4"
        />
        {/* Halo, because the label otherwise sits on top of its own line. */}
        <rect
          x={x(TOTAL_MIN) - 62}
          y={y(1) + 5}
          width={58}
          height={13}
          rx={3}
          fill={SURFACE}
        />
        <text
          x={x(TOTAL_MIN) - 6}
          y={y(1) + 15}
          fontSize={10}
          textAnchor="end"
          fill={MUTED}
        >
          even pace
        </text>

        <path d={area} fill={SERIES} opacity={0.12} />
        <path d={line} fill="none" stroke={SERIES} strokeWidth={2} strokeLinejoin="round" />

        {/* finish marker */}
        {finishSimMinute != null && (
          <>
            <circle cx={x(finishSimMinute)} cy={y(1)} r={4.5} fill={SERIES} stroke={SURFACE} strokeWidth={2} />
            <text
              x={x(finishSimMinute) - 8}
              y={y(1) - 8}
              fontSize={10}
              textAnchor="end"
              fill={INK}
              fontWeight={600}
            >
              done {clockAt(finishSimMinute)}
            </text>
          </>
        )}

        {/* hover crosshair */}
        {hover != null && hoverVal != null && (
          <g pointerEvents="none">
            <line x1={x(hover)} x2={x(hover)} y1={PAD_T} y2={PAD_T + PLOT_H} stroke={MUTED} strokeWidth={1} />
            <circle cx={x(hover)} cy={y(hoverVal)} r={4} fill={SERIES} stroke={SURFACE} strokeWidth={2} />
            <rect
              x={Math.min(W - 128, Math.max(2, x(hover) - 60))}
              y={PAD_T + 2}
              width={126}
              height={19}
              rx={5}
              fill={SURFACE}
              stroke={INK}
              strokeWidth={1}
            />
            <text
              x={Math.min(W - 128, Math.max(2, x(hover) - 60)) + 8}
              y={PAD_T + 15}
              fontSize={10.5}
              fill={INK}
            >
              {clockAt(hover)} — {Math.round(hoverVal * 100)}% done
            </text>
          </g>
        )}

        {/* time axis */}
        {[0, 30, 60, 90, 120].map((m) => (
          <text
            key={m}
            x={x(m)}
            y={H - 10}
            fontSize={11}
            textAnchor={m === 0 ? 'start' : m === TOTAL_MIN ? 'end' : 'middle'}
            fill={MUTED}
          >
            {clockAt(m)}
          </text>
        ))}
      </svg>

      <details style={{ fontSize: '0.8rem', color: 'var(--ink-soft)', marginTop: 4 }}>
        <summary>View as table</summary>
        <table style={{ borderCollapse: 'collapse', fontVariantNumeric: 'tabular-nums' }}>
          <thead>
            <tr>
              <th style={thc}>Milestone</th>
              <th style={thc}>Reached at</th>
              <th style={thc}>Even pace would be</th>
            </tr>
          </thead>
          <tbody>
            {milestones.map((m) => (
              <tr key={m.target}>
                <td style={tdc}>{m.target * 100}% complete</td>
                <td style={tdc}>{m.minute == null ? 'not reached' : clockAt(m.minute)}</td>
                <td style={tdc}>{clockAt(m.target * TOTAL_MIN)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

const thc: React.CSSProperties = {
  textAlign: 'left',
  padding: '4px 10px 4px 0',
  borderBottom: '2px solid var(--line)',
};
const tdc: React.CSSProperties = {
  padding: '3px 10px 3px 0',
  borderBottom: '1px solid var(--line)',
  whiteSpace: 'nowrap',
};
