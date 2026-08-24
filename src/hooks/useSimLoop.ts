// Drives the fixed-timestep loop. rAF gives smooth foreground updates; a
// setInterval backstop keeps sim time flowing when the browser throttles rAF
// (background tab / unfocused window). Both feed the same wall-clock delta,
// so ticks are never double-counted.

import { useEffect } from 'react';
import { useSimStore } from '../state/simStore';

export function useSimLoop() {
  const advance = useSimStore((s) => s.advance);

  useEffect(() => {
    let last = performance.now();
    const pump = () => {
      const now = performance.now();
      advance(now - last);
      last = now;
    };
    let raf = 0;
    const frame = () => {
      pump();
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    const interval = window.setInterval(pump, 500);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(interval);
    };
  }, [advance]);
}
