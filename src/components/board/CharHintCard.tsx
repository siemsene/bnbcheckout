// A friend's public card — intro line, strengths, watch-outs — plus the hook
// that positions it. Shared by the round-1 roster chip and the round-2 plan
// board's lane headers, so the same card students learned to hover in run 1
// is where the run-2 decisions are made.

import { useCallback, useRef, useState } from 'react';
import { CHARACTERS } from '../../engine/content';
import { CHAR_HINTS } from '../../content/charMeta';
import type { CharId } from '../../engine/types';

/**
 * Measure-and-flip positioning for a fixed card. Fixed, not absolute: both
 * hosts scroll (the roster board and the plan overlay's card), and an absolute
 * card was clipped by their overflow. Flipping via `bottom` rather than `top`
 * means the card's height never has to be known in advance.
 */
export function useHoverCard<T extends HTMLElement>() {
  const wrapRef = useRef<T>(null);
  const [cardPos, setCardPos] = useState<React.CSSProperties | null>(null);
  const openCard = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = 260;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    const below = window.innerHeight - r.bottom;
    setCardPos(
      below < 260 && r.top > below
        ? { left, bottom: window.innerHeight - r.top + 6 }
        : { left, top: r.bottom + 6 },
    );
  }, []);
  const closeCard = useCallback(() => setCardPos(null), []);
  return { wrapRef, cardPos, openCard, closeCard };
}

export function CharHintCard({
  charId,
  style,
  children,
}: {
  charId: CharId;
  style: React.CSSProperties;
  /** Anything live the host wants under the public traits. */
  children?: React.ReactNode;
}) {
  const hints = CHAR_HINTS[charId];
  return (
    <span className="chip-card" role="tooltip" style={style}>
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
      {children}
    </span>
  );
}
