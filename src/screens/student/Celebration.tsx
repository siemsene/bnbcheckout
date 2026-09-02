// Confetti burst on finishing checkout. Pure CSS animation, plays ONCE on
// mount (never loops beside the results text), fully skipped when motion is
// reduced. Gentle drift — nowhere near the 3-flashes/sec limit.

import { useEffect, useState } from 'react';
import { useMotionStore } from '../../state/motionStore';

const COLORS = ['#4a7c59', '#d9884a', '#5b8db8', '#c76b8e', '#d9b64a'];
const PIECES = 60;

export function Celebration() {
  const [gone, setGone] = useState(false);
  const reduced = useMotionStore((s) => s.reduced);

  useEffect(() => {
    if (reduced) return;
    const t = setTimeout(() => setGone(true), 4200);
    return () => clearTimeout(t);
  }, [reduced]);

  if (reduced || gone) return null;

  return (
    <div aria-hidden style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 200, overflow: 'hidden' }}>
      <style>{`
        @keyframes confetti-fall {
          0% { transform: translateY(-6vh) rotate(0deg); opacity: 1; }
          85% { opacity: 1; }
          100% { transform: translateY(105vh) rotate(720deg); opacity: 0; }
        }
      `}</style>
      {Array.from({ length: PIECES }, (_, i) => {
        const left = (i * 61) % 100;
        const delay = ((i * 37) % 100) / 70;
        const dur = 2.6 + ((i * 13) % 10) / 8;
        const size = 6 + ((i * 7) % 8);
        return (
          <span
            key={i}
            style={{
              position: 'absolute',
              left: `${left}%`,
              top: 0,
              width: size,
              height: size * 0.6,
              background: COLORS[i % COLORS.length],
              borderRadius: 2,
              animation: `confetti-fall ${dur}s ${delay}s ease-in forwards`,
              transform: 'translateY(-6vh)',
            }}
          />
        );
      })}
    </div>
  );
}
