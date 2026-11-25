// The planning board as a resource Gantt you can drag jobs around in.
//
// The old board was five ordered lists built by pick-a-job-then-pick-a-person,
// with a read-only Gantt underneath showing the consequence. Students had to
// hold the schedule in their heads and read the result somewhere else. Here the
// schedule IS the input: one row per friend, jobs as blocks on a 8:00–10:00
// axis, dragged between rows and along time.
//
// One honesty constraint shapes the whole interaction. The engine takes an
// ORDER per friend, not a set of start times — the constraints decide when each
// job can actually begin. So a block cannot be parked at an arbitrary minute:
// dropping it sets its place in that friend's order, the projection re-runs,
// and the block snaps to when the job can really start. The gap that opens up
// when a job is waiting on something else is the lesson, not a glitch, so it is
// labelled rather than hidden.

import { useEffect, useMemo, useState } from 'react';
import {
  DndContext,
  pointerWithin,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { CHARACTERS, CHAR_IDS, TASKS, TASK_BY_ID, TICKS_PER_MINUTE } from '../../engine/content';
import { eligible } from '../../engine/dispatch';
import {
  MANUAL_SLACK_MIN,
  deriveSlack,
  pruneSlack,
  sameSlack,
} from '../../engine/slack';
import { CHAR_META } from '../../content/charMeta';
import { CharHintCard, useHoverCard } from '../board/CharHintCard';
import { TaskIcon } from '../board/TaskIcon';
import type {
  CharId,
  Plan,
  PlannedProjection,
  SlackWindow,
  TaskDef,
} from '../../engine/types';

const TOTAL_MIN = 120;

/**
 * The pick that is not a job. Held in the same `picked` slot as a task id so
 * the place-it-next idiom is identical: click it, then click the job you want
 * breathing room after. Task ids are kebab-case words, so the underscores keep
 * it from ever matching one. (It used to be a literal NUL character, which
 * worked but made git treat this whole file as binary.)
 */
const SLACK_PICK = '__slack__';

function clockAt(min: number): string {
  const h = Math.floor(8 + min / 60);
  const m = Math.floor(min) % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

/** Who is signed up, and how far that is from what the job wants. */
function crewLine(def: TaskDef, n: number): string {
  const need = def.minWorkers ?? 1;
  if (need > 1) {
    return n === 0 ? `all ${need} together` : `${n} of ${need} — needs all ${need}`;
  }
  if (def.maxWorkers === 1) return 'one person';
  if (n === 0) return `up to ${def.maxWorkers}`;
  const room = def.maxWorkers - n;
  return `${n} of ${def.maxWorkers} — room for ${room === 1 ? 'one' : room} more`;
}

/** "Strip beds", "A and B", "A, B and C" — a list people read as a sentence. */
function listOf(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * What has to happen before this job can start, in names rather than a lock
 * icon: which jobs are constrained is the thing a planner has to see, and
 * *what* they wait on is the part they can act on.
 */
function waitsFor(def: TaskDef): string | null {
  const preds = def.preds ?? [];
  const anyOf = def.predsAny ?? [];
  if (preds.length === 0 && anyOf.length === 0) return null;
  // The final walkthrough waits on everything; naming eighteen jobs helps
  // nobody and would swamp the chip.
  if (preds.length > 3) return `after all ${preds.length} other jobs`;
  const parts: string[] = [];
  if (preds.length > 0) {
    parts.push(`after ${listOf(preds.map((p) => TASK_BY_ID[p]?.name ?? p))}`);
  }
  if (anyOf.length > 0) {
    parts.push(`after any of ${listOf(anyOf.map((p) => TASK_BY_ID[p]?.name ?? p))}`);
  }
  return parts.join(' · ');
}

/** The other friends signed up for a job, as coloured initials. */
function CrewDots({ chars }: { chars: CharId[] }) {
  if (chars.length === 0) return null;
  return (
    <span className="pg-mates" aria-hidden>
      {chars.map((m) => (
        <i key={m} style={{ ['--chip-color' as string]: CHAR_META[m].color }}>
          {CHAR_META[m].short}
        </i>
      ))}
    </span>
  );
}

/** Where each queued job actually lands, per the projection. */
interface Placed {
  taskId: string;
  /** Index in the friend's queue — the thing a drag actually edits. */
  index: number;
  startMin: number;
  endMin: number;
  /** Sim-minutes spent waiting before this job could start. */
  waitMin: number;
  /** Never reached inside the morning. */
  unscheduled: boolean;
  /**
   * They never worked it, but the job still got done — somebody else finished
   * it before this friend came free. Signing two people up is a hint, not a
   * booking: the engine only ever fills empty hands, so a late helper who finds
   * the job already finished simply moves on to their next one.
   */
  finishedElsewhere: boolean;
}

/**
 * Fold the projection's segments back into one block per queued job.
 *
 * A job can appear as several segments (walk there, work, interrupted, work
 * again); the planner wants the span from when the friend started dealing with
 * it to when they finished.
 */
function placeRow(
  charId: CharId,
  queue: string[],
  projection: PlannedProjection,
): Placed[] {
  const segs = projection.timeline.filter((s) => s.charId === charId && s.taskId);
  let cursorMin = 0;
  return queue.map((taskId, index) => {
    const mine = segs.filter((s) => s.taskId === taskId);
    if (mine.length === 0) {
      return {
        taskId,
        index,
        startMin: cursorMin,
        endMin: cursorMin,
        waitMin: 0,
        unscheduled: projection.taskWindows[taskId] == null,
        finishedElsewhere: projection.taskWindows[taskId] != null,
      };
    }
    const startMin = Math.min(...mine.map((s) => s.start)) / TICKS_PER_MINUTE;
    const endMin = Math.max(...mine.map((s) => s.end)) / TICKS_PER_MINUTE;
    const waitMin = Math.max(0, startMin - cursorMin);
    cursorMin = endMin;
    return {
      taskId,
      index,
      startMin,
      endMin,
      waitMin,
      unscheduled: false,
      finishedElsewhere: false,
    };
  });
}

function Block({
  charId,
  placed,
  mates,
  claimed,
  onBuffer,
  onRemove,
}: {
  charId: CharId;
  placed: Placed;
  /** The other friends signed up for the same job. */
  mates: CharId[];
  /** This job's gap is reserved, so the slack bar draws it instead. */
  claimed: boolean;
  /** Put five minutes of planned slack in behind this job, or null if not armed. */
  onBuffer: (() => void) | null;
  onRemove(): void;
}) {
  const id = `blk:${charId}:${placed.index}`;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id,
    data: { taskId: placed.taskId, fromChar: charId, fromIndex: placed.index },
  });
  const def = TASK_BY_ID[placed.taskId];
  const left = (placed.startMin / TOTAL_MIN) * 100;
  const width = Math.max(2.2, ((placed.endMin - placed.startMin) / TOTAL_MIN) * 100);
  const alsoOn = mates.length
    ? ` Also down for it: ${mates.map((m) => CHARACTERS[m].name).join(', ')}.`
    : '';

  // Two different nothings, and telling them apart matters: a job nobody ever
  // reaches is a broken plan, while a job a partner finished first is a plan
  // that worked — the helper simply was not needed.
  if (placed.unscheduled || placed.finishedElsewhere) {
    return (
      <button
        ref={setNodeRef}
        {...listeners}
        {...attributes}
        className={`pg-block ${placed.unscheduled ? 'pg-block-never' : 'pg-block-late'}`}
        style={{ left: `${left}%` }}
        onContextMenu={(e) => {
          e.preventDefault();
          onRemove();
        }}
        title={
          (placed.unscheduled
            ? `${def.name} — never reached before 10:00.`
            : `${def.name} — finished before ${CHARACTERS[charId].name} came free, so they never worked it.`) +
          `${alsoOn} Right-click to take it off the plan.`
        }
      >
        <span className="pg-block-name">{def.name}</span>
        <span className="pg-never">
          {placed.unscheduled ? 'never starts' : 'done without them'}
        </span>
        <CrewDots chars={mates} />
      </button>
    );
  }

  return (
    <>
      {/* Only ever drawn for a gap slack has not already claimed — which in
          practice means the wait before a friend's FIRST job, since every gap
          between two jobs is reserved. */}
      {placed.waitMin > 1 && !claimed && (
        <span
          className="pg-wait"
          style={{
            left: `${((placed.startMin - placed.waitMin) / TOTAL_MIN) * 100}%`,
            width: `${(placed.waitMin / TOTAL_MIN) * 100}%`,
          }}
          title={`Waiting ${Math.round(placed.waitMin)} min — this job cannot start until what it depends on is done`}
        >
          <span className="pg-wait-label">waiting {Math.round(placed.waitMin)}′</span>
        </span>
      )}
      <button
        ref={setNodeRef}
        {...listeners}
        {...attributes}
        className={`pg-block ${isDragging ? 'is-dragging' : ''} ${
          mates.length ? 'is-shared' : ''
        } ${onBuffer ? 'takes-slack' : ''}`}
        style={{ left: `${left}%`, width: `${width}%` }}
        title={
          onBuffer
            ? `Click to keep ${MANUAL_SLACK_MIN} minutes free after ${def.name}`
            : `${def.name} — ${clockAt(placed.startMin)} to ${clockAt(placed.endMin)}.${alsoOn} Drag to another friend or to a different point in the order. Right-click to take it off the plan.`
        }
        onClick={(e) => {
          if (!onBuffer) return;
          e.stopPropagation(); // the lane behind is the place-a-job target
          onBuffer();
        }}
        onDoubleClick={onRemove}
        onContextMenu={(e) => {
          e.preventDefault();
          onRemove();
        }}
      >
        <span className="pg-block-name">{def.name}</span>
        <CrewDots chars={mates} />
      </button>
    </>
  );
}

/**
 * A gap the plan is relying on. Not a control: slack appears and disappears
 * with the pair of jobs it sits between, so there is nothing here to manage —
 * move or drop the job after it and the reservation goes too.
 */
function SlackBar({ window: w, onRemove }: { window: SlackWindow; onRemove(): void }) {
  const mins = w.to - w.from;
  const style = {
    left: `${(w.from / TOTAL_MIN) * 100}%`,
    width: `${(mins / TOTAL_MIN) * 100}%`,
  };
  const label = mins >= 4 && <span className="pg-slack-label">slack {Math.round(mins)}′</span>;

  // Hand-placed: the planner put it there, so they can take it back. Derived
  // slack is not a control — it comes and goes with the pair it sits between.
  if (w.manual) {
    return (
      <button
        className="pg-slack is-manual"
        style={style}
        onClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onRemove();
        }}
        title={`${Math.round(mins)} minutes kept free after ${
          TASK_BY_ID[w.after]?.name ?? w.after
        }, ${clockAt(w.from)} to ${clockAt(w.to)} — nothing gets scheduled into it. Right-click to give the time back.`}
      >
        {label}
      </button>
    );
  }
  return (
    <span
      className="pg-slack"
      style={style}
      title={`Planned slack, ${clockAt(w.from)} to ${clockAt(w.to)} — held for ${
        TASK_BY_ID[w.forTask]?.name ?? w.forTask
      }, so nothing else gets scheduled into it. It goes when that job moves.`}
    >
      {label}
    </span>
  );
}

