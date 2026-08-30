// Critical-path analysis over the task DAG.
//
// Durations are each task's published `baseMinutes` — the "~25′" printed on its
// card — at one person, nominal pace. That is deliberately NOT the same thing as
// the simulation's answer: CPM knows nothing about who is free, how many hands a
// task can take, the learning ramp, or walking between rooms. The gap between
// this number and `projectPlan`'s is the lesson about resource levelling, so the
// UI should show both and say why they differ rather than hiding one.

import { TASKS } from './content';
import type { TaskDef } from './types';

export interface CpmNode {
  id: string;
  dur: number;
  /** Earliest start / finish. */
  es: number;
  ef: number;
  /** Latest start / finish without delaying the project. */
  ls: number;
  lf: number;
  slack: number;
  critical: boolean;
}

export interface CpmResult {
  nodes: Record<string, CpmNode>;
  edges: [string, string][];
  /** The critical chain, in order, ending at the terminal task. */
  criticalPath: string[];
  /** Project length in sim-minutes at nominal durations. */
  projectDuration: number;
}

/** Kahn topological order. Throws on a cycle — that is a content bug, not input. */
function topoOrder(tasks: TaskDef[]): string[] {
  const indeg = new Map<string, number>();
  const succ = new Map<string, string[]>();
  for (const t of tasks) {
    indeg.set(t.id, 0);
    succ.set(t.id, []);
  }
  for (const t of tasks) {
    for (const p of allPreds(t)) {
      indeg.set(t.id, (indeg.get(t.id) ?? 0) + 1);
      succ.get(p)!.push(t.id);
    }
  }
  const queue = tasks.filter((t) => (indeg.get(t.id) ?? 0) === 0).map((t) => t.id);
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const s of succ.get(id) ?? []) {
      const d = (indeg.get(s) ?? 0) - 1;
      indeg.set(s, d);
      if (d === 0) queue.push(s);
    }
  }
  if (order.length !== tasks.length) {
    throw new Error('Task graph contains a cycle');
  }
  return order;
}

const allPreds = (t: TaskDef): string[] => [...(t.preds ?? []), ...(t.predsAny ?? [])];

export function computeCpm(tasks: TaskDef[] = TASKS): CpmResult {
  // Resolve definitions from the argument, never the global table: callers pass
  // synthetic graphs (tests, and any future what-if view) and silently reading
  // the real scenario instead would make those answers quietly wrong.
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const def_ = (id: string) => byId.get(id)!;
  const order = topoOrder(tasks);
  const nodes: Record<string, CpmNode> = {};
  for (const t of tasks) {
    nodes[t.id] = {
      id: t.id,
      dur: t.baseMinutes,
      es: 0,
      ef: 0,
      ls: 0,
      lf: 0,
      slack: 0,
      critical: false,
    };
  }

  // Forward pass. `preds` are conjunctive (wait for the last), `predsAny` is
  // disjunctive (wait only for the first). Nothing in the scenario uses
  // predsAny today, but handling it costs six lines and stops the diagram
  // quietly lying if the content ever changes.
  for (const id of order) {
    const def = def_(id);
    let es = 0;
    for (const p of def.preds ?? []) es = Math.max(es, nodes[p].ef);
    if (def.predsAny?.length) {
      const first = Math.min(...def.predsAny.map((p) => nodes[p].ef));
      es = Math.max(es, first);
    }
    nodes[id].es = es;
    nodes[id].ef = es + nodes[id].dur;
  }

  const projectDuration = Math.max(...Object.values(nodes).map((n) => n.ef));

  // Backward pass.
  for (const n of Object.values(nodes)) n.lf = projectDuration;
  for (const id of [...order].reverse()) {
    const n = nodes[id];
    n.ls = n.lf - n.dur;
    const def = def_(id);
    for (const p of def.preds ?? []) {
      nodes[p].lf = Math.min(nodes[p].lf, n.ls);
    }
    if (def.predsAny?.length) {
      // Only the member the successor actually waits on is constrained; the
      // others are genuinely free to run late.
      const gate = def.predsAny.reduce((a, b) => (nodes[a].ef <= nodes[b].ef ? a : b));
      nodes[gate].lf = Math.min(nodes[gate].lf, n.ls);
    }
  }
  for (const n of Object.values(nodes)) {
    n.ls = n.lf - n.dur;
    n.slack = n.ls - n.es;
    n.critical = n.slack === 0;
  }

  const edges: [string, string][] = [];
  for (const t of tasks) for (const p of allPreds(t)) edges.push([p, t.id]);

  // Walk the critical chain back from the task that ends the project.
  const terminal = Object.values(nodes)
    .filter((n) => n.ef === projectDuration)
    .sort((a, b) => a.id.localeCompare(b.id))[0];
  const criticalPath: string[] = [];
  let cur: CpmNode | undefined = terminal;
  const guard = new Set<string>();
  while (cur && !guard.has(cur.id)) {
    guard.add(cur.id);
    criticalPath.unshift(cur.id);
    const def = def_(cur.id);
    cur = allPreds(def)
      .map((p) => nodes[p])
      .filter((p) => p.critical && p.ef === nodes[criticalPath[0]].es)
      .sort((a, b) => a.id.localeCompare(b.id))[0];
  }

  return { nodes, edges, criticalPath, projectDuration };
}

/**
 * Rows for a time-scaled logic diagram: critical tasks first, in path order,
 * then everything else packed into as few rows as possible without two boxes
 * overlapping in time.
 *
 * Layering by longest path is the textbook layout, and here it puts 13 of the 22
 * tasks in a single column and leaves the next four nearly empty. Laying them out
 * against the clock is no shorter — those 13 all start at minute zero either way
 * — but it reads left-to-right like the Gantt beside it, and it lets float be
 * drawn as a bar instead of written as a number.
 */
export function packRows(cpm: CpmResult, gapMin = 1): Record<string, number> {
  const row: Record<string, number> = {};
  const ends: number[] = [];

  const place = (id: string, fixedRow?: number) => {
    const n = cpm.nodes[id];
    if (fixedRow !== undefined) {
      row[id] = fixedRow;
      ends[fixedRow] = Math.max(ends[fixedRow] ?? -Infinity, n.lf);
      return;
    }
    let r = 0;
    while (r < ends.length && ends[r] + gapMin > n.es) r++;
    row[id] = r;
    // Reserve the BOX only. Float bars are drawn thin and may run under a later
    // box; reserving through `lf` would refuse to pack anything, because most
    // tasks here have enormous float.
    ends[r] = n.ef;
  };

  // The critical chain owns the top band, in order.
  cpm.criticalPath.forEach((id) => place(id, 0));
  ends[0] = cpm.projectDuration;

  const rest = Object.values(cpm.nodes)
    .filter((n) => !cpm.criticalPath.includes(n.id))
    .sort((a, b) => a.es - b.es || a.id.localeCompare(b.id));
  for (const n of rest) place(n.id);

  return row;
}
