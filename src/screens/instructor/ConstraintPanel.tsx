// Instructor-only debrief view: the full hidden-constraint matrix.
// Students never see this route; it drives the post-game discussion.

import { TASKS } from '../../engine/content';

const CHARACTER_NOTES: { name: string; skills: string; quirks: string }[] = [
  {
    name: 'Sora (the player)',
    skills: 'All-rounder, 1.0× everything. No license.',
    quirks: 'Nudging someone pauses Sora’s own work ~30 sim-sec.',
  },
  {
    name: 'Kenji',
    skills: 'License, fast driver (1.3×). Terrible cook (0.5×).',
    quirks: 'Boss calls every ~10–14 sim-min for 3–5 min; a nudge ends the call.',
  },
  {
    name: 'Mei',
    skills: 'Great cook (1.8×), knows snacks (1.4× shopping). No license.',
    quirks: 'Gets distracted every ~8–12 min; drifts until nudged (or ~5 min).',
  },
  {
    name: 'Taro',
    skills: 'Strong (1.6× heavy tasks). No license.',
    quirks:
      'Works best alone (0.7× when sharing). 2–3 toilet emergencies per game — each re-dirties the bathroom (50% rework). Cannot be nudged out of one.',
  },
  {
    name: 'Hana',
    skills: 'License (1.0× driving), meticulous cleaner (1.5×).',
    quirks:
      'Social: 1.25× with company, 0.8× alone. Her cleaning finds forgotten items 65% of the time (others 25%) → luggage repack rework.',
  },
];

export function ConstraintPanel() {
  return (
    <details className="panel" style={{ padding: 16 }}>
      <summary style={{ cursor: 'pointer', fontWeight: 700, fontSize: '1.05rem' }}>
        Hidden constraints (instructor only — great for the debrief)
      </summary>

      <h3 style={{ margin: '14px 0 6px' }}>Characters</h3>
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={th}>Friend</th>
            <th style={th}>Skills</th>
            <th style={th}>Quirks</th>
          </tr>
        </thead>
        <tbody>
          {CHARACTER_NOTES.map((c) => (
            <tr key={c.name}>
              <td style={td}>
                <strong>{c.name}</strong>
              </td>
              <td style={td}>{c.skills}</td>
              <td style={td}>{c.quirks}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3 style={{ margin: '14px 0 6px' }}>Tasks</h3>
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={th}>Task</th>
            <th style={th}>Base</th>
            <th style={th}>Needs first</th>
            <th style={th}>Workers</th>
            <th style={th}>Rules</th>
          </tr>
        </thead>
        <tbody>
          {TASKS.map((t) => (
            <tr key={t.id}>
              <td style={td}>{t.name}</td>
              <td style={td}>{t.baseMinutes}′ ±</td>
              <td style={td}>
                {[...(t.preds ?? [])].join(', ') || '—'}
                {t.predsAny ? ` + any of (${t.predsAny.join(', ')})` : ''}
              </td>
              <td style={td}>
                {t.minWorkers === 5 ? 'all 5' : `≤${t.maxWorkers}`}
              </td>
              <td style={td}>
                {[
                  t.requiresLicense && 'license required',
                  t.travel && 'travel: no learning curve, abandon = walk back & lose progress',
                  t.owners &&
                    `owner ${t.ownerMult}× (${t.owners.join(', ')})${t.nonOwnerMult ? `, others ${t.nonOwnerMult}×` : ''}`,
                  t.equipment === 'vacuum' && 'needs the ONE vacuum (concurrent cleans run 0.55×)',
                  t.id === 'buy-snacks' && '0.6× until the living room is cleaned (shopping list)',
                  t.skill !== 'general' && `skill: ${t.skill}`,
                ]
                  .filter(Boolean)
                  .join('; ') || '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', marginTop: 10 }}>
        Global rules: durations vary ±~15% per run · learning curve 50→100% over 4
        sim-min on non-travel tasks · multi-worker efficiency 1 / 1.7 / 2.1 ·
        skipping breakfast makes everyone 0.8× after minute 60 · nudging = Sora
        walks over (~40s), chats (~20s), walks back — she produces nothing en
        route · un-nudged interruptions (calls, distractions, doorbell) end on
        their own after at most 5 min — nudging just recovers the time sooner ·
        the final walkthrough sometimes finds one last forgotten item (40%).
      </p>
      <p style={{ fontSize: '0.85rem', color: 'var(--ink-soft)' }}>
        Random events per run: Kenji’s boss calls (~6×) · Mei drifts off (~8×) ·
        Taro’s emergencies (2–3×, re-dirty the bathroom) · doorbell neighbor
        traps someone 3–4 min (1–2×) · a cat un-cleans a finished living room
        (1×) · a cooking spill adds 3 min of dishes (1×) · the road-trip playlist
        gives everyone +10% for 6 min (1×) · cleaning can uncover forgotten items
        (Hana 65%, others 25%) that force repacking.
      </p>
    </details>
  );
}

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '0.82rem',
};
const th: React.CSSProperties = {
  textAlign: 'left',
  padding: 6,
  borderBottom: '2px solid var(--line)',
};
const td: React.CSSProperties = {
  padding: 6,
  borderBottom: '1px solid var(--line)',
  verticalAlign: 'top',
};
