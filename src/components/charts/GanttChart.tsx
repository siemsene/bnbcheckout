// "Who worked when on what" — a Gantt of the whole run: one row per friend,
// ranged bars over the fixed 8:00–10:00 window.
//
// Color encodes how the time was SPENT, never which task it was (22 tasks is
// far past any categorical palette): working and travel are two steps of one
// blue ordinal ramp (validated: monotone L, light end 2.03:1 on this surface),
// and blocked is the reserved "serious" status step. Task identity comes from
// direct labels, the hover tooltip, and the table fallback — never from hue.
// Blocked also carries a hatch texture so it is legible without color.

import { memo, useState } from 'react';
import { CHARACTERS, CHAR_IDS, TASK_BY_ID, TICKS_PER_MINUTE } from '../../engine/content';
import type { TimelineKind, TimelineSegment } from '../../engine/types';

const INK = '#33322e';
const MUTED = '#898781';
const GRID = '#e1e0d9';
const SURFACE = '#fffaf0';
/** Muted enough to read as a reference rather than a fourth activity kind. */
const PLANNED = '#b9b7ae';

const KIND_STYLE: Record<TimelineKind, { fill: string; label: string; hint: string }> = {
  working: { fill: '#2a78d6', label: 'Working', hint: 'producing work on the task' },
  travel: { fill: '#86b6ef', label: 'Walking', hint: 'in transit — no work produced' },
  blocked: { fill: '#ec835a', label: 'Blocked', hint: 'on a call, distracted, or unable' },
};
const KIND_ORDER: TimelineKind[] = ['working', 'travel', 'blocked'];

const TOTAL_MIN = 120;
const W = 760;
const LABEL_W = 66;
const TOTAL_W = 46;
const ROW_H = 34;
const BAR_H = 15;
const TOP_PAD = 16; // room for the finish marker's label above row 1
const PLOT_W = W - LABEL_W - TOTAL_W;
const H = TOP_PAD + ROW_H * CHAR_IDS.length + 26;

