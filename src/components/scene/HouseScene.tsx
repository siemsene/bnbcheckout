// Live cutaway of the Airbnb. Rooms crossfade from the messy backdrop to its
// clean twin as cleaning work progresses; characters are chibi sprites with
// task-specific tools and animations; all props derive from SimState.

import { CHARACTERS, CHAR_IDS, PLAYER_CHAR, TASK_BY_ID } from '../../engine/content';
import { ACTIVITY_META, CHAR_HINTS, CHAR_META } from '../../content/charMeta';
import { ROOM_CLEAN_RECTS, SKILL_ANIM, TASK_TOOLS } from '../../content/taskMeta';
import { useSimStore } from '../../state/simStore';
import type { CharId, RoomId, SimState } from '../../engine/types';

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

function charRoom(sim: SimState, charId: CharId): RoomId {
  const c = sim.chars[charId];
  // Sora on a nudge trip stands with her target.
  if (charId === PLAYER_CHAR && sim.nudge) {
    return charRoom(sim, sim.nudge.target);
  }
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
  const progress = (taskId: string) =>
    Math.min(1, sim.tasks[taskId].workDone / sim.tasks[taskId].workRequired);

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

  return (
    <section className="panel scene-wrap" aria-label="House view">
      <img
        className="scene-bg"
        src="/assets/scene/house-cutaway.jpg"
        alt="Cutaway view of the Airbnb: three bedrooms and a bathroom upstairs; living room, hall and kitchen downstairs; driveway in front"
      />

      {/* rooms tidy up as their cleaning task progresses */}
      {Object.entries(ROOM_CLEAN_RECTS).map(([taskId, [x0, y0, x1, y1]]) => {
        const p = progress(taskId);
        if (p <= 0.02) return null;
        return (
          <img
            key={taskId}
            className="scene-clean"
            src="/assets/scene/house-clean.jpg"
            alt=""
            aria-hidden
            style={{
              clipPath: `inset(${y0}% ${100 - x1}% ${100 - y1}% ${x0}%)`,
              opacity: p,
            }}
          />
        );
      })}

      {/* ✨ badges once a room is fully done */}
      {Object.entries(ROOM_CLEAN_RECTS).map(
        ([taskId, [x0, y0, x1]]) =>
          done(taskId) && (
            <div
              key={`b-${taskId}`}
              className="room-badge"
              style={{ left: `${(x0 + x1) / 2}%`, top: `${y0 + 5}%` }}
              role="img"
              aria-label={`${TASK_BY_ID[taskId].name} finished`}
            >
              ✨ clean
            </div>
          ),
      )}

      {/* driveway props — car-specific luggage */}
      {done('fetch-car-a') && (
        <img className="scene-prop" src="/assets/scene/car-a.png" alt="Car A in the driveway"
          style={{ left: '55%', bottom: '0.5%', width: '13%' }} />
      )}
      {done('fetch-car-b') && (
        <img className="scene-prop" src="/assets/scene/car-b.png" alt="Car B in the driveway"
          style={{ left: '74%', bottom: '0.5%', width: '13%' }} />
      )}
      {done('load-car-a') && (
        <img className="scene-prop" src="/assets/scene/luggage-pile.png" alt="Luggage loaded on car A"
          style={{ left: '58%', bottom: '7%', width: '5.5%' }} />
      )}
      {done('load-car-b') && (
        <img className="scene-prop" src="/assets/scene/luggage-pile.png" alt="Luggage loaded on car B"
          style={{ left: '77%', bottom: '7%', width: '5.5%' }} />
      )}
      {(['pack-bag-1', 'pack-bag-2'] as const).filter((b) => done(b) && !done('load-car-a')).map((b, i) => (
        <img key={b} className="scene-prop" src="/assets/scene/luggage-pile.png"
          alt="Packed luggage waiting in the hall"
          style={{ left: `${43 + i * 4}%`, top: '80%', width: '4.5%' }} />
      ))}
      {done('pack-bag-3') && !done('load-car-b') && (
        <img className="scene-prop" src="/assets/scene/luggage-pile.png"
          alt="Packed luggage waiting in the hall"
          style={{ left: '51%', top: '80%', width: '4.5%' }} />
      )}
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
        const moving =
          state.activity === 'walking' ||
          state.activity === 'walkback' ||
          (c === PLAYER_CHAR && sim.nudge != null);
        const working = state.activity === 'working' && state.unavailableUntil <= sim.tick;
        const tool = working && state.taskId ? TASK_TOOLS[state.taskId] : null;
        const animClass =
          working && state.taskId ? SKILL_ANIM[TASK_BY_ID[state.taskId].skill] : '';
        const hints = CHAR_HINTS[c];
        const tip = `${CHARACTERS[c].name} — ${act.label}\n＋ ${hints.strengths.join('\n＋ ')}\n− ${hints.watchouts.join('\n− ')}`;
        return (
          <button
            key={c}
            className={`scene-char ${state.activity} ${animClass}${act.nudgeable ? ' needs-nudge' : ''}`}
            style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
            title={tip}
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
            {tool && (
              <span className="scene-char-tool" aria-hidden>
                {tool}
              </span>
            )}
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
