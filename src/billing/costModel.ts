// What a session costs on Firebase Blaze.
//
// There is no billing API to ask, so this is a model, not a bill. It is built
// out of two things that are actually known: the document counts `usageStats`
// measured, and the write cadence in `state/cadence.ts` that this app provably
// uses. Every line item below says which of those it came from, so a number
// that looks wrong can be argued with rather than just believed.
//
// The one result worth knowing before reading any of it: reads dominate, and
// they grow with the SQUARE of the class size. Every progress write by one
// student is delivered to every other student's leaderboard listener, so a
// class of N costs roughly N² reads. Writes grow linearly and are nearly free.
//
// Deliberately NOT modelled (all sit far inside the always-free tier at
// classroom scale, and guessing at them would only add fake precision):
// Hosting bandwidth, Cloud Functions CPU/memory seconds, network egress, and
// Authentication — anonymous and email/password sign-in are free at any volume
// this project will ever see.

import {
  CHECKPOINT_INTERVAL_MS,
  PROGRESS_INTERVAL_MS,
  runWindowMsFor,
} from '../state/cadence';

/**
 * Google's published Firestore prices, in USD.
 *
 * Which set applies depends on where the database was created, and that is not
 * something the app can read back — so it is a setting on this screen rather
 * than a constant. Multi-region is the default the Firebase console offers for
 * a US project and is the dearer of the two, so it is also the default here:
 * an estimate that errs should err upwards.
 *
 * Source: https://firebase.google.com/docs/firestore/pricing
 */
export interface Pricing {
  id: 'multi-region' | 'regional';
  label: string;
  /** USD per 100,000 document reads. */
  readPer100k: number;
  writePer100k: number;
  deletePer100k: number;
  /** USD per GiB per month. */
  storagePerGiBMonth: number;
  /** USD per million Cloud Functions invocations, past the free 2M. */
  invocationPerMillion: number;
}

export const PRICING: Record<Pricing['id'], Pricing> = {
  'multi-region': {
    id: 'multi-region',
    label: 'Multi-region (nam5 / eur3)',
    readPer100k: 0.06,
    writePer100k: 0.18,
    deletePer100k: 0.02,
    storagePerGiBMonth: 0.18,
    invocationPerMillion: 0.4,
  },
  regional: {
    id: 'regional',
    label: 'Single region (us-central1 and friends)',
    readPer100k: 0.03,
    writePer100k: 0.09,
    deletePer100k: 0.01,
    storagePerGiBMonth: 0.15,
    invocationPerMillion: 0.4,
  },
};

/**
 * The always-free allowance. Firestore's resets every day, which is why the
 * estimator groups usage by the day it happened instead of totalling the month:
 * one big class on one day can go over while the same classes spread across a
 * week stay entirely free, and averaging would hide that completely.
 */
export const FREE_TIER = {
  readsPerDay: 50_000,
  writesPerDay: 20_000,
  deletesPerDay: 20_000,
  storageGiB: 1,
  invocationsPerMonth: 2_000_000,
} as const;

const BYTES_PER_GIB = 1024 ** 3;

/**
 * Measured document sizes, in bytes.
 *
 * The checkpoint figure is not a guess: a seeded 120-minute run serialised to
 * 6.7 KB at the start and 9.9 KB at the deadline, growing as the event log
 * fills, so the deadline figure is the one that matters for storage. The result
 * blob measured 2.6 KB. The three small docs are rounded up from their fields.
 */
export const DOC_BYTES = {
  session: 700,
  player: 400,
  nameTicket: 200,
  checkpoint: 10_000,
  result: 2_600,
} as const;

/** Instructor-driven session-doc writes: stage transitions plus the ending. */
const STAGE_WRITES = { single: 2, 'two-run': 4 } as const;

/** One session, as far as the cost model is concerned. */
export interface SessionUsage {
  players: number;
  /** 0 when the room was created but never actually run. */
  runsPlayed: 0 | 1 | 2;
  format: 'single' | 'two-run';
  simDeadlineMin: number;
  compression: number;
}

export type Unit = 'read' | 'write' | 'delete' | 'invocation' | 'GiB-month';

export interface Ops {
  reads: number;
  writes: number;
  deletes: number;
  invocations: number;
  storageBytes: number;
}

