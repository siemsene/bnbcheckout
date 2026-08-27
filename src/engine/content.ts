// The scenario: 5 friends, 22 tasks, hidden constraints.
// Durations are base sim-minutes; each run multiplies them by [0.85, 1.2].

import type { CharDef, CharId, TaskDef } from './types';

export const SIM_DEADLINE_TICKS = 120 * 60; // 120 sim-minutes, 1 tick = 1 sim-second
export const TICKS_PER_MINUTE = 60;

/** Learning curve: productivity ramps 50% -> 100% over this many ticks. */
export const LEARNING_RAMP_TICKS = 4 * 60;
export const LEARNING_START_FRACTION = 0.5;

/** Transit time when assigned to a (non-travel) task in another room. */
export const TRANSIT_TICKS = 30;

/** Fraction of time-spent-outbound a travel abandon costs as walk-back. */
export const WALKBACK_FRACTION = 0.6;

/** Nudging = Sora walks over, has a word, and walks back. */
export const NUDGE_WALK_TICKS = 40;
export const NUDGE_CHAT_TICKS = 20;

/** Only one vacuum cleaner: concurrent vacuum-tasks beyond the first run slower. */
export const VACUUM_PENALTY = 0.55;

/** Buying snacks without the shopping list (found under the sofa) is slower. */
export const NO_LIST_MULT = 0.6;

/** Music-on boost. */
export const MUSIC_BOOST = 1.1;

/** Everyone unfed works at this rate from HANGRY_TICK until breakfast is eaten. */
export const HANGRY_TICK = 60 * 60;
export const HANGRY_MULT = 0.8;

export const DEFAULT_MULTIWORKER = [0, 1, 1.7, 2.1];

/** Found-item probability thresholds by cleaner (roll < threshold => item found). */
export const FOUND_ITEM_THRESHOLD_HANA = 0.65;
export const FOUND_ITEM_THRESHOLD_OTHERS = 0.25;
export const REPACK_EXTRA_SECONDS = 4 * 60;

/** Bathroom rework after a toilet emergency: this share of done work is lost. */
export const BATHROOM_REWORK_FRACTION = 0.5;

/** Final-walkthrough surprise: threshold and extra unload/reload work. */
export const WALKTHROUGH_SURPRISE_THRESHOLD = 0.4;
export const WALKTHROUGH_SURPRISE_EXTRA_SECONDS = 6 * 60;

export const PLAYER_CHAR: CharId = 'sora';

export const CHARACTERS: Record<CharId, CharDef> = {
  sora: {
    id: 'sora',
    name: 'Sora',
    license: false,
    skillMult: {},
    intro: 'That’s you. Reliable all-rounder, official trip organizer.',
  },
  kenji: {
    id: 'kenji',
    name: 'Kenji',
    license: true,
    skillMult: { driving: 1.3, cooking: 0.5 },
    intro: 'Road-trip captain. Loves driving. Once burned instant noodles.',
  },
  mei: {
    id: 'mei',
    name: 'Mei',
    license: false,
    skillMult: { cooking: 1.8, shopping: 1.4 },
    intro: 'Breakfast wizard and snack connoisseur. Easily amused by birds.',
  },
  taro: {
    id: 'taro',
    name: 'Taro',
    license: false,
    skillMult: { heavy: 1.6 },
    aloneMult: 1.0,
    pairedMult: 0.7,
    intro: 'Carries the whole fridge if you let him. Prefers to work solo. Regrets last night’s street food.',
  },
  hana: {
    id: 'hana',
    name: 'Hana',
    license: true,
    skillMult: { cleaning: 1.5, driving: 1.0 },
    pairedMult: 1.25,
    aloneMult: 0.8,
    intro: 'Cleans like a pro, chats like a talk-show host. Hates being alone.',
  },
};

export const CHAR_IDS = Object.keys(CHARACTERS) as CharId[];

// Room occupancy: bedroom1 = Sora+Kenji, bedroom2 = Mei, bedroom3 = Taro+Hana.
// Bag ownership mirrors rooms.