function Row({
  charId,
  placed,
  matesOf,
  slack,
  claimedGap,
  buffering,
  onBuffer,
  onRemoveSlack,
  dragging,
  refusalFor,
  onRemove,
  onPickDrop,
  picked,
}: {
  charId: CharId;
  placed: Placed[];
  /** The other friends signed up for a job, for the shared-job badge. */
  matesOf(taskId: string, charId: CharId): CharId[];
  /** This friend's reserved stretches. */
  slack: SlackWindow[];
  /** Is the gap in front of this job reserved? Slack draws it instead. */
  claimedGap(from: number, to: number): boolean;
  /** Armed with the slack pick: clicking a job buffers the time behind it. */
  buffering: boolean;
  onBuffer(afterTaskId: string, endMin: number): void;
  onRemoveSlack(index: number): void;
  dragging: { taskId: string; fromChar?: CharId } | null;
  refusalFor(charId: CharId, taskId: string, fromChar?: CharId): string | null;
  onRemove(index: number): void;
  onPickDrop(): void;
  picked: string | null;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `row:${charId}`, data: { charId } });
  const candidate = dragging?.taskId ?? (picked === SLACK_PICK ? null : picked);
  // The same rules the drop itself applies, so a lane that would refuse says so
  // while the block is still in the air rather than after it lands.
  const why = candidate == null ? null : refusalFor(charId, candidate, dragging?.fromChar);
  const allowed = why == null;
  // The lane header carries the same card as the run-1 roster chip. The plan
  // board is a full-screen overlay, so nothing underneath it can be hovered —
  // which left students planning run 2 with names and colours and no memory
  // of who is a terrible cook. A button, so a tap or a Tab opens it too.
  const card = useHoverCard<HTMLButtonElement>();
  return (
    <div className="pg-row">
      <div className="pg-row-label" style={{ ['--chip-color' as string]: CHAR_META[charId].color }}>
        <button
          type="button"
          className="pg-row-name"
          ref={card.wrapRef}
          onMouseEnter={card.openCard}
          onMouseLeave={card.closeCard}
          onFocus={card.openCard}
          onBlur={card.closeCard}
          aria-label={`${CHARACTERS[charId].name} — what they are good at`}
        >
          <img src={CHAR_META[charId].front} alt="" aria-hidden />
          <span>{CHARACTERS[charId].name}</span>
        </button>
        {card.cardPos && <CharHintCard charId={charId} style={card.cardPos} />}
      </div>
      <div
        ref={setNodeRef}
        className={`pg-lane ${isOver && allowed ? 'is-over' : ''} ${
          candidate && !allowed ? 'is-blocked' : ''
        }`}
        onClick={() => picked && onPickDrop()}
        title={why ?? undefined}
        // Click-to-place was mouse-only. With a job picked, the lane is a
        // button for the keyboard too (TaskCard follows the same pattern).
        role={picked ? 'button' : undefined}
        tabIndex={picked ? 0 : undefined}
        aria-label={
          picked
            ? `${CHARACTERS[charId].name}'s lane${why ? ` — ${why}` : ' — press Enter to place here'}`
            : undefined
        }
        aria-disabled={picked && !allowed ? true : undefined}
        onKeyDown={(e) => {
          if (picked && e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            onPickDrop();
          }
        }}
      >
        {/* The key is per-lane: `Row` reconciles inside its own lane, so the
            same job appearing in several lanes is several separate scopes. */}
        {/* Slack is drawn from the plan rather than from a gap between two
            blocks, so reserved time survives the job on either side of it
            being moved or taken off. */}
        {slack.map((w, i) => (
          <SlackBar
            key={`${w.manual ? 'm' : 'd'}:${w.after}>${w.forTask}:${w.from}`}
            window={w}
            onRemove={() => onRemoveSlack(i)}
          />
        ))}
        {placed.map((p) => (
          <Block
            key={`${p.taskId}-${p.index}`}
            charId={charId}
            placed={p}
            mates={matesOf(p.taskId, charId)}
            claimed={claimedGap(p.startMin - p.waitMin, p.startMin)}
            onBuffer={
              buffering && !p.unscheduled && !p.finishedElsewhere
                ? () => onBuffer(p.taskId, p.endMin)
                : null
            }
            onRemove={() => onRemove(p.index)}
          />
        ))}
        {placed.length === 0 && slack.length === 0 && (
          <span className="pg-empty">nothing planned</span>
        )}
      </div>
    </div>
  );
}

