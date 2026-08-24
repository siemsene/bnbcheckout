// Live leaderboard table, shared by student overlay and instructor monitor.
// The utilization-vs-time class scatter is added in the polish phase.

import { useEffect, useState } from 'react';
import { subscribePlayers, type PlayerDoc } from '../../firebase/data';

export function LeaderboardPanel({
  sessionId,
  highlightPlayerId,
  revealScatter,
}: {
  sessionId: string;
  highlightPlayerId?: string;
  revealScatter?: boolean;
}) {
  const [players, setPlayers] = useState<PlayerDoc[]>([]);

  useEffect(() => subscribePlayers(sessionId, setPlayers), [sessionId]);

  const ranked = [...players].sort((a, b) => b.score - a.score);
  const winnersCut = ranked.filter((p) => p.finished).slice(0, 3).map((p) => p.id);

  return (
    <div style={{ textAlign: 'left' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid var(--line)', textAlign: 'left' }}>
            <th style={{ padding: 6 }}>#</th>
            <th style={{ padding: 6 }}>Player</th>
            <th style={{ padding: 6 }}>Status</th>
            <th style={{ padding: 6 }}>Done</th>
            <th style={{ padding: 6 }}>Finish</th>
            <th style={{ padding: 6 }}>Utilization</th>
          </tr>
        </thead>
        <tbody>
          {ranked.map((p, i) => (
            <tr
              key={p.id}
              style={{
                borderBottom: '1px solid var(--line)',
                background:
                  p.id === highlightPlayerId ? 'rgba(217,182,74,0.18)' : undefined,
                fontWeight: winnersCut.includes(p.id) && revealScatter ? 700 : undefined,
              }}
            >
              <td style={{ padding: 6 }}>
                {revealScatter && winnersCut.includes(p.id) ? `🏆 ${i + 1}` : i + 1}
              </td>
              <td style={{ padding: 6 }}>
                {p.name}
                {p.id === highlightPlayerId ? ' (you)' : ''}
              </td>
              <td style={{ padding: 6 }}>{phaseLabel(p)}</td>
              <td style={{ padding: 6 }}>{Math.round(p.pctComplete * 100)}%</td>
              <td style={{ padding: 6 }}>
                {p.finished && p.finishSimMinute != null
                  ? `${Math.round(p.finishSimMinute)}′`
                  : '—'}
              </td>
              <td style={{ padding: 6 }}>{Math.round(p.utilizationAvg * 100)}%</td>
            </tr>
          ))}
          {ranked.length === 0 && (
            <tr>
              <td colSpan={6} style={{ padding: 12, color: 'var(--ink-soft)' }}>
                No players yet — codes are on the board!
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function phaseLabel(p: PlayerDoc): string {
  if (p.finished) return '🎉 finished';
  switch (p.phase) {
    case 'lobby':
      return 'in lobby';
    case 'planning':
      return 'planning';
    case 'running':
      return `playing (${p.simMinute}′)`;
    default:
      return p.phase;
  }
}
