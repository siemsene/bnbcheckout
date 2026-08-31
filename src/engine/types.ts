// Pure data types for the simulation engine. No React, no Firebase, no DOM.
// All state is JSON-safe (plain objects/arrays) so serialize.ts can round-trip it.

export type CharId = 'sora' | 'kenji' | 'mei' | 'taro' | 'hana';

export type Skill =
  | 'cooking'
  | 'cleaning'
  | 'driving'
  | 'heavy'
  | 'shopping'
  | 'general';

export type RoomId =
  | 'bedroom1'
  | 'bedroom2'
  | 'bedroom3'
  | 'bathroom'
  | 'kitchen'
  | 'living'
  | 'hall'
  | 'outside';

export interface TaskDef {
  id: string;
  name: string;
  /** Short player-facing description; the only sanctioned hint at hidden constraints. */
  blurb: string;
  baseMinutes: number;
  maxWorkers: number;
  /** Task only accrues work when at least this many workers contribute (default 1). */
  minWorkers?: number;
  /** All of these must be done before the task unlocks. */
  preds?: string[];
  /** At least one of these must be done (combined with preds). */
  predsAny?: string[];
  skill: Skill;
  /** Shared equipment: only one task using it runs at full speed at a time. */
  equipment?: 'vacuum';
  /** Travel tasks: no learning ramp; abandoning loses progress and costs a walk-back. */
  travel?: boolean;
  /** No learning ramp, without the travel penalties. There is no getting
   * better at phoning your mother, and the ramp would otherwise add ~35% to
   * the wall time of a deliberately short task. */
  noRamp?: boolean;
  /** Only characters with a driving license can contribute. */
  requiresLicense?: boolean;
  /**
   * Hard allow-list: nobody outside it contributes anything. Used for the
   * personal errands ("Mei, ring your mother"). Note this is NOT the same as
   * `owners` + `nonOwnerMult: 0` — that would let the wrong friend take the
   * crew slot and dilute the team factor while producing nothing.
   */
  onlyChars?: CharId[];
  /** Owners work faster (bedrooms: 1.3x, bags: 2x with 0.6x for strangers). */
  owners?: CharId[];
  ownerMult?: number;
  nonOwnerMult?: number;
  room: RoomId;
  /** Efficiency factor indexed by worker count; default [0, 1, 1.7, 2.1]. */
  multiWorkerFactors?: number[];
}

/**
 * Why a character is producing nothing right now. Distinct from a multiplier of
 * zero: the player needs to know *which* of these it is, because the fix differs
 * (nudge them, wait, or reassign someone eligible).
 */
export type BlockReason =
  | 'no-licence'
  | 'not-theirs'
  | 'interrupted'
  | 'idle'
  | 'walking'
  | 'walkback'
  | 'oncall'
  | 'distracted'
  | 'atdoor'
  | 'toilet';

/** One named factor in a character's productivity multiplier. */
export interface MultTerm {
  key: string;
  label: string;
  factor: number;
  /** Optional extra clause, e.g. "full speed in 2 min". */
  hint?: string;
}

/**
 * The productivity multiplier, decomposed. `personalMult` is defined as the
 * product of `terms`, so the explanation the player reads can never drift from
 * the number the engine applies.
 */
export type MultExplain =
  | { blocked: BlockReason }
  | { terms: MultTerm[]; value: number };

export interface CharDef {
  id: CharId;
  name: string;
  license: boolean;
  skillMult: Partial<Record<Skill, number>>;
  /** Multiplier applied when working with at least one other contributor. */
  pairedMult?: number;
  /** Multiplier applied when working alone on a task. */
  aloneMult?: number;
  /** Player-facing one-liner (public traits only — quirks stay hidden). */
  intro: string;
}

// ---------------------------------------------------------------------------
// Pre-rolled randomness (created once per run in init.ts)

