// Draggable character token with a hover card (strengths / watch-outs, plus a
// live breakdown of why they are working at the speed they are) and a
// productivity badge.

import { useCallback, useRef, useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { CHARACTERS, TASK_BY_ID } from '../../engine/content';
import { ACTIVITY_META, CHAR_HINTS, CHAR_META } from '../../content/charMeta';
import { useSimStore } from '../../state/simStore';
import type { BlockReason, CharId, MultExplain } from '../../engine/types';

/**
 * Why someone is producing nothing, in the player's language. The two hard
 * blocks carry their reason in the badge itself — nothing else on screen
 * shows them — while the transient ones defer to the activity icon already
 * on the chip.
 */
const BLOCK_TEXT: Record<BlockReason, { badge: string; long: string }> = {
  'no-licence': {
    badge: 'no licence',
    long: 'Can’t drive — no licence. Someone else has to take this one.',
  },
  'not-theirs': { badge: 'not theirs', long: 'This errand belongs to someone else.' },
  interrupted: { badge: '–', long: 'Just getting back to it.' },
  idle: { badge: '–', long: 'Not working on anything yet.' },
  walking: { badge: '–', long: 'Walking over — no work until they arrive.' },
  walkback: { badge: '–', long: 'Walking back from an abandoned trip.' },
  oncall: { badge: '–', long: 'On the phone. Click to nudge them.' },
  distracted: { badge: '–', long: 'Distracted. Click to nudge them.' },
  atdoor: { badge: '–', long: 'Stuck talking to the neighbour. Click to nudge them.' },
  toilet: { badge: '–', long: 'Indisposed. Nudging will not help.' },
};

export function CharacterChip({
  charId,
  explain,
}: {
  charId: CharId;
  /** Live productivity breakdown on the assigned task (null = not shown). */
  explain?: MultExplain | null;
}) {
  const activity = useSimStore((s) => s.sim?.chars[charId].activity ?? 'idle');
  const taskId = useSimStore((s) => s.sim?.chars[charId].taskId);
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

  // The card is positioned fixed, from measured coordinates, because the board
  // it sits in scrolls (`overflow-y: auto`) and an absolutely positioned card
  // was clipped by it — which is why the productivity breakdown was cut off.
  const wrapRef = useRef<HTMLSpanElement>(null);
  const [cardPos, setCardPos] = useState<React.CSSProperties | null>(null);
  const openCard = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = 260;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    const below = window.innerHeight - r.bottom;
    // Flipping via `bottom` rather than `top` means the card's height never has
    // to be known in advance.
    setCardPos(
      below < 260 && r.top > below
        ? { left, bottom: window.innerHeight - r.top + 6 }
        : { left, top: r.bottom + 6 },
    );
  }, []);
  const closeCard = useCallback(() => setCardPos(null), []);

  const blocked = explain && 'blocked' in explain ? explain.blocked : null;
  const terms = explain && 'terms' in explain ? explain.terms : null;
  const value = explain && 'terms' in explain ? explain.value : null;

  // Colour on the STEADY-STATE rate, not the current one. A friend who just
  // arrived is at half speed for two sim-minutes; painting that red says "wrong
  // person" when the truth is "give them a moment".
  const steady = terms
    ? terms.reduce((m, t) => (t.key === 'learning' ? m : m * t.factor), 1)
    : null;
  const warming = !!terms?.some((t) => t.key === 'learning');

  let badge: React.ReactNode = null;
  if (blocked) {
    badge = (
      <span className="chip-mult blocked" title={BLOCK_TEXT[blocked].long}>
        {BLOCK_TEXT[blocked].badge}
      </span>
    );
  } else if (value != null) {
    badge = (
      // The warming glyph gets a slot whether or not it is showing. It used to
      // be inserted and removed as the friend warmed up, which resized the chip
      // — and with the multiplier changing every tick, the whole roster twitched.
      <span
        className={`chip-mult ${steady! >= 1.15 ? 'good' : steady! < 0.85 ? 'bad' : ''}`}
        aria-label={`working at ${value.toFixed(1)} times normal speed${
          warming ? ', still warming up' : ''
        }`}
      >
        <span className="chip-mult-flag" aria-hidden>
          {warming ? '⏳' : ''}
        </span>
        ×{value.toFixed(1)}
      </span>
    );
  }

  return (
    <span
      className="chip-wrap"
      ref={wrapRef}
      onMouseEnter={openCard}
      onMouseLeave={closeCard}
      onFocusCapture={openCard}
      onBlurCapture={closeCard}
    >
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
          isSelected
            ? 'Selected — now choose a task.'
            : 'Drag to a task, or click to select.'
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
        {badge}
        {/* Rendered even when empty: the icon coming and going as someone
            starts walking or takes a call resized the chip mid-run. */}
        <span
          className="chip-status"
          role={act.icon ? 'img' : undefined}
          aria-label={act.icon ? act.label : undefined}
        >
          {act.icon}
        </span>
      </button>
      {cardPos && !isDragging && (
      <span className="chip-card" role="tooltip" style={cardPos}>
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

        {/* The live half: exactly the factors the engine is multiplying. */}
        {(blocked || terms) && taskId && (
          <span className="chip-breakdown">
            <span className="chip-breakdown-head">
              On {TASK_BY_ID[taskId]?.name ?? taskId}
            </span>
            {blocked ? (
              <span className="chip-breakdown-blocked">{BLOCK_TEXT[blocked].long}</span>
            ) : (
              <>
                {terms!.length === 0 && (
                  <span className="chip-breakdown-row">
                    <span>Nothing helping or hindering</span>
                    <b>×1.00</b>
                  </span>
                )}
                {terms!.map((t) => (
                  <span key={t.key} className="chip-breakdown-row">
                    <span>
                      {t.label}
                      {t.hint && <i> — {t.hint}</i>}
                    </span>
                    <b className={t.factor > 1 ? 'up' : 'down'}>
                      ×{t.factor.toFixed(2)}
                    </b>
                  </span>
                ))}
                <span className="chip-breakdown-row total">
                  <span>Working speed</span>
                  <b>×{value!.toFixed(2)}</b>
                </span>
              </>
            )}
          </span>
        )}
      </span>
      )}
    </span>
  );
}