function clockAt(min: number) {
  const h = Math.floor(8 + min / 60);
  const m = Math.floor(min) % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

function segLabel(seg: TimelineSegment) {
  if (seg.taskId) return TASK_BY_ID[seg.taskId]?.name ?? seg.taskId;
  return seg.kind === 'travel' ? 'Walking back' : 'No task assigned';
}

export const GanttChart = memo(function GanttChart({
  timeline,
  finishSimMinute,
  planned,
  plannedFinishSimMinute,
}: {
  timeline: TimelineSegment[];
  finishSimMinute?: number | null;
  /**
   * The schedule the plan predicted, drawn as a thin ghost rail above each row.
   * Absent for an ordinary run, in which case this renders exactly as it always
   * did — run 1's results must not change shape.
   */
  planned?: TimelineSegment[];
  plannedFinishSimMinute?: number | null;
}) {
  const [hover, setHover] = useState<TimelineSegment | null>(null);

  const x = (min: number) => LABEL_W + (Math.min(min, TOTAL_MIN) / TOTAL_MIN) * PLOT_W;
  const rowTop = (i: number) => TOP_PAD + i * ROW_H;

  // Productive minutes per character, for the right-hand value column.
  const workedMin: Record<string, number> = {};
  for (const s of timeline) {
    if (s.kind !== 'working') continue;
    workedMin[s.charId] = (workedMin[s.charId] ?? 0) + (s.end - s.start) / TICKS_PER_MINUTE;
  }

  return (
    <div style={{ textAlign: 'left' }}>
      <div
        style={{
          display: 'flex',
          gap: 14,
          flexWrap: 'wrap',
          fontSize: '0.75rem',
          color: 'var(--ink-soft)',
          margin: '2px 0 6px',
        }}
      >
        {KIND_ORDER.map((k) => (
          <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <svg width={14} height={11} aria-hidden>
              <rect width={14} height={11} rx={3} fill={KIND_STYLE[k].fill} />
              {k === 'blocked' &&
                [-6, -1, 4, 9].map((o) => (
                  <line
                    key={o}
                    x1={o}
                    y1={11}
                    x2={o + 11}
                    y2={0}
                    stroke="#a3441c"
                    strokeWidth={1.6}
                  />
                ))}
            </svg>
            <strong style={{ color: INK }}>{KIND_STYLE[k].label}</strong> — {KIND_STYLE[k].hint}
          </span>
        ))}
        {planned && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <svg width={14} height={11} aria-hidden>
              <rect y={3} width={14} height={4} rx={2} fill={PLANNED} />
            </svg>
            <strong style={{ color: INK }}>Planned</strong> — what your plan said
            would happen
          </span>
        )}
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: '100%', height: 'auto', touchAction: 'none' }}
        role="img"
        aria-label={`Gantt chart of the run: for each of the five friends, which task they worked on during each part of the two hours. ${CHAR_IDS.map(
          (c) => `${CHARACTERS[c].name} produced work for ${Math.round(workedMin[c] ?? 0)} minutes`,
        ).join('; ')}.`}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          {/* Secondary encoding for "blocked" — readable without color. */}
          <pattern
            id="gantt-hatch"
            width={5}
            height={5}
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <line x1={0} y1={0} x2={0} y2={5} stroke="#a3441c" strokeWidth={1.6} />
          </pattern>
        </defs>

        {/* quarter-hour gridlines, recessive */}
        {Array.from({ length: TOTAL_MIN / 15 + 1 }, (_, i) => i * 15).map((m) => (
          <line
            key={m}
            x1={x(m)}
            x2={x(m)}
            y1={TOP_PAD}
            y2={TOP_PAD + ROW_H * CHAR_IDS.length}
            stroke={GRID}
            strokeWidth={1}
          />
        ))}

        {/* rows */}
        {CHAR_IDS.map((c, i) => {
          const top = rowTop(i);
          const barY = top + (ROW_H - BAR_H) / 2;
          const segs = timeline.filter((s) => s.charId === c);
          return (
            <g key={c}>
              <text x={0} y={barY + BAR_H - 3} fontSize={12} fontWeight={600} fill={INK}>
                {CHARACTERS[c].name}
              </text>

              {/* The plan, as a ghost rail. There is room above the bar without
                  changing the row height, so plan and actual line up vertically
                  and the drift between them is readable at a glance. */}
              {planned
                ?.filter((s) => s.charId === c && s.kind === 'working')
                .map((s, k) => {
                  const gx = x(s.start / TICKS_PER_MINUTE);
                  const gw = Math.max(1.2, x(s.end / TICKS_PER_MINUTE) - gx - 1.5);
                  return (
                    <rect
                      key={`p${k}`}
                      x={gx}
                      y={top + 1}
                      width={gw}
                      height={4}
                      rx={2}
                      fill={PLANNED}
                    />
                  );
                })}
              {segs.map((s, k) => {
                const x0 = x(s.start / TICKS_PER_MINUTE);
                const x1 = x(s.end / TICKS_PER_MINUTE);
                const raw = x1 - x0;
                const w = Math.max(1.2, raw > 3 ? raw - 1.5 : raw); // 2px surface gap
                const style = KIND_STYLE[s.kind];
                const name = segLabel(s);
                // Truncate to whatever the bar can hold rather than dropping the
                // label entirely — reassignments make most bars fairly short.
                const maxChars = Math.floor((w - 9) / 5.1);
                const label =
                  s.kind === 'working' && maxChars >= 4
                    ? maxChars >= name.length
                      ? name
                      : `${name.slice(0, maxChars - 1).trimEnd()}…`
                    : null;
                return (
                  <g
                    key={k}
                    onPointerEnter={() => setHover(s)}
                    style={{ cursor: 'default' }}
                  >
                    {/* hit target, taller than the mark */}
                    <rect x={x0} y={top} width={Math.max(w, 6)} height={ROW_H} fill="transparent" />
                    <rect x={x0} y={barY} width={w} height={BAR_H} rx={3} fill={style.fill} />
                    {s.kind === 'blocked' && (
                      <rect x={x0} y={barY} width={w} height={BAR_H} rx={3} fill="url(#gantt-hatch)" />
                    )}
                    {hover === s && (
                      <rect
                        x={x0}
                        y={barY}
                        width={w}
                        height={BAR_H}
                        rx={3}
                        fill="none"
                        stroke={INK}
                        strokeWidth={1.5}
                      />
                    )}
                    {label && (
                      <text
                        x={x0 + 5}
                        y={barY + BAR_H - 4}
                        fontSize={9.5}
                        fill="#fff"
                        fontWeight={600}
                      >
                        {label}
                      </text>
                    )}
                  </g>
                );
              })}
              <text
                x={W}
                y={barY + BAR_H - 3}
                fontSize={11}
                textAnchor="end"
                fill={INK}
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {Math.round(workedMin[c] ?? 0)}′
              </text>
            </g>
          );
        })}

        {/* finish marker */}
        {finishSimMinute != null && finishSimMinute < TOTAL_MIN && (
          <>
            <line
              x1={x(finishSimMinute)}
              x2={x(finishSimMinute)}
              y1={TOP_PAD}
              y2={TOP_PAD + ROW_H * CHAR_IDS.length}
              stroke={INK}
              strokeWidth={1.5}
              strokeDasharray="4 3"
            />
            <text
              x={x(finishSimMinute) - 4}
              y={TOP_PAD - 5}
              fontSize={10}
              textAnchor="end"
              fill={INK}
              fontWeight={600}
            >
              everyone finished ▸
            </text>
          </>
        )}

        {/* where the plan said it would end, for comparison with the real one */}
        {plannedFinishSimMinute != null && plannedFinishSimMinute < TOTAL_MIN && (
          <>
            <line
              x1={x(plannedFinishSimMinute)}
              x2={x(plannedFinishSimMinute)}
              y1={TOP_PAD}
              y2={TOP_PAD + ROW_H * CHAR_IDS.length}
              stroke={PLANNED}
              strokeWidth={1.5}
              strokeDasharray="2 3"
            />
            <text
              x={x(plannedFinishSimMinute) - 4}
              y={TOP_PAD + ROW_H * CHAR_IDS.length + 11}
              fontSize={10}
              textAnchor="end"
              fill={MUTED}
            >
              plan said here
            </text>
          </>
        )}

        {/* time axis */}
        {[0, 30, 60, 90, 120].map((m) => (
          <text
            key={m}
            x={x(m)}
            y={TOP_PAD + ROW_H * CHAR_IDS.length + 15}
            fontSize={11}
            textAnchor={m === 0 ? 'start' : m === TOTAL_MIN ? 'end' : 'middle'}
            fill={MUTED}
          >
            {clockAt(m)}
          </text>
        ))}
        <text
          x={W}
          y={TOP_PAD + ROW_H * CHAR_IDS.length + 15}
          fontSize={10}
          textAnchor="end"
          fill={MUTED}
        >
          worked
        </text>

        {/* tooltip */}
        {hover &&
          (() => {
            const i = CHAR_IDS.indexOf(hover.charId);
            const text = `${CHARACTERS[hover.charId].name} · ${segLabel(hover)} · ${clockAt(
              hover.start / TICKS_PER_MINUTE,
            )}–${clockAt(hover.end / TICKS_PER_MINUTE)} · ${KIND_STYLE[hover.kind].label}`;
            const tw = text.length * 5.6 + 14;
            const tx = Math.max(2, Math.min(W - tw - 2, x(hover.start / TICKS_PER_MINUTE) - tw / 3));
            const above = i > 1;
            const ty = rowTop(i) + (above ? -20 : ROW_H + 4);
            return (
              <g pointerEvents="none">
                <rect
                  x={tx}
                  y={ty}
                  width={tw}
                  height={19}
                  rx={5}
                  fill={SURFACE}
                  stroke={INK}
                  strokeWidth={1}
                />
                <text x={tx + 7} y={ty + 13} fontSize={10.5} fill={INK}>
                  {text}
                </text>
              </g>
            );
          })()}
      </svg>

      <details style={{ fontSize: '0.8rem', color: 'var(--ink-soft)', marginTop: 4 }}>
        <summary>View as table</summary>
        <div style={{ maxHeight: 240, overflow: 'auto' }}>
          <table
            style={{
              borderCollapse: 'collapse',
              fontVariantNumeric: 'tabular-nums',
              width: '100%',
            }}
          >
            <thead>
              <tr>
                <th style={thc}>Friend</th>
                <th style={thc}>Task</th>
                <th style={thc}>From</th>
                <th style={thc}>To</th>
                <th style={thc}>Minutes</th>
                <th style={thc}>Time spent</th>
              </tr>
            </thead>
            <tbody>
              {timeline.map((s, i) => (
                <tr key={i}>
                  <td style={tdc}>{CHARACTERS[s.charId].name}</td>
                  <td style={tdc}>{segLabel(s)}</td>
                  <td style={tdc}>{clockAt(s.start / TICKS_PER_MINUTE)}</td>
                  <td style={tdc}>{clockAt(s.end / TICKS_PER_MINUTE)}</td>
                  <td style={{ ...tdc, textAlign: 'right' }}>
                    {((s.end - s.start) / TICKS_PER_MINUTE).toFixed(1)}
                  </td>
                  <td style={tdc}>{KIND_STYLE[s.kind].label}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
});

const thc: React.CSSProperties = {
  textAlign: 'left',
  padding: '4px 6px',
  borderBottom: '2px solid var(--line)',
  position: 'sticky',
  top: 0,
  background: 'var(--bg-panel)',
};
const tdc: React.CSSProperties = {
  padding: '3px 6px',
  borderBottom: '1px solid var(--line)',
  whiteSpace: 'nowrap',
};