export type ScheduledEvent =
  | { at: number; type: 'phone'; charId: CharId; duration: number }
  | { at: number; type: 'distraction'; charId: CharId; maxDuration: number }
  /** `skippableByImodium` is pre-rolled so the suppression stays deterministic
   * — there is no RNG available at step time. */
  | {
      at: number;
      type: 'toilet';
      charId: CharId;
      duration: number;
      skippableByImodium?: boolean;
    }
  | { at: number; type: 'doorbell'; charId: CharId; duration: number }
  | { at: number; type: 'cat' }
  | { at: number; type: 'spill' }
  | { at: number; type: 'music'; duration: number }
  | { at: number; type: 'flavor'; textKey: string };

export interface PreRolls {
  /** Per-task duration multiplier in [0.85, 1.2]. */
  durationMults: Record<string, number>;
  /** Per-cleaning-task uniform [0,1) roll: found a forgotten item on completion? */
  foundItemRolls: Record<string, number>;
  /** Which bag task gets the repack when an item is found in a given room. */
  foundItemBag: Record<string, string>;
  /** Uniform roll for the final-walkthrough surprise. */
  walkthroughRoll: number;
}

// ---------------------------------------------------------------------------
// Live state

export type TaskStatus = 'locked' | 'open' | 'done';

export interface TaskState {
  status: TaskStatus;
  workDone: number; // effective person-seconds
  workRequired: number; // person-seconds (baseMinutes * 60 * durationMult)
  assignees: CharId[];
  /** Tick each assignee arrives at the task (transit done). */
  arriveAt: Record<string, number>;
  reworkCount: number;
  /**
   * Effective person-seconds that were finished and then taken back. Lets the
   * progress bar show the ground lost rather than encoding it as a colour —
   * "amber" was being read as "going slowly", which it never meant.
   */
  reworkLost: number;
}

export type Activity =
  | 'idle'
  | 'walking' // in transit to an assigned task
  | 'working'
  | 'distracted'
  | 'oncall'
  /** Caught at the side of the house by the neighbour, who wants to chat. */
  | 'atdoor'
  | 'toilet'
  | 'walkback'; // returning after abandoning a travel task

export interface CharState {
  taskId?: string;
  activity: Activity;
  /** Tick until which the character cannot contribute (interruptions, nudge cost). */
  unavailableUntil: number;
  busyTicks: number;
  fed: boolean;
}

export type Action =
  | { type: 'assign'; charId: CharId; taskId: string }
  | { type: 'unassign'; charId: CharId }
  | { type: 'nudge'; charId: CharId };

export interface LoggedAction {
  tick: number;
  action: Action;
  /**
   * Who caused this. Absent means the player did it by hand; 'plan' means the
   * auto-dispatcher followed their committed plan. The difference IS the
   * variance report — every hand-made action during run 2 is an override.
   */
  src?: 'plan';
}

/**
 * A student's plan: the order each friend should work through their tasks.
 * Order is intent; the engine still decides timing, so a plan cannot cheat
 * precedence, crew limits or transit.
 */
export interface Plan {
  queues: Record<CharId, string[]>;
  /** Bumped on every edit — the projection's cache key. */
  rev: number;
  /**
   * Reserved idle time, in sim-minutes: the gaps a lane already has, held so
   * that the next job dropped into that lane cannot quietly swallow them and
   * push everything after them later.
   *
   * Derived from the projection rather than drawn by hand — every gap between
   * two consecutive scheduled jobs becomes one — and dropped again as soon as
   * the pair it sits between stops being a pair. See `engine/slack.ts`.
   */
  slack?: Partial<Record<CharId, SlackWindow[]>>;
  /**
   * Jobs the planner has declared fully crewed even though they have room for
   * more hands. Purely an intent: a two-person job runs perfectly well with one
   * person on it, just slower, and the engine never reads this. It stops the
   * board asking for a second person who is never coming.
   */
  settled?: string[];
}

/**
 * A reserved stretch of one friend's morning, in sim-minutes from 8:00 —
 * exactly the gap between the job before it and the job it is held for.
 */
