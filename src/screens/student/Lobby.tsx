// Pre-game: meet the team (public traits only) and start planning.

import { CHARACTERS, CHAR_IDS } from '../../engine/content';
import { CHAR_META } from '../../content/charMeta';
import { useSimStore } from '../../state/simStore';

export function Lobby({
  canBegin = true,
  waitingMessage,
}: {
  /** Practice starts planning on demand; a class waits for the instructor. */
  canBegin?: boolean;
  waitingMessage?: string;
}) {
  const beginPlanning = useSimStore((s) => s.beginPlanning);

  return (
    <div className="overlay">
      <div className="overlay-card">
        <h1>Checkout Rush</h1>
        <p style={{ color: 'var(--ink-soft)' }}>
          It’s 8:00 AM. Checkout is at 10:00 AM sharp. Five friends, one Airbnb,
          eighteen things to do. You are <strong>Sora</strong> — get your team
          working <em>in parallel</em> or you’ll never make it.
        </p>
        <div className="char-cards">
          {CHAR_IDS.map((c) => (
            <div key={c} className="panel char-card" style={{ ['--chip-color' as string]: CHAR_META[c].color }}>
              <div className="portrait">
                <img src={CHAR_META[c].ref} alt={`${CHARACTERS[c].name} character portrait`} />
              </div>
              <strong>{CHARACTERS[c].name}</strong>
              <p>{CHARACTERS[c].intro}</p>
            </div>
          ))}
        </div>
        <p style={{ fontSize: '0.85rem', color: 'var(--ink-soft)' }}>
          Drag friends onto tasks. Watch for locked tasks, hidden talents, and…
          distractions. Click a distracted friend to nudge them (it costs you a
          moment of your own work).
        </p>
        {canBegin ? (
          <button className="btn-big" onClick={beginPlanning}>
            Plan the morning →
          </button>
        ) : (
          <p className="panel" style={{ padding: '12px 16px', margin: 0 }} role="status">
            {waitingMessage ?? 'Waiting for your instructor to open planning…'}
          </p>
        )}
      </div>
    </div>
  );
}