export const ZERO_OPS: Ops = {
  reads: 0,
  writes: 0,
  deletes: 0,
  invocations: 0,
  storageBytes: 0,
};

export function addOps(a: Ops, b: Ops): Ops {
  return {
    reads: a.reads + b.reads,
    writes: a.writes + b.writes,
    deletes: a.deletes + b.deletes,
    invocations: a.invocations + b.invocations,
    storageBytes: a.storageBytes + b.storageBytes,
  };
}

/** One row of the "where the money goes" breakdown. */
export interface CostLine {
  key: string;
  label: string;
  unit: Unit;
  units: number;
  /** Priced at list, before any free-tier allowance. */
  usd: number;
  why: string;
}

/**
 * Ops for one session, itemised.
 *
 * A session that never ran still costs something — the room existed, students
 * joined a lobby — so `runsPlayed: 0` is a real case, not an early return.
 */
export function sessionLines(s: SessionUsage): CostLine[] {
  const p = Math.max(0, s.players);
  const runs = s.runsPlayed;
  // Every student's leaderboard listener, plus the instructor's monitor. This
  // is the multiplier that makes reads quadratic.
  const listeners = p + 1;
  // Joins trickle in, so on average only half the room is listening when each
  // one lands. Using the full count here would roughly double a number that is
  // already a rounding error next to the in-run fan-out.
  const joinListeners = listeners / 2;

  const windowSec = runWindowMsFor(s.simDeadlineMin, s.compression) / 1000;
  const progressPerPlayer =
    Math.floor(windowSec / (PROGRESS_INTERVAL_MS / 1000)) + 1;
  const checkpointPerPlayer =
    Math.floor(windowSec / (CHECKPOINT_INTERVAL_MS / 1000)) + 1;
  const stageWrites = STAGE_WRITES[s.format];

  // --- writes ---
  const joinWrites = p * 3; // player doc, name ticket, playerCount bump
  const readyWrites = p * 2; // ready flag, readyCount bump
  const progressWrites = p * progressPerPlayer * runs;
  const checkpointWrites = p * checkpointPerPlayer * runs;
  const resultWrites = p * runs;

  // --- reads ---
  //
  // Only writes to the player DOCUMENT fan out; checkpoints and results live in
  // `private/` subcollections nobody else watches, which is exactly why they
  // are cheap. The room fills before it plays, so the creates are delivered to
  // a half-full room and everything after to a full one.
  const attachReads = p * listeners;
  const fanOutReads =
    p * joinListeners + (p /* ready flags */ + progressWrites) * listeners;
  const sessionDocReads =
    p * joinListeners + (p + stageWrites) * listeners + listeners;
  const debriefReads = p * runs;

  // --- deletes, at the 30-day purge ---
  const deletes = p * 2 + p * 2 * runs + 2;

  // --- invocations ---
  const invocations = 1 + p * 2 + stageWrites;

  // --- storage ---
  const storageBytes =
    DOC_BYTES.session +
    p * (DOC_BYTES.player + DOC_BYTES.nameTicket) +
    p * runs * (DOC_BYTES.checkpoint + DOC_BYTES.result);

  return [
    {
      key: 'fanout',
      label: 'Leaderboard fan-out',
      unit: 'read',
      units: fanOutReads,
      usd: 0,
      why:
        `Each of ${p} students writes progress every ` +
        `${PROGRESS_INTERVAL_MS / 1000}s, and every write is delivered to all ` +
        `${listeners} listeners. This is the quadratic term and almost always ` +
        'the whole bill.',
    },
    {
      key: 'attach',
      label: 'Roster loads',
      unit: 'read',
      units: attachReads,
      usd: 0,
      why: `${listeners} listeners each read the ${p}-player roster once on attach.`,
    },
    {
      key: 'sessiondoc',
      label: 'Session-doc updates',
      unit: 'read',
      units: sessionDocReads,
      usd: 0,
      why:
        'Join counters and stage transitions, delivered to every client ' +
        'watching the session document.',
    },
    {
      key: 'debrief',
      label: 'Debrief loads',
      unit: 'read',
      units: debriefReads,
      usd: 0,
      why: 'Each student reads back their own saved result once per run.',
    },
    {
      key: 'progress',
      label: 'Progress writes',
      unit: 'write',
      units: progressWrites,
      usd: 0,
      why: `${progressPerPlayer} per student per run, over a ${Math.round(
        windowSec / 60,
      )}-minute run.`,
    },
    {
      key: 'checkpoint',
      label: 'Checkpoint saves',
      unit: 'write',
      units: checkpointWrites,
      usd: 0,
      why: `${checkpointPerPlayer} per student per run, so a refresh mid-run loses nothing.`,
    },
    {
      key: 'join',
      label: 'Joins and ready flags',
      unit: 'write',
      units: joinWrites + readyWrites,
      usd: 0,
      why: 'Player doc, name ticket, and the two counters on the session doc.',
    },
    {
      key: 'result',
      label: 'Result saves',
      unit: 'write',
      units: resultWrites + stageWrites,
      usd: 0,
      why: 'One result blob per student per run, plus the stage transitions.',
    },
    {
      key: 'purge',
      label: 'Nightly purge',
      unit: 'delete',
      units: deletes,
      usd: 0,
      why: 'Everything above, deleted once the session passes the retention window.',
    },
    {
      key: 'invocations',
      label: 'Function calls',
      unit: 'invocation',
      units: invocations,
      usd: 0,
      why: 'createSession, one join and one ready per student, plus stage control.',
    },
    {
      key: 'storage',
      label: 'Stored data',
      unit: 'GiB-month',
      units: storageBytes / BYTES_PER_GIB,
      usd: 0,
      why: `${Math.round(storageBytes / 1024)} KiB held until the purge — ` +
        'checkpoints are ~10 KiB each and dominate.',
    },
  ];
}