function TrayChip({
  taskId,
  on,
  picked,
  onPick,
  onCrew,
  onSettle,
}: {
  taskId: string;
  /** Who already has it. A chip stays in the tray until the crew is full. */
  on: CharId[];
  picked: boolean;
  onPick(): void;
  onCrew(): void;
  /** Declare it crewed with the hands it has, short-handed or not. */
  onSettle(): void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `tray:${taskId}`,
    data: { taskId },
  });
  const def = TASK_BY_ID[taskId];
  const need = def.minWorkers ?? 1;
  const missing = need - on.length;
  const waits = waitsFor(def);
  // The chip body is the draggable, and the crew shortcut is its SIBLING, not a
  // nested button: dnd-kit's pointer listeners live on the body, and a button
  // inside it would have its clicks eaten by a 5px twitch turning into a drag.
  return (
    <div
      className={`pg-tray-chip ${picked ? 'picked' : ''} ${isDragging ? 'is-dragging' : ''}`}
    >
      <button
        ref={setNodeRef}
        {...listeners}
        {...attributes}
        className="pg-chip-main"
        onClick={onPick}
        aria-pressed={picked}
      >
        <TaskIcon taskId={taskId} />
        <span>
          {def.name}
          <em>
            ~{def.baseMinutes}′ · {crewLine(def, on.length)}
            {def.requiresLicense && ' · licence'}
          </em>
          {waits && <em className="pg-tray-waits">⛓ {waits}</em>}
        </span>
        <CrewDots chars={on} />
      </button>
      {need > 1 && (
        <button
          className="pg-chip-all"
          onClick={onCrew}
          aria-label={`Put ${
            on.length === 0 ? `all ${need}` : `the other ${missing}`
          } of them on ${def.name}`}
        >
          + {on.length === 0 ? `all ${need}` : `the other ${missing}`}
        </button>
      )}
      {/* Short-handed on purpose. Offered only where it is honest: a job with
          a crew barrier produces literally nothing below its minimum, so
          calling it staffed there would be a plan that cannot run. */}
      {need === 1 && on.length > 0 && (
        <button
          className="pg-chip-done"
          onClick={onSettle}
          aria-label={`Treat ${def.name} as fully staffed with ${on.length} of ${def.maxWorkers}`}
          title={`${def.name} will run with ${on.length} of ${def.maxWorkers} — slower, but planned. Right-click its block to undo.`}
        >
          ✓ enough
        </button>
      )}
    </div>
  );
}

