import { describe, expect, it } from 'vitest';
import {
  ARCHIVED_DAY_KEY,
  FREE_TIER,
  PRICING,
  archivedSessionCount,
  estimate,
  dayKeyOf,
  expandArchive,
  formatUsd,
  grossUsd,
  sessionLines,
  sessionOps,
  type DatedSession,
  type SessionUsage,
} from '../costModel';

const CLASS_OF_30: SessionUsage = {
  players: 30,
  runsPlayed: 1,
  format: 'single',
  simDeadlineMin: 120,
  compression: 8,
};

const dated = (s: SessionUsage, dayKey: string): DatedSession => ({ ...s, dayKey });

describe('sessionLines', () => {
  it('derives the write counts from the real cadence, not a guess', () => {
    const lines = sessionLines(CLASS_OF_30);
    const by = (k: string) => lines.find((l) => l.key === k)!;

    // A 120-minute run at 8x is 900 real seconds: 90 progress intervals plus
    // the write at t=0, and 15 checkpoint intervals plus the one at t=0.
    expect(by('progress').units).toBe(30 * 91);
    expect(by('checkpoint').units).toBe(30 * 16);
    expect(by('result').units).toBe(30 * 1 + 2);
  });

  it('makes reads the dominant cost', () => {
    const ops = sessionOps(CLASS_OF_30);
    expect(ops.reads).toBeGreaterThan(ops.writes * 10);
  });

  it('grows reads quadratically and writes linearly with class size', () => {
    const small = sessionOps({ ...CLASS_OF_30, players: 10 });
    const big = sessionOps({ ...CLASS_OF_30, players: 100 });

    // Ten times the students: ten times the writes, a hundred times the reads.
    // This is the single fact the whole screen exists to surface.
    expect(big.writes / small.writes).toBeCloseTo(10, 0);
    expect(big.reads / small.reads).toBeGreaterThan(50);
  });

  it('charges a session that was created but never run', () => {
    const ops = sessionOps({ ...CLASS_OF_30, runsPlayed: 0 });
    expect(ops.writes).toBeGreaterThan(0);
    // No run means no progress writes and no checkpoints to store.
    expect(ops.storageBytes).toBeLessThan(sessionOps(CLASS_OF_30).storageBytes);
  });

  it('bills a two-run session for both runs', () => {
    const two = sessionOps({ ...CLASS_OF_30, runsPlayed: 2, format: 'two-run' });
    const one = sessionOps(CLASS_OF_30);
    expect(two.reads).toBeGreaterThan(one.reads * 1.8);
  });

  it('is empty-but-valid for a session nobody joined', () => {
    const ops = sessionOps({ ...CLASS_OF_30, players: 0, runsPlayed: 0 });
    expect(ops.reads).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(ops.storageBytes)).toBe(true);
  });
});

describe('estimate', () => {
  it('a single classroom-sized session costs cents, not dollars', () => {
    const e = estimate([dated(CLASS_OF_30, '2026-08-31')], PRICING['multi-region']);
    expect(e.netUsd).toBeLessThan(0.1);
    expect(e.grossUsd).toBeLessThan(0.1);
  });

  it('applies the free tier per day, so spreading classes out is cheaper', () => {
    const sameDay = estimate(
      [dated(CLASS_OF_30, '2026-08-31'), dated(CLASS_OF_30, '2026-08-31')],
      PRICING['multi-region'],
    );
    const spread = estimate(
      [dated(CLASS_OF_30, '2026-08-31'), dated(CLASS_OF_30, '2026-09-01')],
      PRICING['multi-region'],
    );

    // Identical raw usage either way — only the daily allowance differs.
    expect(spread.ops.reads).toBe(sameDay.ops.reads);
    expect(spread.netUsd).toBeLessThan(sameDay.netUsd);
    expect(spread.activeDays).toBe(2);
  });

  it('leaves a small class entirely inside the free tier', () => {
    const tiny = { ...CLASS_OF_30, players: 6 };
    const e = estimate([dated(tiny, '2026-08-31')], PRICING['multi-region']);
    expect(sessionOps(tiny).reads).toBeLessThan(FREE_TIER.readsPerDay);
    expect(e.netUsd).toBe(0);
    expect(e.billableDays).toBe(0);
    // The list price is still real; only the allowance hides it.
    expect(e.grossUsd).toBeGreaterThan(0);
  });

  it('prices multi-region above single region', () => {
    const s = [dated({ ...CLASS_OF_30, players: 120 }, '2026-08-31')];
    expect(estimate(s, PRICING['multi-region']).netUsd).toBeGreaterThan(
      estimate(s, PRICING.regional).netUsd,
    );
  });

  it('costs nothing when nothing happened', () => {
    const e = estimate([], PRICING['multi-region']);
    expect(e.netUsd).toBe(0);
    expect(e.grossUsd).toBe(0);
    expect(e.activeDays).toBe(0);
  });
});

