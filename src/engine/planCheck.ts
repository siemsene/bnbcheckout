// Plan validation: the things a student can get wrong that the projection alone
// would not explain.
//
// The projected Gantt shows *what* a plan does; these say *why*. A plan that
// leaves the living room unqueued simply never finishes, and staring at a
// truncated Gantt does not tell you which of 22 tasks you forgot.
//
// Errors are "this plan cannot finish". Warnings are "this will cost you".
// Neither blocks committing a plan — students are allowed to run a bad plan and
// watch it fail, which is most of the point.

import { CHARACTERS, CHAR_IDS, TASKS, TASK_BY_ID } from './content';
import { eligible } from './dispatch';
import type { CharId, Plan } from './types';

export type PlanIssueLevel = 'error' | 'warn';

export interface PlanIssue {
  level: PlanIssueLevel;
  /** Stable key, so the UI can dedupe and link to the offending row. */
  key: string;
  taskId?: string;
  charId?: CharId;
  text: string;
}

export function checkPlan(plan: Plan): PlanIssue[] {
  const issues: PlanIssue[] = [];
  const queuedBy = (taskId: string) =>
    CHAR_IDS.filter((c) => (plan.queues[c] ?? []).includes(taskId));

  for (const def of TASKS) {
    const holders = queuedBy(def.id);

    // 1. Nobody is doing it at all.
    if (holders.length === 0) {
      issues.push({
        level: 'error',
        key: `unassigned:${def.id}`,
        taskId: def.id,
        text: `Nobody is down to do ${def.name}. The morning cannot finish without it.`,
      });
      continue;
    }

    // 2. Somebody is down for something they physically cannot do. The engine
    //    would refuse it at run time, so the lane is quietly a no-op.
    for (const c of holders) {
      if (eligible(c, def.id)) continue;
      const why = def.onlyChars
        ? `${def.name} is ${def.onlyChars.map((o) => CHARACTERS[o].name).join(' or ')}’s own errand`
        : `${CHARACTERS[c].name} cannot drive`;
      issues.push({
        level: 'error',
        key: `ineligible:${def.id}:${c}`,
        taskId: def.id,
        charId: c,
        text: `${CHARACTERS[c].name} is down for ${def.name}, but ${why}.`,
      });
    }

    // 3. A crew barrier fewer people than it needs have signed up for. It can
    //    never fire, so everything behind it stalls.
    const need = def.minWorkers ?? 1;
    if (need > 1 && holders.length < need) {
      issues.push({
        level: 'error',
        key: `barrier:${def.id}`,
        taskId: def.id,
        text:
          `${def.name} needs all ${need} of them at once, but only ` +
          `${holders.length} ${holders.length === 1 ? 'is' : 'are'} down for it.`,
      });
    }

    // 3b. More hands signed up than the job has room for. Not fatal — the
    //     dispatcher refuses the extra slot and sends that person down their
    //     own queue instead — but the lane does not run the way it reads, and
    //     their block never starts. The board caps crews, so this can only
    //     arrive from a plan built before it did.
    if (holders.length > def.maxWorkers) {
      const spare = holders.length - def.maxWorkers;
      issues.push({
        level: 'warn',
        key: `crowded:${def.id}`,
        taskId: def.id,
        text:
          `${holders.length} people are down for ${def.name}, but only ` +
          `${def.maxWorkers} can work on it at once. ${
            spare === 1 ? 'One of them' : `${spare} of them`
          } will skip it and get on with their next job.`,
      });
    }
  }

  // 4. Order within a lane that contradicts the task graph. Not fatal — the
  //    dispatcher skips a locked task and comes back — but it means the lane
  //    will not run the way it reads, which is worth knowing while planning.
  for (const c of CHAR_IDS) {
    const q = plan.queues[c] ?? [];
    q.forEach((taskId, i) => {
      const def = TASK_BY_ID[taskId];
      if (!def) return;
      for (const p of def.preds ?? []) {
        const at = q.indexOf(p);
        if (at > i) {
          issues.push({
            level: 'warn',
            key: `order:${c}:${taskId}`,
            taskId,
            charId: c,
            text:
              `${CHARACTERS[c].name} has ${def.name} before ${TASK_BY_ID[p].name}, ` +
              `which has to happen first. They will do it later than the lane suggests.`,
          });
          return;
        }
      }
    });
  }

  // 5. An empty lane is almost always an oversight rather than a decision.
  for (const c of CHAR_IDS) {
    if ((plan.queues[c] ?? []).length === 0) {
      issues.push({
        level: 'warn',
        key: `idle:${c}`,
        charId: c,
        text: `${CHARACTERS[c].name} has nothing planned and will stand around all morning.`,
      });
    }
  }

  return issues;
}

/** An empty plan for the lane editor to start from. */
export function emptyPlan(): Plan {
  const queues = {} as Record<CharId, string[]>;
  for (const c of CHAR_IDS) queues[c] = [];
  return { queues, rev: 0 };
}
