// One task row: icon, name, estimate + crew size, progress, assignees with
// live productivity, drop target for chips.

import { useDroppable } from '@dnd-kit/core';
import { TASK_BY_ID } from '../../engine/content';
import { personalMult } from '../../engine/step';
import { useSimStore } from '../../state/simStore';
import { CharacterChip } from './CharacterChip';
import { TaskIcon } from './TaskIcon';

export function TaskCard({ taskId }: { taskId: string }) {
  useSimStore((s) => s.version); // re-render on tick batches
  const sim = useSimStore((s) => s.sim);
  const selected = useSimStore((s) => s.selected);
  const setSelected = useSimStore((s) => s.setSelected);
  const dispatch = useSimStore((s) => s.dispatch);
  const { isOver, setNodeRef, active } = useDroppable({
    id: `task-${taskId}`,
    data: { taskId },
    disabled: sim?.tasks[taskId].status !== 'open',
  });
  if (!sim) return null;

  const def = TASK_BY_ID[taskId];
  const task = sim.tasks[taskId];

  const full = task.assignees.length >= def.maxWorkers;
  const canReceive = selected !== null && task.status === 'open' && !full;
  const pct = Math.min(100, (task.workDone / task.workRequired) * 100);
  const unmet = (def.preds ?? [])
    .filter((p) => sim.tasks[p].status !== 'done')
    .map((p) => TASK_BY_ID[p].name);
  const anyMet = !def.predsAny || def.predsAny.some((p) => sim.tasks[p].status === 'done');
  if (!anyMet && def.predsAny) unmet.push(`any of: ${def.predsAny.map((p) => TASK_BY_ID[p].name).join(' / ')}`);

  const dropClass =
    isOver && active ? (full ? 'drop-full' : 'drop-ok') : '';

  const assignSelected = () => {
    if (!canReceive || !selected) return;
    dispatch({ type: 'assign', charId: selected, taskId });
    setSelected(null);
  };

  return (
    <div
      ref={setNodeRef}
      className={`task-card ${task.status} ${dropClass} ${canReceive ? 'assignable' : ''}`}
      aria-label={`${def.name}, ${task.status === 'done' ? 'done' : `${Math.round(pct)}% complete`}${
        canReceive ? '. Press Enter to assign the selected friend.' : ''
      }`}
      role={canReceive ? 'button' : undefined}
      tabIndex={canReceive ? 0 : undefined}
      onClick={assignSelected}
      onKeyDown={(e) => {
        if (canReceive && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          assignSelected();
        }
      }}
    >
      <TaskIcon taskId={taskId} />
      <div>
        <div className="task-name">
          {task.status === 'locked' && <span aria-hidden>🔒 </span>}
          {def.name}
          {task.reworkCount > 0 && task.status !== 'done' && (
            <span title="rework!" aria-label="needs rework"> ↩</span>
          )}
        </div>
        <div className="task-est" aria-label={`Estimated about ${def.baseMinutes} minutes; ${
          def.minWorkers === 5 ? 'needs all five' : `up to ${def.maxWorkers} ${def.maxWorkers === 1 ? 'person' : 'people'}`
        }`}>
          ~{def.baseMinutes}′ ·{' '}
          {def.minWorkers === 5 ? 'all 5 together' : `${'👤'.repeat(def.maxWorkers)} up to ${def.maxWorkers}`}
          {def.travel && ' · 🚶 away from the house'}
          {task.assignees.length > 1 && def.minWorkers !== 5 && (
            <span title="Combined output of the crew vs one person — more hands help, but not linearly">
              {' '}· crew output ×
              {(def.multiWorkerFactors ?? [0, 1, 1.7, 2.1])[
                Math.min(task.assignees.length, (def.multiWorkerFactors ?? [0, 1, 1.7, 2.1]).length - 1)
              ].toFixed(1)}
            </span>
          )}
        </div>
      </div>
      <div className="task-assignees">
        {task.assignees.map((c) => (
          <CharacterChip key={c} charId={c} mult={personalMult(sim, c)} />
        ))}
        {task.status === 'open' && task.assignees.length === 0 && (
          <span style={{ fontSize: '0.75rem', color: 'var(--ink-soft)' }}>
            drop a friend here
          </span>
        )}
      </div>
      {task.status === 'locked' ? (
        <div className="task-lockinfo">Waiting on: {unmet.join(', ')}</div>
      ) : (
        <>
          <div className="task-blurb">{def.blurb}</div>
          {task.status !== 'done' && (
            <div
              className={`task-progress ${task.reworkCount > 0 ? 'rework' : ''}`}
              role="progressbar"
              aria-valuenow={Math.round(pct)}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div style={{ width: `${pct}%` }} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
