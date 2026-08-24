// The assignment chart: roster of draggable friends + task list grouped by
// status. Dropping a chip on a task assigns; dropping it on the roster
// unassigns. DndContext lives in SimScreen so scene drags could join later.

import { useDroppable } from '@dnd-kit/core';
import { TASKS } from '../../engine/content';
import { useSimStore } from '../../state/simStore';
import { CharacterChip } from './CharacterChip';
import { TaskCard } from './TaskCard';
import { CHAR_IDS } from '../../engine/content';

export function AssignmentBoard() {
  useSimStore((s) => s.version);
  const sim = useSimStore((s) => s.sim);
  const selected = useSimStore((s) => s.selected);
  const setSelected = useSimStore((s) => s.setSelected);
  const dispatch = useSimStore((s) => s.dispatch);
  const { setNodeRef, isOver } = useDroppable({ id: 'roster', data: { roster: true } });
  if (!sim) return null;

  const unassignSelected = () => {
    if (!selected) return;
    dispatch({ type: 'unassign', charId: selected });
    setSelected(null);
  };

  const unassigned = CHAR_IDS.filter((c) => !sim.chars[c].taskId);
  const groups = {
    inProgress: TASKS.filter(
      (t) => sim.tasks[t.id].status === 'open' && sim.tasks[t.id].assignees.length > 0,
    ),
    ready: TASKS.filter(
      (t) => sim.tasks[t.id].status === 'open' && sim.tasks[t.id].assignees.length === 0,
    ),
    locked: TASKS.filter((t) => sim.tasks[t.id].status === 'locked'),
    done: TASKS.filter((t) => sim.tasks[t.id].status === 'done'),
  };

  return (
    <section className="panel board" aria-label="Assignment chart">
      <div
        ref={setNodeRef}
        className="board-roster"
        style={
          isOver || (selected && sim.chars[selected].taskId)
            ? { outline: '2px dashed var(--accent)' }
            : undefined
        }
        aria-label="Unassigned friends — drop here (or click while a friend is selected) to unassign"
        onClick={(e) => {
          if (e.target === e.currentTarget) unassignSelected();
        }}
      >
        {unassigned.length === 0 && (
          <span style={{ fontSize: '0.8rem', color: 'var(--ink-soft)', padding: '4px' }}>
            Everyone is assigned — drop a friend here to unassign.
          </span>
        )}
        {unassigned.map((c) => (
          <CharacterChip key={c} charId={c} />
        ))}
      </div>

      {groups.inProgress.length > 0 && (
        <div className="board-group">
          <h3>In progress</h3>
          <div className="board-tasks">
            {groups.inProgress.map((t) => (
              <TaskCard key={t.id} taskId={t.id} />
            ))}
          </div>
        </div>
      )}
      <div className="board-group">
        <h3>Ready</h3>
        <div className="board-tasks">
          {groups.ready.map((t) => (
            <TaskCard key={t.id} taskId={t.id} />
          ))}
        </div>
      </div>
      {groups.locked.length > 0 && (
        <div className="board-group">
          <h3>Locked</h3>
          <div className="board-tasks">
            {groups.locked.map((t) => (
              <TaskCard key={t.id} taskId={t.id} />
            ))}
          </div>
        </div>
      )}
      {groups.done.length > 0 && (
        <div className="board-group">
          <h3>Done</h3>
          <div className="board-tasks">
            {groups.done.map((t) => (
              <TaskCard key={t.id} taskId={t.id} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
