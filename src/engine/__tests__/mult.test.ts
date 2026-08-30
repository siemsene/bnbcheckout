// The productivity breakdown must BE the calculation, not a description of it.
// `personalMult` is defined as the product of `explainMult`'s terms, so these
// tests pin that identity and the zero/blocked distinction.

import { describe, expect, it } from 'vitest';
import { createRun } from '../init';
import { explainMult, personalMult, step } from '../step';
import { CHAR_IDS, TASKS } from '../content';
import type { Action, CharId, SimState } from '../types';

/** Spread everyone over whatever is open, so many term combinations occur. */
function spread(s: SimState): Action[] {
  const actions: Action[] = [];
  const open = TASKS.filter((t) => s.tasks[t.id].status === 'open');
  let i = 0;
  for (const c of CHAR_IDS) {
    if (s.chars[c].taskId) continue;
    const t = open[i++ % Math.max(1, open.length)];
    if (!t) break;
    if (s.tasks[t.id].assignees.length < t.maxWorkers) {
      actions.push({ type: 'assign', charId: c, taskId: t.id });
    }
  }
  return actions;
}

describe('explainMult', () => {
  it('is exactly the product of its own terms, every tick of a real run', () => {
    let checked = 0;
    let withTerms = 0;
    for (const seed of [3, 42, 999]) {
      const s = createRun(seed);
      for (let i = 0; i < 4000; i++) {
        step(s, i % 40 === 0 ? spread(s) : []);
        if (s.outcome !== 'running') break;
        if (i % 7 !== 0) continue;
        for (const c of CHAR_IDS) {
          const e = explainMult(s, c);
          const m = personalMult(s, c);
          if (e === null) {
            expect(m).toBeNull();
            continue;
          }
          checked++;
          if ('blocked' in e) {
            expect(m).toBe(0);
          } else {
            let product = 1;
            for (const t of e.terms) product *= t.factor;
            // Bit-identical, not approximate: same factors, same order.
            expect(e.value).toBe(product);
            expect(m).toBe(product);
            if (e.terms.length > 0) withTerms++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(500);
    expect(withTerms).toBeGreaterThan(50); // the run really did exercise terms
  });

  it('never emits a term with a factor of exactly 1 (they are noise)', () => {
    const s = createRun(7);
    for (let i = 0; i < 2000; i++) {
      step(s, i % 40 === 0 ? spread(s) : []);
      if (s.outcome !== 'running') break;
      for (const c of CHAR_IDS) {
        const e = explainMult(s, c);
        if (e && !('blocked' in e)) {
          for (const t of e.terms) expect(t.factor).not.toBe(1);
        }
      }
    }
  });

  it('distinguishes why someone is producing nothing', () => {
    const s = createRun(11);
    // Sora has no licence, so fetching a car is a hard zero with a reason.
    step(s, [{ type: 'assign', charId: 'sora' as CharId, taskId: 'fetch-car-a' }]);
    const e = explainMult(s, 'sora' as CharId);
    expect(e).toEqual({ blocked: 'no-licence' });
    expect(personalMult(s, 'sora' as CharId)).toBe(0);
  });

  it('reports a walking character as walking, not as zero skill', () => {
    const s = createRun(12);
    step(s, [{ type: 'assign', charId: 'hana' as CharId, taskId: 'clean-bathroom' }]);
    step(s); // still in transit
    expect(explainMult(s, 'hana' as CharId)).toEqual({ blocked: 'walking' });
  });

  it('names the learning ramp while it is climbing, and drops it once full', () => {
    const s = createRun(5);
    step(s, [{ type: 'assign', charId: 'hana' as CharId, taskId: 'clean-bathroom' }]);
    for (let i = 0; i < 40; i++) step(s); // arrive, then work a little
    const early = explainMult(s, 'hana' as CharId);
    expect(early && 'terms' in early).toBe(true);
    if (early && 'terms' in early) {
      const ramp = early.terms.find((t) => t.key === 'learning');
      expect(ramp).toBeDefined();
      expect(ramp!.factor).toBeLessThan(1);
      expect(ramp!.hint).toMatch(/full speed in \d+ min/);
    }

    for (let i = 0; i < 300; i++) step(s);
    const late = explainMult(s, 'hana' as CharId);
    if (late && 'terms' in late) {
      // Fully ramped is a factor of exactly 1, so the term disappears.
      expect(late.terms.find((t) => t.key === 'learning')).toBeUndefined();
    }
  });
});
