// Where the plan and the morning parted company.
//
// Sorted by how late each task ran, because the biggest slip is the thing worth
// talking about in a debrief — not the alphabet, and not the order the tasks
// happen to be declared in.

import { useState } from 'react';
import { TASK_BY_ID, TICKS_PER_MINUTE } from '../../engine/content';
import { computeVariance, varianceSummary } from '../../engine/variance';
import type { LoggedAction, PlannedProjection, TimelineSegment } from '../../engine/types';

const clockAt = (min: number) =>
  `${Math.floor(8 + min / 60)}:${String(Math.floor(min) % 60).padStart(2, '0')}`;

export function VarianceTable({
  planned,
  timeline,
  actionLog,
  plannedFinish,
  actualFinish,
}: {
  planned: PlannedProjection | undefined;
  timeline: TimelineSegment[];
  actionLog: LoggedAction[];
  plannedFinish: number | null;
  actualFinish: number | null;
}) {
  const [all, setAll] = useState(false);
  if (!planned) return null;

  const rows = computeVariance(planned, timeline, actionLog);
  const s = varianceSummary(rows, actionLog);

  const drifted = rows
    .filter((r) => r.deltaEnd != null)
    .sort((a, b) => (b.deltaEnd ?? 0) - (a.deltaEnd ?? 0));
  const shown = all ? drifted : drifted.slice(0, 6);

  const finishGap =
    plannedFinish != null && actualFinish != null ? actualFinish - plannedFinish : null;

  return (
    <div style={{ textAlign: 'left' }}>
      <p style={{ margin: '0 0 10px' }}>
        {finishGap == null ? (
          plannedFinish != null && actualFinish == null ? (
            <>
              Your plan finished the morning at <strong>{clockAt(plannedFinish)}</strong>.
              The real one did not finish at all — that gap is the whole lesson.
            </>
          ) : (
            <>The plan and the run cannot be lined up on a finish time.</>
          )
        ) : (
          <>
            Your plan said <strong>{clockAt(plannedFinish!)}</strong>; the morning
            actually ended at <strong>{clockAt(actualFinish!)}</strong> —{' '}
            <strong>
              {finishGap > 0
                ? `${Math.round(finishGap)} minutes optimistic`
                : finishGap < 0
                  ? `${Math.round(-finishGap)} minutes better than planned`
                  : 'exactly as planned'}
            </strong>
            .
          </>
        )}{' '}
        You stepped in <strong>{s.overrideCount}</strong>{' '}
        {s.overrideCount === 1 ? 'time' : 'times'}
        {s.neverHappened > 0 && (
          <>
            , and <strong>{s.neverHappened}</strong> planned{' '}
            {s.neverHappened === 1 ? 'job' : 'jobs'} never got done
          </>
        )}
        .
      </p>

      <table style={{ width: '100%', fontSize: '0.82rem', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ textAlign: 'left', color: 'var(--ink-soft)' }}>
            <th style={th}>Job</th>
            <th style={th}>Plan said</th>
            <th style={th}>Actually</th>
            <th style={th}>Drift</th>
            <th style={th}></th>
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r.taskId} style={{ borderTop: '1px solid var(--line)' }}>
              <td style={td}>{TASK_BY_ID[r.taskId].name}</td>
              <td style={td}>{r.plannedEnd == null ? '—' : clockAt(r.plannedEnd)}</td>
              <td style={td}>{r.actualEnd == null ? 'never' : clockAt(r.actualEnd)}</td>
              <td style={{ ...td, fontWeight: 700, color: driftColour(r.deltaEnd) }}>
                {r.deltaEnd == null
                  ? '—'
                  : r.deltaEnd > 0
                    ? `+${Math.round(r.deltaEnd)}′`
                    : `${Math.round(r.deltaEnd)}′`}
              </td>
              <td style={{ ...td, color: 'var(--ink-soft)' }}>
                {r.overridden ? 'you stepped in' : ''}
              </td>
            </tr>
          ))}
          {rows
            .filter((r) => r.plannedEnd != null && r.actualEnd == null)
            .map((r) => (
              <tr key={r.taskId} style={{ borderTop: '1px solid var(--line)' }}>
                <td style={td}>{TASK_BY_ID[r.taskId].name}</td>
                <td style={td}>{clockAt(r.plannedEnd!)}</td>
                <td style={{ ...td, color: 'var(--danger)', fontWeight: 700 }}>never</td>
                <td style={td}>—</td>
                <td style={{ ...td, color: 'var(--ink-soft)' }}>
                  {r.overridden ? 'you stepped in' : ''}
                </td>
              </tr>
            ))}
        </tbody>
      </table>

      {drifted.length > 6 && (
        <button
          className="btn-ghost"
          style={{ marginTop: 8, fontSize: '0.8rem' }}
          onClick={() => setAll(!all)}
        >
          {all ? 'Show the biggest slips only' : `Show all ${drifted.length} jobs`}
        </button>
      )}
    </div>
  );
}

function driftColour(d: number | null) {
  if (d == null) return 'var(--ink-soft)';
  if (d > 5) return '#a2481f';
  if (d < -0.5) return '#22633a';
  return 'var(--ink)';
}

const th: React.CSSProperties = {
  padding: '4px 8px 4px 0',
  borderBottom: '2px solid var(--line)',
};
const td: React.CSSProperties = { padding: '4px 8px 4px 0', whiteSpace: 'nowrap' };

/** Sim-ticks to sim-minutes, for callers holding raw engine values. */
export const toMinutes = (ticks: number) => ticks / TICKS_PER_MINUTE;
