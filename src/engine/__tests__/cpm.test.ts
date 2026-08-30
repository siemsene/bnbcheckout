// Critical-path analysis. The critical path is a teaching claim as much as a
// computation — the debrief says "breakfast was always the bottleneck" — so it
// is pinned here and any content change that moves it has to be deliberate.

import { describe, expect, it } from 'vitest';
import { computeCpm, packRows } from '../cpm';
import { TASKS, TASK_BY_ID } from '../content';
import type { TaskDef } from '../types';

describe('computeCpm', () => {
  const cpm = computeCpm();

  it('finds the breakfast chain, and it is 76 minutes long', () => {
    // make-breakfast 25 -> eat-breakfast 15 -> tidy-kitchen 20 -> garbage 8
    //   -> final-walkthrough 8.
    // The bag/load chain is 35 and the bedroom chain 33, so breakfast dominates
    // by a wide margin. This is precisely the end-game convergence a playtester
    // felt but could not see coming.
    expect(cpm.criticalPath).toEqual([
      'make-breakfast',
      'eat-breakfast',
      'tidy-kitchen',
      'garbage',
      'final-walkthrough',
    ]);
    expect(cpm.projectDuration).toBe(76);
  });

  it('ends at the terminal task', () => {
    const last = cpm.criticalPath[cpm.criticalPath.length - 1];
    expect(cpm.nodes[last].ef).toBe(cpm.projectDuration);
  });

  it('gives every task non-negative float, zero exactly on the critical path', () => {
    for (const t of TASKS) {
      const n = cpm.nodes[t.id];
      expect(n.slack).toBeGreaterThanOrEqual(0);
      expect(n.critical).toBe(cpm.criticalPath.includes(t.id) || n.slack === 0);
    }
  });

  it('never starts a task before its hard predecessors finish', () => {
    for (const t of TASKS) {
      for (const p of t.preds ?? []) {
        expect(cpm.nodes[t.id].es).toBeGreaterThanOrEqual(cpm.nodes[p].ef);
      }
    }
  });

  it('leaves the personal errands with plenty of float', () => {
    // They exist to be slotted into gaps, which is exactly what large float means.
    for (const id of ['call-mom', 'buy-imodium', 'guest-book']) {
      expect(cpm.nodes[id].slack).toBeGreaterThan(30);
    }
  });

  it('treats predsAny as waiting only for the first of the group', () => {
    const fake: TaskDef[] = [
      { ...TASK_BY_ID['call-mom'], id: 'a', baseMinutes: 5, preds: [], predsAny: [], onlyChars: undefined },
      { ...TASK_BY_ID['call-mom'], id: 'b', baseMinutes: 20, preds: [], predsAny: [], onlyChars: undefined },
      { ...TASK_BY_ID['call-mom'], id: 'c', baseMinutes: 3, preds: [], predsAny: ['a', 'b'], onlyChars: undefined },
    ];
    const r = computeCpm(fake);
    expect(r.nodes.c.es).toBe(5); // the shorter of the two, not the longer
  });

  it('throws on a cycle rather than returning nonsense', () => {
    const cyclic: TaskDef[] = [
      { ...TASK_BY_ID['call-mom'], id: 'x', preds: ['y'], predsAny: [] },
      { ...TASK_BY_ID['call-mom'], id: 'y', preds: ['x'], predsAny: [] },
    ];
    expect(() => computeCpm(cyclic)).toThrow(/cycle/i);
  });
});

describe('packRows', () => {
  const cpm = computeCpm();
  const rows = packRows(cpm);

  it('puts the whole critical path on the top row', () => {
    for (const id of cpm.criticalPath) expect(rows[id]).toBe(0);
  });

  it('places every task in a diagram that fits on a screen', () => {
    expect(Object.keys(rows)).toHaveLength(TASKS.length);
    const used = new Set(Object.values(rows));
    // 13 tasks have no predecessors and so all start at minute 0; they cannot
    // share a row, which makes 13 the floor for any time-scaled layout. At ~30px
    // a row that is a shade under 400px — comfortable inside the results card.
    expect(used.size).toBeLessThanOrEqual(14);
    expect(used.size).toBeLessThan(TASKS.length);
  });

  it('never overlaps two tasks in one row', () => {
    const byRow = new Map<number, string[]>();
    for (const [id, r] of Object.entries(rows)) {
      byRow.set(r, [...(byRow.get(r) ?? []), id]);
    }
    for (const [r, ids] of byRow) {
      if (r === 0) continue; // the critical chain is contiguous by construction
      const sorted = ids.sort((a, b) => cpm.nodes[a].es - cpm.nodes[b].es);
      for (let i = 1; i < sorted.length; i++) {
        expect(cpm.nodes[sorted[i]].es).toBeGreaterThanOrEqual(cpm.nodes[sorted[i - 1]].ef);
      }
    }
  });
});