export const TASKS: TaskDef[] = [
  {
    id: 'strip-beds',
    name: 'Strip beds & gather towels',
    blurb: 'Bag up all linens and towels before the rooms can really be cleaned.',
    baseMinutes: 10,
    maxWorkers: 2,
    skill: 'cleaning',
    room: 'hall',
  },
  {
    id: 'make-breakfast',
    name: 'Make breakfast',
    blurb: 'Someone who can actually cook would help. The pan remembers Kenji.',
    baseMinutes: 25,
    maxWorkers: 2,
    skill: 'cooking',
    room: 'kitchen',
    multiWorkerFactors: [0, 1, 1.6],
  },
  {
    id: 'eat-breakfast',
    name: 'Eat breakfast together',
    blurb: 'Everyone at the table. Nobody functions well on an empty stomach.',
    baseMinutes: 15,
    maxWorkers: 5,
    minWorkers: 5,
    preds: ['make-breakfast'],
    skill: 'general',
    room: 'kitchen',
    multiWorkerFactors: [0, 0, 0, 0, 0, 5],
  },
  {
    id: 'clean-bedroom-1',
    name: 'Clean bedroom 1 (Sora & Kenji’s)',
    blurb: 'Whoever slept here knows where everything goes.',
    baseMinutes: 15,
    maxWorkers: 1,
    preds: ['strip-beds'],
    skill: 'cleaning',
    equipment: 'vacuum',
    owners: ['sora', 'kenji'],
    ownerMult: 1.3,
    room: 'bedroom1',
  },
  {
    id: 'clean-bedroom-2',
    name: 'Clean bedroom 2 (Mei’s)',
    blurb: 'Whoever slept here knows where everything goes.',
    baseMinutes: 15,
    maxWorkers: 1,
    preds: ['strip-beds'],
    skill: 'cleaning',
    equipment: 'vacuum',
    owners: ['mei'],
    ownerMult: 1.3,
    room: 'bedroom2',
  },
  {
    id: 'clean-bedroom-3',
    name: 'Clean bedroom 3 (Taro & Hana’s)',
    blurb: 'Whoever slept here knows where everything goes.',
    baseMinutes: 15,
    maxWorkers: 1,
    preds: ['strip-beds'],
    skill: 'cleaning',
    equipment: 'vacuum',
    owners: ['taro', 'hana'],
    ownerMult: 1.3,
    room: 'bedroom3',
  },
  {
    id: 'clean-bathroom',
    name: 'Clean bathroom',
    blurb: 'Best saved for when everyone is… done with it.',
    baseMinutes: 15,
    maxWorkers: 1,
    skill: 'cleaning',
    room: 'bathroom',
  },
  {
    id: 'tidy-kitchen',
    name: 'Tidy kitchen & wash dishes',
    blurb: 'Pointless until breakfast is over — new dishes keep appearing.',
    baseMinutes: 20,
    maxWorkers: 2,
    preds: ['eat-breakfast'],
    skill: 'cleaning',
    room: 'kitchen',
  },
  {
    id: 'clean-living-room',
    name: 'Clean living room',
    blurb: 'Cushions, board games, and a suspicious number of mugs. Wasn’t the shopping list around here somewhere?',
    baseMinutes: 12,
    maxWorkers: 2,
    skill: 'cleaning',
    equipment: 'vacuum',
    room: 'living',
  },
  {
    id: 'pack-bag-1',
    name: 'Pack Sora & Kenji’s luggage',
    blurb: 'Owners know what’s theirs. Anyone else will hold up socks, puzzled.',
    baseMinutes: 18,
    maxWorkers: 2,
    skill: 'general',
    owners: ['sora', 'kenji'],
    ownerMult: 2.0,
    nonOwnerMult: 0.6,
    room: 'bedroom1',
  },
  {
    id: 'pack-bag-2',
    name: 'Pack Mei’s luggage',
    blurb: 'Owners know what’s theirs. Anyone else will hold up socks, puzzled.',
    baseMinutes: 18,
    maxWorkers: 2,
    skill: 'general',
    owners: ['mei'],
    ownerMult: 2.0,
    nonOwnerMult: 0.6,
    room: 'bedroom2',
  },
  {
    id: 'pack-bag-3',
    name: 'Pack Taro & Hana’s luggage',
    blurb: 'Owners know what’s theirs. Anyone else will hold up socks, puzzled.',
    baseMinutes: 18,
    maxWorkers: 2,
    skill: 'general',
    owners: ['taro', 'hana'],
    ownerMult: 2.0,
    nonOwnerMult: 0.6,
    room: 'bedroom3',
  },
  {
    id: 'fetch-car-a',
    name: 'Fetch car A from the parking garage',
    blurb: 'A 10-minute walk away. Requires, you know, being able to drive.',
    baseMinutes: 14,
    maxWorkers: 1,
    skill: 'driving',
    travel: true,
    requiresLicense: true,
    room: 'outside',
  },
  {
    id: 'fetch-car-b',
    name: 'Fetch car B from the parking garage',
    blurb: 'Same garage, second car. One driver can’t drive two cars at once.',
    baseMinutes: 14,
    maxWorkers: 1,
    skill: 'driving',
    travel: true,
    requiresLicense: true,
    room: 'outside',
  },
  {
    id: 'buy-snacks',
    name: 'Buy road snacks at the corner store',
    blurb: 'Someone who knows what everyone likes will be much quicker.',
    baseMinutes: 22,
    maxWorkers: 2,
    skill: 'shopping',
    travel: true,
    room: 'outside',
  },
  {
    id: 'load-car-a',
    name: 'Load car A (Sora, Kenji & Mei’s bags)',
    blurb: 'Their three-person luggage puzzle only fits car A one way. Needs the bags packed and car A out front. Strong arms help.',
    baseMinutes: 9,
    maxWorkers: 2,
    preds: ['pack-bag-1', 'pack-bag-2', 'fetch-car-a'],
    skill: 'heavy',
    room: 'outside',
  },
  {
    id: 'load-car-b',
    name: 'Load car B (Taro & Hana’s bags + the snacks)',
    blurb: 'The big bags and the cooler go in the wagon. Needs that luggage packed, snacks bought, and car B out front.',
    baseMinutes: 9,
    maxWorkers: 2,
    preds: ['pack-bag-3', 'buy-snacks', 'fetch-car-b'],
    skill: 'heavy',
    room: 'outside',
  },
  {
    id: 'garbage',
    name: 'Take out garbage & recycling',
    blurb: 'Kitchen and bathroom produce most of it — no point going before both are done.',
    baseMinutes: 8,
    maxWorkers: 2,
    preds: ['tidy-kitchen', 'clean-bathroom'],
    skill: 'heavy',
    room: 'outside',
  },
  // Personal errands. No predecessors, so they are available from minute zero —
  // and short enough to slot inside the final walkthrough, which is what stops
  // four friends idling at the end. Each is locked to one person, so they can
  // never all be dumped on whoever happens to be free.
  {
    id: 'call-mom',
    name: 'Mei: ring your mother back',
    blurb:
      'Three missed calls since breakfast. Only Mei can have this conversation, and it is not getting shorter.',
    baseMinutes: 5,
    maxWorkers: 1,
    onlyChars: ['mei'],
    noRamp: true,
    skill: 'general',
    room: 'living',
  },
  {
    id: 'buy-imodium',
    name: 'Taro: pharmacy run',
    blurb:
      'It is around the corner. Taro knows exactly why he is going. Sooner is better than later.',
    baseMinutes: 6,
    maxWorkers: 1,
    onlyChars: ['taro'],
    travel: true,
    skill: 'shopping',
    room: 'outside',
  },
  {
    id: 'guest-book',
    name: 'Hana: thank-you note in the guest book',
    blurb:
      'Hana promised the host a proper note, and she is the only one whose handwriting is fit for it.',
    baseMinutes: 4,
    maxWorkers: 1,
    onlyChars: ['hana'],
    noRamp: true,
    skill: 'general',
    room: 'hall',
  },
  {
    id: 'final-walkthrough',
    name: 'Final walkthrough & keys in lockbox',
    blurb: 'One person, every room, one last look. The very last thing to do.',
    baseMinutes: 8,
    maxWorkers: 1,
    preds: [
      'strip-beds',
      'make-breakfast',
      'eat-breakfast',
      'clean-bedroom-1',
      'clean-bedroom-2',
      'clean-bedroom-3',
      'clean-bathroom',
      'tidy-kitchen',
      'clean-living-room',
      'pack-bag-1',
      'pack-bag-2',
      'pack-bag-3',
      'fetch-car-a',
      'fetch-car-b',
      'buy-snacks',
      'load-car-a',
      'load-car-b',
      'garbage',
    ],
    skill: 'general',
    room: 'hall',
  },
];

