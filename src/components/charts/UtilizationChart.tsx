// "Who was busy when" — small multiples: one single-series area chart per
// character. Single hue (identity is carried by the row label, not color),
// hover crosshair with per-minute value, table fallback via <details>.

import { useState } from 'react';
import { CHARACTERS, CHAR_IDS } from '../../engine/content';

const INK = '#33322e';
const MUTED = '#898781';
const GRID = '#e1e0d9';
const SERIES = '#2a78d6'; // validated categorical slot 1 (light)

const W = 520;
const ROW_H = 44;
const PLOT_H = 34;
const LABEL_W = 56;
const AVG_W = 44;
const PLOT_W = W - LABEL_W - AVG_W;

export function UtilizationChart({ utilization }: { utilization: number[][] }) {
  const [hoverMin, setHoverMin] = useState<number | null>(null);
  const minutes = Math.max(1, ...utilization.map((s) => s.length));

  const x = (m: number) => LABEL_W + (m / Math.max(1, minutes - 1)) * PLOT_W;

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const m = Math.round(((px - LABEL_W) / PLOT_W) * (minutes - 1));
    setHoverMin(m >= 0 && m < minutes ? m : null);
  }

  return (
    <div style={{ textAlign: 'left' }}>
      <svg
        viewBox={`0 0 ${W} ${ROW_H * CHAR_IDS.length + 18}`}
        style={{ width: '100%', height: 'auto', touchAction: 'none' }}
        role="img"
        aria-label="Utilization over time for each of the five friends"
        onPointerMove={onMove}
        onPointerLeave={() => setHoverMin(null)}
      >
        {CHAR_IDS.map((c, i) => {
          const series = utilization[i] ?? [];
          const top = i * ROW_H;
          const y = (v: number) => top + PLOT_H - v * (PLOT_H - 4);
          const pts = series.map((v, m) => `${x(m).toFixed(1)},${y(v).toFixed(1)}`);
          const area =
            pts.length > 1
              ? `M ${x(0)},${y(0) /* first value baseline start */} L ${pts.join(' L ')} L ${x(series.length - 1)},${top + PLOT_H} L ${x(0)},${top + PLOT_H} Z`
              : '';
          const avg =
            series.length > 0 ? series.reduce((a, b) => a + b, 0) / series.length : 0;
          return (
            <g key={c}>
              {/* hairline baseline */}
              <line x1={LABEL_W} x2={LABEL_W + PLOT_W} y1={top + PLOT_H} y2={top + PLOT_H}
                stroke={GRID} strokeWidth={1} />
              {area && <path d={area} fill={SERIES} opacity={0.1} />}
              {pts.length > 1 && (
                <polyline points={pts.join(' ')} fill="none" stroke={SERIES}
                  strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              )}
              <text x={0} y={top + PLOT_H - 10} fontSize={12} fontWeight={600} fill={INK}>
                {CHARACTERS[c].name}
              </text>
              <text x={W} y={top + PLOT_H - 10} fontSize={12} textAnchor="end" fill={INK}>
                {Math.round(avg * 100)}%
              </text>
              {hoverMin != null && hoverMin < series.length && (
                <circle cx={x(hoverMin)} cy={y(series[hoverMin])} r={4} fill={SERIES}
                  stroke="#fffaf0" strokeWidth={2} />
              )}
            </g>
          );
        })}
        {/* shared crosshair + time axis */}
        {hoverMin != null && (
          <>
            <line x1={x(hoverMin)} x2={x(hoverMin)} y1={0}
              y2={ROW_H * CHAR_IDS.length - (ROW_H - PLOT_H)}
              stroke={MUTED} strokeWidth={1} />
            <text x={x(hoverMin)} y={ROW_H * CHAR_IDS.length + 12} fontSize={11}
              textAnchor="middle" fill={INK}>
              {hoverMin}′ —{' '}
              {CHAR_IDS.map((c, i) =>
                `${CHARACTERS[c].name[0]} ${Math.round(((utilization[i] ?? [])[hoverMin] ?? 0) * 100)}%`,
              ).join('  ')}
            </text>
          </>
        )}
        {hoverMin == null && (
          <>
            <text x={LABEL_W} y={ROW_H * CHAR_IDS.length + 12} fontSize={11} fill={MUTED}>
              8:00
            </text>
            <text x={LABEL_W + PLOT_W} y={ROW_H * CHAR_IDS.length + 12} fontSize={11}
              textAnchor="end" fill={MUTED}>
              {`${Math.floor(8 + minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`}
            </text>
          </>
        )}
      </svg>
      <details style={{ fontSize: '0.8rem', color: 'var(--ink-soft)' }}>
        <summary>View as table</summary>
        <table style={{ borderCollapse: 'collapse', fontVariantNumeric: 'tabular-nums' }}>
          <thead>
            <tr>
              <th style={{ padding: 4, textAlign: 'left' }}>Friend</th>
              <th style={{ padding: 4 }}>Average</th>
              <th style={{ padding: 4 }}>First half</th>
              <th style={{ padding: 4 }}>Second half</th>
            </tr>
          </thead>
          <tbody>
            {CHAR_IDS.map((c, i) => {
              const s = utilization[i] ?? [];
              const avg = (arr: number[]) =>
                arr.length ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 100) : 0;
              const half = Math.floor(s.length / 2);
              return (
                <tr key={c}>
                  <td style={{ padding: 4 }}>{CHARACTERS[c].name}</td>
                  <td style={{ padding: 4, textAlign: 'right' }}>{avg(s)}%</td>
                  <td style={{ padding: 4, textAlign: 'right' }}>{avg(s.slice(0, half))}%</td>
                  <td style={{ padding: 4, textAlign: 'right' }}>{avg(s.slice(half))}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </details>
    </div>
  );
}
