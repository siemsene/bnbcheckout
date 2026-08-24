// Live cutaway of the Airbnb, drawn over the painted backdrop. All
// state-driven props (clean sparkles, cars, luggage, garbage) are positioned
// from SimState; characters are chibi sprites tweened between room anchors.

import { CHARACTERS, CHAR_IDS, TASK_BY_ID } from '../../engine/content';
import { ACTIVITY_META, CHAR_META } from '../../content/charMeta';
import { useSimStore } from '../../state/simStore';
import type { CharId, RoomId, SimState } from '../../engine/types';

// Anchor points measured on house-cutaway.jpg (percent of image box).
const ROOM_ANCHORS: Record<RoomId, { x: number; y: number }> = {
  bedroom1: { x: 18.5, y: 52 },
  bedroom2: { x: 39, y: 52 },
  bedroom3: { x: 59, y: 52 },
  bathroom: { x: 81, y: 52 },
  living: { x: 24, y: 88 },
  hall: { x: 50, y: 88 },
  kitchen: { x: 77, y: 88 },
  outside: { x: 36, y: 97 },
};

// Overlay boxes for the "room is clean" sparkle badges.
const ROOM_BADGES: Record<string, { x: number; y: number }> = {
  'clean-bedroom-1': { x: 27, y: 30 },
  'clean-bedroom-2': { x: 47, y: 30 },
  'clean-bedroom-3': { x: 67, y: 30 },
  'clean-bathroom': { x: 90, y: 30 },
  'clean-living-room': { x: 34, y: 62 },
  'tidy-kitchen': { x: 87, y: 62 },
};

function charRoom(sim: SimState, charId: CharId): RoomId {
  const c = sim.chars[charId];
  if (c.activity === 'toilet') return 'bathroom';
  if (c.activity === 'walkback') return 'outside';
  if (c.taskId) return TASK_BY_ID[c.taskId].room;
  return 'hall';
}

export function HouseScene() {
  useSimStore((s) => s.version);
  const sim = useSimStore((s) => s.sim);
  const bubbles = useSimStore((s) => s.bubbles);
  const dispatch = useSimStore((s) => s.dispatch);
  if (!sim) return null;

  const done = (taskId: string) => sim.tasks[taskId].status === 'done';

  const roomCounts: Partial<Record<RoomId, number>> = {};
  const positions: Record<CharId, { x: number; y: number }> = {} as never;
  for (const c of CHAR_IDS) {
    const room = charRoom(sim, c);
    const idx = roomCounts[room] ?? 0;
    roomCounts[room] = idx + 1;
    const a = ROOM_ANCHORS[room];
    positions[c] = { x: a.x + idx * 5.2 - 7, y: a.y - (idx % 2) * 1.5 };
  }

  const toasts = bubbles.filter((b) => !b.charId);
  const carsLoaded = done('load-cars');

  return (
    <section className="panel scene-wrap" aria-label="House view">
      <img
        className="scene-bg"
        src="/assets/scene/house-cutaway.jpg"
        alt="Cutaway view of the Airbnb: three bedrooms and a bathroom upstairs; living room, hall and kitchen downstairs; driveway in front"
      />

      {/* clean-room badges — shape+text, not colour alone */}
      {Object.entries(ROOM_BADGES).map(
        ([taskId, pos]) =>
          done(taskId) && (
            <div
              key={taskId}
              className="room-badge"
              style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
              role="img"
              aria-label={`${TASK_BY_ID[taskId].name} finished`}
            >
              ✨ clean
            </div>
          ),
      )}

      {/* driveway props */}
      {done('fetch-car-a') && (
        <img className="scene-prop" src="/assets/scene/car-a.png" alt="Car A in the driveway"
          style={{ left: '58%', bottom: '0.5%', width: '13%' }} />
      )}
      {done('fetch-car-b') && (
        <img className="scene-prop" src="/assets/scene/car-b.png" alt="Car B in the driveway"
          style={{ left: '74%', bottom: '0.5%', width: '13%' }} />
      )}
      {carsLoaded && (
        <img className="scene-prop" src="/assets/scene/luggage-pile.png" alt="Luggage loaded by the cars"
          style={{ left: '68%', bottom: '6%', width: '6%' }} />
      )}
      {!carsLoaded &&
        (['pack-bag-1', 'pack-bag-2', 'pack-bag-3'] as const).filter(done).map((b, i) => (
          <img key={b} className="scene-prop" src="/assets/scene/luggage-pile.png"
            alt="Packed luggage waiting in the hall"
            style={{ left: `${44 + i * 4}%`, top: '80%', width: '4.5%' }} />
        ))}
      {done('garbage') && (
        <img className="scene-prop" src="/assets/scene/garbage.png" alt="Garbage out at the curb"
          style={{ left: '3%', bottom: '1%', width: '7%' }} />
      )}

      {/* characters */}
      {CHAR_IDS.map((c) => {
        const meta = CHAR_META[c];
        const state = sim.chars[c];
        const act = ACTIVITY_META[state.activity];
        const pos = positions[c];
        const moving = state.activity === 'walking' || state.activity === 'walkback';
        return (
          <button
            key={c}
            className={`scene-char ${state.activity}`}
            style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
            title={`${CHARACTERS[c].name} — ${act.label}`}
            aria-label={`${CHARACTERS[c].name} — ${act.label}`}
            onClick={() => {
              if (act.nudgeable) dispatch({ type: 'nudge', charId: c });
            }}
          >
            <img
              className="scene-char-img"
              src={moving ? meta.walk : meta.front}
              alt=""
              style={state.activity === 'walkback' ? { scale: '-1 1' } : undefined}
            />
            <span className="scene-char-label">{CHARACTERS[c].name}</span>
            {act.icon && (
              <span className="scene-char-status" role="img" aria-label={act.label}>
                {act.icon}
              </span>
            )}
          </button>
        );
      })}

      {/* speech bubbles */}
      {bubbles
        .filter((b) => b.charId)
        .map((b) => {
          const pos = positions[b.charId!];
          return (
            <div key={b.id} className="bubble" style={{ left: `${pos.x}%`, top: `${pos.y - 13}%` }}>
              {b.text}
            </div>
          );
        })}
      {toasts.length > 0 && (
        <div style={{ position: 'absolute', top: 6, left: 0, right: 0, textAlign: 'center' }}>
          {toasts.slice(-2).map((b) => (
            <div key={b.id} className="bubble toast" style={{ display: 'inline-block' }}>
              {b.text}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