export const TASK_BY_ID: Record<string, TaskDef> = Object.fromEntries(
  TASKS.map((t) => [t.id, t]),
);

/** Cleaning tasks whose completion can uncover a forgotten item. */
export const FIND_ITEM_TASKS: Record<string, string> = {
  'clean-bedroom-1': 'pack-bag-1',
  'clean-bedroom-2': 'pack-bag-2',
  'clean-bedroom-3': 'pack-bag-3',
  'clean-living-room': 'any',
};

// ---------------------------------------------------------------------------
// Chaos-event tuning (all times drawn at init)

/** Un-nudged interruptions (calls, distractions, doorbell) self-resolve after
 * at most this long — nudging is a shortcut, never the only way back to work. */
export const INTERRUPT_MAX_TICKS = 5 * 60;

export const EVENT_TUNING = {
  kenjiPhone: { firstMin: [8, 14], gapMin: [10, 14], durationMin: [3, 5], count: 6 },
  meiDistraction: { firstMin: [5, 10], gapMin: [8, 12], maxDurationMin: 8, count: 8 },
  /** `imodiumSkipChance`: per-emergency odds it is headed off once Taro has
   * been to the pharmacy. Deliberately below 1 — buying it early is strong but
   * never a guaranteed shutdown of the mechanic. */
  taroToilet: {
    windowMin: [15, 100],
    durationMin: 4,
    count: [2, 3],
    imodiumSkipChance: 0.75,
  },
  /** The neighbor rings; whoever answers is stuck chatting until nudged. */
  doorbell: { windowMin: [12, 95], durationMin: [3, 4], count: [1, 2] },
  /** A cat wanders in; if the living room was already clean, it un-cleans a bit. */
  cat: { windowMin: [20, 105], count: 1 },
  /** Cooking spill: extra dishes for tidy-kitchen (only while it still matters). */
  spill: { windowMin: [10, 55], count: 1 },
  /** Someone puts the road-trip playlist on: short whole-team boost. */
  music: { windowMin: [25, 90], durationMin: 6, count: 1 },
  flavor: {
    count: [2, 3],
    windowMin: [10, 110],
    textKeys: ['flavor-wifi', 'flavor-selfie', 'flavor-keys'],
  },
} as const;
