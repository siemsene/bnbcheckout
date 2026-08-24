// Class results: average utilization (y) vs completion time (x), one dot per
// finished player. Emphasis form: winners get a ring + trophy label + name;
// everyone else stays in the base hue. Unfinished players are listed under the
// plot (they have no completion time). The leaderboard table alongside is the
// table view. Hover tooltip per dot.

import { useState } from 'react';
import type { PlayerDoc } from '../../firebase/data';

const INK = '#33322e';
const MUTED = '#898781';
const GRID = '#e1e0d9';
const SERIES = '#2a78d6';
const GOLD = '#b8860b';

const W = 560;
const H = 320;
const M = { top: 18, right: 20, bottom: 42, left: 46 };

export function ClassScatter({
  players,
  highlightId,
}: {
  players: PlayerDoc[];
  highlightId?: string;
}) {
  const [hover, setHover] = useState<PlayerDoc | null>(null);
  const finished = players.filter((p) => p.finished && p.finishSimMinute != null);
  const unfinished = players.filter((p) => !p.finished);
  const winners = [...finished].sort((a, b) => b.score - a.score).slice(0, 3);

  if (finished.length === 0) {
    return (
      <p style={{ color: 'var(--ink-soft)' }}>
        The scatter appears when the first player finishes checkout.
      </p>
    );
  }

  const xMin = Math.min(60, ...finished.map((p) => p.finishSimMinute!)) - 5;
  const xMax = 120;
  const x = (v: number) => M.left + ((v - xMin) / (xMax - xMin)) * (W - M.left - M.right);
  const y = (v: number) => M.top + (1 - v) * (H - M.top - M.bottom);

  const xTicks = [];
  for (let t = Math.ceil(xMin / 15) * 15; t <= xMax; t += 15) xTicks.push(t);

  return (
    <div style={{ textAlign: 'left' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: '100%', height: 'auto' }}
        role="img"
        aria-label="Scatter chart of average team utilization against checkout completion time; winners are marked with a trophy"
      >
        {/* grid + axes */}
        {[0, 0.25, 0.5, 0.75, 1].map((v) => (
          <g key={v}>
            <line x1={M.left} x2={W - M.right} y1={y(v)} y2={y(v)} stroke={GRID} strokeWidth={1} />
            <text x={M.left - 6} y={y(v) + 4} fontSize={11} textAnchor="end" fill={MUTED}>
              {Math.round(v * 100)}%
            </text>
          </g>
        ))}
        {xTicks.map((t) => (
          <text key={t} x={x(t)} y={H - M.bottom + 16} fontSize={11} textAnchor="middle" fill={MUTED}>
            {t}′
          </text>
        ))}
        <line x1={M.left} x2={W - M.right} y1={H - M.bottom} y2={H - M.bottom}
          stroke="#c3c2b7" strokeWidth={1} />
        <text x={(M.left + W - M.right) / 2} y={H - 6} fontSize={12} textAnchor="middle" fill={INK}>
          Checkout completed at (sim-minutes; earlier is better →  left)
        </text>
        <text x={12} y={M.top + (H - M.top - M.bottom) / 2} fontSize={12} textAnchor="middle"
          fill={INK} transform={`rotate(-90 12 ${M.top + (H - M.top - M.bottom) / 2})`}>
          Avg team utilization
        </text>

        {/* dots */}
        {finished.map((p) => {
          const isWinner = winners.some((w) => w.id === p.id);
          const isYou = p.id === highlightId;
          const cx = x(p.finishSimMinute!);
          const cy = y(p.utilizationAvg);
          return (
            <g key={p.id}
              onPointerEnter={() => setHover(p)}
              onPointerLeave={() => setHover(null)}
              style={{ cursor: 'default' }}>
              {/* enlarged invisible hit target */}
              <circle cx={cx} cy={cy} r={12} fill="transparent" />
              <circle cx={cx} cy={cy} r={isWinner ? 7 : 5}
                fill={SERIES}
                stroke={isWinner ? GOLD : '#fffaf0'}
                strokeWidth={isWinner ? 3 : 2} />
              {(isWinner || isYou) && (
                <text x={cx} y={cy - 12} fontSize={11} fontWeight={700} textAnchor="middle" fill={INK}>
                  {isWinner ? '🏆 ' : ''}{p.name}{isYou ? ' (you)' : ''}
                </text>
              )}
            </g>
          );
        })}

        {/* tooltip */}
        {hover && (
          <g pointerEvents="none">
            <rect x={Math.min(x(hover.finishSimMinute!) + 10, W - 180)}
              y={Math.max(4, y(hover.utilizationAvg) - 40)} width={170} height={34} rx={6}
              fill="#fffef9" stroke={GRID} />
            <text x={Math.min(x(hover.finishSimMinute!) + 18, W - 172)}
              y={Math.max(18, y(hover.utilizationAvg) - 26)} fontSize={11} fill={INK} fontWeight={700}>
              {hover.name}
            </text>
            <text x={Math.min(x(hover.finishSimMinute!) + 18, W - 172)}
              y={Math.max(31, y(hover.utilizationAvg) - 13)} fontSize={11} fill={INK}>
              done {Math.round(hover.finishSimMinute!)}′ · util {Math.round(hover.utilizationAvg * 100)}%
            </text>
          </g>
        )}
      </svg>
      {unfinished.length > 0 && (
        <p style={{ fontSize: '0.8rem', color: 'var(--ink-soft)' }}>
          Didn’t finish before 10 AM: {unfinished.map((p) => `${p.name} (${Math.round(p.pctComplete * 100)}%)`).join(', ')}
        </p>
      )}
    </div>
  );
}