/** Roll a session's line items up into plain op counts. */
export function sessionOps(s: SessionUsage): Ops {
  const ops = { ...ZERO_OPS };
  for (const line of sessionLines(s)) {
    if (line.unit === 'read') ops.reads += line.units;
    else if (line.unit === 'write') ops.writes += line.units;
    else if (line.unit === 'delete') ops.deletes += line.units;
    else if (line.unit === 'invocation') ops.invocations += line.units;
    else ops.storageBytes += line.units * BYTES_PER_GIB;
  }
  return ops;
}

/** List price for a bundle of ops, with no free tier applied. */
export function grossUsd(ops: Ops, pricing: Pricing): number {
  return (
    (ops.reads / 100_000) * pricing.readPer100k +
    (ops.writes / 100_000) * pricing.writePer100k +
    (ops.deletes / 100_000) * pricing.deletePer100k +
    (ops.invocations / 1_000_000) * pricing.invocationPerMillion +
    (ops.storageBytes / BYTES_PER_GIB) * pricing.storagePerGiBMonth
  );
}

export function priceLines(lines: CostLine[], pricing: Pricing): CostLine[] {
  return lines.map((l) => ({
    ...l,
    usd:
      l.unit === 'read'
        ? (l.units / 100_000) * pricing.readPer100k
        : l.unit === 'write'
          ? (l.units / 100_000) * pricing.writePer100k
          : l.unit === 'delete'
            ? (l.units / 100_000) * pricing.deletePer100k
            : l.unit === 'invocation'
              ? (l.units / 1_000_000) * pricing.invocationPerMillion
              : l.units * pricing.storagePerGiBMonth,
  }));
}

/** A session plus the day it happened, which is what the free tier turns on. */
export interface DatedSession extends SessionUsage {
  /** Session creation time. Sessions with no timestamp are billed as one day. */
  dayKey: string;
}

export interface Estimate {
  ops: Ops;
  /** List price, ignoring the free tier. The fair way to attribute a share. */
  grossUsd: number;
  /** What actually reaches the invoice once the free tier is applied. */
  netUsd: number;
  /** Days on which usage went past a free-tier ceiling. */
  billableDays: number;
  /** Total days that saw any activity at all. */
  activeDays: number;
}

/**
 * Price a set of sessions.
 *
 * The free tier resets daily, so usage is bucketed by the day each session ran
 * and each ceiling is applied within its own day. Sessions with no creation
 * timestamp fall into one shared bucket — that overstates their overlap, which
 * is the safe direction.
 */
