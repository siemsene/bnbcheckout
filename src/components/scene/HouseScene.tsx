// Live cutaway of the Airbnb. Placeholder floorplan is procedural SVG; the
// painted Ghibli backdrop replaces the room fills in the asset phase. All
// state-driven props (mess, cars, luggage) are drawn from SimState, and
// characters are positioned by percentage anchors with CSS transitions.

import { CHARACTERS, CHAR_IDS, TASK_BY_ID } from '../../engine/content';
import { ACTIVITY_META, CHAR_META } from '../../content/charMeta';
import { useSimStore } from '../../state/simStore';
import type { CharId, RoomId, SimState } from '../../engine/types';

const ROOM_ANCHORS: Record<RoomId, { x: number; y: number; label: string }> = {
  bedroom1: { x: 13, y: 26, label: 'Bedroom 1' },
  bedroom2: { x: 37, y: 26, label: 'Bedroom 2' },
  bedroom3: { x: 61, y: 26, label: 'Bedroom 3' },
  bathroom: { x: 86, y: 26, label: 'Bathroom' },
  living: { x: 22, y: 62, label: 'Living room' },
  hall: { x: 50, y: 62, label: 'Hall' },
  kitchen: { x: 79, y: 62, label: 'Kitchen' },
  outside: { x: 50, y: 90, label: 'Outside' },
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

  // Slot characters side by side within a room.
  const roomCounts: Partial<Record<RoomId, number>> = {};
  const positions: Record<CharId, { x: number; y: number }> = {} as never;
  for (const c of CHAR_IDS) {
    const room = charRoom(sim, c);
    const idx = roomCounts[room] ?? 0;
    roomCounts[room] = idx + 1;
    const a = ROOM_ANCHORS[room];
    positions[c] = { x: a.x + idx * 5.5 - 5, y: a.y };
  }

  const toasts = bubbles.filter((b) => !b.charId);

  return (
    <section className="panel scene-wrap" aria-label="House view">
      <FloorplanSvg sim={sim} />
      {CHAR_IDS.map((c) => {
        const meta = CHAR_META[c];
        const act = ACTIVITY_META[sim.chars[c].activity];
        const pos = positions[c];
        return (
          <button
            key={c}
            className={`scene-char ${sim.chars[c].activity}`}
            style={{
              left: `${pos.x}%`,
              top: `${pos.y}%`,
              ['--chip-color' as string]: meta.color,
            }}
            title={`${CHARACTERS[c].name} — ${act.label}`}
            aria-label={`${CHARACTERS[c].name} — ${act.label}`}
            onClick={() => {
              if (act.nudgeable) dispatch({ type: 'nudge', charId: c });
            }}
          >
            <span className="scene-char-body" aria-hidden>
              {meta.short}
            </span>
            <span className="scene-char-label" aria-hidden>
              {CHARACTERS[c].name}
            </span>
            {act.icon && (
              <span className="scene-char-status" role="img" aria-label={act.label}>
                {act.icon}
              </span>
            )}
          </button>
        );
      })}
      {bubbles
        .filter((b) => b.charId)
        .map((b) => {
          const pos = positions[b.charId!];
          return (
            <div
              key={b.id}
              className="bubble"
              style={{ left: `${pos.x}%`, top: `${pos.y - 14}%` }}
            >
              {b.text}
            </div>
          );
        })}
      {toasts.length > 0 && (
        <div style={{ position: 'absolute', top: 6, left: 0, right: 0, textAlign: 'center' }}>
          {toasts.map((b) => (
            <div key={b.id} className="bubble toast" style={{ display: 'inline-block' }}>
              {b.text}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------

function FloorplanSvg({ sim }: { sim: SimState }) {
  const clean = (taskId: string) => sim.tasks[taskId].status === 'done';
  const carA = clean('fetch-car-a');
  const carB = clean('fetch-car-b');

  const room = (x: number, y: number, w: number, h: number, label: string, dirty?: boolean) => (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={2.5}
        fill={dirty ? '#efe3cd' : '#f7f2e6'}
        stroke="#c9bda2"
        strokeWidth={0.5}
      />
      <text x={x + 2} y={y + 4.5} fontSize={3} fill="#8a8272">
        {label}
      </text>
      {dirty && (
        <text x={x + w - 8} y={y + 5} fontSize={4} aria-hidden>
          🧺
        </text>
      )}
    </g>
  );

  return (
    <svg className="scene-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
      {/* sky + house shell */}
      <rect x={0} y={0} width={100} height={100} fill="#e8f0e4" />
      <rect x={2} y={8} width={96} height={70} rx={3} fill="#fbf6ea" stroke="#a8987a" strokeWidth={0.8} />
      <path d="M 0 10 L 50 0 L 100 10" fill="none" stroke="#a8987a" strokeWidth={1.2} />

      {room(4, 12, 20, 28, 'Bedroom 1', !clean('clean-bedroom-1'))}
      {room(28, 12, 20, 28, 'Bedroom 2', !clean('clean-bedroom-2'))}
      {room(52, 12, 20, 28, 'Bedroom 3', !clean('clean-bedroom-3'))}
      {room(76, 12, 20, 28, 'Bathroom', !clean('clean-bathroom'))}
      {room(4, 44, 32, 32, 'Living room', !clean('clean-living-room'))}
      {room(40, 44, 24, 32, 'Hall')}
      {room(68, 44, 28, 32, 'Kitchen', !clean('tidy-kitchen'))}

      {/* driveway */}
      <rect x={0} y={80} width={100} height={20} fill="#d8d3c2" />
      <text x={2} y={85} fontSize={3} fill="#8a8272">
        Driveway — garage & store are a walk away →
      </text>
      {carA && <Car x={58} y={86} label="A" />}
      {carB && <Car x={76} y={86} label="B" />}
      {clean('load-cars') && (
        <text x={70} y={97} fontSize={3.5} fill="#4a7c59" fontWeight={700}>
          Luggage loaded ✓
        </text>
      )}

      {/* packed bags waiting in the hall */}
      {(['pack-bag-1', 'pack-bag-2', 'pack-bag-3'] as const).map(
        (b, i) =>
          clean(b) &&
          !clean('load-cars') && (
            <rect
              key={b}
              x={44 + i * 5}
              y={70}
              width={4}
              height={5}
              rx={0.8}
              fill="#a9814f"
              stroke="#7c5c33"
              strokeWidth={0.4}
            />
          ),
      )}
    </svg>
  );
}

function Car({ x, y, label }: { x: number; y: number; label: string }) {
  return (
    <g>
      <rect x={x} y={y} width={14} height={6} rx={2} fill="#7f9db9" stroke="#4c657c" strokeWidth={0.5} />
      <rect x={x + 3} y={y - 3} width={8} height={4} rx={1.5} fill="#9db8d1" stroke="#4c657c" strokeWidth={0.5} />
      <circle cx={x + 3.5} cy={y + 6} r={1.6} fill="#3a3a3a" />
      <circle cx={x + 10.5} cy={y + 6} r={1.6} fill="#3a3a3a" />
      <text x={x + 6} y={y + 4.5} fontSize={3.5} fontWeight={700} fill="#243a4c">
        {label}
      </text>
    </g>
  );
}