export interface SlackWindow {
  from: number;
  to: number;
  /**
   * The job this time is being kept for. It is held against everything ELSE:
   * the job itself may start the moment it can, so a predecessor landing early
   * is never punished by the very window that exists to protect it.
   *
   * Empty on a buffer the planner placed by hand — that time is held against
   * every job, which is what makes it a buffer rather than a queue.
   */
  forTask: string;
  /** The job it follows. The pair is what justifies the window's existence. */
  after: string;
  /**
   * Put here on purpose, rather than derived from a gap the schedule already
   * had. Survives as long as the job it follows is still in that lane, and is
   * the planner's to remove.
   */
  manual?: boolean;
}

/** What a plan is predicted to do, in the same shapes the charts already read. */
export interface PlannedProjection {
  timeline: TimelineSegment[];
  completion: number[];
  finishSimMinute: number | null;
  outcome: Outcome;
  /** Predicted [start, end) tick window per task; null if never scheduled. */
  taskWindows: Record<string, { start: number; end: number } | null>;
  /** Tasks no queue ever reached — a plan that cannot finish the project. */
  unscheduled: string[];
}

export type SimEvent =
  | { type: 'bubble'; tick: number; charId?: CharId; textKey: string }
  | { type: 'rework'; tick: number; taskId: string; textKey: string }
  | { type: 'taskDone'; tick: number; taskId: string }
  | { type: 'finished'; tick: number }
  | { type: 'deadline'; tick: number };

export type Outcome = 'running' | 'finished' | 'deadline';

/** How a character spent a stretch of time — the Gantt's three bar styles. */
export type TimelineKind =
  | 'working' // contributing effective work to taskId
  | 'travel' // walking to the task, or walking back after abandoning one
  | 'blocked'; // on a call, distracted, in the bathroom, or unable to do the task

export interface TimelineSegment {
  charId: CharId;
  /** Task they were assigned to, if any (blocked/travel time can be task-less). */
  taskId?: string;
  kind: TimelineKind;
  /** Half-open tick range [start, end). */
  start: number;
  end: number;
}

export interface SimState {
  engineVersion: number;
  seed: number;
  /**
   * Seed for the chaos stream — interruptions, rework rolls, the cat. Split from
   * `seed` (which drives task durations) so a replay can keep the same project
   * and re-roll only the disruptions.
   */
  chaosSeed: number;
  /** 1 for a normal run; 2 for the replay half of a two-run session. */
  round: 1 | 2;
  tick: number;
  outcome: Outcome;
  tasks: Record<string, TaskState>;
  chars: Record<CharId, CharState>;
  schedule: ScheduledEvent[];
  nextEventIdx: number;
  rolls: PreRolls;
  /** True once the walkthrough surprise has fired (it fires at most once). */
  walkthroughSurpriseDone: boolean;
  /** Active nudge trip: Sora is walking over to snap someone out of it. */
  nudge: { target: CharId; arriveAt: number } | null;
  /** Someone put music on — everyone works a little faster until this tick. */
  boostUntil: number;
  /** Bubble textKeys already emitted (dedupe). */
  emitted: Record<string, true>;
  /** [charIndex][simMinute] = fraction of that minute spent busy, appended every 60 ticks. */
  utilization: number[][];
  /** [simMinute] = overall project completion in [0,1]. Dips on rework. */
  completion: number[];
  /** Closed + still-open activity spans, in start order — drives the Gantt. */
  timeline: TimelineSegment[];
  /** Index into `timeline` of each character's currently-open segment. Stored as
   * an index (not a reference) so checkpoints survive JSON round-tripping. */
  openSegIdx: Partial<Record<CharId, number>>;
  actionLog: LoggedAction[];

  /**
   * The committed plan driving auto-assignment. Absent in a single run and in
   * practice mode, where `step()` skips the dispatcher entirely — so none of
   * this can perturb an ordinary game.
   */
  plan?: Plan;
  /**
   * What the plan predicted, frozen at the moment it was committed. Frozen, not
   * recomputed, so the debrief compares against the plan the student actually
   * signed up to.
   */
  plannedProjection?: PlannedProjection;
}

export interface StepResult {
  state: SimState;
  events: SimEvent[];
}