export function estimate(sessions: DatedSession[], pricing: Pricing): Estimate {
  const byDay = new Map<string, Ops>();
  let total = { ...ZERO_OPS };

  for (const s of sessions) {
    const ops = sessionOps(s);
    total = addOps(total, ops);
    byDay.set(s.dayKey, addOps(byDay.get(s.dayKey) ?? ZERO_OPS, ops));
  }

  let billableReads = 0;
  let billableWrites = 0;
  let billableDeletes = 0;
  let billableDays = 0;

  for (const day of byDay.values()) {
    const r = Math.max(0, day.reads - FREE_TIER.readsPerDay);
    const w = Math.max(0, day.writes - FREE_TIER.writesPerDay);
    const d = Math.max(0, day.deletes - FREE_TIER.deletesPerDay);
    if (r + w + d > 0) billableDays++;
    billableReads += r;
    billableWrites += w;
    billableDeletes += d;
  }

  const billableStorage = Math.max(
    0,
    total.storageBytes - FREE_TIER.storageGiB * BYTES_PER_GIB,
  );
  const billableInvocations = Math.max(
    0,
    total.invocations - FREE_TIER.invocationsPerMonth,
  );

  return {
    ops: total,
    grossUsd: grossUsd(total, pricing),
    netUsd: grossUsd(
      {
        reads: billableReads,
        writes: billableWrites,
        deletes: billableDeletes,
        invocations: billableInvocations,
        storageBytes: billableStorage,
      },
      pricing,
    ),
    billableDays,
    activeDays: byDay.size,
  };
}

/** Local calendar day of a timestamp — the bucket the free tier resets on. */
export function dayKeyOf(ms: number | null): string {
  if (ms == null) return 'undated';
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

/** Money, at the scale this project actually produces. */
export function formatUsd(usd: number): string {
  if (usd === 0) return '$0.00';
  if (usd < 0.01) return '<$0.01';
  return `$${usd.toFixed(2)}`;
}

// --- archived sessions ----------------------------------------------------

/**
 * Session shapes recovered from the lifetime archive: one count per distinct
 * `players|runs|format|deadlineMin|compression` key.
 *
 * The archive stores shapes rather than prices on purpose. A dollar figure
 * written at purge time would freeze whatever this model said that night, and
 * then sit next to live sessions priced by a newer one — two numbers in the
 * same column that no longer mean the same thing. Shapes re-price cleanly.
 */
export type ArchivedShapes = Record<string, number>;

/**
 * The day bucket archived sessions are billed under.
 *
 * They deliberately do NOT join the live per-day buckets: a purged session's
 * real date is gone, so pretending to know which day's free-tier allowance it
 * consumed would invent an answer. Archived usage is only ever reported at list
 * price, which is what the per-instructor column already shows.
 */
export const ARCHIVED_DAY_KEY = 'archived';

/** Turn an archive histogram back into sessions the model can price. */
export function expandArchive(sizes: ArchivedShapes): DatedSession[] {
  const out: DatedSession[] = [];

  for (const [key, count] of Object.entries(sizes)) {
    if (!Number.isFinite(count) || count <= 0) continue;
    const [players, runs, format, deadline, compression] = key.split('|');

    const p = Number(players);
    const r = Number(runs);
    const d = Number(deadline);
    const c = Number(compression);
    // A key this malformed came from a schema that no longer exists. Skipping
    // it undercounts by one shape; guessing at it would corrupt every total it
    // touches, and there is nothing here worth that risk.
    if (!Number.isFinite(p) || p < 0) continue;
    if (r !== 0 && r !== 1 && r !== 2) continue;

    const session: DatedSession = {
      players: p,
      runsPlayed: r,
      format: format === 'two-run' ? 'two-run' : 'single',
      simDeadlineMin: Number.isFinite(d) && d > 0 ? d : 120,
      compression: Number.isFinite(c) && c > 0 ? c : 8,
      dayKey: ARCHIVED_DAY_KEY,
    };
    for (let i = 0; i < Math.floor(count); i++) out.push(session);
  }

  return out;
}

/** How many sessions an archive histogram represents. */
export function archivedSessionCount(sizes: ArchivedShapes): number {
  return Object.values(sizes).reduce(
    (n, c) => n + (Number.isFinite(c) && c > 0 ? Math.floor(c) : 0),
    0,
  );
}