export function PlanGantt({
  plan,
  projection,
  onChange,
}: {
  plan: Plan;
  projection: PlannedProjection;
  onChange(plan: Plan): void;
}) {
  const [dragging, setDragging] = useState<{ taskId: string; fromChar?: CharId } | null>(
    null,
  );
  const [picked, setPicked] = useState<string | null>(null);
  const [refused, setRefused] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  const rows = useMemo(
    () =>
      CHAR_IDS.map((c) => ({
        charId: c,
        placed: placeRow(c, plan.queues[c] ?? [], projection),
      })),
    [plan, projection],
  );

  /**
   * Who is signed up for each job. One map behind the tray counts, the block
   * badges and the capacity rules, so all three can never disagree about who is
   * on what.
   */
  const holders = useMemo(() => {
    const m = new Map<string, CharId[]>();
    for (const c of CHAR_IDS) {
      for (const taskId of plan.queues[c] ?? []) {
        const on = m.get(taskId) ?? [];
        if (!on.includes(c)) on.push(c); // CHAR_IDS order, so badges are stable
        m.set(taskId, on);
      }
    }
    return m;
  }, [plan]);

  const holdersOf = (taskId: string): CharId[] => holders.get(taskId) ?? [];
  const matesOf = (taskId: string, charId: CharId) =>
    holdersOf(taskId).filter((c) => c !== charId);

  const slackOf = (charId: CharId): SlackWindow[] => plan.slack?.[charId] ?? [];

  /**
   * Keep five minutes free behind a job. An absolute window, fixed at the
   * moment it is placed: it is a buffer against that job overrunning, so it
   * must not slide along with whatever it was measured from.
   */
  const addBuffer = (charId: CharId) => (afterTaskId: string, endMin: number) => {
    const w: SlackWindow = {
      from: endMin,
      to: endMin + MANUAL_SLACK_MIN,
      forTask: '', // held against every job, which is what a buffer is
      after: afterTaskId,
      manual: true,
    };
    onChange({
      ...plan,
      slack: {
        ...plan.slack,
        [charId]: [...(plan.slack?.[charId] ?? []), w].sort((a, b) => a.from - b.from),
      },
      // Unlike derived slack, this one changes the schedule, so it has to be
      // projected again rather than folded in silently.
      rev: plan.rev + 1,
    });
    setPicked(null);
  };

  const removeSlackAt = (charId: CharId) => (index: number) => {
    const windows = plan.slack?.[charId] ?? [];
    if (!windows[index]?.manual) return; // derived slack is not ours to remove
    onChange({
      ...plan,
      slack: { ...plan.slack, [charId]: windows.filter((_, i) => i !== index) },
      rev: plan.rev + 1,
    });
  };

  /** Does slack already draw this gap? Then the waiting stripe should not. */
  const claimedGap = (charId: CharId) => (from: number, to: number) =>
    to - from > 0 && slackOf(charId).some((w) => w.from < to && w.to > from);

  /**
   * Reserve every gap the schedule has, and let go of the ones it no longer
   * has. Derived from the projection the student is looking at, so what the
   * board shows and what run 2 does cannot drift apart.
   *
   * Deriving does NOT bump `rev`: a window only ever reserves a stretch that
   * was already empty, so it cannot change the projection it came from, and
   * re-projecting would be a wasted 80ms — and a loop waiting to happen.
   */
  useEffect(() => {
    const derived = deriveSlack(
      Object.fromEntries(
        rows.map((r) => [
          r.charId,
          r.placed.map((p) => ({
            taskId: p.taskId,
            startMin: p.startMin,
            endMin: p.endMin,
            absent: p.unscheduled || p.finishedElsewhere,
          })),
        ]),
      ),
      plan.slack,
    );
    if (!sameSlack(derived, plan.slack)) onChange({ ...plan, slack: derived });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, plan.slack]);

  /**
   * Declare a job fully crewed with the hands it has. Right-clicking any of its
   * blocks takes the job off the plan and clears this with it, which is what
   * makes right-click a reset rather than two different gestures.
   */
  const setSettled = (taskId: string, on: boolean) => {
    const settled = new Set(plan.settled ?? []);
    if (on) settled.add(taskId);
    else settled.delete(taskId);
    onChange({ ...plan, settled: [...settled], rev: plan.rev + 1 });
  };

  const isSettled = (taskId: string) => (plan.settled ?? []).includes(taskId);

  /** Take one friend off a job, clearing any designation that outlives it. */
  const removeAt = (charId: CharId, index: number) => {
    const taskId = (plan.queues[charId] ?? [])[index];
    const queues = Object.fromEntries(
      CHAR_IDS.map((c) => [c, [...(plan.queues[c] ?? [])]]),
    ) as Record<CharId, string[]>;
    queues[charId].splice(index, 1);
    const stillOn = CHAR_IDS.some((c) => queues[c].includes(taskId));
    const settled = (plan.settled ?? []).filter((t) => stillOn || t !== taskId);
    onChange({
      ...plan,
      queues,
      settled,
      slack: pruneSlack(plan.slack, queues),
      rev: plan.rev + 1,
    });
  };

  /**
   * Why this job cannot go in this lane, or null if it can.
   *
   * `fromChar` is the lane a dragged block is LEAVING. A move between lanes is
   * crew-neutral — the source gives its slot up — so it must not be refused for
   * a crew that is only full because of the block being moved. A move within
   * one lane is a reorder and is never refused at all.
   */
  const refusalFor = (
    charId: CharId,
    taskId: string,
    fromChar?: CharId,
  ): string | null => {
    const def = TASK_BY_ID[taskId];
    if (!def) return null;
    if (fromChar === charId) return null; // reordering inside one lane
    const name = CHARACTERS[charId].name;
    if (!eligible(charId, taskId)) return `${name} can't do ${def.name}.`;
    if ((plan.queues[charId] ?? []).includes(taskId)) {
      return `${name} is already down for ${def.name}.`;
    }
    const on = holdersOf(taskId).filter((c) => c !== fromChar);
    if (on.length + 1 > def.maxWorkers) {
      const who = on.map((c) => CHARACTERS[c].name).join(' and ');
      return def.maxWorkers === 1
        ? `Only one person can do ${def.name}, and ${who} has it.`
        : `${def.name} takes ${def.maxWorkers} at a time, and ${who} have it. Take someone off first.`;
    }
    return null;
  };

  /**
   * Put the whole crew on a job that needs one. Added at the FRONT of each
   * lane, not the end: the barrier only fires once every signed-up friend is
   * free at the same moment, so a crew job parked at the end of five queues
   * could not happen until everyone had finished everything else — which
   * strands everything that waits on it. At the front it costs nothing, because
   * the dispatcher skips a locked job and lets people get on with other work
   * until it opens.
   */
  const addWholeCrew = (taskId: string) => {
    edit((q) => {
      for (const c of CHAR_IDS) {
        if (!eligible(c, taskId)) continue;
        if (!q[c].includes(taskId)) q[c].unshift(taskId);
      }
    });
    setPicked(null);
    setRefused(null);
  };

  const idle = CHAR_IDS.filter((c) => (plan.queues[c] ?? []).length === 0);
  // A job stays on offer until its crew is full — that is the whole point of
  // being able to put two people on one job.
  const tray = TASKS.filter(
    (t) => holdersOf(t.id).length < t.maxWorkers && !isSettled(t.id),
  );

  const edit = (fn: (q: Record<CharId, string[]>) => void) => {
    const queues = Object.fromEntries(
      CHAR_IDS.map((c) => [c, [...(plan.queues[c] ?? [])]]),
    ) as Record<CharId, string[]>;
    fn(queues);
    // Spread the plan rather than rebuilding it: slack and settled live here
    // too, and a fresh object literal would silently drop them on every drag.
    // Pruning happens HERE, before the projection re-runs, so a window that the
    // edit invalidated cannot influence the schedule it is no longer part of —
    // while the ones still justified stay on to defend their gaps against
    // whatever was just added.
    onChange({
      ...plan,
      queues,
      slack: pruneSlack(plan.slack, queues),
      rev: plan.rev + 1,
    });
  };

  /**
   * Turn a drop x into a place in the order. The block lands after everything
   * whose projected start is earlier than where it was dropped, which is what
   * makes dragging rightwards mean "do this later".
   */
  function indexForDrop(charId: CharId, dropFraction: number, skipIndex?: number): number {
    const dropMin = dropFraction * TOTAL_MIN;
    const placed = rows.find((r) => r.charId === charId)!.placed;
    let idx = 0;
    for (const p of placed) {
      if (skipIndex != null && p.index === skipIndex) continue;
      if (p.startMin < dropMin) idx++;
    }
    return idx;
  }

  function onDragEnd(e: DragEndEvent) {
    setDragging(null);
    const { active, over } = e;
    if (!over) return;
    const data = active.data.current as
      | { taskId: string; fromChar?: CharId; fromIndex?: number }
      | undefined;
    if (!data) return;
    const overId = String(over.id);

    if (overId === 'tray') {
      if (data.fromChar != null && data.fromIndex != null) {
        edit((q) => q[data.fromChar!].splice(data.fromIndex!, 1));
      }
      return;
    }
    if (!overId.startsWith('row:')) return;
    const toChar = overId.slice(4) as CharId;

    // Checked BEFORE the edit, never inside it. The edit removes the block from
    // its old lane first, so a refusal discovered mid-edit would drop the job
    // on the floor — which is exactly what the old in-mutation guard did.
    const why = refusalFor(toChar, data.taskId, data.fromChar);
    if (why) {
      setRefused(why);
      return;
    }
    setRefused(null);

    // Where along the row did it land? The translated rect is the block's final
    // position; measuring its left edge against the lane keeps "dropped further
    // right" meaning "later in the order".
    const rect = active.rect.current.translated;
    const laneRect = over.rect;
    const fraction =
      rect && laneRect.width > 0
        ? Math.min(1, Math.max(0, (rect.left - laneRect.left) / laneRect.width))
        : 1;

    edit((q) => {
      const sameRow = data.fromChar === toChar;
      if (data.fromChar != null && data.fromIndex != null) {
        q[data.fromChar].splice(data.fromIndex, 1);
      }
      const at = indexForDrop(toChar, fraction, sameRow ? data.fromIndex : undefined);
      q[toChar].splice(Math.min(at, q[toChar].length), 0, data.taskId);
    });
  }

  const TrayZone = () => {
    const { setNodeRef, isOver } = useDroppable({ id: 'tray' });
    return (
      <div ref={setNodeRef} className={`pg-tray ${isOver ? 'is-over' : ''}`}>
        <div className="pg-tray-head">
          <strong>Jobs that still need hands</strong>
          <span>
            {tray.length === 0
              ? 'every job has a full crew'
              : 'drag one into a row — or click it, then click a row. A job stays here while there is still room on it.'}
          </span>
        </div>
        <div className="pg-tray-list">
          {/* Not a job — a way to spend time on purpose. Sits with the jobs
              because it is placed the same way: pick it, then click the job you
              want the breathing room after. */}
          <button
            className={`pg-tray-chip pg-slack-chip ${picked === SLACK_PICK ? 'picked' : ''}`}
            onClick={() => setPicked(picked === SLACK_PICK ? null : SLACK_PICK)}
            aria-pressed={picked === SLACK_PICK}
            title={`Keep ${MANUAL_SLACK_MIN} minutes free somewhere in a lane: click this, then click the job you want the time after.`}
          >
            <span aria-hidden style={{ fontSize: '1.2rem' }}>⏸</span>
            <span>
              {MANUAL_SLACK_MIN} min slack
              <em>
                {picked === SLACK_PICK
                  ? 'now click the job to put it behind'
                  : 'buffer time nothing can be scheduled into'}
              </em>
            </span>
          </button>
          {tray.map((t) => (
            <TrayChip
              key={t.id}
              taskId={t.id}
              on={holdersOf(t.id)}
              picked={picked === t.id}
              onPick={() => setPicked(picked === t.id ? null : t.id)}
              onCrew={() => addWholeCrew(t.id)}
              onSettle={() => setSettled(t.id, true)}
            />
          ))}
          {tray.length === 0 && <span className="pg-empty">Nothing left to hand out.</span>}
        </div>
      </div>
    );
  };

  return (
    <DndContext
      sensors={sensors}
      // Lanes are wide and short; matching on the pointer rather than the
      // dragged element's rectangle makes "which row did I drop on" mean the
      // row under the cursor, which is what people aim with.
      collisionDetection={pointerWithin}
      onDragStart={(e: DragStartEvent) => {
        const d = e.active.data.current as
          | { taskId: string; fromChar?: CharId }
          | undefined;
        setDragging(d ? { taskId: d.taskId, fromChar: d.fromChar } : null);
        setRefused(null);
      }}
      onDragCancel={() => setDragging(null)}
      onDragEnd={onDragEnd}
    >
      <div className="pg">
        <div className="pg-axis">
          <div className="pg-axis-label" />
          <div className="pg-axis-track">
            {[0, 15, 30, 45, 60, 75, 90, 105, 120].map((m) => (
              <span key={m} className="pg-tick" style={{ left: `${(m / TOTAL_MIN) * 100}%` }}>
                <i />
                {m % 30 === 0 && <em>{clockAt(m)}</em>}
              </span>
            ))}
          </div>
        </div>

        {rows.map((r) => (
          <Row
            key={r.charId}
            charId={r.charId}
            placed={r.placed}
            matesOf={matesOf}
            dragging={dragging}
            refusalFor={refusalFor}
            picked={picked}
            slack={slackOf(r.charId)}
            claimedGap={claimedGap(r.charId)}
            buffering={picked === SLACK_PICK}
            onBuffer={addBuffer(r.charId)}
            onRemoveSlack={removeSlackAt(r.charId)}
            onRemove={(i) => removeAt(r.charId, i)}
            onPickDrop={() => {
              if (!picked) return;
              // The slack pick is placed on a JOB, not on a lane: clicking the
              // empty lane with it armed should do nothing rather than refuse.
              if (picked === SLACK_PICK) return;
              const why = refusalFor(r.charId, picked);
              if (why) {
                setRefused(why);
                return;
              }
              setRefused(null);
              edit((q) => q[r.charId].push(picked));
              // Keep the pick alive while the job still has room, so clicking
              // chip → Sora → Kenji builds a pair. That is the keyboard and
              // touch equivalent of dragging the same job in twice.
              const room = TASK_BY_ID[picked].maxWorkers - holdersOf(picked).length - 1;
              if (room <= 0) setPicked(null);
            }}
          />
        ))}

        {refused && (
          <p className="pg-refused" role="alert">
            {refused}
          </p>
        )}

        {/* An empty row means that friend stands still for the whole replay.
            That is a legitimate plan, but it is also exactly what a forgotten
            plan looks like, so it is called out rather than left to be noticed
            when the run has already started. */}
        {idle.length > 0 && (
          <p className="pg-idle-warn">
            {idle.map((c) => CHARACTERS[c].name).join(', ')}{' '}
            {idle.length === 1 ? 'has' : 'have'} nothing to do — {idle.length === 1 ? 'they' : 'they'}
            {' '}will stand around for the whole run.
          </p>
        )}

        <TrayZone />
      </div>
    </DndContext>
  );
}
