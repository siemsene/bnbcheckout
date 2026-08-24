// Draggable character token with a hover card (strengths / watch-outs) and an
// optional live productivity badge when assigned to a task.

import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { CHARACTERS } from '../../engine/content';
import { ACTIVITY_META, CHAR_HINTS, CHAR_META } from '../../content/charMeta';
import { useSimStore } from '../../state/simStore';
import type { CharId } from '../../engine/types';

export function CharacterChip({
  charId,
  mult,
}: {
  charId: CharId;
  /** Live personal productivity on the assigned task (null = not shown). */
  mult?: number | null;
}) {
  const activity = useSimStore((s) => s.sim?.chars[charId].activity ?? 'idle');
  const dispatch = useSimStore((s) => s.dispatch);
  const selected = useSimStore((s) => s.selected);
  const setSelected = useSimStore((s) => s.setSelected);
  const meta = CHAR_META[charId];
  const act = ACTIVITY_META[activity];
  const hints = CHAR_HINTS[charId];
  const isSelected = selected === charId;

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `chip-${charId}`,
    data: { charId },
  });

  const multBadge =
    mult != null && activity === 'working' ? (
      <span
        className={`chip-mult ${mult >= 1.15 ? 'good' : mult < 0.85 ? 'bad' : ''}`}
        title={`Current productivity ×${mult.toFixed(1)}`}
        aria-label={`productivity ${mult.toFixed(1)} times normal`}
      >
        ×{mult.toFixed(1)}
      </span>
    ) : null;

  return (
    <span className="chip-wrap">
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
        onClick={() => {
          if (act.nudgeable) dispatch({ type: 'nudge', charId });
          else setSelected(isSelected ? null : charId);
        }}
        {...listeners}
        {...attributes}
      >
        <span className="chip-avatar" aria-hidden>
          <img src={meta.front} alt="" />
        </span>
        {CHARACTERS[charId].name}
        {multBadge}
        {act.icon && (
          <span className="chip-status" role="img" aria-label={act.label}>
            {act.icon}
          </span>
        )}
      </button>
      <span className="chip-card" role="tooltip">
        <strong>{CHARACTERS[charId].name}</strong>
        <em>{CHARACTERS[charId].intro}</em>
        <span className="chip-card-list">
          {hints.strengths.map((h) => (
            <span key={h}>＋ {h}</span>
          ))}
          {hints.watchouts.map((h) => (
            <span key={h} className="watchout">
              − {h}
            </span>
          ))}
        </span>
      </span>
    </span>
  );
}
