// Draggable character token. Shown in the roster and on task cards.
// Clicking a distracted / on-call character nudges them (engine action).

import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { CHARACTERS } from '../../engine/content';
import { ACTIVITY_META, CHAR_META } from '../../content/charMeta';
import { useSimStore } from '../../state/simStore';
import type { CharId } from '../../engine/types';

export function CharacterChip({ charId }: { charId: CharId }) {
  const activity = useSimStore((s) => s.sim?.chars[charId].activity ?? 'idle');
  const dispatch = useSimStore((s) => s.dispatch);
  const selected = useSimStore((s) => s.selected);
  const setSelected = useSimStore((s) => s.setSelected);
  const meta = CHAR_META[charId];
  const act = ACTIVITY_META[activity];
  const isSelected = selected === charId;

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `chip-${charId}`,
    data: { charId },
  });

  return (
    <button
      ref={setNodeRef}
      style={{
        ['--chip-color' as string]: meta.color,
        transform: CSS.Translate.toString(transform),
      }}
      className={`chip ${isDragging ? 'dragging' : ''} ${act.nudgeable ? 'attention' : ''} ${
        isSelected ? 'selected' : ''
      }`}
      aria-label={`${CHARACTERS[charId].name} — ${act.label}. ${
        isSelected ? 'Selected — now choose a task.' : 'Drag to a task, or click to select.'
      }`}
      title={`${CHARACTERS[charId].name} — ${act.label}`}
      onClick={() => {
        if (act.nudgeable) dispatch({ type: 'nudge', charId });
        else setSelected(isSelected ? null : charId);
      }}
      {...listeners}
      {...attributes}
    >
      <span className="chip-avatar" aria-hidden>
        {meta.short}
      </span>
      {CHARACTERS[charId].name}
      {act.icon && (
        <span className="chip-status" role="img" aria-label={act.label}>
          {act.icon}
        </span>
      )}
    </button>
  );
}
