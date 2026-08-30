// The task network, drawn against the clock.
//
// Each task is a box spanning its earliest start to its earliest finish on the
// same 0–120′ axis the Gantt uses, so the two read the same way. The critical
// chain sits on the top band; everything else is packed into as few rows as
// will hold it. Float — the slack between a task's earliest and latest finish —
// is a hollow bar trailing each box, which is the whole reason to draw this
// against time rather than as abstract layers.
//
// Colour is never the only signal: critical boxes also carry a heavier border
// and a ▲ marker, and the whole thing has a table fallback.

import { memo, useMemo, useState } from 'react';
import { computeCpm, packRows } from '../../engine/cpm';
import { TASK_BY_ID } from '../../engine/content';

const INK = '#33322e';
const MUTED = '#898781';
const GRID = '#e1e0d9';
const SURFACE = '#fffaf0';
const SERIES = '#2a78d6';
const CRITICAL = '#ec835a';

const TOTAL_MIN = 120;
const W = 900;
// Room for the end labels: centred text at x=0 and x=W would be half cut off.
const PAD_L = 26;
const PAD_R = 26;
const TOP = 26;
const ROW_H = 30;
const BAR_H = 18;
const PLOT_W = W - PAD_L - PAD_R;

function clockAt(min: number) {
  const h = Math.floor(8 + min / 60);
  const m = Math.floor(min) % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

/**
 * Memoised with no props: the network is a property of the scenario, not of the
 * plan, so it never needs to re-render. Without this it was being rebuilt on
 * every room-stage tick — four times a second — behind the plan board.
 */
export const NetworkDiagram = memo(function NetworkDiagram() {
  const [hover, setHover] = useState<string | null>(null);
  const { cpm, rows, rowCount } = useMemo(() => {
    const cpm = computeCpm();
    const rows = packRows(cpm);
    return { cpm, rows, rowCount: Math.max(...Object.values(rows)) + 1 };
  }, []);

  const H = TOP + rowCount * ROW_H + 28;
  const x = (min: number) => PAD_L + (Math.min(min, TOTAL_MIN) / TOTAL_MIN) * PLOT_W;
  const rowTop = (r: number) => TOP + r * ROW_H;

  const nodes = Object.values(cpm.nodes);
  const hovered = hover ? cpm.nodes[hover] : null;

  return (
    <div style={{ textAlign: 'left' }}>
      <div style={{ overflowX: 'auto' }}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          style={{ minWidth: 620, display: 'block' }}
          role="img"
          aria-label={
            `Task network on a time axis. The critical path runs ` +
            `${cpm.criticalPath.map((id) => TASK_BY_ID[id].name).join(', then ')}, ` +
            `and takes ${cpm.projectDuration} minutes of the 120 available.`
          }
        >
          {/* hour gridlines */}
          {[0, 30, 60, 90, 120].map((m) => (
            <g key={m}>
              <line x1={x(m)} x2={x(m)} y1={TOP - 8} y2={H - 24} stroke={GRID} strokeWidth={1} />
              <text
                x={x(m)}
                y={TOP - 13}
                fontSize={11}
                textAnchor={m === 0 ? 'start' : m === TOTAL_MIN ? 'end' : 'middle'}
                fill={MUTED}
              >
                {clockAt(m)}
              </text>
            </g>
          ))}

          {/* the critical-path length, marked on the axis */}
          <line
            x1={x(cpm.projectDuration)}
            x2={x(cpm.projectDuration)}
            y1={TOP - 8}
            y2={H - 24}
            stroke={CRITICAL}
            strokeWidth={1.5}
            strokeDasharray="4 3"
          />

          {nodes.map((n) => {
            const r = rows[n.id];
            const y = rowTop(r);
            const bx = x(n.es);
            const bw = Math.max(6, x(n.ef) - x(n.es));
            const fw = x(n.lf) - x(n.ef);
            const dim = hover != null && hover !== n.id;
            const name = TASK_BY_ID[n.id].name;
            // Same truncation the Gantt uses, so labels behave identically.
            const maxChars = Math.floor((bw - 9) / 5.1);
            const label = maxChars >= 3 ? name.slice(0, maxChars) : '';

            return (
              <g
                key={n.id}
                opacity={dim ? 0.35 : 1}
                onMouseEnter={() => setHover(n.id)}
                onMouseLeave={() => setHover(null)}
              >
                {/* float: how late this could run without hurting the finish */}
                {fw > 2 && (
                  <rect
                    x={x(n.ef)}
                    y={y + BAR_H / 2 - 2}
                    width={fw}
                    height={4}
                    fill={SERIES}
                    opacity={0.18}
                  />
                )}
                <rect
                  x={bx}
                  y={y}
                  width={bw}
                  height={BAR_H}
                  rx={3}
                  fill={n.critical ? CRITICAL : SERIES}
                  fillOpacity={n.critical ? 0.9 : 0.75}
                  stroke={n.critical ? '#a2481f' : 'none'}
                  strokeWidth={n.critical ? 2.5 : 0}
                />
                {label && (
                  <text
                    x={bx + 5}
                    y={y + BAR_H / 2 + 4}
                    fontSize={10.5}
                    fill="#fff"
                    style={{ pointerEvents: 'none' }}
                  >
                    {n.critical ? '▲ ' : ''}
                    {label}
                  </text>
                )}
              </g>
            );
          })}

          {hovered && (
            <g style={{ pointerEvents: 'none' }}>
              <rect
                x={Math.min(x(hovered.es), W - 250)}
                y={rowTop(rows[hovered.id]) - 26}
                width={244}
                height={22}
                rx={4}
                fill={SURFACE}
                stroke={GRID}
              />
              <text
                x={Math.min(x(hovered.es), W - 250) + 8}
                y={rowTop(rows[hovered.id]) - 11}
                fontSize={11}
                fill={INK}
              >
                {TASK_BY_ID[hovered.id].name} · {hovered.dur}′ ·{' '}
                {hovered.critical ? 'on the critical path' : `${hovered.slack}′ of float`}
              </text>
            </g>
          )}

          <text x={PAD_L} y={H - 8} fontSize={11} fill={MUTED}>
            ▲ critical path — {cpm.projectDuration}′ of the 120 available. Faded
            bars are float: how late a task can run without moving the finish.
          </text>
        </svg>
      </div>

      <details style={{ marginTop: 8 }}>
        <summary style={{ cursor: 'pointer', fontSize: '0.85rem' }}>View as table</summary>
        <table style={{ width: '100%', fontSize: '0.8rem', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left', color: MUTED }}>
              <th>Task</th>
              <th>Length</th>
              <th>Earliest start</th>
              <th>Earliest finish</th>
              <th>Latest finish</th>
              <th>Float</th>
              <th>Critical</th>
            </tr>
          </thead>
          <tbody>
            {nodes
              .sort((a, b) => a.es - b.es || a.id.localeCompare(b.id))
              .map((n) => (
                <tr key={n.id} style={{ borderTop: `1px solid ${GRID}` }}>
                  <td>{TASK_BY_ID[n.id].name}</td>
                  <td>{n.dur}′</td>
                  <td>{clockAt(n.es)}</td>
                  <td>{clockAt(n.ef)}</td>
                  <td>{clockAt(n.lf)}</td>
                  <td>{n.slack}′</td>
                  <td>{n.critical ? 'yes' : ''}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </details>
    </div>
  );
});
