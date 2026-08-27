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
}

export type Activity =
  | 'idle'
  | 'walking' // in transit to an assigned task
  | 'working'
  | 'distracted'
  | 'oncall'
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
  /** Closed + still-open activity spans, in start order — drives the Gantt. */
  timeline: TimelineSegment[];
  /** Index into `timeline` of each character's currently-open segment. Stored as
   * an index (not a reference) so checkpoints survive JSON round-tripping. */
  openSegIdx: Partial<Record<CharId, number>>;
  actionLog: LoggedAction[];
}

export interface StepResult {
  state: SimState;
  events: SimEvent[];
}
