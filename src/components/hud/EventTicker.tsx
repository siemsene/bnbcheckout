// Text log of everything that happens — the accessible mirror of bubbles and
// scene animation (aria-live), and the "color is never the only signal" backstop.

import { useSimStore } from '../../state/simStore';

export function EventTicker() {
  const ticker = useSimStore((s) => s.ticker);

  return (
    <div className="ticker" aria-live="polite" aria-label="Event log">
      {[...ticker].reverse().map((e) => (
        <div key={e.id} className={`ticker-${e.kind}`}>
          <span style={{ opacity: 0.6 }}>[{e.simMinute}′]</span> {e.text}
        </div>
      ))}
    </div>
  );
}
