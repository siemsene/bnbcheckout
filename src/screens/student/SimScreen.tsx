// The main play screen: HUD + assignment board + house scene + ticker.
// DndContext handles chip -> task drops (pointer and keyboard).

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { useSimLoop } from '../../hooks/useSimLoop';
import { useSimStore } from '../../state/simStore';
import { AssignmentBoard } from '../../components/board/AssignmentBoard';
import { HouseScene } from '../../components/scene/HouseScene';
import { HUD } from '../../components/hud/HUD';
import { EventTicker } from '../../components/hud/EventTicker';
import type { CharId } from '../../engine/types';

export function SimScreen() {
  useSimLoop();
  const phase = useSimStore((s) => s.phase);
  const startClock = useSimStore((s) => s.startClock);
  const dispatch = useSimStore((s) => s.dispatch);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  function onDragEnd(ev: DragEndEvent) {
    const charId = ev.active.data.current?.charId as CharId | undefined;
    if (!charId || !ev.over) return;
    const overData = ev.over.data.current as { taskId?: string; roster?: boolean };
    if (overData?.taskId) {
      dispatch({ type: 'assign', charId, taskId: overData.taskId });
    } else if (overData?.roster) {
      dispatch({ type: 'unassign', charId });
    }
  }

  return (
    <div className="sim-layout">
      <HUD />
      {phase === 'planning' && (
        <div
          className="panel"
          style={{
            padding: '8px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            background: '#fdf3dd',
          }}
        >
          <strong>Planning time</strong>
          <span style={{ color: 'var(--ink-soft)', flex: 1 }}>
            The clock is frozen. Stage your first assignments, then start the morning.
          </span>
          <button className="btn-big" onClick={startClock}>
            ▶ Start the clock
          </button>
        </div>
      )}
      <div className="sim-main">
        <DndContext sensors={sensors} onDragEnd={onDragEnd}>
          <AssignmentBoard />
        </DndContext>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0 }}>
          <HouseScene />
          <div className="panel" style={{ flexShrink: 0 }}>
            <EventTicker />
          </div>
        </div>
      </div>
    </div>
  );
}