describe('formatting', () => {
  it('does not round a real charge down to nothing', () => {
    expect(formatUsd(0)).toBe('$0.00');
    expect(formatUsd(0.0004)).toBe('<$0.01');
    expect(formatUsd(1.239)).toBe('$1.24');
  });

  it('buckets undated sessions rather than dropping them', () => {
    expect(dayKeyOf(null)).toBe('undated');
    expect(dayKeyOf(Date.UTC(2026, 7, 31, 12))).toMatch(/^2026-0[89]-\d\d$/);
  });
});

describe('expandArchive', () => {
  it('re-prices a purged session exactly as if it were still live', () => {
    const live: DatedSession = {
      players: 24,
      runsPlayed: 2,
      format: 'two-run',
      simDeadlineMin: 120,
      compression: 8,
      dayKey: '2026-08-31',
    };
    const archived = expandArchive({ '24|2|two-run|120|8': 1 });

    expect(archived).toHaveLength(1);
    // Same shape in, same ops out — that equality is the whole point of storing
    // shapes rather than a frozen dollar figure.
    expect(sessionOps(archived[0])).toEqual(sessionOps(live));
  });

  it('keeps archived usage out of the live free-tier day buckets', () => {
    const archived = expandArchive({ '30|1|single|120|8': 1 });
    expect(archived[0].dayKey).toBe(ARCHIVED_DAY_KEY);

    const mixed = estimate(
      [...archived, { ...archived[0], dayKey: '2026-08-31' }],
      PRICING['multi-region'],
    );
    // Two days, so the allowance applies twice — an archived session must never
    // silently eat a live day's free reads.
    expect(mixed.activeDays).toBe(2);
  });

  it('expands a repeated shape into that many sessions', () => {
    const sizes = { '10|1|single|120|8': 3, '40|2|two-run|120|8': 2 };
    const rows = expandArchive(sizes);

    expect(rows).toHaveLength(5);
    expect(archivedSessionCount(sizes)).toBe(5);
    expect(rows.filter((r) => r.players === 40)).toHaveLength(2);
  });

  it('adds up: ten archived classes cost ten times one', () => {
    const one = grossUsd(sessionOps(expandArchive({ '30|1|single|120|8': 1 })[0]), PRICING.regional);
    const ten = estimate(expandArchive({ '30|1|single|120|8': 10 }), PRICING.regional);
    expect(ten.grossUsd).toBeCloseTo(one * 10, 6);
  });

  it('drops keys it cannot trust rather than guessing at them', () => {
    expect(expandArchive({ 'garbage': 1 })).toHaveLength(0);
    expect(expandArchive({ '30|9|single|120|8': 1 })).toHaveLength(0);
    expect(expandArchive({ '30|1|single|120|8': 0 })).toHaveLength(0);
    expect(expandArchive({})).toHaveLength(0);
  });

  it('falls back to the standard run length when a key omits it', () => {
    const [row] = expandArchive({ '30|1|single||': 1 });
    expect(row.simDeadlineMin).toBe(120);
    expect(row.compression).toBe(8);
  });
});
