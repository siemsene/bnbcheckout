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

/** Loading a car is a shuttle: bags come out of the house one armful at a time.
 * Each leg is a position swap that the .scene-char CSS transition walks out. */
const LOAD_SHUTTLE: Record<
  string,
  { house: { x: number; y: number }; car: { x: number; y: number } }
> = {
  'load-car-a': { house: { x: 45, y: 93.5 }, car: { x: 60, y: 97 } },
  'load-car-b': { house: { x: 48, y: 93.5 }, car: { x: 79, y: 97 } },
};
/** Sim-seconds per leg. Slightly longer than the 1.2s CSS transition at 1x, so
 * each trip reads as walk-then-load rather than a continuous glide. */
const SHUTTLE_LEG_TICKS = 12;

/**
 * Where each transient event shows up, and how. These events used to exist only
 * as a line in the ticker, so the thing that had just happened to the run was
 * invisible in the house it happened in.
 */
const FX_SPEC: Record<
  string,
  { src?: string; glyph?: string; alt: string; left: number; top: number; width: number }
> = {
  // Placed off to the side of each room's character anchor, on the floor line,
  // so a prop never lands on top of the friends standing there.
  cat: {
    src: '/assets/scene/cat.png',
    alt: 'A cat has wandered into the living room',
    left: 13,
    top: 87,
    width: 9,
  },
  neighbor: {
    src: '/assets/scene/neighbor.png',
    alt: 'The neighbour is at the front door',
    left: 40,
    top: 96,
    width: 8.5,
  },
  'shopping-list': {
    src: '/assets/scene/shopping-list.png',
    alt: 'The missing shopping list turned up under the sofa',
    left: 32,
    top: 86,
    width: 5.5,
  },
  // No painted prop for these two; a glyph in the right room still tells the
  // player where to look, which is the part that was missing.
  spill: { glyph: '💦', alt: 'Something spilled in the kitchen', left: 70, top: 87, width: 4 },
  music: { glyph: '🎶', alt: 'Music is on — everyone works a little faster', left: 60, top: 72, width: 4 },
};

const reducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function loadShuttle(sim: SimState, charId: CharId) {
  const c = sim.chars[charId];
  if (!c.taskId || c.activity !== 'working') return null;
  if (c.unavailableUntil > sim.tick) return null;
  const spec = LOAD_SHUTTLE[c.taskId];
  if (!spec) return null;

  // Reduced motion: stand at the car rather than teleporting back and forth.
  const k = Math.max(0, sim.tasks[c.taskId].assignees.indexOf(charId));
  if (reducedMotion()) return { ...spec.car, x: spec.car.x + k * 4, atCar: true };

  // One full leg of phase per worker — the out-and-back cycle is two legs, so
  // a pair is always on opposite legs: they pass each other mid-driveway
  // instead of bunching up at the same end.
  const phase = k * SHUTTLE_LEG_TICKS;
  const atCar = Math.floor((sim.tick + phase) / SHUTTLE_LEG_TICKS) % 2 === 0;
  const end = atCar ? spec.car : spec.house;
  return { x: end.x + k * 4, y: end.y, atCar };
}

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
  const sceneFx = useSimStore((s) => s.sceneFx);
  const dispatch = useSimStore((s) => s.dispatch);
  if (!sim) return null;

  const done = (taskId: string) => sim.tasks[taskId].status === 'done';
  const progress = (taskId: string) =>
    Math.min(1, sim.tasks[taskId].workDone / sim.tasks[taskId].workRequired);

  // Group first, place second. The old single pass grew a room's occupants
  // rightwards from a fixed `anchor - 7` offset, so one friend alone in a room
  // stood off against its left wall and never in it. Centring needs the count,
  // which is only known once everyone has been sorted into rooms.
  const occupants: Partial<Record<RoomId, CharId[]>> = {};
  const positions: Record<CharId, { x: number; y: number }> = {} as never;
  const shuttling: Partial<Record<CharId, boolean>> = {};
  const facingHouse: Partial<Record<CharId, boolean>> = {};
  for (const c of CHAR_IDS) {
    const trip = loadShuttle(sim, c);
    if (trip) {
      positions[c] = { x: trip.x, y: trip.y };
      shuttling[c] = true;
      facingHouse[c] = !trip.atCar; // heading back for the next armful
      continue;
    }
    const room = charRoom(sim, c);
    (occupants[room] ??= []).push(c);
  }
  for (const [room, list] of Object.entries(occupants) as [RoomId, CharId[]][]) {
    const a = ROOM_ANCHORS[room];
    // Tighter as the room fills, so five friends still read as "all in here"
    // rather than spilling through the wall into the room next door.
    const gap = list.length <= 2 ? 6.4 : list.length === 3 ? 5.4 : 4.6;
    list.forEach((c, i) => {
      positions[c] = {
        x: a.x + (i - (list.length - 1) / 2) * gap,
        y: a.y - (i % 2) * 1.6, // slight zigzag keeps overlapping sprites readable
      };
    });
  }

  const toasts = bubbles.filter((b) => !b.charId);

  /**
   * Vertical step between stacked bubbles, in % of scene height — sized for a
   * two-line bubble, which is the common case. A smaller step looked separated
   * in the collision test while still overlapping on screen.
   */
  const BUBBLE_ROW = 13;
  const stacked: { x: number; y: number }[] = [];
  const laidOutBubbles = bubbles
    .filter((b) => b.charId && positions[b.charId])
    // The scene is only so tall: past three at once, stacking runs off the
    // roof. The ticker keeps the full record, so nothing is lost by showing
    // only the newest few.
    .slice(-3)
    .map((b) => {
      const p = positions[b.charId!];
      const x = Math.min(87, Math.max(13, p.x));
      let y = p.y - 13;
      let guard = 0;
      while (
        guard++ < 6 &&
        stacked.some((q) => Math.abs(q.x - x) < 27 && Math.abs(q.y - y) < BUBBLE_ROW)
      ) {
        y -= BUBBLE_ROW;
      }
      y = Math.max(4, y);
      stacked.push({ x, y });
      return { ...b, x, y };
    });

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

      {/* transient event props — cat, neighbour, the found shopping list */}
      {sceneFx.map((fx) => {
        const spec = FX_SPEC[fx.kind];
        if (!spec) return null;
        return spec.src ? (
          <img
            key={fx.id}
            className="scene-fx"
            src={spec.src}
            alt={spec.alt}
            style={{ left: `${spec.left}%`, top: `${spec.top}%`, width: `${spec.width}%` }}
          />
        ) : (
          <span
            key={fx.id}
            className="scene-fx scene-fx-glyph"
            role="img"
            aria-label={spec.alt}
            style={{ left: `${spec.left}%`, top: `${spec.top}%` }}
          >
            {spec.glyph}
          </span>
        );
      })}

      {/* characters */}
      {CHAR_IDS.map((c) => {
        const meta = CHAR_META[c];
        const state = sim.chars[c];
        const act = ACTIVITY_META[state.activity];
        const pos = positions[c];
        const shuttle = shuttling[c] === true;
        const moving =
          shuttle ||
          state.activity === 'walking' ||
          state.activity === 'walkback' ||
          (c === PLAYER_CHAR && sim.nudge != null);
        const working = state.activity === 'working' && state.unavailableUntil <= sim.tick;
        const tool = working && state.taskId ? TASK_TOOLS[state.taskId] : null;
        // Car loaders waddle between house and car instead of playing the
        // stationary lifting animation.
        const animClass =
          !shuttle && working && state.taskId
            ? SKILL_ANIM[TASK_BY_ID[state.taskId].skill]
            : '';
        const hints = CHAR_HINTS[c];
        const tip = `${CHARACTERS[c].name} — ${act.label}\n＋ ${hints.strengths.join('\n＋ ')}\n− ${hints.watchouts.join('\n− ')}`;
        return (
          <button
            key={c}
            className={`scene-char ${shuttle ? 'walking' : state.activity} ${animClass}${
              act.nudgeable ? ' needs-nudge' : ''
            }`}
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
              style={
                state.activity === 'walkback' || facingHouse[c]
                  ? { scale: '-1 1' }
                  : undefined
              }
            />
            <span className="scene-char-label">{CHARACTERS[c].name}</span>
            {/* Activity symbols sit in one centred row ABOVE the head. They
                used to be pinned to the top-left and top-right corners, which
                put them over whoever was standing alongside. */}
            {(tool || act.icon) && (
              <span className="scene-char-icons">
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
              </span>
            )}
          </button>
        );
      })}

      {/* Speech bubbles. Each is anchored to its speaker, then walked upwards
          until it clears the ones already placed — two friends working the same
          room used to print their lines directly on top of each other. Also
          clamped horizontally so a bubble at the edge is not cut off. */}
      {laidOutBubbles.map((b) => (
        <div key={b.id} className="bubble" style={{ left: `${b.x}%`, top: `${b.y}%` }}>
          {b.text}
        </div>
      ))}
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
